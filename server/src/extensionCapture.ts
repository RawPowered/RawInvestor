import path from 'node:path';
import { promises as fs } from 'node:fs';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import SqliteDatabase from 'better-sqlite3';
import { canonicalizePricechartingUrl } from './pricechartingCanonical.js';
import {
  type CardLanguageTag,
  assessSuspiciousNonEnglish,
  inferLanguageFromImageSignals,
  inferLanguageFromTcgContext,
  inferLanguageTagFromText,
  inferListingLanguage,
  mergeLanguageTags,
} from './plugins/cardLanguageDetect.js';

export type { CardLanguageTag };

export type ExtensionCapturePass =
  | 'ebay-graded-no'
  | 'ebay-graded-yes'
  | 'ebay'
  | 'tcg';

export type ExtensionCapturePayload = {
  source: 'tcgplayer' | 'pricecharting' | 'ebay';
  url: string;
  title?: string;
  capturedAt?: number;
  /** MV3 Quick Fetch lane (dual graded eBay passes). */
  capturePass?: ExtensionCapturePass;
  data: Record<string, unknown>;
};

export type NormalizedTcgSaleRow = {
  at: number;
  condition: string | null;
  qty: number;
  price: number;
  languageTag?: CardLanguageTag;
  hasPhoto?: boolean | null;
  suspiciousLanguagePump?: boolean;
  suspiciousReason?: string | null;
};

export type TcgComparisonMarketPrices = {
  nearMint?: number | null;
  lightlyPlayed?: number | null;
  moderatelyPlayed?: number | null;
  heavilyPlayed?: number | null;
  damaged?: number | null;
};

export type NormalizedTcgCapture = {
  productId: number | null;
  context: {
    language: string | null;
    condition: string | null;
    printing: string | null;
  };
  captureMode: 'default' | 'deep';
  rowCount: number;
  hasMore: boolean;
  comparisonMarketPrices?: TcgComparisonMarketPrices;
  pricePoints: {
    marketPrice: number | null;
    capturedMarketPrice?: number | null;
    mostRecentSale: number | null;
    listedMedian: number | null;
    currentQuantity: number | null;
    currentSellers: number | null;
  };
  latestSalesRows: NormalizedTcgSaleRow[];
};

export type NormalizedEbayRow = {
  title: string;
  price: number;
  unitPrice?: number;
  lotQuantity?: number;
  isLot?: boolean;
  soldAt: number;
  itemId: string | null;
  itemUrl: string | null;
  /** Best-effort listing state for active SRP captures. */
  listingKind?: 'auction' | 'bin' | 'unknown';
  /** Best-effort auction bid amount (when listingKind==='auction'). */
  currentBid?: number | null;
  /** Best-effort BIN price (when listingKind==='bin'). */
  buyItNow?: number | null;
  bidCount?: number | null;
  /** Epoch ms when we think the listing ends (when parseable). */
  endsAtMs?: number | null;
  /** True when capture text indicates free shipping/delivery. When true, shippingCost is omitted/null. */
  freeShipping?: boolean;
  /** Parsed add-on shipping USD when present; null if unknown or free shipping. */
  shippingCost?: number | null;
  bestOfferAccepted?: boolean;
  pokemonCenterStamp?: boolean;
  sealedInTitle?: boolean;
  gradeTag?: string | null;
  grader?: 'PSA' | 'CGC' | 'BGS' | 'SGC' | 'TAG' | 'ACE' | 'AI' | null;
  isGraded?: boolean;
  conditionTag?: 'NM' | 'LP' | 'MP' | 'HP' | 'DMG' | null;
  languageTag?: CardLanguageTag;
  hasPhoto?: boolean | null;
  /** Thumbnail URL from SRP or item page when available. */
  imageUrl?: string | null;
  suspiciousLanguagePump?: boolean;
  suspiciousReason?: string | null;
};

export type NormalizedEbayCapture = {
  query: string;
  captureMode: 'default' | 'deep';
  hasMore: boolean;
  rowCount: number;
  listings: NormalizedEbayRow[];
  /** Rows excluded at scrape time (link/title/ID inconsistency); merged into portfolio `rejectedListings`. */
  excludedListings: NormalizedEbayRow[];
};

export const parseEbayTitleMeta = (
  titleRaw: unknown
): {
  gradeTag: string | null;
  grader: 'PSA' | 'CGC' | 'BGS' | 'SGC' | 'TAG' | 'ACE' | 'AI' | null;
  isGraded: boolean;
  conditionTag: 'NM' | 'LP' | 'MP' | 'HP' | 'DMG' | null;
} => {
  const t = String(titleRaw || '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const grader: 'PSA' | 'CGC' | 'BGS' | 'SGC' | 'TAG' | 'ACE' | 'AI' | null = /\bPSA\b/.test(t)
    ? 'PSA'
    : /\bCGC\b/.test(t)
      ? 'CGC'
      : /\bBGS\b|\bBECKETT\b/.test(t)
        ? 'BGS'
        : /\bSGC\b/.test(t)
          ? 'SGC'
          : /\bACE\b/.test(t)
            ? 'ACE'
          : /\bAI(?:\s*GRADE(?:D)?)?\b/.test(t)
            ? 'AI'
          : /\bTAG\b/.test(t)
            ? 'TAG'
            : null;
  // Common no-space seller styles: PSA10, PSA9, CGC10, ACE10, etc.
  const gluedGrader =
    t.match(/\b(PSA|CGC|BGS|SGC|TAG|ACE|AI)(?:\s*)(10|[1-9](?:\.\d)?)\b/) ??
    t.match(/\b(10|[1-9](?:\.\d)?)(?:\s*)(PSA|CGC|BGS|SGC|TAG|ACE|AI)\b/);
  const gluedGraderName = gluedGrader
    ? ((/PSA|CGC|BGS|SGC|TAG|ACE|AI/.exec(gluedGrader[0])?.[0] ?? null) as
        | 'PSA'
        | 'CGC'
        | 'BGS'
        | 'SGC'
        | 'TAG'
        | 'ACE'
        | 'AI'
        | null)
    : null;
  const mPristine =
    t.match(/\b(?:PRISTINE|BLACK LABEL)\s*(10)\b/) ||
    t.match(/\b10\s*(?:PRISTINE|BLACK LABEL)\b/);
  const mSimple = t.match(/\b(?:PSA|CGC|BGS|SGC|TAG|ACE|AI|BECKETT)\s*(\d{1,2}(?:\.\d)?)\b/);
  const mSimpleNoSpace =
    t.match(/\b(?:PSA|CGC|BGS|SGC|TAG|ACE|AI)(10|[1-9](?:\.\d)?)\b/) ||
    t.match(/\b(10|[1-9](?:\.\d)?)(?:PSA|CGC|BGS|SGC|TAG|ACE|AI)\b/);
  const resolvedGrader = grader ?? gluedGraderName;
  const resolvedGrade = mSimple?.[1] ?? mSimpleNoSpace?.[1] ?? null;
  const gradeTag =
    mPristine && resolvedGrader
      ? `${resolvedGrader} 10 PRISTINE`
      : resolvedGrade && resolvedGrader
        ? `${resolvedGrader} ${resolvedGrade}`
        : null;
  const conditionTag: 'NM' | 'LP' | 'MP' | 'HP' | 'DMG' | null = /\bNEAR MINT\b|\bNM\b/.test(t)
    ? 'NM'
    : /\bLIGHTLY PLAYED\b|\bLP\b/.test(t)
      ? 'LP'
      : /\bMODERATELY PLAYED\b|\bMP\b/.test(t)
        ? 'MP'
        : /\bHEAVILY PLAYED\b|\bHP\b/.test(t)
          ? 'HP'
          : /\bDAMAGED\b|\bDMG\b/.test(t)
            ? 'DMG'
            : null;
  return { gradeTag, grader: resolvedGrader, isGraded: Boolean(resolvedGrader && gradeTag), conditionTag };
};

export const parseLotMetaFromTitle = (
  titleRaw: unknown
): { lotQuantity: number; isLot: boolean } => {
  const raw = String(titleRaw || '');
  // Card numbers like "80/83" are identifiers, not lot quantities.
  const hasCardFractionPattern = /\b\d{1,3}\s*\/\s*\d{1,3}\b/.test(raw);
  const t = raw
    .toLowerCase()
    .replace(/[^a-z0-9\s#x-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return { lotQuantity: 1, isLot: false };
  if (/\bplayset\b/i.test(t)) return { lotQuantity: 4, isLot: true };

  const explicitQtyPatterns = [
    /\blot of\s+(\d{1,3})\b/i,
    /\bqty\s*:?\s*(\d{1,3})\b/i,
    /\bx\s*(\d{1,3})\b/i, // x10
    /\b(\d{1,3})\s*x\b/i, // 10x
  ];
  for (const p of explicitQtyPatterns) {
    const m = t.match(p);
    if (!m) continue;
    const qty = Number.parseInt(m[1] || '', 10);
    if (!Number.isFinite(qty) || qty <= 1 || qty > 500) continue;
    // If title looks like a card-number fraction, only trust strongly explicit
    // lot wording such as "lot of N" or "qty N", not bare xN/ Nx.
    const strongLotWord = /\blot of\b|\bqty\b/i.test(t);
    if (hasCardFractionPattern && !strongLotWord) continue;
    return { lotQuantity: qty, isLot: true };
  }
  return { lotQuantity: 1, isLot: false };
};

const normalizeForPokemonCenterTitle = (s: string): string =>
  String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** eBay: "Pokemon Center" / "POKEMON CENTER" / "Pokemon Center Stamped" / stamp in title, etc. */
export const parsePokemonCenterStampFromTitle = (titleRaw: unknown): boolean => {
  const t = normalizeForPokemonCenterTitle(String(titleRaw || ''));
  if (/\bpokemon center stamped\b/.test(t)) return true;
  if (/\bpokemon center stamp\b/.test(t)) return true;
  if (/\bpokemon center\b/.test(t)) return true;
  return false;
};

export const parseSealedInTitle = (titleRaw: unknown): boolean => {
  const t = normalizeForPokemonCenterTitle(String(titleRaw || ''));
  return /\bsealed\b/.test(t);
};

const sanitizeHost = (u: URL): string =>
  u.hostname.toLowerCase().replace(/^www\./, '');

const isEbaySchSearch = (u: URL): boolean =>
  u.pathname.toLowerCase().includes('/sch/') && Boolean((u.searchParams.get('_nkw') || u.searchParams.get('nkw') || '').trim());

const isAllowedHost = (source: ExtensionCapturePayload['source'], u: URL): boolean => {
  const host = sanitizeHost(u);
  if (source === 'tcgplayer') return host === 'tcgplayer.com';
  if (source === 'pricecharting') return host === 'pricecharting.com';
  if (source === 'ebay') {
    if (host !== 'ebay.com' && host !== 'm.ebay.com') return false;
    return isEbaySchSearch(u);
  }
  return false;
};

const safeName = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

type CaptureRow = {
  source: ExtensionCapturePayload['source'];
  url: string;
  normalized_url: string;
  captured_at: number;
  title: string | null;
  payload_json: string;
  payload_hash: string | null;
  file_name: string | null;
};

const dbByDataDir = new Map<string, SqliteDatabase.Database>();

const openCaptureDb = async (dataDir: string): Promise<SqliteDatabase.Database> => {
  const existing = dbByDataDir.get(dataDir);
  if (existing) return existing;
  const extDir = path.join(dataDir, 'extension-captures');
  await fs.mkdir(extDir, { recursive: true });
  const dbPath = path.join(extDir, 'captures.sqlite');
  const db = new SqliteDatabase(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS extension_captures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      url TEXT NOT NULL,
      normalized_url TEXT NOT NULL,
      captured_at INTEGER NOT NULL,
      title TEXT,
      payload_json TEXT NOT NULL,
      payload_hash TEXT,
      file_name TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
    );
  `);
  const cols = db.prepare(`PRAGMA table_info(extension_captures)`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'payload_hash')) {
    db.exec(`ALTER TABLE extension_captures ADD COLUMN payload_hash TEXT;`);
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_extension_captures_source_captured_at
      ON extension_captures(source, captured_at DESC);
    CREATE INDEX IF NOT EXISTS idx_extension_captures_source_norm_captured_at
      ON extension_captures(source, normalized_url, captured_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_extension_captures_file_name
      ON extension_captures(file_name) WHERE file_name IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_extension_captures_dedupe
      ON extension_captures(source, normalized_url, payload_hash)
      WHERE payload_hash IS NOT NULL;
  `);

  // One-time bootstrap: import pre-existing JSON captures.
  const files = (await fs.readdir(extDir).catch(() => [] as string[]))
    .filter((f) => /^(tcgplayer|pricecharting|ebay)_.*\.json$/i.test(f))
    .sort();
  if (files.length) {
    const hasFileStmt = db.prepare(
      'SELECT 1 FROM extension_captures WHERE file_name = ? LIMIT 1'
    );
    const insertStmt = db.prepare(`
      INSERT INTO extension_captures (
        source, url, normalized_url, captured_at, title, payload_json, payload_hash, file_name
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const tx = db.transaction((batch: string[]) => {
      for (const file of batch) {
        if (hasFileStmt.get(file)) continue;
        try {
          const abs = path.join(extDir, file);
          const txt = readFileSync(abs, 'utf8');
          const parsed = validateCapturePayload(JSON.parse(txt));
          insertStmt.run(
            parsed.source,
            parsed.url,
            normalizeForMatch(parsed.url),
            parsed.capturedAt ?? Date.now(),
            parsed.title ?? null,
            JSON.stringify(parsed),
            createHash('sha256').update(JSON.stringify(parsed)).digest('hex'),
            file
          );
        } catch {
          // ignore malformed file during import
        }
      }
    });
    tx(files);
  }
  dbByDataDir.set(dataDir, db);
  return db;
};

export const initializeExtensionCaptureStore = async (
  dataDir: string
): Promise<{ dbPath: string; totalCaptures: number }> => {
  const db = await openCaptureDb(dataDir);
  const extDir = path.join(dataDir, 'extension-captures');
  const row = db
    .prepare('SELECT COUNT(1) AS n FROM extension_captures')
    .get() as { n: number };
  return {
    dbPath: path.join(extDir, 'captures.sqlite'),
    totalCaptures: row?.n ?? 0,
  };
};

export const closeExtensionCaptureStore = (dataDir?: string): void => {
  if (dataDir) {
    const db = dbByDataDir.get(dataDir);
    if (db) {
      db.close();
      dbByDataDir.delete(dataDir);
    }
    return;
  }
  for (const [k, db] of dbByDataDir.entries()) {
    db.close();
    dbByDataDir.delete(k);
  }
};

export const getExtensionCaptureAdminStats = async (
  dataDir: string
): Promise<{
  dbPath: string;
  dbSizeBytes: number;
  totalCaptures: number;
  bySource: Array<{ source: ExtensionCapturePayload['source']; count: number }>;
  oldestCapturedAt: number | null;
  newestCapturedAt: number | null;
}> => {
  const db = await openCaptureDb(dataDir);
  const extDir = path.join(dataDir, 'extension-captures');
  const dbPath = path.join(extDir, 'captures.sqlite');
  const dbSizeBytes = (await fs.stat(dbPath).then((s) => s.size).catch(() => 0)) || 0;
  const totalRow = db
    .prepare('SELECT COUNT(1) AS n, MIN(captured_at) AS minAt, MAX(captured_at) AS maxAt FROM extension_captures')
    .get() as { n: number; minAt: number | null; maxAt: number | null };
  const bySource = db
    .prepare(
      `SELECT source, COUNT(1) AS count
       FROM extension_captures
       GROUP BY source
       ORDER BY count DESC`
    )
    .all() as Array<{ source: ExtensionCapturePayload['source']; count: number }>;
  return {
    dbPath,
    dbSizeBytes,
    totalCaptures: totalRow?.n ?? 0,
    bySource,
    oldestCapturedAt: totalRow?.minAt ?? null,
    newestCapturedAt: totalRow?.maxAt ?? null,
  };
};

export const validateCapturePayload = (body: unknown): ExtensionCapturePayload => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Body must be an object.');
  }
  const o = body as Record<string, unknown>;
  const source = String(o.source || '').trim().toLowerCase() as ExtensionCapturePayload['source'];
  if (source !== 'tcgplayer' && source !== 'pricecharting' && source !== 'ebay') {
    throw new Error('source must be "tcgplayer", "pricecharting", or "ebay".');
  }
  const rawUrl = String(o.url || '').trim();
  let resolvedUrl = rawUrl;
  if (source === 'pricecharting') {
    const canon = canonicalizePricechartingUrl(rawUrl);
    if (!canon) {
      throw new Error('url must be a valid pricecharting.com URL.');
    }
    resolvedUrl = canon;
  }
  let u: URL;
  try {
    u = new URL(resolvedUrl);
  } catch {
    throw new Error('url must be a valid absolute URL.');
  }
  if (!isAllowedHost(source, u)) {
    throw new Error(`url host is not allowed for source=${source}.`);
  }
  if (!o.data || typeof o.data !== 'object' || Array.isArray(o.data)) {
    throw new Error('data must be an object.');
  }
  const passRaw = String(o.capturePass || '').trim();
  const capturePass =
    passRaw === 'ebay-graded-no' ||
    passRaw === 'ebay-graded-yes' ||
    passRaw === 'ebay' ||
    passRaw === 'tcg'
      ? (passRaw as ExtensionCapturePass)
      : undefined;
  return {
    source,
    url: u.toString(),
    title: String(o.title || '').trim() || undefined,
    capturedAt:
      typeof o.capturedAt === 'number' && Number.isFinite(o.capturedAt)
        ? o.capturedAt
        : Date.now(),
    capturePass,
    data: o.data as Record<string, unknown>,
  };
};

export const saveExtensionCapture = async (
  dataDir: string,
  payload: ExtensionCapturePayload
): Promise<string> => {
  const db = await openCaptureDb(dataDir);
  const extDir = path.join(dataDir, 'extension-captures');
  await fs.mkdir(extDir, { recursive: true });
  const t = payload.capturedAt ?? Date.now();
  const iso = new Date(t).toISOString().replace(/[:.]/g, '-');
  const urlPart = safeName(new URL(payload.url).pathname.split('/').filter(Boolean).slice(0, 2).join('-') || 'page');
  const name = `${payload.source}_${iso}_${urlPart}_${randomUUID().slice(0, 8)}.json`;
  const payloadJson = JSON.stringify(payload);
  const payloadHash = createHash('sha256').update(payloadJson).digest('hex');
  db.prepare(
    `INSERT OR IGNORE INTO extension_captures
      (source, url, normalized_url, captured_at, title, payload_json, payload_hash, file_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    payload.source,
    payload.url,
    normalizeForMatch(payload.url),
    t,
    payload.title ?? null,
    payloadJson,
    payloadHash,
    name
  );
  const abs = path.join(extDir, name);
  return abs;
};

export const normalizeForMatch = (raw: string): string => {
  try {
    const u = new URL(raw);
    const host = sanitizeHost(u);
    const pathOnly = u.pathname.replace(/\/+$/, '');
    if (host === 'ebay.com' || host === 'm.ebay.com') {
      const nkw = (u.searchParams.get('_nkw') || u.searchParams.get('nkw') || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
      const sold = u.searchParams.get('LH_Sold') === '1' || u.searchParams.get('lh_sold') === '1';
      const completeExplicit =
        u.searchParams.get('LH_Complete') === '1' || u.searchParams.get('lh_complete') === '1';
      // Sold SERPs are completed listings in practice; the address bar often drops LH_Complete=1
      // even though the UI matches "sold + complete". Treat sold-without-explicit as completed so
      // captures line up with app `ebaySoldSearchUrlForCard` and refresh/latest lookups.
      const complete = sold ? true : completeExplicit;
      return `ebay|nkw=${nkw}|s=${sold ? 1 : 0}|c=${complete ? 1 : 0}`;
    }
    const pcCanon = canonicalizePricechartingUrl(u.toString());
    if (pcCanon) {
      const uPc = new URL(pcCanon);
      const p = uPc.pathname.replace(/\/+$/, '');
      return `pricecharting|${p.toLowerCase()}`;
    }
    if (host === 'pricecharting.com') {
      return `pricecharting|${pathOnly.toLowerCase()}`;
    }
    if (host === 'tcgplayer.com') {
      const normalizeQuery = (k: string): string =>
        (u.searchParams.get(k) || u.searchParams.get(k.toLowerCase()) || '').trim().toLowerCase();
      const lang = normalizeQuery('Language');
      const cond = normalizeQuery('Condition');
      const print = normalizeQuery('Printing');
      return `tcgplayer|${pathOnly.toLowerCase()}?language=${lang}&condition=${cond}&printing=${print}`;
    }
    return `${host}${pathOnly}`;
  } catch {
    return String(raw || '').trim().toLowerCase();
  }
};

const parseEbayNormalizedKey = (
  k: string
): { nkw: string; sold: boolean; complete: boolean } | null => {
  if (!k.startsWith('ebay|')) return null;
  const parts = k.split('|');
  const p = new Map<string, string>();
  for (const part of parts.slice(1)) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    p.set(part.slice(0, i), part.slice(i + 1));
  }
  return {
    nkw: String(p.get('nkw') || '').trim(),
    sold: p.get('s') === '1',
    complete: p.get('c') === '1',
  };
};

/** Fuzzy eBay lookup: allow legacy DB keys with sold=1 but complete=0 before we defaulted LH_Complete for sold SERPs. */
const ebaySoldNormFlagsCompatible = (
  got: { nkw: string; sold: boolean; complete: boolean } | null,
  want: { nkw: string; sold: boolean; complete: boolean } | null
): boolean => {
  if (!got || !want) return false;
  if (got.sold !== want.sold) return false;
  if (got.complete === want.complete) return true;
  return Boolean(want.sold && want.complete && got.sold && !got.complete);
};

const ebayQueryTokens = (s: string): string[] =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((t) => t.length >= 3);

const ebayOverlapScore = (a: string, b: string): number => {
  const aa = new Set(ebayQueryTokens(a));
  const bb = new Set(ebayQueryTokens(b));
  if (!aa.size || !bb.size) return 0;
  let n = 0;
  for (const t of aa) if (bb.has(t)) n += 1;
  return n;
};

const tcgMatchParts = (raw: string): { path: string; language: string; condition: string; printing: string } | null => {
  try {
    const u = new URL(raw);
    if (sanitizeHost(u) !== 'tcgplayer.com') return null;
    const path = u.pathname.replace(/\/+$/, '').toLowerCase();
    const pick = (k: string): string =>
      (u.searchParams.get(k) || u.searchParams.get(k.toLowerCase()) || '').trim().toLowerCase();
    return {
      path,
      language: pick('Language'),
      condition: pick('Condition'),
      printing: pick('Printing'),
    };
  } catch {
    return null;
  }
};

const normalizeOneEbayListingRow = (
  o: Record<string, unknown>,
  toStr: (x: unknown) => string | null,
  toNum: (x: unknown) => number | null
): NormalizedEbayRow | null => {
  const price = toNum(o.price);
  const soldAt = toNum(o.soldAt) ?? toNum(o.at);
  if (price == null || soldAt == null) return null;
  const title = toStr(o.title) || '(no title)';
  const imageUrlRaw = toStr(o.imageUrl);
  const imageUrl =
    imageUrlRaw && /^https?:\/\//i.test(imageUrlRaw) && imageUrlRaw.length < 2000 ? imageUrlRaw : null;
  const imageAlt = toStr(o.imageAlt);
  const imageTitle = toStr(o.imageTitle);
  const { languageTag, suspiciousLanguagePump, suspiciousReason } = inferListingLanguage({
    title,
    imageUrl,
    imageAlt,
    imageTitle,
    marketLanguage: 'English',
  });
  const parsed = parseEbayTitleMeta(title);
  const lotMetaFromTitle = parseLotMetaFromTitle(title);
  const lotQtyExplicit =
    typeof o.lotQuantity === 'number' && Number.isFinite(o.lotQuantity) && o.lotQuantity > 1
      ? Math.round(o.lotQuantity)
      : typeof o.quantity === 'number' && Number.isFinite(o.quantity) && o.quantity > 1
        ? Math.round(o.quantity)
        : null;
  const lotMeta =
    lotQtyExplicit != null
      ? { lotQuantity: lotQtyExplicit, isLot: true }
      : lotMetaFromTitle;
  const fromTitle = parsePokemonCenterStampFromTitle(title);
  const stampExplicit = o.pokemonCenterStamp;
  const pokemonCenterStamp =
    stampExplicit === true || stampExplicit === false ? Boolean(stampExplicit) : fromTitle;
  const fromTitleSealed = parseSealedInTitle(title);
  const sealedExplicit = o.sealedInTitle;
  const sealedInTitle =
    sealedExplicit === true || sealedExplicit === false ? Boolean(sealedExplicit) : fromTitleSealed;
  const hasPhoto =
    o.hasPhoto === true
      ? true
      : o.hasPhoto === false
        ? false
        : o.photoOnly === true
          ? true
          : null;

  const listingKindRaw = toStr(o.listingKind);
  const listingKind =
    listingKindRaw === 'auction' || listingKindRaw === 'bin' || listingKindRaw === 'unknown'
      ? (listingKindRaw as 'auction' | 'bin' | 'unknown')
      : undefined;

  const currentBid = toNum(o.currentBid);
  const buyItNow = toNum(o.buyItNow);
  const bidCount = toNum(o.bidCount);
  const endsAtMs = toNum(o.endsAtMs);

  const inferredCurrentBid =
    listingKind === 'auction' ? (currentBid ?? price) : currentBid ?? null;
  const inferredBuyItNow = listingKind === 'bin' ? (buyItNow ?? price) : buyItNow ?? null;

  const freeShipping = o.freeShipping === true;
  const shippingCostRaw = toNum(o.shippingCost);
  let shippingCost: number | null = null;
  if (!freeShipping && shippingCostRaw != null && Number.isFinite(shippingCostRaw) && shippingCostRaw >= 0)
    shippingCost = shippingCostRaw;
  const bestOfferAccepted = o.bestOfferAccepted === true;

  return {
    title,
    price,
    unitPrice: lotMeta.isLot && lotMeta.lotQuantity > 1 ? Number((price / lotMeta.lotQuantity).toFixed(2)) : price,
    lotQuantity: lotMeta.lotQuantity,
    isLot: lotMeta.isLot,
    soldAt,
    itemId: toStr(o.itemId),
    itemUrl: toStr(o.itemUrl),
    listingKind,
    currentBid: inferredCurrentBid,
    buyItNow: inferredBuyItNow,
    bidCount: bidCount == null ? null : bidCount,
    endsAtMs: endsAtMs == null ? null : endsAtMs,
    freeShipping: freeShipping ? true : undefined,
    shippingCost,
    bestOfferAccepted: bestOfferAccepted ? true : undefined,
    pokemonCenterStamp,
    sealedInTitle,
    gradeTag: toStr(o.gradeTag) ?? parsed.gradeTag,
    grader:
      (toStr(o.grader)?.toUpperCase() as 'PSA' | 'CGC' | 'BGS' | 'SGC' | 'TAG' | 'ACE' | 'AI' | null) ??
      parsed.grader,
    isGraded: o.isGraded === true || parsed.isGraded,
    conditionTag:
      (toStr(o.conditionTag)?.toUpperCase() as 'NM' | 'LP' | 'MP' | 'HP' | 'DMG' | null) ??
      parsed.conditionTag,
    languageTag,
    hasPhoto,
    imageUrl,
    suspiciousLanguagePump,
    suspiciousReason,
  };
};

export const normalizeEbayCapture = (payload: ExtensionCapturePayload): NormalizedEbayCapture | null => {
  if (payload.source !== 'ebay') return null;
  const data = payload.data as Record<string, unknown>;
  const toStr = (x: unknown): string | null => (x != null ? String(x).trim() || null : null);
  const toNum = (x: unknown): number | null =>
    typeof x === 'number' && Number.isFinite(x) ? x : null;
  const rowsIn = Array.isArray(data.listings) ? data.listings : [];
  const excludedIn = Array.isArray(data.excludedListings) ? data.excludedListings : [];
  const listings: NormalizedEbayRow[] = [];
  for (const r of rowsIn) {
    if (!r || typeof r !== 'object') continue;
    const row = normalizeOneEbayListingRow(r as Record<string, unknown>, toStr, toNum);
    if (row) listings.push(row);
  }
  const excludedListingsRaw: NormalizedEbayRow[] = [];
  for (const r of excludedIn) {
    if (!r || typeof r !== 'object') continue;
    const row = normalizeOneEbayListingRow(r as Record<string, unknown>, toStr, toNum);
    if (row) excludedListingsRaw.push(row);
  }
  const dedup = new Map<string, NormalizedEbayRow>();
  for (const row of listings) {
    const key = row.itemId || `${row.soldAt}|${row.price}|${row.title.toLowerCase()}`;
    if (!dedup.has(key)) dedup.set(key, row);
  }
  const uniq = Array.from(dedup.values()).sort((a, b) => b.soldAt - a.soldAt);
  const dedupEx = new Map<string, NormalizedEbayRow>();
  for (const row of excludedListingsRaw) {
    const key = row.itemId || `${row.soldAt}|${row.price}|${row.title.toLowerCase()}`;
    if (!dedupEx.has(key)) dedupEx.set(key, row);
  }
  const excludedUniq = Array.from(dedupEx.values()).sort((a, b) => b.soldAt - a.soldAt);
  return {
    query: toStr(data.query) || '',
    captureMode: data.captureMode === 'deep' ? 'deep' : 'default',
    hasMore: Boolean(data.hasMore),
    rowCount:
      typeof data.rowCount === 'number' && Number.isFinite(data.rowCount)
        ? (data.rowCount as number)
        : uniq.length,
    listings: uniq,
    excludedListings: excludedUniq,
  };
};

export const backfillEbayCaptureTitleMetadata = async (
  dataDir: string,
  opts?: { force?: boolean; dryRun?: boolean }
): Promise<{
  alreadyDone: boolean;
  scannedFiles: number;
  updatedFiles: number;
  scannedRows: number;
  updatedRows: number;
  markerPath: string;
}> => {
  const db = await openCaptureDb(dataDir);
  const extDir = path.join(dataDir, 'extension-captures');
  const markerPath = path.join(extDir, '.ebay-title-meta-backfill-v1.done');
  const force = opts?.force === true;
  const dryRun = opts?.dryRun === true;
  if (!force) {
    try {
      await fs.access(markerPath);
      return {
        alreadyDone: true,
        scannedFiles: 0,
        updatedFiles: 0,
        scannedRows: 0,
        updatedRows: 0,
        markerPath,
      };
    } catch {
      // continue
    }
  }
  let scannedFiles = 0;
  let updatedFiles = 0;
  let scannedRows = 0;
  let updatedRows = 0;
  const rows = db
    .prepare(
      `SELECT id, payload_json, file_name
       FROM extension_captures
       WHERE source = 'ebay'
       ORDER BY captured_at DESC`
    )
    .all() as Array<{ id: number; payload_json: string; file_name: string | null }>;
  const updateStmt = db.prepare('UPDATE extension_captures SET payload_json = ? WHERE id = ?');
  for (const row of rows) {
    try {
      const parsed = validateCapturePayload(JSON.parse(row.payload_json));
      if (parsed.source !== 'ebay') continue;
      scannedFiles += 1;
      const listings = Array.isArray(parsed.data.listings) ? parsed.data.listings : [];
      let payloadChanged = false;
      for (const listing of listings) {
        if (!listing || typeof listing !== 'object') continue;
        scannedRows += 1;
        const o = listing as Record<string, unknown>;
        const title = String(o.title || '').trim();
        if (!title) continue;
        const meta = parseEbayTitleMeta(title);
        const nextGradeTag = meta.gradeTag;
        const nextGrader = meta.grader;
        const nextIsGraded = meta.isGraded;
        const nextCondition = meta.conditionTag;
        const prevGradeTag = o.gradeTag != null ? String(o.gradeTag).trim() || null : null;
        const prevGrader = o.grader != null ? String(o.grader).trim().toUpperCase() || null : null;
        const prevIsGraded = o.isGraded === true;
        const prevCondition = o.conditionTag != null ? String(o.conditionTag).trim().toUpperCase() || null : null;
        const changed =
          prevGradeTag !== nextGradeTag ||
          prevGrader !== nextGrader ||
          prevIsGraded !== nextIsGraded ||
          prevCondition !== nextCondition;
        if (!changed) continue;
        o.gradeTag = nextGradeTag;
        o.grader = nextGrader;
        o.isGraded = nextIsGraded;
        o.conditionTag = nextCondition;
        updatedRows += 1;
        payloadChanged = true;
      }
      if (payloadChanged) {
        updatedFiles += 1;
        if (!dryRun) updateStmt.run(JSON.stringify(parsed), row.id);
      }
    } catch {
      // keep marching through malformed rows
    }
  }
  if (!dryRun) {
    await fs.mkdir(extDir, { recursive: true });
    const markerBody = JSON.stringify(
      { at: Date.now(), version: 1, scannedFiles, updatedFiles, scannedRows, updatedRows },
      null,
      2
    );
    await fs.writeFile(markerPath, markerBody, 'utf8');
  }
  return { alreadyDone: false, scannedFiles, updatedFiles, scannedRows, updatedRows, markerPath };
};

const ALLOWED_GRADERS = new Set(['PSA', 'CGC', 'BGS', 'SGC', 'TAG', 'ACE', 'AI']);
const ALLOWED_RAW_CONDITIONS = new Set(['NM', 'LP', 'MP', 'HP', 'DMG']);

export type EbayListingTagPatch = {
  url: string;
  itemId?: string | null;
  soldAt?: number | null;
  price?: number | null;
  correctedPrice?: number | null;
  title?: string | null;
  isGraded: boolean;
  grader?: 'PSA' | 'CGC' | 'BGS' | 'SGC' | 'TAG' | 'ACE' | 'AI' | null;
  gradeTag?: string | null;
  conditionTag?: 'NM' | 'LP' | 'MP' | 'HP' | 'DMG' | null;
  /** Explicit lot toggle override; omit to keep current/title-derived value. */
  isLot?: boolean | null;
  /** Explicit lot quantity override; min 1. */
  lotQuantity?: number | null;
  /** Set true/false to override; omit to leave unchanged. */
  pokemonCenterStamp?: boolean | null;
  sealedInTitle?: boolean | null;
};

const normalizeListingMatchIdentity = (patch: EbayListingTagPatch) => {
  const itemId = String(patch.itemId || '').trim() || null;
  const soldAt = typeof patch.soldAt === 'number' && Number.isFinite(patch.soldAt) ? patch.soldAt : null;
  const price = typeof patch.price === 'number' && Number.isFinite(patch.price) ? patch.price : null;
  const title = String(patch.title || '').trim().toLowerCase() || null;
  return { itemId, soldAt, price, title };
};

/** Same rules as portfolioExtensionMerge getItemId — raw captures often only set itemUrl. */
const extractEbayListingItemId = (listing: Record<string, unknown>): string | null => {
  const rawId = String(listing.itemId ?? '').trim();
  if (/^\d{6,}$/.test(rawId)) return rawId;
  const m = String(listing.itemUrl ?? '').match(/\/itm\/(\d{6,})/i);
  return m ? m[1] : null;
};

const pricesMatchForListingPatch = (a: number, b: number): boolean =>
  a === b ||
  Math.abs(a - b) < 0.0005 ||
  Number(a.toFixed(2)) === Number(b.toFixed(2));

const listingIdentityMatches = (
  listing: Record<string, unknown>,
  identity: ReturnType<typeof normalizeListingMatchIdentity>
): boolean => {
  if (identity.itemId) {
    const rowId = extractEbayListingItemId(listing);
    return rowId != null && rowId === identity.itemId;
  }
  if (identity.soldAt == null || identity.price == null || !identity.title) return false;
  const rowSoldAt =
    typeof listing.soldAt === 'number' && Number.isFinite(listing.soldAt)
      ? listing.soldAt
      : typeof listing.at === 'number' && Number.isFinite(listing.at)
        ? listing.at
        : null;
  const rowPrice = typeof listing.price === 'number' && Number.isFinite(listing.price) ? listing.price : null;
  const rowTitle = String(listing.title || '').trim().toLowerCase() || null;
  if (rowSoldAt !== identity.soldAt || rowTitle !== identity.title) return false;
  if (rowPrice == null) return false;
  return pricesMatchForListingPatch(rowPrice, identity.price);
};

/** True if this eBay capture payload contains a listing row matching `identity` (listings + excludedListings). */
const payloadContainsListingIdentity = (
  payload: ExtensionCapturePayload,
  identity: ReturnType<typeof normalizeListingMatchIdentity>
): boolean => {
  if (payload.source !== 'ebay') return false;
  const dataObj = payload.data as Record<string, unknown>;
  const buckets: unknown[] = [];
  if (Array.isArray(dataObj.listings)) buckets.push(...dataObj.listings);
  if (Array.isArray(dataObj.excludedListings)) buckets.push(...dataObj.excludedListings);
  for (const listing of buckets) {
    if (!listing || typeof listing !== 'object') continue;
    if (listingIdentityMatches(listing as Record<string, unknown>, identity)) return true;
  }
  return false;
};

/**
 * When URL-based lookup fails (normalized_url / fuzzy mismatch), find capture rows that actually
 * contain this listing in payload JSON — direct entry-to-entry match in our DB.
 */
const collectEbayCaptureRowsWithListingIdentity = (
  db: SqliteDatabase.Database,
  identity: ReturnType<typeof normalizeListingMatchIdentity>
): Array<{ id: number; payload: ExtensionCapturePayload; captured_at: number }> => {
  const out: Array<{ id: number; payload: ExtensionCapturePayload; captured_at: number }> = [];
  const batchSize = 500;
  let offset = 0;
  while (true) {
    const rows = db
      .prepare(
        `SELECT id, payload_json, captured_at
         FROM extension_captures
         WHERE source = 'ebay'
         ORDER BY captured_at DESC
         LIMIT ? OFFSET ?`
      )
      .all(batchSize, offset) as Array<{ id: number; payload_json: string; captured_at: number }>;
    if (!rows.length) break;
    for (const row of rows) {
      try {
        const payload = validateCapturePayload(JSON.parse(row.payload_json));
        if (payload.source !== 'ebay') continue;
        if (payloadContainsListingIdentity(payload, identity)) {
          out.push({ id: row.id, payload, captured_at: Number(row.captured_at) || 0 });
        }
      } catch {
        /* skip malformed */
      }
    }
    offset += batchSize;
  }
  return out;
};

/** Mutate listings + excludedListings in `parsed`; return whether a row was updated. */
const applyEbayListingTagPatchToPayload = (
  parsed: ExtensionCapturePayload,
  identity: ReturnType<typeof normalizeListingMatchIdentity>,
  patch: EbayListingTagPatch
): boolean => {
  if (parsed.source !== 'ebay') return false;
  const dataObj = parsed.data as Record<string, unknown>;
  const listingBuckets: unknown[] = [];
  if (Array.isArray(dataObj.listings)) listingBuckets.push(...dataObj.listings);
  if (Array.isArray(dataObj.excludedListings)) listingBuckets.push(...dataObj.excludedListings);
  const normalizedPatch = sanitizeEbayListingTagPatch(patch);
  const correctedPrice =
    typeof patch.correctedPrice === 'number' && Number.isFinite(patch.correctedPrice) && patch.correctedPrice >= 0
      ? patch.correctedPrice
      : null;
  const lotQuantity =
    typeof patch.lotQuantity === 'number' && Number.isFinite(patch.lotQuantity)
      ? Math.max(1, Math.round(patch.lotQuantity))
      : null;
  const lotToggle = patch.isLot === true ? true : patch.isLot === false ? false : null;
  let changed = false;
  for (const listing of listingBuckets) {
    if (!listing || typeof listing !== 'object') continue;
    const o = listing as Record<string, unknown>;
    if (!listingIdentityMatches(o, identity)) continue;
    o.isGraded = normalizedPatch.isGraded;
    o.grader = normalizedPatch.grader;
    o.gradeTag = normalizedPatch.gradeTag;
    o.conditionTag = normalizedPatch.conditionTag;
    if (correctedPrice != null) o.price = correctedPrice;
    if (typeof patch.pokemonCenterStamp === 'boolean') {
      o.pokemonCenterStamp = patch.pokemonCenterStamp;
    }
    if (typeof patch.sealedInTitle === 'boolean') {
      o.sealedInTitle = patch.sealedInTitle;
    }
    if (lotToggle != null) {
      o.isLot = lotToggle;
      if (!lotToggle) {
        o.lotQuantity = 1;
      } else if (lotQuantity != null) {
        o.lotQuantity = lotQuantity;
      } else if (
        !(typeof o.lotQuantity === 'number' && Number.isFinite(o.lotQuantity) && o.lotQuantity > 1)
      ) {
        o.lotQuantity = 2;
      }
    } else if (lotQuantity != null) {
      o.lotQuantity = lotQuantity;
      o.isLot = lotQuantity > 1;
    }
    const effectiveQty =
      typeof o.lotQuantity === 'number' && Number.isFinite(o.lotQuantity) && o.lotQuantity > 1
        ? Math.round(o.lotQuantity)
        : 1;
    const effectivePrice =
      typeof o.price === 'number' && Number.isFinite(o.price) && o.price >= 0 ? o.price : null;
    if (effectivePrice != null) {
      o.unitPrice = Number((effectivePrice / effectiveQty).toFixed(2));
    }
    changed = true;
    break;
  }
  return changed;
};

/** Resolve DB row + payload for eBay tag patches (exact normalized_url, then same fuzzy nkw overlap as findLatestExtensionCapture). */
const findLatestEbayCaptureDbRow = async (
  dataDir: string,
  url: string
): Promise<{ id: number; payload: ExtensionCapturePayload } | null> => {
  const db = await openCaptureDb(dataDir);
  const wanted = normalizeForMatch(url);
  const wantedEbay = parseEbayNormalizedKey(wanted);

  const tryRow = (row: { id: number; payload_json: string } | undefined) => {
    if (!row) return null;
    try {
      const payload = validateCapturePayload(JSON.parse(row.payload_json));
      if (payload.source === 'ebay') return { id: row.id, payload };
    } catch {
      /* ignore */
    }
    return null;
  };

  const exactRow = db
    .prepare(
      `SELECT id, payload_json
       FROM extension_captures
       WHERE source = 'ebay' AND normalized_url = ?
       ORDER BY captured_at DESC
       LIMIT 1`
    )
    .get(wanted) as { id: number; payload_json: string } | undefined;
  const exactHit = tryRow(exactRow);
  if (exactHit) return exactHit;

  if (!wantedEbay) return null;

  const batchSize = 1000;
  let offset = 0;
  while (true) {
    const rows = db
      .prepare(
        `SELECT id, payload_json
         FROM extension_captures
         WHERE source = 'ebay'
         ORDER BY captured_at DESC
         LIMIT ? OFFSET ?`
      )
      .all(batchSize, offset) as Array<{ id: number; payload_json: string }>;
    if (!rows.length) break;
    for (const row of rows) {
      try {
        const parsed = validateCapturePayload(JSON.parse(row.payload_json));
        if (parsed.source !== 'ebay') continue;
        if (normalizeForMatch(parsed.url) === wanted) return { id: row.id, payload: parsed };
        const got = parseEbayNormalizedKey(normalizeForMatch(parsed.url));
        if (!got) continue;
        if (!ebaySoldNormFlagsCompatible(got, wantedEbay)) continue;
        const overlap = ebayOverlapScore(got.nkw, wantedEbay.nkw);
        if (overlap >= 2) return { id: row.id, payload: parsed };
      } catch {
        /* ignore malformed */
      }
    }
    offset += batchSize;
  }
  return null;
};

const sanitizeEbayListingTagPatch = (
  patch: EbayListingTagPatch
): Pick<EbayListingTagPatch, 'isGraded' | 'grader' | 'gradeTag' | 'conditionTag'> => {
  const isGraded = patch.isGraded === true;
  const graderRaw = String(patch.grader || '')
    .trim()
    .toUpperCase();
  const grader =
    isGraded && graderRaw && ALLOWED_GRADERS.has(graderRaw)
      ? (graderRaw as 'PSA' | 'CGC' | 'BGS' | 'SGC' | 'TAG' | 'ACE' | 'AI')
      : null;
  const gradeTagRaw = String(patch.gradeTag || '').trim();
  const gradeTag = isGraded && gradeTagRaw ? gradeTagRaw : null;
  const conditionRaw = String(patch.conditionTag || '')
    .trim()
    .toUpperCase();
  const conditionTag =
    !isGraded && conditionRaw && ALLOWED_RAW_CONDITIONS.has(conditionRaw)
      ? (conditionRaw as 'NM' | 'LP' | 'MP' | 'HP' | 'DMG')
      : null;
  return {
    isGraded: Boolean(isGraded && grader && gradeTag),
    grader: isGraded ? grader : null,
    gradeTag: isGraded ? gradeTag : null,
    conditionTag,
  };
};

export const updateLatestEbayCaptureListingTags = async (
  dataDir: string,
  patch: EbayListingTagPatch
): Promise<{ capture: ExtensionCapturePayload; normalized: NormalizedEbayCapture } | null> => {
  const db = await openCaptureDb(dataDir);
  const url = String(patch.url || '').trim();
  if (!url) throw new Error('url is required.');
  const identity = normalizeListingMatchIdentity(patch);
  if (!identity.itemId && (identity.soldAt == null || identity.price == null || !identity.title)) {
    throw new Error('listing identity required: itemId or soldAt+price+title.');
  }

  const updateStmt = db.prepare(
    'UPDATE extension_captures SET payload_json = ?, payload_hash = ? WHERE id = ?'
  );

  /** Prefer URL-resolved row when it actually contains the listing; else scan DB by listing identity. */
  const urlFound = await findLatestEbayCaptureDbRow(dataDir, url);
  let candidates: Array<{ id: number; payload: ExtensionCapturePayload; captured_at: number }> = [];
  if (urlFound && payloadContainsListingIdentity(urlFound.payload, identity)) {
    const meta = db
      .prepare('SELECT captured_at FROM extension_captures WHERE id = ?')
      .get(urlFound.id) as { captured_at: number } | undefined;
    candidates = [
      {
        id: urlFound.id,
        payload: urlFound.payload,
        captured_at: Number(meta?.captured_at) || 0,
      },
    ];
  } else {
    candidates = collectEbayCaptureRowsWithListingIdentity(db, identity);
  }

  if (candidates.length === 0) return null;

  let best: { capture: ExtensionCapturePayload; normalized: NormalizedEbayCapture; captured_at: number } | null =
    null;

  for (const row of candidates) {
    const changed = applyEbayListingTagPatchToPayload(row.payload, identity, patch);
    if (!changed) continue;
    const nextPayloadJson = JSON.stringify(row.payload);
    const nextHash = createHash('sha256').update(nextPayloadJson).digest('hex');
    updateStmt.run(nextPayloadJson, nextHash, row.id);
    const normalized = normalizeEbayCapture(row.payload);
    if (!normalized) continue;
    if (!best || row.captured_at >= best.captured_at) {
      best = { capture: row.payload, normalized, captured_at: row.captured_at };
    }
  }

  if (!best) return null;
  return { capture: best.capture, normalized: best.normalized };
};

export type FindLatestExtensionCaptureOpts = {
  /** Sealed products: looser eBay nkw overlap (graded URL params may differ). */
  relaxedEbayMatch?: boolean;
};

export const findLatestExtensionCapture = async (
  dataDir: string,
  source: ExtensionCapturePayload['source'],
  url?: string,
  opts?: FindLatestExtensionCaptureOpts
): Promise<ExtensionCapturePayload | null> => {
  const minEbayOverlap = opts?.relaxedEbayMatch === true ? 1 : 2;
  const db = await openCaptureDb(dataDir);
  const wanted = url ? normalizeForMatch(url) : null;
  const wantedTcg = source === 'tcgplayer' && url ? tcgMatchParts(url) : null;
  const wantedEbay = source === 'ebay' && wanted ? parseEbayNormalizedKey(wanted) : null;
  if (wanted && source !== 'tcgplayer') {
    const row = db
      .prepare(
        `SELECT payload_json
         FROM extension_captures
         WHERE source = ? AND normalized_url = ?
         ORDER BY captured_at DESC
         LIMIT 1`
      )
      .get(source, wanted) as { payload_json: string } | undefined;
    if (!row && source !== 'ebay') return null;
    if (!row && source === 'ebay') {
      // Fall through to fuzzy scan for minor query-shape differences.
    } else if (row) {
      try {
        return validateCapturePayload(JSON.parse(row.payload_json));
      } catch {
        return null;
      }
    }
  }
  const batchSize = 1000;
  let offset = 0;
  while (true) {
    const rows = db
      .prepare(
        `SELECT payload_json
         FROM extension_captures
         WHERE source = ?
         ORDER BY captured_at DESC
         LIMIT ? OFFSET ?`
      )
      .all(source, batchSize, offset) as Array<{ payload_json: string }>;
    if (!rows.length) break;
    for (const row of rows) {
    try {
      const parsed = validateCapturePayload(JSON.parse(row.payload_json));
      if (parsed.source !== source) continue;
      if (!wanted) return parsed;
      if (normalizeForMatch(parsed.url) === wanted) return parsed;
      if (source === 'ebay' && wantedEbay) {
        const got = parseEbayNormalizedKey(normalizeForMatch(parsed.url));
        if (!got) continue;
        if (!ebaySoldNormFlagsCompatible(got, wantedEbay)) continue;
        const overlap = ebayOverlapScore(got.nkw, wantedEbay.nkw);
        // Require meaningful overlap so we don't jump to unrelated card captures.
        if (overlap >= minEbayOverlap) return parsed;
      }
      if (wantedTcg) {
        const got = tcgMatchParts(parsed.url);
        if (!got) continue;
        if (got.path !== wantedTcg.path) continue;
        const wantedHasCtx = Boolean(
          wantedTcg.language || wantedTcg.condition || wantedTcg.printing
        );
        if (!wantedHasCtx) return parsed;
        if (
          got.language === wantedTcg.language &&
          got.condition === wantedTcg.condition &&
          got.printing === wantedTcg.printing
        ) {
          return parsed;
        }
      }
    } catch {
      // Ignore malformed capture files.
    }
  }
    offset += batchSize;
  }
  return null;
};

export const normalizeTcgCapture = (
  payload: ExtensionCapturePayload
): NormalizedTcgCapture | null => {
  if (payload.source !== 'tcgplayer') return null;
  const data = payload.data as Record<string, unknown>;
  const ctx = (data.context && typeof data.context === 'object'
    ? (data.context as Record<string, unknown>)
    : {}) as Record<string, unknown>;
  const toNum = (x: unknown): number | null =>
    typeof x === 'number' && Number.isFinite(x) ? x : null;
  const pricePointsRaw = (data.pricePoints && typeof data.pricePoints === 'object'
    ? (data.pricePoints as Record<string, unknown>)
    : {}) as Record<string, unknown>;
  const comparisonRaw =
    data.comparisonMarketPrices && typeof data.comparisonMarketPrices === 'object'
      ? (data.comparisonMarketPrices as Record<string, unknown>)
      : {};
  const comparisonMarketPrices: TcgComparisonMarketPrices = {
    nearMint: toNum(comparisonRaw.nearMint),
    lightlyPlayed: toNum(comparisonRaw.lightlyPlayed),
    moderatelyPlayed: toNum(comparisonRaw.moderatelyPlayed),
    heavilyPlayed: toNum(comparisonRaw.heavilyPlayed),
    damaged: toNum(comparisonRaw.damaged),
  };
  const rowsIn = Array.isArray(data.latestSalesRows) ? data.latestSalesRows : [];
  const rows: NormalizedTcgSaleRow[] = [];
  const normCond = (x: unknown): string | null => {
    if (x == null) return null;
    const s = String(x).trim().toLowerCase().replace(/\s+/g, ' ');
    return s || null;
  };
  const ctxLanguage = ctx.language != null ? String(ctx.language).trim() || null : null;
  const marketLanguage = ctxLanguage ?? (data.language != null ? String(data.language).trim() || null : null);
  const pageLanguageTag = inferLanguageFromTcgContext(marketLanguage);
  for (const r of rowsIn) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const at = toNum(o.at);
    const qty = toNum(o.qty);
    const price = toNum(o.price);
    if (at == null || qty == null || price == null) continue;
    const rowLangFromExt =
      typeof o.languageTag === 'string' ? (o.languageTag as CardLanguageTag) : null;
    const fromCondition = inferLanguageTagFromText(o.condition);
    const fromImage = inferLanguageFromImageSignals({
      alt: typeof o.imageAlt === 'string' ? o.imageAlt : null,
      title: typeof o.imageTitle === 'string' ? o.imageTitle : null,
      src: typeof o.imageUrl === 'string' ? o.imageUrl : null,
    });
    const languageTag = mergeLanguageTags(pageLanguageTag, fromCondition, fromImage, rowLangFromExt ?? 'UNKNOWN');
    const suspicious = assessSuspiciousNonEnglish({ languageTag, marketLanguage });
    rows.push({
      at,
      condition: normCond(o.condition),
      qty,
      price,
      languageTag,
      hasPhoto: o.hasPhoto === true ? true : o.hasPhoto === false ? false : null,
      suspiciousLanguagePump: o.suspiciousLanguagePump === true || suspicious.suspiciousLanguagePump,
      suspiciousReason:
        typeof o.suspiciousReason === 'string'
          ? o.suspiciousReason
          : suspicious.suspiciousReason,
    });
  }
  const dedup = new Map<string, NormalizedTcgSaleRow>();
  for (const row of rows) {
    const atDay = Math.floor(row.at / 86_400_000);
    const key = `${atDay}|${row.condition ?? ''}|${row.qty}|${row.price.toFixed(4)}`;
    if (!dedup.has(key)) dedup.set(key, row);
  }
  const uniqRows = Array.from(dedup.values()).sort((a, b) => b.at - a.at);
  const productId = toNum(data.productId);
  const capturedMarketPrice =
    toNum(pricePointsRaw.capturedMarketPrice) ?? toNum(pricePointsRaw.marketPrice) ?? toNum(data.marketPrice);
  return {
    productId,
    context: {
      language: ctxLanguage,
      condition: ctx.condition != null ? String(ctx.condition).trim() || null : null,
      printing: ctx.printing != null ? String(ctx.printing).trim() || null : null,
    },
    captureMode: data.captureMode === 'deep' ? 'deep' : 'default',
    rowCount:
      typeof data.rowCount === 'number' && Number.isFinite(data.rowCount)
        ? data.rowCount
        : uniqRows.length,
    hasMore: Boolean(data.hasMore),
    comparisonMarketPrices,
    pricePoints: {
      marketPrice: capturedMarketPrice,
      capturedMarketPrice,
      mostRecentSale: toNum(pricePointsRaw.mostRecentSale),
      listedMedian: toNum(pricePointsRaw.listedMedian),
      currentQuantity: toNum(pricePointsRaw.currentQuantity),
      currentSellers: toNum(pricePointsRaw.currentSellers),
    },
    latestSalesRows: uniqRows,
  };
};

export const normalizeExtensionForResponse = (
  p: ExtensionCapturePayload
): NormalizedTcgCapture | NormalizedEbayCapture | null => {
  if (p.source === 'tcgplayer') return normalizeTcgCapture(p);
  if (p.source === 'ebay') return normalizeEbayCapture(p);
  return null;
};

export const listExtensionCaptureHistory = async (
  dataDir: string,
  source: ExtensionCapturePayload['source'],
  opts?: {
    url?: string;
    limit?: number;
    offset?: number;
    startDateMs?: number;
    endDateMs?: number;
    search?: string;
    sortBy?: 'capturedAt' | 'url' | 'title';
    sortDir?: 'asc' | 'desc';
  }
): Promise<{ captures: ExtensionCapturePayload[]; total: number; limit: number; offset: number }> => {
  const db = await openCaptureDb(dataDir);
  const wanted = opts?.url ? normalizeForMatch(opts.url) : null;
  const limit = Math.max(1, Math.min(500, Math.floor(opts?.limit ?? 30)));
  const offset = Math.max(0, Math.floor(opts?.offset ?? 0));
  const startDateMs =
    typeof opts?.startDateMs === 'number' && Number.isFinite(opts.startDateMs) ? opts.startDateMs : null;
  const endDateMs =
    typeof opts?.endDateMs === 'number' && Number.isFinite(opts.endDateMs) ? opts.endDateMs : null;
  const search = String(opts?.search || '').trim();
  const sortBy = opts?.sortBy ?? 'capturedAt';
  const sortDir = opts?.sortDir === 'asc' ? 'ASC' : 'DESC';
  const orderColumn = sortBy === 'url' ? 'url' : sortBy === 'title' ? 'title' : 'captured_at';
  const where: string[] = ['source = ?'];
  const whereParams: unknown[] = [source];
  if (wanted) {
    where.push('normalized_url = ?');
    whereParams.push(wanted);
  }
  if (startDateMs != null) {
    where.push('captured_at >= ?');
    whereParams.push(startDateMs);
  }
  if (endDateMs != null) {
    where.push('captured_at <= ?');
    whereParams.push(endDateMs);
  }
  if (search) {
    where.push('(LOWER(COALESCE(title, \'\')) LIKE ? OR LOWER(url) LIKE ? OR LOWER(payload_json) LIKE ?)');
    const like = `%${search.toLowerCase()}%`;
    whereParams.push(like, like, like);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const totalRow = db
    .prepare(
      `SELECT COUNT(1) AS n
       FROM extension_captures
       ${whereSql}`
    )
    .get(...whereParams) as { n: number } | undefined;
  const rows = db
    .prepare(
      `SELECT payload_json
       FROM extension_captures
       ${whereSql}
       ORDER BY ${orderColumn} ${sortDir}, id ${sortDir}
       LIMIT ? OFFSET ?`
    )
    .all(...whereParams, limit, offset) as Array<{ payload_json: string }>;
  const out: ExtensionCapturePayload[] = [];
  for (const row of rows) {
    try {
      const parsed = validateCapturePayload(JSON.parse(row.payload_json));
      if (parsed.source !== source) continue;
      out.push(parsed);
    } catch {
      // ignore
    }
  }
  return { captures: out, total: totalRow?.n ?? 0, limit, offset };
};
