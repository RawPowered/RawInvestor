import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Durable JSON-on-disk storage for the portfolio.
 *
 * The client used to persist everything in `localStorage`, which ties the
 * data to a single browser profile and disappears the moment a user clears
 * site data. This module gives us a real file on disk the client syncs to:
 *
 *   <repo>/server/data/portfolio.json        <- source of truth (legacy mirror)
 *   Dated JSON snapshots live in a dedicated vault dir (PCGR_BACKUPS_DIR), by default
 *   sibling to data/: ../portfolio-backups-vault/ — kept separate so Electron factory reset
 *   can wipe runtime-data without deleting restore points.
 *
 * Writes are atomic (write to a `.tmp` sibling, then rename). A daily
 * backup copy is produced on the first successful write of each UTC day
 * and the backup directory is pruned to the most recent N files.
 */

export type PortfolioDoc = {
  /** Schema version - bump when the shape changes so the client can migrate. */
  version: number;
  /** Epoch ms of the most recent successful write. 0 = never written. */
  updatedAt: number;
  /** Anything the client wants us to remember; we don't interpret it. The
   *  client owns the shape; the server only persists. */
  [key: string]: unknown;
};

export const CURRENT_VERSION = 1;
export const EMPTY_DOC: PortfolioDoc = Object.freeze({
  version: CURRENT_VERSION,
  updatedAt: 0,
});

const MAX_BACKUPS = 30;

export type StorageOptions = {
  /** Where to put `portfolio.json`. Legacy `backups/` may still exist here for reads. */
  dataDir: string;
  /** Max number of dated backup files to keep. Defaults to 30. */
  maxBackups?: number;
  /**
   * Directory for dated `portfolio-YYYY-MM-DD.json` snapshots (append-only style rotation).
   * Default: resolved sibling `portfolio-backups-vault` next to `dataDir`.
   */
  backupDir?: string;
};

export class Storage {
  readonly dataFile: string;
  readonly backupDir: string;
  private readonly maxBackups: number;

  constructor(opts: StorageOptions) {
    this.dataFile = path.join(opts.dataDir, 'portfolio.json');
    this.backupDir =
      opts.backupDir ??
      path.resolve(opts.dataDir, '..', 'portfolio-backups-vault');
    this.maxBackups = opts.maxBackups ?? MAX_BACKUPS;
  }

  /** Older installs wrote under `<dataDir>/backups`. Merge listing with vault for restore UX. */
  private legacyBackupDir(): string {
    return path.join(path.dirname(this.dataFile), 'backups');
  }

  /**
   * Load the portfolio file. Returns `EMPTY_DOC` when the file doesn't exist
   * yet (fresh install) or contains something that isn't a parseable object.
   */
  async read(): Promise<PortfolioDoc> {
    try {
      const raw = await fs.readFile(this.dataFile, 'utf-8');
      const parsed = this.parsePortfolioJson(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ...EMPTY_DOC };
      }
      const doc = parsed as PortfolioDoc;
      return {
        ...doc,
        version: typeof doc.version === 'number' ? doc.version : CURRENT_VERSION,
        updatedAt: typeof doc.updatedAt === 'number' ? doc.updatedAt : 0,
      };
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === 'ENOENT') return { ...EMPTY_DOC };
      throw err;
    }
  }

  /**
   * Parse portfolio JSON with a small recovery path for files that have
   * trailing garbage bytes after a valid JSON object.
   */
  private parsePortfolioJson(raw: string): unknown {
    try {
      return JSON.parse(raw);
    } catch (err) {
      const trimmed = raw.trim();
      const first = trimmed.indexOf('{');
      const last = trimmed.lastIndexOf('}');
      if (first >= 0 && last > first) {
        const candidate = trimmed.slice(first, last + 1);
        try {
          return JSON.parse(candidate);
        } catch {
          // fall through to original error
        }
      }
      throw err;
    }
  }

  /**
   * Atomically replace the portfolio file with `patch` merged over whatever
   * is on disk. `updatedAt` is stamped server-side so clock drift between
   * multiple clients can't trick a later write into losing to an earlier one.
   */
  /**
   * @param authoritativeBase When provided (e.g. SQLite snapshot), merge the patch
   *   onto this doc instead of only `portfolio.json`. Keeps PUT aligned with GET when
   *   the embedded DB is ahead of or divergent from the JSON file.
   */
  async write(
    patch: Record<string, unknown>,
    now: number = Date.now(),
    authoritativeBase?: PortfolioDoc | null
  ): Promise<PortfolioDoc> {
    const current = authoritativeBase != null ? authoritativeBase : await this.read();
    const next: PortfolioDoc = {
      ...current,
      ...patch,
      version: CURRENT_VERSION,
      updatedAt: now,
    };
    await fs.mkdir(path.dirname(this.dataFile), { recursive: true });
    const tmp = this.dataFile + '.tmp';
    const body = JSON.stringify(next, null, 2);
    await fs.writeFile(tmp, body, 'utf-8');
    // rename is atomic on the same filesystem on every OS we care about.
    await fs.rename(tmp, this.dataFile);
    await this.rotateBackups(body, now);
    return next;
  }

  /**
   * Ensure a dated backup exists for today. Uses the same JSON body we just
   * wrote (so the backup always matches the authoritative file). No-ops if a
   * backup for today already exists - we keep at most one per UTC day.
   */
  private async rotateBackups(body: string, now: number): Promise<void> {
    const day = new Date(now).toISOString().slice(0, 10);
    const backupFile = path.join(this.backupDir, `portfolio-${day}.json`);
    try {
      await fs.mkdir(this.backupDir, { recursive: true });
      try {
        await fs.access(backupFile);
        return; // already written today
      } catch {
        /* ENOENT - fall through and create it */
      }
      await fs.writeFile(backupFile, body, 'utf-8');

      // Prune oldest backups beyond the cap. File names sort chronologically
      // because the date suffix is ISO (YYYY-MM-DD).
      const files = (await fs.readdir(this.backupDir))
        .filter((f) => /^portfolio-\d{4}-\d{2}-\d{2}\.json$/.test(f))
        .sort();
      const excess = files.length - this.maxBackups;
      for (let i = 0; i < excess; i++) {
        await fs.unlink(path.join(this.backupDir, files[i]));
      }
    } catch (err) {
      // Backups are best-effort - a failure here must NOT sink the main write.
      console.warn('[storage] backup rotation failed:', err);
    }
  }

  /** List backup filenames (newest first). Includes legacy `<data>/backups` if present. */
  async listBackups(): Promise<string[]> {
    const readNames = async (dir: string): Promise<string[]> => {
      try {
        const files = await fs.readdir(dir);
        return files.filter((f) => /^portfolio-\d{4}-\d{2}-\d{2}\.json$/.test(f));
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        if (e.code === 'ENOENT') return [];
        throw err;
      }
    };
    const vault = await readNames(this.backupDir);
    const legacyDir = this.legacyBackupDir();
    const legacy =
      path.resolve(legacyDir) === path.resolve(this.backupDir) ? [] : await readNames(legacyDir);
    const merged = new Set([...vault, ...legacy]);
    return [...merged].sort().reverse();
  }
}
