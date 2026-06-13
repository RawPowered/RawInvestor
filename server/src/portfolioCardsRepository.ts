import path from 'node:path';
import fs from 'node:fs';
import SqliteDatabase from 'better-sqlite3';
import type { PortfolioDoc } from './storage.js';
import {
  computeMetrics,
  DEFAULT_FEES,
  rawUngradedRoiPct,
  truePossibleRoiPct,
  upsidePsa10MinusRaw,
  type Fees,
} from './cardMetrics.js';
import { buildCardMatchKeys } from './cardMatchKeys.js';
import { canonicalizePricechartingUrl } from './pricechartingCanonical.js';

const dbByDataDir = new Map<string, SqliteDatabase.Database>();

export type PortfolioMetaDoc = Record<string, unknown> & {
  version?: number;
  updatedAt?: number;
};

export type ListCardsParams = {
  limit: number;
  offset: number;
  sort: string;
  search?: string;
  pokemonName?: string;
  collectionIds?: string[];
  sets?: string[];
  releaseYears?: number[];
  evSign?: 'all' | 'positive' | 'negative';
  profitLens?: 'all' | 'raw_no_grade' | 'grade_ev' | 'psa10_win';
  /** Filter rows: singles only, sealed only, or both. */
  portfolioKind?: 'all' | 'single' | 'sealed';
  /** @deprecated use payloadMode */
  includePayload?: boolean;
  /** full = payload_json; summary = indexed columns only (smaller); ids = id only */
  payloadMode?: 'full' | 'summary' | 'ids';
};

export const getAppPortfolioDbPath = (dataDir: string): string =>
  path.join(dataDir, 'app-portfolio', 'portfolio.db');

const migrate = (db: SqliteDatabase.Database) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS portfolio_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      doc_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY NOT NULL,
      updated_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      set_name TEXT NOT NULL DEFAULT '',
      rarity TEXT,
      collection_id TEXT,
      raw REAL,
      grade9 REAL,
      psa10 REAL,
      p10 REAL,
      p9 REAL,
      release_date_ms INTEGER,
      norm_pc_url TEXT,
      norm_tcg_url TEXT,
      tcg_product_id TEXT,
      ebay_sold_norm TEXT,
      ebay_active_norm TEXT,
      metrics_ev REAL,
      metrics_roi_pct REAL,
      metrics_total_invested REAL,
      metrics_net10 REAL,
      metrics_net_raw_no_grade REAL,
      metrics_net_fail REAL,
      sort_true_roi_pct REAL,
      sort_raw_roi_pct REAL,
      sort_upside REAL,
      sort_name TEXT,
      sort_set TEXT,
      pregrade_basis REAL
    );
    CREATE INDEX IF NOT EXISTS idx_cards_collection ON cards(collection_id);
    CREATE INDEX IF NOT EXISTS idx_cards_set_name ON cards(set_name);
    CREATE INDEX IF NOT EXISTS idx_cards_norm_tcg ON cards(norm_tcg_url);
    CREATE INDEX IF NOT EXISTS idx_cards_norm_pc ON cards(norm_pc_url);
    CREATE INDEX IF NOT EXISTS idx_cards_tcg_pid ON cards(tcg_product_id);
    CREATE INDEX IF NOT EXISTS idx_cards_ebay_sold ON cards(ebay_sold_norm);
    CREATE INDEX IF NOT EXISTS idx_cards_ebay_active ON cards(ebay_active_norm);
    CREATE INDEX IF NOT EXISTS idx_cards_updated ON cards(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_cards_metrics_ev ON cards(metrics_ev);
    CREATE INDEX IF NOT EXISTS idx_cards_name ON cards(sort_name);
  `);
  const cols = db.prepare(`PRAGMA table_info(cards)`).all() as Array<{ name: string }>;
  const have = new Set(cols.map((c) => c.name));
  if (!have.has('pregrade_basis')) {
    db.exec(`ALTER TABLE cards ADD COLUMN pregrade_basis REAL`);
  }
  if (!have.has('portfolio_kind')) {
    db.exec(`ALTER TABLE cards ADD COLUMN portfolio_kind TEXT DEFAULT 'single'`);
    db.exec(`UPDATE cards SET portfolio_kind = 'single' WHERE portfolio_kind IS NULL`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_cards_portfolio_kind ON cards(portfolio_kind)`);
  }
};

export const openAppPortfolioDb = (dataDir: string): SqliteDatabase.Database => {
  const existing = dbByDataDir.get(dataDir);
  if (existing) return existing;
  const dir = path.join(dataDir, 'app-portfolio');
  fs.mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, 'portfolio.db');
  const db = new SqliteDatabase(dbPath);
  db.pragma('journal_mode = WAL');
  migrate(db);
  dbByDataDir.set(dataDir, db);
  return db;
};

/** Close pooled DB for this DATA_DIR (tests / teardown). */
export const closeAppPortfolioDb = (dataDir: string): void => {
  const db = dbByDataDir.get(dataDir);
  if (!db) return;
  try {
    db.close();
  } catch {
    /* ignore */
  }
  dbByDataDir.delete(dataDir);
};

export const appPortfolioReady = (dataDir: string): boolean => {
  try {
    const dbPath = getAppPortfolioDbPath(dataDir);
    return fs.existsSync(dbPath);
  } catch {
    return false;
  }
};

export const hasAnyCards = (dataDir: string): boolean => {
  try {
    const db = openAppPortfolioDb(dataDir);
    const row = db.prepare('SELECT 1 AS ok FROM cards LIMIT 1').get() as { ok: number } | undefined;
    return Boolean(row);
  } catch {
    return false;
  }
};

export const totalCardCount = (dataDir: string): number => {
  try {
    const db = openAppPortfolioDb(dataDir);
    const row = db.prepare('SELECT COUNT(1) AS c FROM cards').get() as { c: number };
    return Number(row?.c) || 0;
  } catch {
    return 0;
  }
};

/** Resolve extension overlay / PriceCharting tab URL to an existing card row (norm keys match upsert). */
export const findCardIdByDashboardSourceUrl = (
  dataDir: string,
  source: 'pricecharting' | 'tcgplayer',
  rawUrl: string
): string | null => {
  const u = String(rawUrl || '').trim();
  if (!u) return null;
  let payload: Record<string, unknown>;
  if (source === 'pricecharting') {
    const canon = canonicalizePricechartingUrl(u);
    if (!canon) return null;
    payload = { url: canon };
  } else {
    payload = { tcgplayerUrl: u };
  }
  const keys = buildCardMatchKeys(payload);
  const db = openAppPortfolioDb(dataDir);
  if (keys.normPcUrl) {
    const row = db
      .prepare('SELECT id FROM cards WHERE norm_pc_url = ? LIMIT 1')
      .get(keys.normPcUrl) as { id: string } | undefined;
    if (row?.id) return row.id;
  }
  if (keys.normTcgUrl) {
    const row = db
      .prepare('SELECT id FROM cards WHERE norm_tcg_url = ? LIMIT 1')
      .get(keys.normTcgUrl) as { id: string } | undefined;
    if (row?.id) return row.id;
  }
  if (keys.tcgProductId) {
    const row = db
      .prepare('SELECT id FROM cards WHERE tcg_product_id = ? LIMIT 1')
      .get(keys.tcgProductId) as { id: string } | undefined;
    if (row?.id) return row.id;
  }
  return null;
};

export const feesFromMetaDoc = (doc: PortfolioMetaDoc): Fees => {
  const fees = doc.fees as Fees | undefined;
  if (!fees || typeof fees !== 'object') return { ...DEFAULT_FEES };
  return {
    gradingFee: Number(fees.gradingFee) || DEFAULT_FEES.gradingFee,
    shipToGrader: Number(fees.shipToGrader) ?? DEFAULT_FEES.shipToGrader,
    shipFromGrader: Number(fees.shipFromGrader) ?? DEFAULT_FEES.shipFromGrader,
    saleFeePct: Number(fees.saleFeePct) ?? DEFAULT_FEES.saleFeePct,
    saleFeeFlat: Number(fees.saleFeeFlat) ?? DEFAULT_FEES.saleFeeFlat,
    shipToBuyer: Number(fees.shipToBuyer) ?? DEFAULT_FEES.shipToBuyer,
  };
};

export const readPortfolioMeta = (dataDir: string): PortfolioMetaDoc | null => {
  const db = openAppPortfolioDb(dataDir);
  const row = db
    .prepare('SELECT doc_json FROM portfolio_meta WHERE id = 1')
    .get() as { doc_json: string } | undefined;
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.doc_json) as PortfolioMetaDoc;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

export const writePortfolioMeta = (dataDir: string, doc: PortfolioMetaDoc): number => {
  const db = openAppPortfolioDb(dataDir);
  const updatedAt =
    typeof doc.updatedAt === 'number' && Number.isFinite(doc.updatedAt) ? doc.updatedAt : Date.now();
  const body = JSON.stringify({ ...doc, updatedAt });
  db.prepare(
    `INSERT INTO portfolio_meta (id, doc_json, updated_at)
     VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET doc_json = excluded.doc_json, updated_at = excluded.updated_at`
  ).run(body, updatedAt);
  return updatedAt;
};

export const defaultEmptyMeta = (): PortfolioMetaDoc => ({
  version: 1,
  updatedAt: Date.now(),
  fees: { ...DEFAULT_FEES },
  collections: [],
  filters: {
    search: '',
    collectionIds: [],
    evSign: 'all',
    sets: [],
    releaseYears: [],
    pokemonName: '',
    profitLens: 'all',
    portfolioKindScope: 'single',
  },
  sort: 'ev_desc',
  psaToken: '',
  nebulaOpen: false,
  extensionLatestOnlyMode: false,
  quickCardAdminSettings: {
    gemRateOnQuickRefresh: false,
    gemRateQuickMode: 'every_n_days',
    gemRateQuickIntervalDays: 7,
    autoQuickRefreshOnLoad: false,
    quickFetchMarketMode: 'hybrid',
  },
  backupSettings: {
    intervalDays: 7,
    retainSql: 8,
    retainJson: 8,
    enabledSql: true,
    enabledJson: true,
    lastRunAt: 0,
  },
  googleCseKey: '',
  googleCseCx: '',
  /** eBay developer app (client credentials). Empty = use process.env only. */
  ebayClientId: '',
  ebayClientSecret: '',
  /** `production` | `sandbox` — API host + OAuth token endpoint. */
  ebayEnv: 'production',
});

/** Cached numeric columns from payload + fees for SQL sort/filter. */
const computeCardCaches = (payload: Record<string, unknown>, fees: Fees) => {
  const m = computeMetrics(payload as Parameters<typeof computeMetrics>[0], fees);
  const tr = truePossibleRoiPct(payload as Parameters<typeof truePossibleRoiPct>[0]);
  const rr = rawUngradedRoiPct(payload as Parameters<typeof rawUngradedRoiPct>[0]);
  const upside = upsidePsa10MinusRaw(payload as Parameters<typeof upsidePsa10MinusRaw>[0]);
  const name = String(payload.name ?? '')
    .trim()
    .toLowerCase();
  const setName = String(payload.set ?? '')
    .trim()
    .toLowerCase();
  const rd = payload.releaseDateMs;
  const releaseDateMs =
    typeof rd === 'number' && Number.isFinite(rd) && rd > 0 ? Math.floor(rd) : null;
  const keys = buildCardMatchKeys(payload);

  return {
    metrics: m,
    sortTrueRoi: Number.isFinite(tr) ? tr : null,
    sortRawRoi: Number.isFinite(rr) ? rr : null,
    sortUpside: upside,
    sortName: name,
    sortSet: setName,
    releaseDateMs,
    keys,
  };
};

export const upsertCardFull = (
  dataDir: string,
  cardPayload: Record<string, unknown>,
  fees: Fees,
  updatedAt = Date.now()
): void => {
  const id = String(cardPayload.id ?? '').trim();
  if (!id) throw new Error('Card id required');

  const db = openAppPortfolioDb(dataDir);
  const name = String(cardPayload.name ?? '');
  const setName = String(cardPayload.set ?? '');
  const rarity = typeof cardPayload.rarity === 'string' ? cardPayload.rarity : null;
  const collectionId =
    typeof cardPayload.collectionId === 'string' ? cardPayload.collectionId : null;
  const raw = typeof cardPayload.raw === 'number' ? cardPayload.raw : Number(cardPayload.raw) || 0;
  const grade9 =
    typeof cardPayload.grade9 === 'number' ? cardPayload.grade9 : Number(cardPayload.grade9) || 0;
  const psa10 =
    typeof cardPayload.psa10 === 'number' ? cardPayload.psa10 : Number(cardPayload.psa10) || 0;
  const p10 = typeof cardPayload.p10 === 'number' ? cardPayload.p10 : Number(cardPayload.p10) || 0;
  const p9 = typeof cardPayload.p9 === 'number' ? cardPayload.p9 : Number(cardPayload.p9) || 0;
  const rd = cardPayload.releaseDateMs;
  const releaseDateMs =
    typeof rd === 'number' && Number.isFinite(rd) && rd > 0 ? Math.floor(rd) : null;
  const portfolioKindRaw = cardPayload.portfolioKind;
  const portfolioKind =
    portfolioKindRaw === 'sealed' ? 'sealed' : 'single';

  const payloadNorm = { ...cardPayload, portfolioKind };
  const caches = computeCardCaches(payloadNorm, fees);
  const body = JSON.stringify(payloadNorm);
  const rawN = Number(cardPayload.raw) || 0;
  const paid =
    typeof cardPayload.actualCost === 'number' && cardPayload.actualCost > 0
      ? cardPayload.actualCost
      : rawN;
  const inbound = cardPayload.freeShipping ? 0 : Number(cardPayload.shippingCost) || 0;
  const pregradeBasis = paid + inbound;

  db.prepare(
    `INSERT INTO cards (
      id, updated_at, payload_json, name, set_name, rarity, collection_id,
      raw, grade9, psa10, p10, p9, release_date_ms, portfolio_kind,
      norm_pc_url, norm_tcg_url, tcg_product_id, ebay_sold_norm, ebay_active_norm,
      metrics_ev, metrics_roi_pct, metrics_total_invested, metrics_net10, metrics_net_raw_no_grade, metrics_net_fail,
      sort_true_roi_pct, sort_raw_roi_pct, sort_upside, sort_name, sort_set, pregrade_basis
    ) VALUES (
      @id, @updated_at, @payload_json, @name, @set_name, @rarity, @collection_id,
      @raw, @grade9, @psa10, @p10, @p9, @release_date_ms, @portfolio_kind,
      @norm_pc_url, @norm_tcg_url, @tcg_product_id, @ebay_sold_norm, @ebay_active_norm,
      @metrics_ev, @metrics_roi_pct, @metrics_total_invested, @metrics_net10, @metrics_net_raw_no_grade, @metrics_net_fail,
      @sort_true_roi_pct, @sort_raw_roi_pct, @sort_upside, @sort_name, @sort_set, @pregrade_basis
    )
    ON CONFLICT(id) DO UPDATE SET
      updated_at = excluded.updated_at,
      payload_json = excluded.payload_json,
      name = excluded.name,
      set_name = excluded.set_name,
      rarity = excluded.rarity,
      collection_id = excluded.collection_id,
      raw = excluded.raw,
      grade9 = excluded.grade9,
      psa10 = excluded.psa10,
      p10 = excluded.p10,
      p9 = excluded.p9,
      release_date_ms = excluded.release_date_ms,
      portfolio_kind = excluded.portfolio_kind,
      norm_pc_url = excluded.norm_pc_url,
      norm_tcg_url = excluded.norm_tcg_url,
      tcg_product_id = excluded.tcg_product_id,
      ebay_sold_norm = excluded.ebay_sold_norm,
      ebay_active_norm = excluded.ebay_active_norm,
      metrics_ev = excluded.metrics_ev,
      metrics_roi_pct = excluded.metrics_roi_pct,
      metrics_total_invested = excluded.metrics_total_invested,
      metrics_net10 = excluded.metrics_net10,
      metrics_net_raw_no_grade = excluded.metrics_net_raw_no_grade,
      metrics_net_fail = excluded.metrics_net_fail,
      sort_true_roi_pct = excluded.sort_true_roi_pct,
      sort_raw_roi_pct = excluded.sort_raw_roi_pct,
      sort_upside = excluded.sort_upside,
      sort_name = excluded.sort_name,
      sort_set = excluded.sort_set,
      pregrade_basis = excluded.pregrade_basis`
  ).run({
    id,
    updated_at: updatedAt,
    payload_json: body,
    name,
    set_name: setName,
    rarity,
    collection_id: collectionId,
    raw,
    grade9,
    psa10,
    p10,
    p9,
    release_date_ms: releaseDateMs,
    portfolio_kind: portfolioKind,
    norm_pc_url: caches.keys.normPcUrl,
    norm_tcg_url: caches.keys.normTcgUrl,
    tcg_product_id: caches.keys.tcgProductId,
    ebay_sold_norm: caches.keys.ebaySoldNorm,
    ebay_active_norm: caches.keys.ebayActiveNorm,
    metrics_ev: caches.metrics.ev,
    metrics_roi_pct: caches.metrics.roiPct,
    metrics_total_invested: caches.metrics.totalInvested,
    metrics_net10: caches.metrics.net10,
    metrics_net_raw_no_grade: caches.metrics.netRawNoGrade,
    metrics_net_fail: caches.metrics.netFail,
    sort_true_roi_pct: caches.sortTrueRoi,
    sort_raw_roi_pct: caches.sortRawRoi,
    sort_upside: caches.sortUpside,
    sort_name: caches.sortName,
    sort_set: caches.sortSet,
    pregrade_basis: pregradeBasis,
  });
};

export const patchCardPayload = (
  dataDir: string,
  cardId: string,
  patch: Record<string, unknown>,
  fees: Fees
): Record<string, unknown> | null => {
  const db = openAppPortfolioDb(dataDir);
  const row = db.prepare('SELECT payload_json FROM cards WHERE id = ?').get(cardId) as
    | { payload_json: string }
    | undefined;
  if (!row) return null;
  let base: Record<string, unknown>;
  try {
    base = JSON.parse(row.payload_json) as Record<string, unknown>;
  } catch {
    return null;
  }
  const next = { ...base, ...patch, id: cardId };
  upsertCardFull(dataDir, next, fees, Date.now());
  return next;
};

export const deleteCardById = (dataDir: string, cardId: string): boolean => {
  const db = openAppPortfolioDb(dataDir);
  const r = db.prepare('DELETE FROM cards WHERE id = ?').run(cardId);
  return r.changes > 0;
};

export const getCardById = (dataDir: string, cardId: string): Record<string, unknown> | null => {
  const db = openAppPortfolioDb(dataDir);
  const row = db.prepare('SELECT payload_json FROM cards WHERE id = ?').get(cardId) as
    | { payload_json: string }
    | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.payload_json) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const orderByClause = (sort: string): string => {
  switch (sort) {
    case 'ev_desc':
      return 'metrics_ev DESC, id ASC';
    case 'ev_asc':
      return 'metrics_ev ASC, id ASC';
    case 'roi_desc':
      return 'metrics_roi_pct DESC, id ASC';
    case 'roi_asc':
      return 'metrics_roi_pct ASC, id ASC';
    case 'true_roi_desc':
      return 'sort_true_roi_pct IS NULL, sort_true_roi_pct DESC, id ASC';
    case 'true_roi_asc':
      return 'sort_true_roi_pct IS NULL, sort_true_roi_pct ASC, id ASC';
    case 'raw_roi_desc':
      return 'sort_raw_roi_pct IS NULL, sort_raw_roi_pct DESC, id ASC';
    case 'raw_roi_asc':
      return 'sort_raw_roi_pct IS NULL, sort_raw_roi_pct ASC, id ASC';
    case 'invested_asc':
      return 'metrics_total_invested ASC, id ASC';
    case 'invested_desc':
      return 'metrics_total_invested DESC, id ASC';
    case 'upside_desc':
      return 'sort_upside DESC, id ASC';
    case 'p10_desc':
      return 'p10 DESC, id ASC';
    case 'raw_asc':
      return 'raw ASC, id ASC';
    case 'psa10_desc':
      return 'psa10 DESC, id ASC';
    case 'name_desc':
      return 'sort_name DESC, id ASC';
    case 'name_asc':
      return 'sort_name ASC, id ASC';
    case 'set_asc':
      return 'sort_set ASC, sort_name ASC, id ASC';
    default:
      return 'metrics_ev DESC, id ASC';
  }
};

const UNASSIGNED = '__unassigned__';

const buildFilterSql = (
  p: Omit<ListCardsParams, 'limit' | 'offset' | 'sort' | 'includePayload' | 'payloadMode'>
): { sql: string; params: unknown[] } => {
  const cond: string[] = [];
  const params: unknown[] = [];

  const q = String(p.search ?? '').trim().toLowerCase();
  if (q) {
    cond.push('(LOWER(name) LIKE ? OR LOWER(set_name) LIKE ? OR LOWER(COALESCE(rarity,\'\')) LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like);
  }

  const poke = String(p.pokemonName ?? '').trim().toLowerCase();
  if (poke) {
    cond.push('LOWER(name) LIKE ?');
    params.push(`%${poke}%`);
  }

  const colIds = p.collectionIds ?? [];
  if (colIds.length > 0) {
    const wantsUnassigned = colIds.includes(UNASSIGNED);
    const others = colIds.filter((x) => x !== UNASSIGNED);
    if (wantsUnassigned && others.length > 0) {
      cond.push('(collection_id IS NULL OR collection_id IN (' + others.map(() => '?').join(',') + '))');
      params.push(...others);
    } else if (wantsUnassigned) {
      cond.push('collection_id IS NULL');
    } else {
      cond.push('collection_id IN (' + others.map(() => '?').join(',') + ')');
      params.push(...others);
    }
  }

  const sets = p.sets ?? [];
  if (sets.length > 0) {
    cond.push('set_name IN (' + sets.map(() => '?').join(',') + ')');
    params.push(...sets);
  }

  const years = p.releaseYears ?? [];
  if (years.length > 0) {
    cond.push(
      `(
        release_date_ms IS NOT NULL
        AND CAST(strftime('%Y', release_date_ms / 1000.0, 'unixepoch') AS INTEGER) IN (${years.map(() => '?').join(',')})
      )`
    );
    params.push(...years);
  }

  if (p.evSign === 'positive') {
    cond.push('metrics_ev >= 0');
  } else if (p.evSign === 'negative') {
    cond.push('metrics_ev < 0');
  }

  const lens = p.profitLens ?? 'all';
  if (lens === 'raw_no_grade') {
    cond.push('metrics_net_raw_no_grade > 0');
  } else if (lens === 'grade_ev') {
    cond.push('metrics_ev > 0');
  } else if (lens === 'psa10_win') {
    cond.push('metrics_net10 > 0');
  }

  const pk = p.portfolioKind ?? 'all';
  if (pk === 'single') {
    /** Match client `portfolioKind !== 'sealed'`: treat NULL/blank as single (COALESCE misses ''). */
    cond.push("(LOWER(TRIM(COALESCE(portfolio_kind, ''))) <> 'sealed')");
  } else if (pk === 'sealed') {
    cond.push("(LOWER(TRIM(COALESCE(portfolio_kind, ''))) = 'sealed')");
  }

  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  return { sql: where, params };
};

const pcUrlFromNorm = (norm: string | null): string | undefined => {
  const s = String(norm || '').trim();
  if (!s) return undefined;
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith('pricecharting|')) {
    const p = s.slice('pricecharting|'.length);
    return `https://www.pricecharting.com${p.startsWith('/') ? p : `/${p}`}`;
  }
  return `https://www.pricecharting.com${s.startsWith('/') ? s : `/${s}`}`;
};

type SummarySqlRow = {
  id: string;
  updated_at: number;
  name: string;
  set_name: string;
  rarity: string | null;
  collection_id: string | null;
  raw: number | null;
  grade9: number | null;
  psa10: number | null;
  p10: number | null;
  p9: number | null;
  release_date_ms: number | null;
  portfolio_kind: string | null;
  norm_pc_url: string | null;
  norm_tcg_url: string | null;
  tcg_product_id: string | null;
};

const mapSummaryRow = (row: SummarySqlRow): Record<string, unknown> => ({
  id: row.id,
  name: row.name,
  set: row.set_name,
  rarity: row.rarity ?? undefined,
  collectionId: row.collection_id ?? undefined,
  raw: Number(row.raw) || 0,
  grade9: Number(row.grade9) || 0,
  psa10: Number(row.psa10) || 0,
  p10: Number(row.p10) || 0,
  p9: Number(row.p9) || 0,
  releaseDateMs:
    typeof row.release_date_ms === 'number' && Number.isFinite(row.release_date_ms)
      ? row.release_date_ms
      : undefined,
  portfolioKind: row.portfolio_kind === 'sealed' ? 'sealed' : 'single',
  url: pcUrlFromNorm(row.norm_pc_url),
  tcgplayerUrl: row.tcg_product_id?.trim()
    ? `https://www.tcgplayer.com/product/${String(row.tcg_product_id).trim()}`
    : undefined,
  updatedAt: row.updated_at,
  listFetchMode: 'summary',
});

export const listCardsPage = (
  dataDir: string,
  p: ListCardsParams
): { items: Array<Record<string, unknown> | { id: string }>; total: number } => {
  const db = openAppPortfolioDb(dataDir);
  const limit = Math.max(1, Math.min(200, p.limit || 50));
  const offset = Math.max(0, p.offset || 0);
  const sort = p.sort || 'ev_desc';

  const { sql: whereSql, params: filterParams } = buildFilterSql(p);
  const totalRow = db.prepare(`SELECT COUNT(1) AS c FROM cards ${whereSql}`).get(...filterParams) as {
    c: number;
  };
  const total = Number(totalRow?.c) || 0;

  const order = orderByClause(sort);
  const payloadMode: 'full' | 'summary' | 'ids' =
    p.payloadMode ??
    (p.includePayload === false ? 'ids' : 'full');

  if (payloadMode === 'ids') {
    const stmt = db.prepare(`SELECT id FROM cards ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`);
    const rows = stmt.all(...filterParams, limit, offset) as { id: string }[];
    return {
      items: rows.map((r) => ({ id: r.id })),
      total,
    };
  }

  if (payloadMode === 'summary') {
    const sel = `SELECT id, updated_at, name, set_name, rarity, collection_id, raw, grade9, psa10, p10, p9, release_date_ms, portfolio_kind, norm_pc_url, norm_tcg_url, tcg_product_id FROM cards`;
    const stmt = db.prepare(`${sel} ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`);
    const rows = stmt.all(...filterParams, limit, offset) as SummarySqlRow[];
    const items = rows.map((r) => mapSummaryRow(r));
    return { items, total };
  }

  const stmt = db.prepare(`SELECT payload_json FROM cards ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`);

  const rows = stmt.all(...filterParams, limit, offset) as Array<{ payload_json: string }>;

  const items = rows.map((r) => {
    try {
      return JSON.parse(r.payload_json) as Record<string, unknown>;
    } catch {
      return {};
    }
  });

  return { items, total };
};

export const recomputeAllCardCaches = (dataDir: string, fees: Fees): number => {
  const db = openAppPortfolioDb(dataDir);
  const rows = db.prepare('SELECT id, payload_json FROM cards').all() as Array<{ id: string; payload_json: string }>;
  let n = 0;
  for (const r of rows) {
    try {
      const payload = JSON.parse(r.payload_json) as Record<string, unknown>;
      upsertCardFull(dataDir, payload, fees, Number(payload.updatedAt) || Date.now());
      n += 1;
    } catch {
      /* skip */
    }
  }
  return n;
};

export type PortfolioSummary = {
  count: number;
  preGradeSpend: number;
  gradingSpend: number;
  gradingPerCard: number;
  invested: number;
  expectedRevenue: number;
  ev: number;
  roi: number;
  bestCaseNet: number;
  worstCaseNet: number;
  perDollarReturn: number;
};

export const aggregatePortfolioSummary = (
  dataDir: string,
  fees: Fees,
  filter?: Omit<ListCardsParams, 'limit' | 'offset' | 'sort' | 'includePayload' | 'payloadMode'>
): PortfolioSummary => {
  const db = openAppPortfolioDb(dataDir);
  const gradingPerCard = fees.gradingFee + fees.shipToGrader + fees.shipFromGrader;

  const { sql: whereSql, params: filterParams } = filter
    ? buildFilterSql(filter)
    : { sql: '', params: [] as unknown[] };

  const row = db
    .prepare(
      `SELECT
        COUNT(1) AS cardCount,
        COALESCE(SUM(pregrade_basis), 0) AS preGradeSum,
        COALESCE(SUM(metrics_total_invested), 0) AS investedSum,
        COALESCE(SUM(metrics_ev), 0) AS evSum,
        COALESCE(SUM(metrics_net10), 0) AS bestSum,
        COALESCE(SUM(metrics_net_fail), 0) AS worstSum
      FROM cards ${whereSql}`
    )
    .get(...filterParams) as Record<string, unknown>;

  const cardCount = Number(row.cardCount) || 0;
  const preGradeSpend = Number(row.preGradeSum) || 0;
  const gradingSpend = gradingPerCard * cardCount;
  const invested = Number(row.investedSum) || 0;
  const ev = Number(row.evSum) || 0;
  const expectedRevenue = invested + ev;
  const roi = invested > 0 ? (ev / invested) * 100 : 0;
  const bestCaseNet = Number(row.bestSum) || 0;
  const worstCaseNet = Number(row.worstSum) || 0;
  const perDollarReturn = invested > 0 ? expectedRevenue / invested : 0;

  return {
    count: cardCount,
    preGradeSpend,
    gradingSpend,
    gradingPerCard,
    invested,
    expectedRevenue,
    ev,
    roi,
    bestCaseNet,
    worstCaseNet,
    perDollarReturn,
  };
};

/** Import legacy blob document into v2 tables (optional migration). */
export const importLegacyPortfolioDoc = (dataDir: string, doc: PortfolioDoc): { cardsImported: number } => {
  const raw = doc as Record<string, unknown>;
  const fees = feesFromMetaDoc(raw);
  let meta: PortfolioMetaDoc = {
    version: typeof raw.version === 'number' ? raw.version : 1,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
    fees: raw.fees && typeof raw.fees === 'object' ? (raw.fees as object) : { ...DEFAULT_FEES },
    collections: Array.isArray(raw.collections) ? raw.collections : [],
    filters: raw.filters && typeof raw.filters === 'object' ? (raw.filters as object) : defaultEmptyMeta().filters,
    sort: typeof raw.sort === 'string' ? raw.sort : 'ev_desc',
    psaToken: typeof raw.psaToken === 'string' ? raw.psaToken : '',
    nebulaOpen: raw.nebulaOpen === true,
    extensionLatestOnlyMode: raw.extensionLatestOnlyMode === true,
    hunts: Array.isArray(raw.hunts) ? raw.hunts : [],
    targets: Array.isArray(raw.targets) ? raw.targets : [],
    googleCseKey: typeof raw.googleCseKey === 'string' ? raw.googleCseKey : '',
    googleCseCx: typeof raw.googleCseCx === 'string' ? raw.googleCseCx : '',
    ebayClientId: typeof raw.ebayClientId === 'string' ? raw.ebayClientId : '',
    ebayClientSecret: typeof raw.ebayClientSecret === 'string' ? raw.ebayClientSecret : '',
    ebayEnv: raw.ebayEnv === 'sandbox' ? 'sandbox' : 'production',
  };
  writePortfolioMeta(dataDir, meta);

  const cards = Array.isArray(raw.cards) ? raw.cards : [];
  let n = 0;
  for (const c of cards) {
    if (!c || typeof c !== 'object') continue;
    const payload = c as Record<string, unknown>;
    const id = String(payload.id ?? '').trim();
    if (!id) continue;
    upsertCardFull(dataDir, { ...payload, id }, fees, Date.now());
    n += 1;
  }
  return { cardsImported: n };
};
