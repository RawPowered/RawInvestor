import path from 'node:path';
import { promises as fs } from 'node:fs';
import SqliteDatabase from 'better-sqlite3';
import type { PortfolioDoc } from './storage.js';

const dbByDataDir = new Map<string, SqliteDatabase.Database>();

const openPortfolioDb = async (dataDir: string): Promise<SqliteDatabase.Database> => {
  const existing = dbByDataDir.get(dataDir);
  if (existing) return existing;
  const dbDir = path.join(dataDir, 'portfolio-sqlite');
  await fs.mkdir(dbDir, { recursive: true });
  const dbPath = path.join(dbDir, 'portfolio.sqlite');
  const db = new SqliteDatabase(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS portfolio_store (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      doc_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  dbByDataDir.set(dataDir, db);
  return db;
};

export const initializePortfolioSqliteStore = async (
  dataDir: string
): Promise<{ dbPath: string; hasSnapshot: boolean; updatedAt: number | null; cardCount: number }> => {
  const db = await openPortfolioDb(dataDir);
  const dbPath = path.join(dataDir, 'portfolio-sqlite', 'portfolio.sqlite');
  const row = db
    .prepare('SELECT doc_json, updated_at FROM portfolio_store WHERE id = 1')
    .get() as { doc_json: string; updated_at: number } | undefined;
  if (!row) return { dbPath, hasSnapshot: false, updatedAt: null, cardCount: 0 };
  try {
    const parsed = JSON.parse(row.doc_json) as PortfolioDoc;
    const cards = Array.isArray((parsed as Record<string, unknown>).cards)
      ? ((parsed as Record<string, unknown>).cards as unknown[]).length
      : 0;
    return { dbPath, hasSnapshot: true, updatedAt: row.updated_at, cardCount: cards };
  } catch {
    return { dbPath, hasSnapshot: true, updatedAt: row.updated_at, cardCount: 0 };
  }
};

export const readPortfolioSqlite = async (dataDir: string): Promise<PortfolioDoc | null> => {
  const db = await openPortfolioDb(dataDir);
  const row = db
    .prepare('SELECT doc_json FROM portfolio_store WHERE id = 1')
    .get() as { doc_json: string } | undefined;
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.doc_json) as PortfolioDoc;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
};

export const writePortfolioSqlite = async (
  dataDir: string,
  doc: PortfolioDoc
): Promise<{ updatedAt: number; cardCount: number }> => {
  const db = await openPortfolioDb(dataDir);
  const updatedAt = typeof doc.updatedAt === 'number' && Number.isFinite(doc.updatedAt)
    ? doc.updatedAt
    : Date.now();
  const body = JSON.stringify({ ...doc, updatedAt });
  db.prepare(
    `INSERT INTO portfolio_store (id, doc_json, updated_at)
     VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET doc_json = excluded.doc_json, updated_at = excluded.updated_at`
  ).run(body, updatedAt);
  const cards = Array.isArray((doc as Record<string, unknown>).cards)
    ? ((doc as Record<string, unknown>).cards as unknown[]).length
    : 0;
  return { updatedAt, cardCount: cards };
};

export const getPortfolioSqliteAdminStats = async (
  dataDir: string
): Promise<{
  dbPath: string;
  dbSizeBytes: number;
  hasSnapshot: boolean;
  updatedAt: number | null;
  cardCount: number;
}> => {
  const db = await openPortfolioDb(dataDir);
  const dbPath = path.join(dataDir, 'portfolio-sqlite', 'portfolio.sqlite');
  const dbSizeBytes = (await fs.stat(dbPath).then((s) => s.size).catch(() => 0)) || 0;
  const row = db
    .prepare('SELECT doc_json, updated_at FROM portfolio_store WHERE id = 1')
    .get() as { doc_json: string; updated_at: number } | undefined;
  if (!row) {
    return { dbPath, dbSizeBytes, hasSnapshot: false, updatedAt: null, cardCount: 0 };
  }
  let cardCount = 0;
  try {
    const parsed = JSON.parse(row.doc_json) as Record<string, unknown>;
    cardCount = Array.isArray(parsed.cards) ? parsed.cards.length : 0;
  } catch {
    cardCount = 0;
  }
  return {
    dbPath,
    dbSizeBytes,
    hasSnapshot: true,
    updatedAt: row.updated_at,
    cardCount,
  };
};
