import path from 'node:path';
import fs from 'fs/promises';
import fsSync from 'node:fs';
import type { PortfolioDoc } from './storage.js';
import {
  closeAppPortfolioDb,
  defaultEmptyMeta,
  getAppPortfolioDbPath,
  openAppPortfolioDb,
  readPortfolioMeta,
  writePortfolioMeta,
  type PortfolioMetaDoc,
} from './portfolioCardsRepository.js';

export type BackupSettings = {
  intervalDays: number;
  retainSql: number;
  retainJson: number;
  enabledSql: boolean;
  enabledJson: boolean;
  lastRunAt: number;
};

const DEFAULT_BACKUP: BackupSettings = {
  intervalDays: 7,
  retainSql: 8,
  retainJson: 8,
  enabledSql: true,
  enabledJson: true,
  lastRunAt: 0,
};

export const mergeBackupSettings = (raw: unknown): BackupSettings => {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    intervalDays:
      typeof o.intervalDays === 'number' && Number.isFinite(o.intervalDays) && o.intervalDays >= 1
        ? Math.min(365, Math.floor(o.intervalDays))
        : DEFAULT_BACKUP.intervalDays,
    retainSql:
      typeof o.retainSql === 'number' && Number.isFinite(o.retainSql) && o.retainSql >= 1
        ? Math.min(100, Math.floor(o.retainSql))
        : DEFAULT_BACKUP.retainSql,
    retainJson:
      typeof o.retainJson === 'number' && Number.isFinite(o.retainJson) && o.retainJson >= 1
        ? Math.min(100, Math.floor(o.retainJson))
        : DEFAULT_BACKUP.retainJson,
    enabledSql: o.enabledSql !== false,
    enabledJson: o.enabledJson !== false,
    lastRunAt:
      typeof o.lastRunAt === 'number' && Number.isFinite(o.lastRunAt) ? o.lastRunAt : DEFAULT_BACKUP.lastRunAt,
  };
};

export const getBackupSettingsFromMeta = (meta: PortfolioMetaDoc | null): BackupSettings =>
  mergeBackupSettings(meta?.backupSettings);

export const rotatingBackupRoot = (dataDir: string): string =>
  path.join(dataDir, 'portfolio-rotating-backups');

export const sqlBackupDir = (dataDir: string): string => path.join(rotatingBackupRoot(dataDir), 'sql');

export const jsonBackupDir = (dataDir: string): string => path.join(rotatingBackupRoot(dataDir), 'json');

const isoStamp = (): string => new Date().toISOString().replace(/[:.]/g, '-');

async function ensureDirs(dataDir: string): Promise<void> {
  await fs.mkdir(sqlBackupDir(dataDir), { recursive: true });
  await fs.mkdir(jsonBackupDir(dataDir), { recursive: true });
}

async function pruneDir(dir: string, retain: number, ext: string): Promise<number> {
  let removed = 0;
  try {
    const names = await fs.readdir(dir);
    const files = names.filter((n) => n.endsWith(ext));
    const stats = await Promise.all(
      files.map(async (name) => {
        const p = path.join(dir, name);
        const st = await fs.stat(p).catch(() => null);
        return st ? { name, p, mtime: st.mtimeMs } : null;
      })
    );
    const sorted = stats.filter(Boolean).sort((a, b) => (b!.mtime > a!.mtime ? 1 : -1)) as Array<{
      name: string;
      p: string;
      mtime: number;
    }>;
    const drop = sorted.slice(retain);
    for (const f of drop) {
      await fs.unlink(f.p).catch(() => {});
      removed += 1;
    }
  } catch {
    /* ignore */
  }
  return removed;
}

/** Export full portfolio doc from v2 row store (for JSON backup / portability). */
export const exportPortfolioDocFromV2 = (dataDir: string): PortfolioDoc => {
  const meta = readPortfolioMeta(dataDir) ?? defaultEmptyMeta();
  const db = openAppPortfolioDb(dataDir);
  const rows = db.prepare('SELECT payload_json FROM cards').all() as Array<{ payload_json: string }>;
  const cards: unknown[] = [];
  for (const r of rows) {
    try {
      cards.push(JSON.parse(r.payload_json));
    } catch {
      /* skip */
    }
  }
  const raw = meta as Record<string, unknown>;
  return {
    version: typeof raw.version === 'number' ? raw.version : 1,
    updatedAt: Date.now(),
    fees: raw.fees,
    collections: raw.collections,
    filters: raw.filters,
    sort: raw.sort,
    psaToken: raw.psaToken,
    nebulaOpen: raw.nebulaOpen,
    extensionLatestOnlyMode: raw.extensionLatestOnlyMode,
    hunts: raw.hunts,
    targets: raw.targets,
    cards,
  } as PortfolioDoc;
};

export type RotatingBackupResult = {
  sqlPath?: string;
  jsonPath?: string;
  prunedSql: number;
  prunedJson: number;
  skipped: boolean;
  reason?: string;
};

/**
 * Create SQL + JSON rotating backups when due (or when force=true).
 * Updates meta.backupSettings.lastRunAt on success.
 */
export const runRotatingPortfolioBackups = async (
  dataDir: string,
  opts?: { force?: boolean }
): Promise<RotatingBackupResult> => {
  await ensureDirs(dataDir);
  const meta = readPortfolioMeta(dataDir) ?? defaultEmptyMeta();
  const settings = getBackupSettingsFromMeta(meta);
  const now = Date.now();
  const intervalMs = settings.intervalDays * 86_400_000;
  const due =
    opts?.force === true ||
    settings.lastRunAt <= 0 ||
    now - settings.lastRunAt >= intervalMs;

  if (!due) {
    return { skipped: true, reason: 'interval_not_reached', prunedSql: 0, prunedJson: 0 };
  }

  if (!settings.enabledSql && !settings.enabledJson) {
    const nextMeta = { ...meta, backupSettings: { ...settings, lastRunAt: now } };
    writePortfolioMeta(dataDir, nextMeta);
    return { skipped: true, reason: 'both_disabled', prunedSql: 0, prunedJson: 0 };
  }

  let sqlPath: string | undefined;
  let jsonPath: string | undefined;

  const stamp = isoStamp();
  const liveDb = getAppPortfolioDbPath(dataDir);

  if (settings.enabledSql && fsSync.existsSync(liveDb)) {
    const dest = path.join(sqlBackupDir(dataDir), `portfolio-${stamp}.db`);
    await fs.copyFile(liveDb, dest);
    sqlPath = dest;
  }

  if (settings.enabledJson) {
    const doc = exportPortfolioDocFromV2(dataDir);
    const dest = path.join(jsonBackupDir(dataDir), `portfolio-${stamp}.json`);
    const tmp = `${dest}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(doc, null, 2), 'utf8');
    await fs.rename(tmp, dest);
    jsonPath = dest;
  }

  const prunedSql = settings.enabledSql ? await pruneDir(sqlBackupDir(dataDir), settings.retainSql, '.db') : 0;
  const prunedJson = settings.enabledJson ? await pruneDir(jsonBackupDir(dataDir), settings.retainJson, '.json') : 0;

  const nextMeta = {
    ...meta,
    backupSettings: { ...settings, lastRunAt: now },
  };
  writePortfolioMeta(dataDir, nextMeta);

  return { sqlPath, jsonPath, prunedSql, prunedJson, skipped: false };
};

export type BackupListEntry = { name: string; path: string; bytes: number; mtimeMs: number };

export const listRotatingBackups = async (
  dataDir: string
): Promise<{ sql: BackupListEntry[]; json: BackupListEntry[]; sqlDir: string; jsonDir: string }> => {
  const sdir = sqlBackupDir(dataDir);
  const jdir = jsonBackupDir(dataDir);
  const readOne = async (dir: string, ext: string): Promise<BackupListEntry[]> => {
    try {
      const names = await fs.readdir(dir);
      const out: BackupListEntry[] = [];
      for (const name of names.filter((n) => n.endsWith(ext))) {
        const p = path.join(dir, name);
        const st = await fs.stat(p).catch(() => null);
        if (!st) continue;
        out.push({ name, path: p, bytes: st.size, mtimeMs: st.mtimeMs });
      }
      return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
    } catch {
      return [];
    }
  };
  return {
    sqlDir: sdir,
    jsonDir: jdir,
    sql: await readOne(sdir, '.db'),
    json: await readOne(jdir, '.json'),
  };
};

/** Restore live portfolio.db from a backup file name under sql backup dir. Closes DB pool first. */
export const restorePortfolioDbFromSqlBackup = async (
  dataDir: string,
  backupFileName: string
): Promise<void> => {
  const safe = path.basename(backupFileName);
  if (!safe || safe !== backupFileName || !safe.endsWith('.db')) {
    throw new Error('Invalid backup file name.');
  }
  const src = path.join(sqlBackupDir(dataDir), safe);
  if (!fsSync.existsSync(src)) throw new Error('Backup file not found.');
  const dest = getAppPortfolioDbPath(dataDir);
  closeAppPortfolioDb(dataDir);
  await fs.copyFile(src, dest);
};
