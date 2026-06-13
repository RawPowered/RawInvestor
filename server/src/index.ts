import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import * as cheerio from 'cheerio';
import { parseCardHtml, slugFromUrl } from './scraper.js';
import { downloadImage } from './image.js';
import {
  canonicalizePricechartingUrl,
  fetchPricechartingProductWithImages,
  syncPricechartingUrlIntoPortfolio,
} from './pricechartingSync.js';
import { fetchPsaPopulation } from './psa.js';
import { fetchGemRateCardSummary, searchGemRate } from './gemrate.js';
import { extractTcgplayerProductId, fetchTcgplayerProduct } from './tcgplayer.js';
import { fetchTcgplayerMarketHistory } from './tcgplayerHistory.js';
import {
  assertTcgplayerArticleUrl,
  fetchTcgplayerContentArticle,
  searchBuyersGuideArticles,
} from './tcgplayerArticle.js';
import { previewTcgplayerCatalog, previewTcgplayerProductIds } from './tcgplayerCatalog.js';
import {
  fetchEbaySoldSummary,
  getEbayAccessToken,
  invalidateEbayTokenCache,
  resolveEbayAppCredentials,
} from './ebay.js';
import { fetchEbayItemPageTitle, scoreListingTitleMatch } from './ebayListingVerify.js';
import { Storage } from './storage.js';
import {
  getPortfolioSqliteAdminStats,
  initializePortfolioSqliteStore,
  readPortfolioSqlite,
  writePortfolioSqlite,
} from './portfolioSqlite.js';
import type { PortfolioDoc } from './storage.js';
import {
  aggregatePortfolioSummary,
  appPortfolioReady,
  defaultEmptyMeta,
  deleteCardById,
  feesFromMetaDoc,
  findCardIdByDashboardSourceUrl,
  getCardById,
  importLegacyPortfolioDoc,
  listCardsPage,
  openAppPortfolioDb,
  patchCardPayload,
  readPortfolioMeta,
  recomputeAllCardCaches,
  getAppPortfolioDbPath,
  totalCardCount,
  upsertCardFull,
  writePortfolioMeta,
  type ListCardsParams,
  type PortfolioMetaDoc,
} from './portfolioCardsRepository.js';
import { mergeExtensionCaptureIntoPortfolio } from './portfolioExtensionMerge.js';
import {
  getBackupSettingsFromMeta,
  listRotatingBackups,
  restorePortfolioDbFromSqlBackup,
  runRotatingPortfolioBackups,
} from './portfolioRotatingBackup.js';
import {
  backfillEbayCaptureTitleMetadata,
  findLatestExtensionCapture,
  getExtensionCaptureAdminStats,
  initializeExtensionCaptureStore,
  listExtensionCaptureHistory,
  normalizeEbayCapture,
  normalizeExtensionForResponse,
  normalizeForMatch,
  normalizeTcgCapture,
  saveExtensionCapture,
  updateLatestEbayCaptureListingTags,
  validateCapturePayload,
} from './extensionCapture.js';
import {
  mergeEbaySessionExtensionReport,
  parseEbaySessionExtensionPostBody,
} from './extEbaySessionReport.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

const app = express();
const isProductionRuntime = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
const allowInsecureDevAuth = String(process.env.PCGR_ALLOW_INSECURE_DEV_AUTH || '').trim() === '1';
const strictAuthMode = isProductionRuntime && !allowInsecureDevAuth;
const appToken = String(process.env.PCGR_APP_TOKEN || '').trim();
const extToken = String(process.env.PCGR_EXT_TOKEN || '').trim();
const maintToken = String(process.env.PCGR_MAINT_TOKEN || '').trim();

const parseCsvEnv = (value: string | undefined): string[] =>
  String(value || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

/** MV3 service workers send Origin: chrome-extension://… — allow preflight + POST to the local API. */
const isBrowserExtensionOrigin = (normalized: string): boolean =>
  normalized.startsWith('chrome-extension://') ||
  normalized.startsWith('moz-extension://') ||
  normalized.startsWith('safari-web-extension://');

const configuredOrigins = parseCsvEnv(process.env.PCGR_ALLOWED_ORIGINS).map((v) => v.toLowerCase());
const devOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173'];
const allowedOrigins = new Set([...(strictAuthMode ? [] : devOrigins), ...configuredOrigins]);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const normalized = String(origin).trim().toLowerCase();
      // Electron file:// requests typically send Origin: null.
      if (normalized === 'null') return callback(null, true);
      if (isBrowserExtensionOrigin(normalized)) return callback(null, true);
      if (allowedOrigins.has(normalized)) return callback(null, true);
      return callback(new Error('CORS blocked for origin'));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'x-psa-token',
      'x-ext-token',
      'x-maint-token',
      'x-pcgr-app-token',
    ],
  })
);
// Portfolios with long price histories can easily clear the default 100kb
// limit. 10mb is plenty for thousands of cards and still rejects abuse.
app.use(express.json({ limit: '50mb' }));

const resolveRuntimeDir = (envValue: string | undefined, fallbackAbs: string): string => {
  const raw = String(envValue || '').trim();
  if (!raw) return fallbackAbs;
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
};
// Packaged builds should set PCGR_* dirs to a user-writable location.
const IMAGES_DIR = resolveRuntimeDir(
  process.env.PCGR_IMAGES_DIR,
  path.resolve(__dirname, '..', 'images')
);
const DATA_DIR = resolveRuntimeDir(
  process.env.PCGR_DATA_DIR,
  path.resolve(__dirname, '..', 'data')
);
const BACKUPS_DIR = resolveRuntimeDir(
  process.env.PCGR_BACKUPS_DIR,
  path.resolve(DATA_DIR, '..', 'portfolio-backups-vault')
);
const UPLOADS_DIR = resolveRuntimeDir(
  process.env.PCGR_UPLOADS_DIR,
  path.resolve(__dirname, '..', '..', 'uploads')
);
const storage = new Storage({ dataDir: DATA_DIR, backupDir: BACKUPS_DIR });

const PORT = Number(process.env.PORT) || 3001;

const validTokenHeader = (req: express.Request, headerName: string, expected: string): boolean => {
  const got = String(req.headers[headerName] || '').trim();
  return Boolean(got) && got === expected;
};

const requireExtToken: express.RequestHandler = (req, res, next) => {
  if (!strictAuthMode && !extToken) return next();
  if (!extToken) {
    return res.status(503).json({ error: 'Server misconfigured: missing PCGR_EXT_TOKEN.' });
  }
  if (!validTokenHeader(req, 'x-ext-token', extToken)) {
    return res.status(401).json({ error: 'Invalid extension token.' });
  }
  return next();
};

/** Lets the packaged app POST merged captures using `x-pcgr-app-token` when RawEngine skips upload (same origin as portfolio PATCH). */
const requireExtOrAppTokenForCapture: express.RequestHandler = (req, res, next) => {
  if (!strictAuthMode) return next();
  if (extToken && validTokenHeader(req, 'x-ext-token', extToken)) return next();
  if (appToken && validTokenHeader(req, 'x-pcgr-app-token', appToken)) return next();
  if (!extToken && !appToken) {
    return res.status(503).json({ error: 'Server misconfigured: missing PCGR_EXT_TOKEN / PCGR_APP_TOKEN.' });
  }
  return res.status(401).json({ error: 'Invalid capture upload token.' });
};

const requireMaintOrAppToken: express.RequestHandler = (req, res, next) => {
  /** Outside hardened production, skip — browser+Vite has no Electron-injected `x-pcgr-app-token`; stray PCGR_MAINT_TOKEN in `.env` must not lock Admin API in dev. */
  if (!strictAuthMode) return next();
  const maintOk = maintToken ? validTokenHeader(req, 'x-maint-token', maintToken) : false;
  const appOk = appToken ? validTokenHeader(req, 'x-pcgr-app-token', appToken) : false;
  if (maintOk || appOk) return next();
  if (!maintToken && !appToken) {
    return res.status(503).json({ error: 'Server misconfigured: missing maintenance/auth token.' });
  }
  return res.status(401).json({ error: 'Invalid maintenance token.' });
};

const requireStoreWriteAuth: express.RequestHandler = (req, res, next) => {
  if (strictAuthMode) {
    if (!appToken) {
      return res.status(503).json({ error: 'Server misconfigured: missing PCGR_APP_TOKEN.' });
    }
    if (!validTokenHeader(req, 'x-pcgr-app-token', appToken)) {
      return res.status(401).json({ error: 'Invalid app token.' });
    }
  }
  next();
};

/** Never send `ebayClientSecret` to clients; expose only a configured flag. */
const sanitizePortfolioMetaForClient = (doc: PortfolioMetaDoc): PortfolioMetaDoc => {
  const m = { ...(doc as Record<string, unknown>) };
  const has =
    typeof m.ebayClientSecret === 'string' && String(m.ebayClientSecret).trim().length > 0;
  delete m.ebayClientSecret;
  delete m.ebayClientSecretConfigured;
  m.ebayClientSecretConfigured = has;
  return m as PortfolioMetaDoc;
};

const parseCsvNums = (s: string): number[] =>
  String(s || '')
    .split(',')
    .map((x) => Number.parseInt(x.trim(), 10))
    .filter((n) => Number.isFinite(n));

const listParamsFromQuery = (req: express.Request): ListCardsParams => {
  const limit = Math.min(200, Math.max(1, Number.parseInt(String(req.query.limit || '50'), 10) || 50));
  const offset = Math.max(0, Number.parseInt(String(req.query.offset || '0'), 10) || 0);
  const sort = String(req.query.sort || 'ev_desc');
  const search = String(req.query.q || '').trim();
  const pokemonName = String(req.query.pokemonName || '').trim();
  const collectionIds = String(req.query.collectionIds || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  const sets = String(req.query.sets || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  const releaseYears = parseCsvNums(String(req.query.releaseYears || ''));
  const evSignRaw = String(req.query.evSign || 'all');
  const evSign =
    evSignRaw === 'positive' || evSignRaw === 'negative' ? evSignRaw : 'all';
  const pl = String(req.query.profitLens || 'all');
  const profitLens =
    pl === 'raw_no_grade' || pl === 'grade_ev' || pl === 'psa10_win' ? pl : 'all';
  const pkRaw = String(req.query.portfolioKind || 'all');
  const portfolioKind =
    pkRaw === 'single' || pkRaw === 'sealed' ? pkRaw : 'all';
  const inc = String(req.query.include || 'payload').toLowerCase();
  const payloadMode =
    inc === 'ids' ? 'ids' : inc === 'summary' ? 'summary' : 'full';
  return {
    limit,
    offset,
    sort,
    search,
    pokemonName,
    collectionIds,
    sets,
    releaseYears,
    evSign,
    profitLens,
    portfolioKind,
    payloadMode,
    includePayload: payloadMode !== 'ids',
  };
};

app.use('/images', express.static(IMAGES_DIR, { maxAge: '1d' }));
app.get('/api/health', (_req, res) =>
  res.json({
    ok: true,
    mode: strictAuthMode ? 'hardened' : 'dev',
  })
);

app.get('/api/portfolio/meta', (_req, res) => {
  try {
    let meta = readPortfolioMeta(DATA_DIR);
    if (!meta) {
      meta = defaultEmptyMeta();
      writePortfolioMeta(DATA_DIR, meta);
    }
    return res.json(sanitizePortfolioMetaForClient(meta));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
});

app.patch('/api/portfolio/meta', requireStoreWriteAuth, async (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ error: 'Body must be a JSON object.' });
    }
    const cur = readPortfolioMeta(DATA_DIR) ?? defaultEmptyMeta();
    const prevFees = feesFromMetaDoc(cur);
    const body = { ...(req.body as Record<string, unknown>) };
    delete body.ebayClientSecretConfigured;
    const next = { ...cur, ...body, updatedAt: Date.now() } as PortfolioMetaDoc;
    writePortfolioMeta(DATA_DIR, next);
    const nextFees = feesFromMetaDoc(next);
    if (JSON.stringify(prevFees) !== JSON.stringify(nextFees)) {
      const n = recomputeAllCardCaches(DATA_DIR, nextFees);
      console.log(`[pcgr-server] recomputed metric caches for ${n} cards after fee change`);
    }
    return res.json(sanitizePortfolioMetaForClient(next));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
});

/** Merge fields into existing Arsenal targets by `id` (RawEngine listing watch, etc.). */
app.patch('/api/portfolio/targets', requireStoreWriteAuth, async (req, res) => {
  try {
    const body = req.body as Record<string, unknown>;
    const updates = body?.updates;
    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({ error: 'Body must include non-empty updates: [{ id, ...patches }].' });
    }
    const cur = readPortfolioMeta(DATA_DIR) ?? defaultEmptyMeta();
    const targets = Array.isArray(cur.targets) ? [...(cur.targets as Record<string, unknown>[])].filter(Boolean) : [];
    let changed = 0;
    for (const u of updates) {
      if (!u || typeof u !== 'object' || Array.isArray(u)) continue;
      const patch = u as Record<string, unknown>;
      const id = String(patch.id || '').trim();
      if (!id) continue;
      const idx = targets.findIndex((t) => t && typeof t === 'object' && String((t as Record<string, unknown>).id) === id);
      if (idx < 0) continue;
      const { id: _idDrop, ...rest } = patch;
      const prev = targets[idx] as Record<string, unknown>;
      targets[idx] = { ...prev, ...rest, id: prev.id, updatedAt: Date.now() };
      changed += 1;
    }
    if (changed === 0) {
      return res.json({ ok: true, merged: 0, updatedAt: cur.updatedAt ?? Date.now() });
    }
    const updatedAt = Date.now();
    writePortfolioMeta(DATA_DIR, { ...cur, targets, updatedAt } as PortfolioMetaDoc);
    return res.json({ ok: true, merged: changed, updatedAt });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
});

app.get('/api/cards', (_req, res) => {
  try {
    const p = listParamsFromQuery(_req);
    const { items, total } = listCardsPage(DATA_DIR, p);
    return res.json({
      items,
      total,
      limit: p.limit,
      offset: p.offset,
      sort: p.sort,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
});

app.get('/api/cards/:id', (req, res) => {
  try {
    const cid = String(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
    const card = getCardById(DATA_DIR, cid);
    if (!card) return res.status(404).json({ error: 'Not found' });
    return res.json(card);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
});

app.post('/api/cards', requireStoreWriteAuth, (req, res) => {
  try {
    const meta = readPortfolioMeta(DATA_DIR) ?? defaultEmptyMeta();
    const fees = feesFromMetaDoc(meta);
    const body = req.body as Record<string, unknown>;
    const id = String(body?.id || '').trim();
    if (!id) return res.status(400).json({ error: 'id required' });
    upsertCardFull(DATA_DIR, { ...body, id }, fees);
    return res.json(getCardById(DATA_DIR, id));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
});

app.put('/api/cards/:id', requireStoreWriteAuth, (req, res) => {
  try {
    const cid = String(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
    const meta = readPortfolioMeta(DATA_DIR) ?? defaultEmptyMeta();
    const fees = feesFromMetaDoc(meta);
    const body = req.body as Record<string, unknown>;
    if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Invalid body' });
    upsertCardFull(DATA_DIR, { ...body, id: cid }, fees);
    return res.json(getCardById(DATA_DIR, cid));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
});

app.patch('/api/cards/:id', requireStoreWriteAuth, (req, res) => {
  try {
    const cid = String(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
    const meta = readPortfolioMeta(DATA_DIR) ?? defaultEmptyMeta();
    const fees = feesFromMetaDoc(meta);
    const patch = req.body as Record<string, unknown>;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      return res.status(400).json({ error: 'Body must be an object.' });
    }
    const next = patchCardPayload(DATA_DIR, cid, patch, fees);
    if (!next) return res.status(404).json({ error: 'Not found' });
    return res.json(next);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
});

app.delete('/api/cards/:id', requireStoreWriteAuth, (req, res) => {
  try {
    const cid = String(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
    const ok = deleteCardById(DATA_DIR, cid);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    return res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
});

app.post('/api/cards/batch-upsert', requireStoreWriteAuth, (req, res) => {
  try {
    const meta = readPortfolioMeta(DATA_DIR) ?? defaultEmptyMeta();
    const fees = feesFromMetaDoc(meta);
    const cards = Array.isArray((req.body as { cards?: unknown })?.cards)
      ? ((req.body as { cards: unknown[] }).cards as unknown[])
      : [];
    let n = 0;
    for (const c of cards) {
      if (!c || typeof c !== 'object') continue;
      const id = String((c as Record<string, unknown>).id || '').trim();
      if (!id) continue;
      upsertCardFull(DATA_DIR, { ...(c as Record<string, unknown>), id }, fees);
      n += 1;
    }
    return res.json({ ok: true, upserted: n });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
});

/** Large imports: POST JSON `{ "ndjson": "one card JSON per line..." }` (avoids shipping a giant JSON array). */
app.post('/api/portfolio/import-ndjson', requireStoreWriteAuth, (req, res) => {
  try {
    const raw =
      typeof (req.body as { ndjson?: string })?.ndjson === 'string'
        ? (req.body as { ndjson: string }).ndjson
        : '';
    const meta = readPortfolioMeta(DATA_DIR) ?? defaultEmptyMeta();
    const fees = feesFromMetaDoc(meta);
    let imported = 0;
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        const card = JSON.parse(t) as Record<string, unknown>;
        const id = String(card.id || '').trim();
        if (!id) continue;
        upsertCardFull(DATA_DIR, { ...card, id }, fees);
        imported += 1;
      } catch {
        /* skip malformed line */
      }
    }
    const m = readPortfolioMeta(DATA_DIR);
    if (m) writePortfolioMeta(DATA_DIR, { ...m, updatedAt: Date.now() });
    return res.json({ ok: true, imported });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
});

app.get('/api/portfolio/summary', (req, res) => {
  try {
    const meta = readPortfolioMeta(DATA_DIR) ?? defaultEmptyMeta();
    const fees = feesFromMetaDoc(meta);
    const base = listParamsFromQuery(req);
    const filter: Omit<ListCardsParams, 'limit' | 'offset' | 'sort' | 'includePayload' | 'payloadMode'> = {
      search: base.search,
      pokemonName: base.pokemonName,
      collectionIds: base.collectionIds,
      sets: base.sets,
      releaseYears: base.releaseYears,
      evSign: base.evSign,
      profitLens: base.profitLens,
      portfolioKind: base.portfolioKind,
    };
    const hasFilter =
      Boolean(base.search) ||
      Boolean(base.pokemonName) ||
      (base.collectionIds?.length ?? 0) > 0 ||
      (base.sets?.length ?? 0) > 0 ||
      (base.releaseYears?.length ?? 0) > 0 ||
      base.evSign !== 'all' ||
      base.profitLens !== 'all' ||
      (base.portfolioKind ?? 'all') !== 'all';
    const summary = aggregatePortfolioSummary(DATA_DIR, fees, hasFilter ? filter : undefined);
    return res.json(summary);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
});

app.post('/api/ext/capture', requireExtOrAppTokenForCapture, async (req, res) => {
  try {
    const payload = validateCapturePayload(req.body);
    const file = await saveExtensionCapture(DATA_DIR, payload);
    let portfolioMerge: Awaited<ReturnType<typeof mergeExtensionCaptureIntoPortfolio>> = {
      touched: 0,
      diagnostics: [],
    };
    try {
      portfolioMerge = await mergeExtensionCaptureIntoPortfolio(DATA_DIR, storage, payload);
    } catch (mergeErr) {
      const msg = mergeErr instanceof Error ? mergeErr.message : String(mergeErr);
      console.warn('[ext/capture] portfolio merge failed:', mergeErr);
      portfolioMerge = {
        touched: 0,
        diagnostics: [],
        error: msg,
        warning: 'Portfolio merge failed — capture file was saved but the card was not updated.',
      };
    }
    return res.json({
      ok: true,
      source: payload.source,
      capturedAt: payload.capturedAt,
      file,
      portfolioMerge,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(400).json({ error: msg });
  }
});

/** MV3 extension (Edge/Chrome): report eBay DOM session probe for Arsenal / Quick Fetch. */
app.post('/api/ext/ebay-session', requireExtOrAppTokenForCapture, (req, res) => {
  try {
    const parsed = parseEbaySessionExtensionPostBody(req.body);
    if (!parsed) {
      return res.status(400).json({
        error: 'Body must be JSON with status: signed-in | signed-out | unknown (optional url, title).',
      });
    }
    const cur = readPortfolioMeta(DATA_DIR) ?? defaultEmptyMeta();
    const now = Date.now();
    const next = mergeEbaySessionExtensionReport(cur, parsed, now);
    writePortfolioMeta(DATA_DIR, next);
    return res.json({ ok: true, reportedAt: now });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
});

/**
 * RawEngine: ingest a PriceCharting product URL using the same scrape pipeline as
 * Add Card → Fetch (server `/api/scrape`), then upsert into SQLite. New cards
 * get a TCGPlayer product snapshot when PC exposes a TCG URL.
 */
app.get('/api/ext/dashboard-card', requireExtOrAppTokenForCapture, (req, res) => {
  try {
    const source = String(req.query.source || '').trim().toLowerCase();
    const pageUrl = String(req.query.url || '').trim();
    if (source !== 'pricecharting' && source !== 'tcgplayer') {
      return res.status(400).json({ error: 'source must be pricecharting or tcgplayer' });
    }
    if (!pageUrl) return res.status(400).json({ error: 'url is required' });
    if (!appPortfolioReady(DATA_DIR)) {
      return res.json({ ok: true, inPortfolio: false });
    }
    const id = findCardIdByDashboardSourceUrl(DATA_DIR, source, pageUrl);
    return res.json({ ok: true, inPortfolio: Boolean(id), id: id || undefined });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
});

app.post(
  '/api/ext/pricecharting/sync',
  requireExtOrAppTokenForCapture,
  async (req, res) => {
    try {
      const rawUrl = String(req.body?.url || '').trim();
      if (!rawUrl) return res.status(400).json({ error: 'url is required' });
      const canonicalUrl = canonicalizePricechartingUrl(rawUrl);
      if (!canonicalUrl) {
        return res.status(400).json({ error: 'Must be a valid pricecharting.com URL' });
      }
      const pk = req.body?.portfolioKind;
      const portfolioKind = pk === 'sealed' || pk === 'single' ? pk : undefined;
      const { cardId, created } = await syncPricechartingUrlIntoPortfolio(
        DATA_DIR,
        IMAGES_DIR,
        rawUrl,
        { portfolioKind }
      );
      return res.json({
        ok: true,
        cardId,
        created,
        url: canonicalUrl,
        portfolioMerge: { touched: 1, diagnostics: [] as unknown[] },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[pricecharting/sync]', msg);
      if (/PriceCharting responded\s+\d+/i.test(msg)) {
        return res.status(502).json({ error: `Scrape failed: ${msg}` });
      }
      return res.status(500).json({ error: msg });
    }
  }
);

app.get('/api/ext/capture/latest', async (req, res) => {
  const source = String(req.query.source || '').trim().toLowerCase();
  const url = String(req.query.url || '').trim();
  if (source !== 'tcgplayer' && source !== 'pricecharting' && source !== 'ebay') {
    return res
      .status(400)
      .json({ error: 'source must be tcgplayer, pricecharting, or ebay.' });
  }
  try {
    const relaxedEbay =
      String(req.query.relaxedEbay || req.query.sealed || '').trim() === '1' ||
      String(req.query.relaxedEbay || req.query.sealed || '').trim().toLowerCase() === 'true';
    const hit = await findLatestExtensionCapture(
      DATA_DIR,
      source as 'tcgplayer' | 'pricecharting' | 'ebay',
      url || undefined,
      source === 'ebay' && relaxedEbay ? { relaxedEbayMatch: true } : undefined
    );
    return res.json({
      capture: hit,
      normalized: hit ? normalizeExtensionForResponse(hit) : null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
});

app.get('/api/ext/capture/history', async (req, res) => {
  const source = String(req.query.source || '').trim().toLowerCase();
  const url = String(req.query.url || '').trim();
  const search = String(req.query.search || '').trim();
  const sortByRaw = String(req.query.sortBy || '').trim().toLowerCase();
  const sortDirRaw = String(req.query.sortDir || '').trim().toLowerCase();
  const limitRaw = Number.parseInt(String(req.query.limit || ''), 10);
  const offsetRaw = Number.parseInt(String(req.query.offset || ''), 10);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, limitRaw)) : 100;
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0;
  const parseDateArg = (value: unknown): number | undefined => {
    const s = String(value || '').trim();
    if (!s) return undefined;
    const asNum = Number(s);
    if (Number.isFinite(asNum)) return asNum < 1_000_000_000_000 ? asNum * 1000 : asNum;
    const ts = Date.parse(s);
    return Number.isFinite(ts) ? ts : undefined;
  };
  const startDateMs = parseDateArg(req.query.startDate);
  const endDateMs = parseDateArg(req.query.endDate);
  const sortBy =
    sortByRaw === 'url' || sortByRaw === 'title' || sortByRaw === 'capturedat'
      ? (sortByRaw === 'capturedat' ? 'capturedAt' : sortByRaw)
      : 'capturedAt';
  const sortDir = sortDirRaw === 'asc' ? 'asc' : 'desc';
  if (source !== 'tcgplayer' && source !== 'pricecharting' && source !== 'ebay') {
    return res
      .status(400)
      .json({ error: 'source must be tcgplayer, pricecharting, or ebay.' });
  }
  try {
    const history = await listExtensionCaptureHistory(
      DATA_DIR,
      source as 'tcgplayer' | 'pricecharting' | 'ebay',
      {
        url: url || undefined,
        limit,
        offset,
        startDateMs,
        endDateMs,
        search: search || undefined,
        sortBy: sortBy as 'capturedAt' | 'url' | 'title',
        sortDir,
      }
    );
    const normalized =
      source === 'tcgplayer'
        ? history.captures.map((x) => normalizeTcgCapture(x)).filter(Boolean)
        : source === 'ebay'
          ? history.captures.map((x) => normalizeEbayCapture(x)).filter(Boolean)
          : [];
    return res.json({
      captures: history.captures,
      normalized,
      total: history.total,
      limit: history.limit,
      offset: history.offset,
      hasMore: history.offset + history.captures.length < history.total,
      nextOffset:
        history.offset + history.captures.length < history.total
          ? history.offset + history.captures.length
          : null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
});

app.post('/api/maintenance/extension-captures/ebay-title-backfill', requireMaintOrAppToken, async (req, res) => {
  try {
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const force = body.force === true;
    const dryRun = body.dryRun === true;
    const result = await backfillEbayCaptureTitleMetadata(DATA_DIR, { force, dryRun });
    return res.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
});

app.post('/api/maintenance/portfolio/repair-pricecharting-links', requireMaintOrAppToken, async (req, res) => {
  try {
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const dryRun = body.dryRun === true;
    const force = body.force === true;
    const sqliteDoc = await readPortfolioSqlite(DATA_DIR);
    const currentDoc = sqliteDoc && typeof sqliteDoc.updatedAt === 'number' && sqliteDoc.updatedAt > 0
      ? sqliteDoc
      : await storage.read();
    const rawCards = Array.isArray((currentDoc as Record<string, unknown>).cards)
      ? ((currentDoc as Record<string, unknown>).cards as unknown[])
      : [];
    const cards = rawCards.map((x) =>
      x && typeof x === 'object' ? ({ ...(x as Record<string, unknown>) }) : ({} as Record<string, unknown>)
    );

    let scanned = 0;
    let candidates = 0;
    let updated = 0;
    let fetchFailed = 0;
    const touched: Array<{ id: string; name: string; oldTcg: string; newTcg: string }> = [];

    for (let i = 0; i < cards.length; i += 1) {
      const c = cards[i];
      scanned += 1;
      const pcUrl = String(c?.url || '').trim();
      if (!/^https?:\/\/(www\.)?pricecharting\.com\//i.test(pcUrl)) continue;
      const oldTcg = String(c?.tcgplayerUrl || '').trim();
      if (!force && oldTcg) continue;
      candidates += 1;
      try {
        const pageRes = await fetch(pcUrl, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
          },
        });
        if (!pageRes.ok) throw new Error(`PriceCharting responded ${pageRes.status}`);
        const html = await pageRes.text();
        const parsed = parseCardHtml(html, pcUrl);
        const nextTcg = String(parsed.tcgplayerUrl || '').trim();
        if (!nextTcg) continue;
        if (nextTcg === oldTcg) continue;
        touched.push({
          id: String(c.id || ''),
          name: String(c.name || ''),
          oldTcg,
          newTcg: nextTcg,
        });
        cards[i] = {
          ...c,
          tcgplayerUrl: nextTcg,
          cardNumber: String(c.cardNumber || parsed.cardNumber || '').trim(),
        };
        updated += 1;
      } catch {
        fetchFailed += 1;
      }
      // Keep request pace moderate to reduce anti-bot flags.
      await new Promise((r) => setTimeout(r, 420));
    }

    if (!dryRun && updated > 0) {
      const nextDoc = { ...(currentDoc as Record<string, unknown>), cards };
      const written = await storage.write(nextDoc);
      await writePortfolioSqlite(DATA_DIR, written);
    }

    return res.json({
      ok: true,
      dryRun,
      force,
      scanned,
      candidates,
      updated,
      fetchFailed,
      touched: touched.slice(0, 50),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
});

app.post('/api/maintenance/portfolio/rebuild-pricecharting-stats', requireMaintOrAppToken, async (req, res) => {
  try {
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const dryRun = body.dryRun === true;
    const sqliteDoc = await readPortfolioSqlite(DATA_DIR);
    const currentDoc =
      sqliteDoc && typeof sqliteDoc.updatedAt === 'number' && sqliteDoc.updatedAt > 0
        ? sqliteDoc
        : await storage.read();
    const rawCards = Array.isArray((currentDoc as Record<string, unknown>).cards)
      ? ((currentDoc as Record<string, unknown>).cards as unknown[])
      : [];
    const cards = rawCards.map((x) =>
      x && typeof x === 'object' ? ({ ...(x as Record<string, unknown>) }) : ({} as Record<string, unknown>)
    );

    let scanned = 0;
    let candidates = 0;
    let updated = 0;
    let fetchFailed = 0;
    const touched: Array<{ id: string; name: string; url: string }> = [];

    for (let i = 0; i < cards.length; i += 1) {
      const c = cards[i];
      scanned += 1;
      const pcUrl = String(c?.url || '').trim();
      if (!/^https?:\/\/(www\.)?pricecharting\.com\//i.test(pcUrl)) continue;
      candidates += 1;
      try {
        const pageRes = await fetch(pcUrl, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
          },
        });
        if (!pageRes.ok) throw new Error(`PriceCharting responded ${pageRes.status}`);
        const html = await pageRes.text();
        const parsed = parseCardHtml(html, pcUrl);

        const nextCard: Record<string, unknown> = {
          ...c,
          raw: typeof parsed.raw === 'number' && Number.isFinite(parsed.raw) ? parsed.raw : c.raw,
          grade9: typeof parsed.grade9 === 'number' && Number.isFinite(parsed.grade9) ? parsed.grade9 : c.grade9,
          psa10: typeof parsed.psa10 === 'number' && Number.isFinite(parsed.psa10) ? parsed.psa10 : c.psa10,
          allPrices: Array.isArray(parsed.allPrices) ? parsed.allPrices : c.allPrices,
          recentSales: Array.isArray(parsed.recentSales) ? parsed.recentSales : c.recentSales,
          salesVolume: parsed.salesVolume && typeof parsed.salesVolume === 'object' ? parsed.salesVolume : c.salesVolume,
          cardNumber: String(c.cardNumber || parsed.cardNumber || '').trim(),
          releaseDateMs:
            typeof parsed.releaseDateMs === 'number' && Number.isFinite(parsed.releaseDateMs)
              ? parsed.releaseDateMs
              : c.releaseDateMs,
          tcgplayerUrl:
            typeof parsed.tcgplayerUrl === 'string' && parsed.tcgplayerUrl.trim()
              ? parsed.tcgplayerUrl.trim()
              : c.tcgplayerUrl,
          lastRefreshedAt: Date.now(),
        };
        cards[i] = nextCard;
        updated += 1;
        touched.push({
          id: String(c.id || ''),
          name: String(c.name || ''),
          url: pcUrl,
        });
      } catch {
        fetchFailed += 1;
      }
      await new Promise((r) => setTimeout(r, 420));
    }

    if (!dryRun && updated > 0) {
      const nextDoc = { ...(currentDoc as Record<string, unknown>), cards };
      const written = await storage.write(nextDoc);
      await writePortfolioSqlite(DATA_DIR, written);
    }

    return res.json({
      ok: true,
      dryRun,
      scanned,
      candidates,
      updated,
      fetchFailed,
      touched: touched.slice(0, 50),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
});

app.post('/api/ext/capture/ebay/listing-tags', requireMaintOrAppToken, async (req, res) => {
  try {
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const url = String(body.url || '').trim();
    const itemId = body.itemId != null ? String(body.itemId).trim() || null : null;
    const soldAt = typeof body.soldAt === 'number' ? body.soldAt : null;
    const price = typeof body.price === 'number' ? body.price : null;
    const correctedPrice = typeof body.correctedPrice === 'number' ? body.correctedPrice : null;
    const title = body.title != null ? String(body.title).trim() || null : null;
    const isGraded = body.isGraded === true;
    const grader = body.grader != null ? String(body.grader).trim().toUpperCase() || null : null;
    const gradeTag = body.gradeTag != null ? String(body.gradeTag).trim() || null : null;
    const conditionTag =
      body.conditionTag != null ? String(body.conditionTag).trim().toUpperCase() || null : null;
    const isLot = body.isLot === true ? true : body.isLot === false ? false : null;
    const lotQuantity =
      typeof body.lotQuantity === 'number' && Number.isFinite(body.lotQuantity)
        ? Math.max(1, Math.round(body.lotQuantity))
        : null;
    const pokemonCenterStamp =
      body.pokemonCenterStamp === true ? true : body.pokemonCenterStamp === false ? false : null;
    const sealedInTitle =
      body.sealedInTitle === true ? true : body.sealedInTitle === false ? false : null;
    const updated = await updateLatestEbayCaptureListingTags(DATA_DIR, {
      url,
      itemId,
      soldAt,
      price,
      correctedPrice,
      title,
      isGraded,
      grader: grader as 'PSA' | 'CGC' | 'BGS' | 'SGC' | 'TAG' | 'ACE' | 'AI' | null,
      gradeTag,
      conditionTag: conditionTag as 'NM' | 'LP' | 'MP' | 'HP' | 'DMG' | null,
      isLot,
      lotQuantity,
      pokemonCenterStamp,
      sealedInTitle,
    });
    if (!updated) {
      let normKey = '';
      try {
        normKey = url ? normalizeForMatch(url) : '';
      } catch {
        normKey = '';
      }
      const dbg = `[listing-tags 404] dataDir=${DATA_DIR} norm=${normKey} itemId=${itemId ?? ''} soldAt=${soldAt ?? ''} price=${price ?? ''} title=${title ? String(title).slice(0, 120) : ''}`;
      console.warn(`[pcgr-server] ${dbg}`);
      try {
        const logDir = path.join(DATA_DIR, 'logs');
        await fs.mkdir(logDir, { recursive: true });
        await fs.appendFile(path.join(logDir, 'capture-debug.log'), `${new Date().toISOString()} ${dbg}\n`);
      } catch {
        /* ignore log failures */
      }
      return res.status(404).json({ error: 'Matching ebay capture/listing not found.' });
    }
    return res.json({
      ok: true,
      capture: updated.capture,
      normalized: updated.normalized,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(400).json({ error: msg });
  }
});

app.get('/api/portfolio/storage-locations', (_req, res) => {
  try {
    return res.json({
      dataDir: DATA_DIR,
      backupVaultDir: storage.backupDir,
      legacyBackupsDir: path.join(DATA_DIR, 'backups'),
      portfolioJson: storage.dataFile,
      appPortfolioDb: getAppPortfolioDbPath(DATA_DIR),
      imagesDir: IMAGES_DIR,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
});

app.get('/api/admin/database-center', requireMaintOrAppToken, async (_req, res) => {
  try {
    const captureStats = await getExtensionCaptureAdminStats(DATA_DIR);
    const portfolioSqlite = await getPortfolioSqliteAdminStats(DATA_DIR);
    const backups = await storage.listBackups();
    const rotating = await listRotatingBackups(DATA_DIR);
    const meta = readPortfolioMeta(DATA_DIR);
    const backupSettings = getBackupSettingsFromMeta(meta);
    return res.json({
      ok: true,
      captureStats,
      portfolio: {
        dataFile: storage.dataFile,
        backupVaultDir: storage.backupDir,
        backupsCount: backups.length,
        latestBackup: backups[0] ?? null,
      },
      portfolioSqlite,
      appPortfolio: {
        dbPath: getAppPortfolioDbPath(DATA_DIR),
        cardCount: totalCardCount(DATA_DIR),
      },
      rotatingBackups: {
        sqlDir: rotating.sqlDir,
        jsonDir: rotating.jsonDir,
        sqlCount: rotating.sql.length,
        jsonCount: rotating.json.length,
        latestSql: rotating.sql[0]?.name ?? null,
        latestJson: rotating.json[0]?.name ?? null,
        backupSettings,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
});

app.get('/api/admin/portfolio-rotating-backups', requireMaintOrAppToken, async (_req, res) => {
  try {
    const list = await listRotatingBackups(DATA_DIR);
    const meta = readPortfolioMeta(DATA_DIR);
    return res.json({
      ok: true,
      ...list,
      backupSettings: getBackupSettingsFromMeta(meta),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
});

app.post('/api/admin/portfolio-rotating-backups/run', requireMaintOrAppToken, async (req, res) => {
  try {
    const force = (req.body && typeof req.body === 'object' && (req.body as { force?: boolean }).force) === true;
    const result = await runRotatingPortfolioBackups(DATA_DIR, { force });
    return res.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
});

app.post('/api/admin/portfolio-restore/sql', requireMaintOrAppToken, async (req, res) => {
  try {
    const name = String((req.body && typeof req.body === 'object' ? (req.body as { filename?: string }).filename : '') || '').trim();
    if (!name) return res.status(400).json({ error: 'filename required' });
    await restorePortfolioDbFromSqlBackup(DATA_DIR, name);
    return res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(400).json({ error: msg });
  }
});

app.post('/api/admin/portfolio-restore/json', requireMaintOrAppToken, async (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'JSON body required' });
    }
    const r = importLegacyPortfolioDoc(DATA_DIR, req.body as PortfolioDoc);
    return res.json({ ok: true, cardsImported: r.cardsImported });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
});

/**
 * Portfolio store — compatibility layer. Primary API is `/api/portfolio/meta`
 * + `/api/cards` (paginated). This endpoint returns meta plus `cardCount`;
 * card rows are listed via GET `/api/cards`.
 */
app.get('/api/store', async (_req, res) => {
  try {
    let meta = readPortfolioMeta(DATA_DIR);
    if (!meta) {
      const sqliteDoc = await readPortfolioSqlite(DATA_DIR);
      if (sqliteDoc && typeof sqliteDoc.updatedAt === 'number' && sqliteDoc.updatedAt > 0) {
        return res.json(sqliteDoc);
      }
      const doc = await storage.read();
      return res.json(doc);
    }
    const n = totalCardCount(DATA_DIR);
    return res.json({
      ...meta,
      cards: [],
      updatedAt: meta.updatedAt ?? Date.now(),
      cardCount: n,
      _storeApi: 'meta+cards',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: `Store read failed: ${msg}` });
  }
});

app.put('/api/store', requireStoreWriteAuth, async (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ error: 'Request body must be a JSON object.' });
    }
    const body = req.body as Record<string, unknown>;
    const cardsIn = Array.isArray(body.cards) ? (body.cards as unknown[]) : [];
    const metaPatch = { ...body };
    delete metaPatch.cards;
    delete metaPatch._storeApi;
    delete metaPatch.cardCount;
    const cur = readPortfolioMeta(DATA_DIR) ?? defaultEmptyMeta();
    const mergedMeta = { ...cur, ...metaPatch, updatedAt: Date.now() } as PortfolioMetaDoc;
    writePortfolioMeta(DATA_DIR, mergedMeta);
    const fees = feesFromMetaDoc(mergedMeta);
    const keep = new Set<string>();
    for (const c of cardsIn) {
      if (!c || typeof c !== 'object') continue;
      const id = String((c as Record<string, unknown>).id || '').trim();
      if (!id) continue;
      keep.add(id);
      upsertCardFull(DATA_DIR, { ...(c as Record<string, unknown>), id }, fees);
    }
    if (String(req.query.replace || '') === '1') {
      const db = openAppPortfolioDb(DATA_DIR);
      const rows = db.prepare('SELECT id FROM cards').all() as { id: string }[];
      for (const r of rows) {
        if (!keep.has(r.id)) deleteCardById(DATA_DIR, r.id);
      }
    }
    return res.json({
      ok: true,
      updatedAt: mergedMeta.updatedAt,
      version: mergedMeta.version ?? 1,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: `Store write failed: ${msg}` });
  }
});

app.get('/api/store/backups', async (_req, res) => {
  try {
    const files = await storage.listBackups();
    return res.json({ backups: files });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
});

app.get('/api/scrape', async (req, res) => {
  const raw = String(req.query.url || '').trim().replace(/\/+$/, '');
  const canonicalUrl = canonicalizePricechartingUrl(raw);
  if (!canonicalUrl) {
    return res.status(400).json({ error: 'Must be a valid pricecharting.com URL' });
  }
  try {
    const { scraped, slug, localImage } = await fetchPricechartingProductWithImages(canonicalUrl, IMAGES_DIR);
    return res.json({
      ...scraped,
      slug,
      localImage,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(502).json({ error: `Scrape failed: ${msg}` });
  }
});

app.get('/api/pricecharting/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'q is required' });
  const normalized = q.replace(/\s+/g, ' ').trim();
  const compact = normalized
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[^a-z0-9#\s-]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const coarse = compact
    .replace(/\s+#\s*[a-z0-9-]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const attempts = Array.from(
    new Set([normalized, compact, coarse].filter((v) => v.length >= 3))
  );

  const parseLinks = (html: string): string[] => {
    const $ = cheerio.load(html);
    const links: string[] = [];
    $('a[href]').each((_, a) => {
      const href = String($(a).attr('href') || '').trim();
      if (!href) return;
      if (!/^\/(game|trading-cards)\//i.test(href)) return;
      const abs = new URL(href, 'https://www.pricecharting.com').toString();
      if (!links.includes(abs)) links.push(abs);
    });
    return links;
  };

  try {
    const headers = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    };
    for (const term of attempts) {
      const urls = [
        `https://www.pricecharting.com/search-products?type=prices&q=${encodeURIComponent(term)}`,
        `https://www.pricecharting.com/search-products?q=${encodeURIComponent(term)}`,
        `https://www.pricecharting.com/search?q=${encodeURIComponent(term)}`,
      ];
      for (const u of urls) {
        const pageRes = await fetch(u, { headers });
        if (!pageRes.ok) continue;
        const html = await pageRes.text();
        const links = parseLinks(html);
        if (links.length > 0) {
          return res.json({ query: q, attempted: term, url: links[0], candidates: links.slice(0, 8) });
        }
      }
    }
    return res.json({
      query: q,
      url: null,
      candidates: [],
      hint: 'No search match found from PriceCharting HTML results.',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Do not throw 502 for collection imports - return a soft miss so bulk
    // jobs can continue without noisy console/network errors.
    return res.json({ query: q, url: null, candidates: [], error: `Search failed: ${msg}` });
  }
});

const nameToSlug = (name: string): string => {
  const clean = name
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9#\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const hash = clean.match(/^(.+?)\s+#\s*([a-z0-9-]+)\b/i);
  if (hash) {
    const card = hash[1].trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return `${card}-${hash[2].toLowerCase()}`;
  }
  return clean.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
};

const extractSourceUrl = (md: string): string | null => {
  const m = md.match(/Source URL:\s*(https?:\/\/www\.pricecharting\.com\/[^\s]+)/i);
  return m ? m[1] : null;
};

let uploadHintCache: Array<{ slug: string; url: string }> | null = null;

const loadUploadHintCache = async (): Promise<Array<{ slug: string; url: string }>> => {
  if (uploadHintCache) return uploadHintCache;
  const out: Array<{ slug: string; url: string }> = [];
  try {
    const files = await fs.readdir(UPLOADS_DIR);
    for (const f of files) {
      if (!f.toLowerCase().endsWith('.md')) continue;
      const full = path.join(UPLOADS_DIR, f);
      const text = await fs.readFile(full, 'utf8');
      const url = extractSourceUrl(text);
      if (!url) continue;
      try {
        const u = new URL(url);
        const slug = u.pathname.split('/').filter(Boolean).pop();
        if (slug) out.push({ slug: slug.toLowerCase(), url: `${u.origin}${u.pathname}` });
      } catch {
        // ignore malformed URL in uploaded markdown
      }
    }
  } catch {
    // uploads folder is optional
  }
  uploadHintCache = out;
  return out;
};

app.get('/api/pricecharting/url-hint', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'q is required' });
  try {
    const target = nameToSlug(q);
    const hints = await loadUploadHintCache();
    const hit = hints.find((h) => h.slug === target);
    return res.json({ query: q, slug: target, url: hit?.url ?? null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.json({ query: q, url: null, error: `Hint lookup failed: ${msg}` });
  }
});

app.get('/api/psa/pop', async (req, res) => {
  const specId = String(req.query.specId || '').trim();
  // Token can come from Authorization: Bearer or X-PSA-Token header.
  const auth = String(req.headers['authorization'] || '');
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  const headerTok = String(req.headers['x-psa-token'] || '').trim();
  const envTok = String(process.env.PSA_TOKEN || '').trim();
  const token = bearer || headerTok || envTok;

  if (!specId) return res.status(400).json({ error: 'specId is required' });
  if (!token) {
    return res.status(401).json({
      error:
        'PSA API token missing. Get a free token at https://www.psacard.com/publicapi and paste it into Settings.',
    });
  }

  try {
    const data = await fetchPsaPopulation(specId, token);
    return res.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = /401/.test(msg) ? 401 : /429/.test(msg) ? 429 : 502;
    return res.status(status).json({ error: msg });
  }
});

app.get('/api/gemrate/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'q is required' });
  try {
    const data = await searchGemRate(q);
    return res.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(502).json({ error: msg });
  }
});

app.get('/api/gemrate/card-details', async (req, res) => {
  const gemrateId = String(req.query.gemrate_id || '').trim();
  if (!gemrateId) return res.status(400).json({ error: 'gemrate_id is required' });
  try {
    const summary = await fetchGemRateCardSummary(gemrateId);
    if (!summary) return res.status(502).json({ error: 'GemRate card-details unavailable' });
    return res.json(summary);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(502).json({ error: msg });
  }
});

app.get('/api/tcgplayer/product', async (req, res) => {
  const url = String(req.query.url || '').trim();
  const pidRaw = String(req.query.productId || '').trim();
  const forceRefresh = String(req.query.forceRefresh || '').trim().length > 0;
  let productId: number | null = null;
  if (url) {
    if (!/^https?:\/\/(www\.)?tcgplayer\.com\/product\/\d+/i.test(url)) {
      return res.status(400).json({ error: 'Must be a tcgplayer.com /product/{id}/… URL' });
    }
    productId = extractTcgplayerProductId(url);
  } else if (pidRaw) {
    const n = parseInt(pidRaw, 10);
    productId = Number.isFinite(n) && n > 0 ? n : null;
  }
  if (!productId) {
    return res.status(400).json({ error: 'Provide url=… or productId=…' });
  }
  try {
    const snap = await fetchTcgplayerProduct(productId, url || undefined, { forceRefresh });
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    return res.json({ ...snap, fetchedAt: Date.now() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(502).json({ error: msg });
  }
});

/**
 * TCGplayer Martech-style **market chart** weekly series. Tries optional env
 * `PCGR_TCGPLAYER_HISTORY_URL_TEMPLATE` (JSON, `{productId}`), then Playwright
 * against the live product page table.
 */
app.get('/api/tcgplayer/history', async (req, res) => {
  const url = String(req.query.url || '').trim();
  if (!/^https?:\/\/(www\.)?tcgplayer\.com\/product\/\d+/i.test(url)) {
    return res.status(400).json({ error: 'Must be a tcgplayer.com /product/{id}/… URL' });
  }
  try {
    const data = await fetchTcgplayerMarketHistory(url);
    return res.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(502).json({ error: msg });
  }
});

app.post('/api/tcgplayer/content-article', async (req, res) => {
  const url = String((req.body as { url?: string })?.url || '').trim();
  if (!url) return res.status(400).json({ error: 'url is required' });
  try {
    assertTcgplayerArticleUrl(url);
    const data = await fetchTcgplayerContentArticle(url);
    return res.json({ ...data, fetchedAt: Date.now(), sourceUrl: url });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const code = /Invalid URL|must be/.test(msg) ? 400 : 502;
    return res.status(code).json({ error: msg });
  }
});

/** Set/catalog browse URL → product ids + mp-search-api details (gallery picker). */
app.post('/api/tcgplayer/catalog-preview', async (req, res) => {
  const url = String((req.body as { url?: string })?.url || '').trim();
  if (!url) return res.status(400).json({ error: 'url is required' });
  try {
    const data = await previewTcgplayerCatalog(url);
    return res.json({ ...data, fetchedAt: Date.now(), sourceUrl: url });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const code =
      /Invalid URL|must be|article/i.test(msg) || /That URL is a TCGPlayer article/.test(msg)
        ? 400
        : 502;
    return res.status(code).json({ error: msg });
  }
});

/** Explicit TCGPlayer product ids → same enrichment as catalog-preview (e.g. links from article HTML). */
app.post('/api/tcgplayer/product-preview-by-ids', async (req, res) => {
  const raw = (req.body as { ids?: unknown })?.ids;
  if (!Array.isArray(raw)) return res.status(400).json({ error: 'ids array is required' });
  const ids = raw.map((x) => Number(x)).filter((n) => Number.isFinite(n));
  try {
    const data = await previewTcgplayerProductIds(ids);
    return res.json({ ...data, fetchedAt: Date.now() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const code = /No valid|required/i.test(msg) ? 400 : 502;
    return res.status(code).json({ error: msg });
  }
});

app.get('/api/tcgplayer/find-buyers-guide', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'q is required' });
  try {
    const meta = readPortfolioMeta(DATA_DIR) ?? {};
    const mk = String((meta as { googleCseKey?: string }).googleCseKey ?? '').trim();
    const mcx = String((meta as { googleCseCx?: string }).googleCseCx ?? '').trim();
    const apiKey = mk || String(process.env.GOOGLE_CSE_KEY ?? '').trim();
    const cx = mcx || String(process.env.GOOGLE_CSE_CX ?? '').trim();
    const r = await searchBuyersGuideArticles(q, {
      apiKey,
      cx,
    });
    if (!r.configured) {
      return res.json({
        configured: false,
        items: [],
        message:
          'Add Google Programmable Search API key + Search engine ID in Admin → Configuration (or set GOOGLE_CSE_KEY / GOOGLE_CSE_CX on the server).',
      });
    }
    if (r.error) return res.status(502).json({ configured: true, items: [], error: r.error });
    return res.json({ configured: true, items: r.items });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(502).json({ error: msg });
  }
});

app.post('/api/ebay/verify-listing', async (req, res) => {
  const body = req.body as {
    itemUrl?: string;
    name?: string;
    set?: string;
    cardNumber?: string;
    listingTitle?: string;
  };
  const itemUrl = String(body?.itemUrl || '').trim();
  if (!itemUrl || !/^https?:\/\/(www\.|m\.)?ebay\.com\/itm\/?/i.test(itemUrl)) {
    return res.status(400).json({ error: 'itemUrl must be an eBay item URL' });
  }
  try {
    let title = String(body?.listingTitle || '').trim();
    if (!title) {
      const t = await fetchEbayItemPageTitle(itemUrl.split('#')[0].split('?')[0]);
      title = t || '';
    }
    const verdict = scoreListingTitleMatch({
      name: String(body?.name || ''),
      set: typeof body?.set === 'string' ? body.set : undefined,
      cardNumber: typeof body?.cardNumber === 'string' ? body.cardNumber : undefined,
      listingTitle: title || '',
    });
    return res.json({ ...verdict, pageTitle: title || null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(502).json({ error: msg });
  }
});

app.get('/api/ebay/sold', requireStoreWriteAuth, async (req, res) => {
  const q = String(req.query.q || '').trim();
  const windowDaysRaw = Number.parseInt(String(req.query.windowDays || ''), 10);
  const limitRaw = Number.parseInt(String(req.query.limit || ''), 10);
  const startDate = String(req.query.startDate || '').trim();
  const endDate = String(req.query.endDate || '').trim();
  const categoryIds = String(req.query.categoryIds || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!q) return res.status(400).json({ error: 'q is required' });
  try {
    const data = await fetchEbaySoldSummary(q, {
      windowDays: Number.isFinite(windowDaysRaw) ? windowDaysRaw : undefined,
      limit: Number.isFinite(limitRaw) ? limitRaw : undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      categoryIds: categoryIds.length ? categoryIds : undefined,
      dataDir: DATA_DIR,
    });
    return res.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(502).json({ error: msg });
  }
});

app.get('/api/ebay/config/status', (_req, res) => {
  try {
    const cur = readPortfolioMeta(DATA_DIR) ?? defaultEmptyMeta();
    const raw = cur as Record<string, unknown>;
    const resolved = resolveEbayAppCredentials(DATA_DIR);
    const apiFirst = raw.ebayApiFirstIncremental !== false;
    return res.json({
      configured: resolved != null,
      env: raw.ebayEnv === 'sandbox' ? 'sandbox' : 'production',
      effectiveCredentialSource: resolved?.source ?? null,
      ebayApiFirstIncremental: apiFirst,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
});

app.get('/api/ebay/config', requireStoreWriteAuth, (_req, res) => {
  try {
    const cur = readPortfolioMeta(DATA_DIR) ?? defaultEmptyMeta();
    const raw = cur as Record<string, unknown>;
    const id = String(raw.ebayClientId ?? '').trim();
    const hasSec = typeof raw.ebayClientSecret === 'string' && String(raw.ebayClientSecret).trim().length > 0;
    const env = raw.ebayEnv === 'sandbox' ? 'sandbox' : 'production';
    const resolved = resolveEbayAppCredentials(DATA_DIR);
    const apiFirst = raw.ebayApiFirstIncremental !== false;
    return res.json({
      ebayClientId: id,
      ebayClientSecretConfigured: hasSec,
      ebayEnv: env,
      ebayApiFirstIncremental: apiFirst,
      effectiveCredentialSource: resolved?.source ?? null,
      effectiveConfigured: resolved != null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
});

app.patch('/api/ebay/config', requireStoreWriteAuth, (req, res) => {
  try {
    const body = req.body as Record<string, unknown>;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ error: 'Body must be a JSON object.' });
    }
    const cur = readPortfolioMeta(DATA_DIR) ?? defaultEmptyMeta();
    const next = { ...cur, updatedAt: Date.now() } as PortfolioMetaDoc;
    const n = next as Record<string, unknown>;
    if (typeof body.ebayClientId === 'string') {
      n.ebayClientId = body.ebayClientId.trim();
    }
    if (body.ebayEnv === 'sandbox' || body.ebayEnv === 'production') {
      n.ebayEnv = body.ebayEnv;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'ebayClientSecret')) {
      const s = typeof body.ebayClientSecret === 'string' ? body.ebayClientSecret.trim() : '';
      n.ebayClientSecret = s;
    }
    if (typeof body.ebayApiFirstIncremental === 'boolean') {
      n.ebayApiFirstIncremental = body.ebayApiFirstIncremental;
    }
    writePortfolioMeta(DATA_DIR, next);
    invalidateEbayTokenCache();
    const hasSec = typeof n.ebayClientSecret === 'string' && String(n.ebayClientSecret).trim().length > 0;
    const resolved = resolveEbayAppCredentials(DATA_DIR);
    return res.json({
      ok: true,
      ebayClientId: String(n.ebayClientId ?? '').trim(),
      ebayClientSecretConfigured: hasSec,
      ebayEnv: n.ebayEnv === 'sandbox' ? 'sandbox' : 'production',
      effectiveCredentialSource: resolved?.source ?? null,
      effectiveConfigured: resolved != null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
});

app.post('/api/ebay/test-token', requireStoreWriteAuth, async (_req, res) => {
  try {
    await getEbayAccessToken(DATA_DIR);
    const resolved = resolveEbayAppCredentials(DATA_DIR);
    return res.json({
      ok: true,
      credentialSource: resolved?.source ?? null,
      env: resolved?.env ?? null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(502).json({ ok: false, error: msg });
  }
});

type EbayBatchQuery = {
  cardId: string;
  q: string;
  windowDays?: number;
  limit?: number;
  startDate?: string;
  endDate?: string;
  categoryIds?: string[];
};

const runWithConcurrency = async <T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, idx: number) => Promise<R>
): Promise<R[]> => {
  const out: R[] = new Array(items.length);
  let next = 0;
  const runOne = async () => {
    while (true) {
      const idx = next;
      next += 1;
      if (idx >= items.length) break;
      out[idx] = await worker(items[idx], idx);
    }
  };
  const workers = Array.from({ length: Math.max(1, concurrency) }, () => runOne());
  await Promise.all(workers);
  return out;
};

app.post('/api/ebay/sold/batch', requireStoreWriteAuth, async (req, res) => {
  const body = req.body as {
    queries?: EbayBatchQuery[];
    concurrency?: number;
  };
  if (!body || !Array.isArray(body.queries)) {
    return res.status(400).json({ error: 'queries[] is required' });
  }
  const queries = body.queries
    .map((q) => ({
      cardId: String(q.cardId || '').trim(),
      q: String(q.q || '').trim(),
      windowDays: typeof q.windowDays === 'number' ? q.windowDays : undefined,
      limit: typeof q.limit === 'number' ? q.limit : undefined,
      startDate: typeof q.startDate === 'string' ? q.startDate : undefined,
      endDate: typeof q.endDate === 'string' ? q.endDate : undefined,
      categoryIds: Array.isArray(q.categoryIds) ? q.categoryIds : undefined,
    }))
    .filter((q) => q.cardId && q.q);
  if (!queries.length) {
    return res.status(400).json({ error: 'At least one query with cardId + q is required' });
  }
  const concurrency = Math.max(1, Math.min(4, Number(body.concurrency) || 2));
  try {
    const results = await runWithConcurrency(queries, concurrency, async (q) => {
      try {
        const data = await fetchEbaySoldSummary(q.q, {
          windowDays: q.windowDays,
          limit: q.limit,
          startDate: q.startDate,
          endDate: q.endDate,
          categoryIds: q.categoryIds,
          dataDir: DATA_DIR,
        });
        return { cardId: q.cardId, ok: true as const, data };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { cardId: q.cardId, ok: false as const, error: msg };
      }
    });
    return res.json({ results, total: queries.length, succeeded: results.filter((r) => r.ok).length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(502).json({ error: msg });
  }
});

app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (res.headersSent) return;
  const msg = err instanceof Error ? err.message : String(err);
  const withStatus = err as { status?: number; statusCode?: number };
  let status =
    typeof withStatus.status === 'number' && Number.isFinite(withStatus.status)
      ? withStatus.status
      : typeof withStatus.statusCode === 'number' && Number.isFinite(withStatus.statusCode)
        ? withStatus.statusCode
        : 500;
  if (status === 500 && /CORS blocked for origin/i.test(msg)) status = 403;
  if (status < 400 || status > 599) status = 500;
  console.warn('[pcgr-server]', req.method, req.url, status, msg);
  res.status(status).json({ error: msg || 'Request failed' });
});

const bootstrapPortfolioV2 = async (): Promise<void> => {
  let meta = readPortfolioMeta(DATA_DIR);
  if (meta) return;
  if (String(process.env.PCGR_IMPORT_LEGACY || '').trim() === '1') {
    try {
      const sqliteDoc = await readPortfolioSqlite(DATA_DIR);
      const doc =
        sqliteDoc && typeof sqliteDoc.updatedAt === 'number' && sqliteDoc.updatedAt > 0
          ? sqliteDoc
          : await storage.read();
      const raw = doc as Record<string, unknown>;
      const cl = raw.cards;
      const n = Array.isArray(cl) ? cl.length : 0;
      if (n > 0) {
        importLegacyPortfolioDoc(DATA_DIR, doc as PortfolioDoc);
        console.log(`[pcgr-server] PCGR_IMPORT_LEGACY: imported ${n} cards into app-portfolio v2`);
        return;
      }
    } catch (e) {
      console.warn('[pcgr-server] legacy import failed:', e);
    }
  }
  writePortfolioMeta(DATA_DIR, defaultEmptyMeta());
  console.log('[pcgr-server] initialized empty app-portfolio v2 meta');
};

app.listen(PORT, () => {
  void (async () => {
    await bootstrapPortfolioV2();
    console.log(`[pcgr-server] listening on http://localhost:${PORT}`);
    console.log(`[pcgr-server] images cached in ${IMAGES_DIR}`);
    console.log(`[pcgr-server] legacy portfolio.json at ${storage.dataFile} (v2 uses app-portfolio/)`);
    initializeExtensionCaptureStore(DATA_DIR)
    .then((r) => {
      console.log(
        `[pcgr-server] extension captures sqlite ready: ${r.totalCaptures} rows (${r.dbPath}).`
      );
    })
    .catch((err) => {
      console.warn('[pcgr-server] extension capture sqlite init failed:', err);
    });
  initializePortfolioSqliteStore(DATA_DIR)
    .then((r) => {
      console.log(
        `[pcgr-server] portfolio sqlite ready: ${r.cardCount} cards (${r.dbPath}).`
      );
    })
    .catch((err) => {
      console.warn('[pcgr-server] portfolio sqlite init failed:', err);
    });
    backfillEbayCaptureTitleMetadata(DATA_DIR)
    .then((r) => {
      if (r.alreadyDone) {
        console.log('[pcgr-server] ebay title metadata backfill already completed.');
        return;
      }
      console.log(
        `[pcgr-server] ebay title metadata backfill done: files ${r.updatedFiles}/${r.scannedFiles}, rows ${r.updatedRows}/${r.scannedRows}.`
      );
    })
    .catch((err) => {
      console.warn('[pcgr-server] ebay title metadata backfill failed:', err);
    });
    setInterval(() => {
      void runRotatingPortfolioBackups(DATA_DIR)
        .then((r) => {
          if (!r.skipped && r.sqlPath) {
            console.log(`[pcgr-server] rotating SQL backup: ${path.basename(r.sqlPath)}`);
          }
          if (!r.skipped && r.jsonPath) {
            console.log(`[pcgr-server] rotating JSON backup: ${path.basename(r.jsonPath)}`);
          }
        })
        .catch((err) => console.warn('[pcgr-server] rotating portfolio backup failed:', err));
    }, 3_600_000);
    void runRotatingPortfolioBackups(DATA_DIR).catch((err) =>
      console.warn('[pcgr-server] initial rotating backup check failed:', err)
    );
  })();
});
