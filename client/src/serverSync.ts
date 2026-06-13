import type { Card, Collection, Fees, Hunt, Target } from './types';
import type { QuickCardAdminSettings } from './utils/quickCardAdminSettings';
import { apiUrl, buildApiHeaders } from './apiBase';
import { DEFAULT_FEES } from './math';
import {
  normalizeFilterState,
  SORT_LABELS,
  type FilterState,
  type SortPreset,
} from './sort';

/**
 * Portfolio data the client syncs to the server. Keeping this type in one
 * place makes it obvious when we're adding a new piece of state that should
 * be remembered across reloads and machines.
 */
export type PortfolioSnapshot = {
  cards: Card[];
  fees: Fees;
  collections: Collection[];
  hunts?: Hunt[];
  targets?: Target[];
  filters: FilterState;
  sort: SortPreset;
  psaToken: string;
  nebulaOpen: boolean;
  extensionLatestOnlyMode: boolean;
  quickCardAdminSettings?: QuickCardAdminSettings;
  /** Google Programmable Search JSON API key (buyer's guide discovery); optional if set on server env. */
  googleCseKey: string;
  /** Programmable Search Engine ID (`cx`). */
  googleCseCx: string;
};

/**
 * The shape the server's `GET /api/store` returns. `updatedAt=0` means the
 * file doesn't exist yet (fresh install); anything else means there is
 * durable data the client should hydrate from.
 */
export type ServerDoc = {
  version: number;
  updatedAt: number;
} & Partial<PortfolioSnapshot>;

export type SyncStatus = 'idle' | 'syncing' | 'saved' | 'offline';

export type EbayListingTagPatchRequest = {
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
  isLot?: boolean | null;
  lotQuantity?: number | null;
  pokemonCenterStamp?: boolean | null;
  sealedInTitle?: boolean | null;
  maintToken?: string;
};

export type EbayListingTagPatchResponse = {
  ok: true;
  capture: {
    source: 'ebay';
    url: string;
    capturedAt?: number;
  };
  normalized: {
    query: string;
    captureMode: 'default' | 'deep';
    hasMore: boolean;
    rowCount: number;
    listings: Array<{
      title: string;
      price: number;
      soldAt: number;
      itemId: string | null;
      itemUrl: string | null;
      gradeTag?: string | null;
      grader?: 'PSA' | 'CGC' | 'BGS' | 'SGC' | 'TAG' | 'ACE' | 'AI' | null;
      isGraded?: boolean;
      conditionTag?: 'NM' | 'LP' | 'MP' | 'HP' | 'DMG' | null;
      unitPrice?: number;
      lotQuantity?: number;
      isLot?: boolean;
      pokemonCenterStamp?: boolean;
      sealedInTitle?: boolean;
    }>;
  };
};

/**
 * GET the durable portfolio from the server. Returns `null` when the server
 * is unreachable (so the caller can silently fall back to localStorage) and
 * an empty doc (`updatedAt=0`) when the server is online but has no data
 * yet (first run after installing this feature).
 */
export const loadFromServer = async (): Promise<ServerDoc | null> => {
  try {
    const r = await fetch(apiUrl('/api/store'), { headers: buildApiHeaders({ Accept: 'application/json' }) });
    if (!r.ok) return null;
    const doc = (await r.json()) as ServerDoc;
    if (!doc || typeof doc !== 'object') return null;
    return doc;
  } catch {
    return null;
  }
};

/** Primary portfolio meta (fees, filters, collections, …). */
export const loadPortfolioMetaFromServer = async (): Promise<ServerDoc | null> => {
  try {
    const r = await fetch(apiUrl('/api/portfolio/meta'), {
      headers: buildApiHeaders({ Accept: 'application/json' }),
    });
    if (!r.ok) return null;
    const doc = (await r.json()) as ServerDoc;
    if (!doc || typeof doc !== 'object') return null;
    return doc;
  } catch {
    return null;
  }
};

export const filtersToCardQueryParams = (
  filters: FilterState,
  sort: SortPreset,
  offset: number,
  limit: number,
  includePayload: boolean | 'summary' = true
): URLSearchParams => {
  const sp = new URLSearchParams();
  sp.set('limit', String(limit));
  sp.set('offset', String(offset));
  sp.set('sort', sort);
  const inc =
    includePayload === 'summary' ? 'summary' : includePayload ? 'payload' : 'ids';
  sp.set('include', inc);
  const q = filters.search.trim();
  if (q) sp.set('q', q);
  const poke = filters.pokemonName.trim();
  if (poke) sp.set('pokemonName', poke);
  if (filters.collectionIds.length > 0) {
    sp.set('collectionIds', filters.collectionIds.join(','));
  }
  if (filters.sets.length > 0) sp.set('sets', filters.sets.join(','));
  if (filters.releaseYears.length > 0) {
    sp.set('releaseYears', filters.releaseYears.join(','));
  }
  if (filters.evSign !== 'all') sp.set('evSign', filters.evSign);
  if (filters.profitLens !== 'all') sp.set('profitLens', filters.profitLens);
  if (filters.portfolioKindScope !== 'all') sp.set('portfolioKind', filters.portfolioKindScope);
  return sp;
};

export type CardsPageResult = {
  items: Card[];
  total: number;
  limit: number;
  offset: number;
  sort: string;
};

export const fetchCardsPageFromServer = async (
  filters: FilterState,
  sort: SortPreset,
  offset: number,
  limit: number,
  includePayload: boolean | 'summary' = true
): Promise<CardsPageResult | null> => {
  try {
    const sp = filtersToCardQueryParams(filters, sort, offset, limit, includePayload);
    const r = await fetch(`${apiUrl('/api/cards')}?${sp.toString()}`, {
      headers: buildApiHeaders({ Accept: 'application/json' }),
    });
    if (!r.ok) return null;
    const data = (await r.json()) as CardsPageResult;
    if (!data || !Array.isArray(data.items)) return null;
    return data;
  } catch {
    return null;
  }
};

export type PortfolioTotalsServer = {
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

export const fetchPortfolioSummaryFromServer = async (
  filters: FilterState
): Promise<PortfolioTotalsServer | null> => {
  try {
    const sp = filtersToCardQueryParams(filters, 'ev_desc', 0, 50, true);
    sp.delete('limit');
    sp.delete('offset');
    sp.delete('sort');
    sp.delete('include');
    const r = await fetch(`${apiUrl('/api/portfolio/summary')}?${sp.toString()}`, {
      headers: buildApiHeaders({ Accept: 'application/json' }),
    });
    if (!r.ok) return null;
    return (await r.json()) as PortfolioTotalsServer;
  } catch {
    return null;
  }
};

/** Walk all pages from GET /api/cards (used after bulk import / hydrate). */
export const fetchAllCardsPagesFromServer = async (
  filters: FilterState,
  sort: SortPreset,
  pageSize = 500,
  includePayload: boolean | 'summary' = true
): Promise<Card[] | null> => {
  const all: Card[] = [];
  let off = 0;
  for (;;) {
    const page = await fetchCardsPageFromServer(filters, sort, off, pageSize, includePayload);
    if (!page) return null;
    all.push(...page.items);
    off += page.items.length;
    if (off >= page.total || page.items.length === 0) break;
  }
  return all;
};

export type SyncBaseline = {
  lastMetaJson: string;
  lastCardJson: Map<string, string>;
};

export const createEmptySyncBaseline = (): SyncBaseline => ({
  lastMetaJson: '',
  lastCardJson: new Map(),
});

export const metaBaselineString = (snapshot: PortfolioSnapshot): string =>
  JSON.stringify({
    fees: snapshot.fees,
    collections: snapshot.collections,
    filters: snapshot.filters,
    sort: snapshot.sort,
    psaToken: snapshot.psaToken,
    nebulaOpen: snapshot.nebulaOpen,
    extensionLatestOnlyMode: snapshot.extensionLatestOnlyMode,
    quickCardAdminSettings: snapshot.quickCardAdminSettings,
    googleCseKey: snapshot.googleCseKey,
    googleCseCx: snapshot.googleCseCx,
  });

export const metaBaselineFromServerDoc = (doc: Partial<ServerDoc>): string =>
  JSON.stringify({
    fees: doc.fees ? { ...DEFAULT_FEES, ...doc.fees } : DEFAULT_FEES,
    collections: Array.isArray(doc.collections) ? doc.collections : [],
    filters: normalizeFilterState((doc.filters ?? {}) as Partial<FilterState>),
    sort:
      typeof doc.sort === 'string' && doc.sort in SORT_LABELS ? doc.sort : ('ev_desc' as SortPreset),
    psaToken: typeof doc.psaToken === 'string' ? doc.psaToken : '',
    nebulaOpen: doc.nebulaOpen === true,
    extensionLatestOnlyMode: doc.extensionLatestOnlyMode === true,
    quickCardAdminSettings:
      doc.quickCardAdminSettings && typeof doc.quickCardAdminSettings === 'object'
        ? (doc.quickCardAdminSettings as QuickCardAdminSettings)
        : undefined,
    googleCseKey: typeof doc.googleCseKey === 'string' ? doc.googleCseKey : '',
    googleCseCx: typeof doc.googleCseCx === 'string' ? doc.googleCseCx : '',
  });

/**
 * Push only changed cards + meta vs baseline (mutates `baseline` on success).
 * Returns new portfolio `updatedAt` when meta PATCH ran, otherwise a fresh timestamp.
 */
export type IncrementalPushOptions = {
  /**
   * When true (SQLite-primary paged client), `snapshot.cards` should contain only
   * dirty rows; unchanged cards are omitted from the PUT loop.
   */
  dirtyOnly?: boolean;
};

export const incrementalPushPortfolioToServer = async (
  snapshot: PortfolioSnapshot,
  baseline: SyncBaseline,
  opts?: IncrementalPushOptions
): Promise<number | null> => {
  const metaPatch: Record<string, unknown> = {
    fees: snapshot.fees,
    collections: snapshot.collections,
    filters: snapshot.filters,
    sort: snapshot.sort,
    psaToken: snapshot.psaToken,
    nebulaOpen: snapshot.nebulaOpen,
    extensionLatestOnlyMode: snapshot.extensionLatestOnlyMode,
    quickCardAdminSettings: snapshot.quickCardAdminSettings,
    googleCseKey: snapshot.googleCseKey,
    googleCseCx: snapshot.googleCseCx,
  };
  const metaStr = JSON.stringify(metaPatch);
  let updatedAt: number | null = null;
  if (metaStr !== baseline.lastMetaJson) {
    const doc = await patchPortfolioMetaOnServer(metaPatch);
    if (!doc) return null;
    updatedAt = typeof doc.updatedAt === 'number' ? doc.updatedAt : Date.now();
    baseline.lastMetaJson = metaStr;
  }
  const dirtyOnly = opts?.dirtyOnly === true;
  const cardList = snapshot.cards;
  if (dirtyOnly) {
    for (const card of cardList) {
      const j = JSON.stringify(card);
      const out = await putCardOnServer(card);
      if (!out) return null;
      baseline.lastCardJson.set(card.id, j);
    }
    return updatedAt ?? Date.now();
  }
  for (const card of cardList) {
    const j = JSON.stringify(card);
    if (baseline.lastCardJson.get(card.id) !== j) {
      const out = await putCardOnServer(card);
      if (!out) return null;
      baseline.lastCardJson.set(card.id, j);
    }
  }
  return updatedAt ?? Date.now();
};

export const batchUpsertCardsOnServer = async (cards: Card[]): Promise<boolean> => {
  try {
    const r = await fetch(apiUrl('/api/cards/batch-upsert'), {
      method: 'POST',
      headers: buildApiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ cards }),
    });
    return r.ok;
  } catch {
    return false;
  }
};

export const postPortfolioNdjsonImport = async (
  ndjson: string
): Promise<{ imported: number } | null> => {
  try {
    const r = await fetch(apiUrl('/api/portfolio/import-ndjson'), {
      method: 'POST',
      headers: buildApiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ ndjson }),
    });
    if (!r.ok) return null;
    const data = (await r.json()) as { imported?: number };
    return { imported: Number(data.imported) || 0 };
  } catch {
    return null;
  }
};

export const parseNdjsonCardLines = (raw: string): Card[] => {
  const out: Card[] = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const c = JSON.parse(t) as Card;
      if (c && typeof c === 'object' && typeof c.id === 'string') out.push(c);
    } catch {
      /* skip bad line */
    }
  }
  return out;
};

export const buildCardsNdjsonBlob = (cards: Card[]): Blob =>
  new Blob([cards.map((c) => JSON.stringify(c)).join('\n')], {
    type: 'application/x-ndjson',
  });

export const exportCardsNdjsonFilename = (now: number = Date.now()): string =>
  `raw-investor-cards-${new Date(now).toISOString().slice(0, 10)}.ndjson`;

export const patchPortfolioMetaOnServer = async (
  patch: Record<string, unknown>
): Promise<ServerDoc | null> => {
  try {
    const r = await fetch(apiUrl('/api/portfolio/meta'), {
      method: 'PATCH',
      headers: buildApiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(patch),
    });
    if (!r.ok) return null;
    return (await r.json()) as ServerDoc;
  } catch {
    return null;
  }
};

export const putCardOnServer = async (card: Card): Promise<Card | null> => {
  try {
    const r = await fetch(apiUrl(`/api/cards/${encodeURIComponent(card.id)}`), {
      method: 'PUT',
      headers: buildApiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(card),
    });
    if (!r.ok) return null;
    return (await r.json()) as Card;
  } catch {
    return null;
  }
};

export const postCardOnServer = async (card: Card): Promise<Card | null> => {
  try {
    const r = await fetch(apiUrl('/api/cards'), {
      method: 'POST',
      headers: buildApiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(card),
    });
    if (!r.ok) return null;
    return (await r.json()) as Card;
  } catch {
    return null;
  }
};

export type PatchCardResult =
  | { ok: true; card: Card }
  | { ok: false; status?: number; error?: string };

export const patchCardOnServer = async (id: string, patch: Partial<Card>): Promise<PatchCardResult> => {
  try {
    const r = await fetch(apiUrl(`/api/cards/${encodeURIComponent(id)}`), {
      method: 'PATCH',
      headers: buildApiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(patch),
    });
    const text = await r.text();
    if (!r.ok) {
      let err = `HTTP ${r.status}`;
      try {
        const j = JSON.parse(text) as { error?: string };
        if (j?.error) err = String(j.error);
      } catch {
        if (text && text.length < 500) err = `${err}: ${text}`;
      }
      return { ok: false, status: r.status, error: err };
    }
    try {
      const card = JSON.parse(text) as Card;
      return { ok: true, card };
    } catch {
      return { ok: false, status: r.status, error: 'Invalid JSON from PATCH response' };
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
};

/** Authoritative card row after PATCH or sync (GET single resource). */
export const fetchCardByIdFromServer = async (id: string): Promise<Card | null> => {
  try {
    const r = await fetch(apiUrl(`/api/cards/${encodeURIComponent(id)}`), {
      headers: buildApiHeaders({ Accept: 'application/json' }),
      cache: 'no-store',
    });
    if (!r.ok) return null;
    return (await r.json()) as Card;
  } catch {
    return null;
  }
};

export const deleteCardOnServer = async (id: string): Promise<boolean> => {
  try {
    const r = await fetch(apiUrl(`/api/cards/${encodeURIComponent(id)}`), {
      method: 'DELETE',
      headers: buildApiHeaders({ Accept: 'application/json' }),
    });
    return r.ok;
  } catch {
    return false;
  }
};

/**
 * PUT the current snapshot back to the server. Resolves to the new
 * `updatedAt` timestamp on success, or `null` when the save failed (server
 * offline, 5xx, body too big). Callers should treat `null` as "try again
 * next tick" - the next state change will re-trigger the debounced save.
 */
export const saveToServer = async (
  snapshot: PortfolioSnapshot
): Promise<number | null> => {
  try {
    const r = await fetch(apiUrl('/api/store'), {
      method: 'PUT',
      headers: buildApiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(snapshot),
    });
    if (!r.ok) return null;
    const data = (await r.json()) as { updatedAt?: number };
    return typeof data.updatedAt === 'number' ? data.updatedAt : Date.now();
  } catch {
    return null;
  }
};

/**
 * Merge a partial document into the server store (same as full snapshot PUT).
 * Use for Arsenal hunts/targets when the main app does not own that state.
 */
export const mergePortfolioServerPatch = async (
  patch: Record<string, unknown>
): Promise<number | null> => {
  const doc = await patchPortfolioMetaOnServer(patch);
  if (!doc || typeof doc.updatedAt !== 'number') return null;
  return doc.updatedAt;
};

/**
 * Build the portfolio JSON blob used by the manual Import / Export buttons.
 * Shape is deliberately identical to what the server persists so an export
 * file is a drop-in restore target.
 */
export const buildExportBlob = (
  snapshot: PortfolioSnapshot,
  now: number = Date.now()
): Blob => {
  const doc: ServerDoc = {
    version: 1,
    updatedAt: now,
    ...snapshot,
  };
  return new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
};

/** Today's date as `YYYY-MM-DD`, used for the default export filename. */
export const exportFilename = (now: number = Date.now()): string =>
  `raw-investor-portfolio-${new Date(now).toISOString().slice(0, 10)}.json`;

/**
 * Parse an uploaded portfolio JSON file. Returns a partial snapshot the
 * caller can merge into state, or throws a descriptive Error when the file
 * isn't a valid portfolio export.
 */
export const parseImport = (raw: string): Partial<PortfolioSnapshot> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('File is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected a JSON object at the top level.');
  }
  const obj = parsed as Record<string, unknown>;
  const out: Partial<PortfolioSnapshot> = {};
  if (Array.isArray(obj.cards)) out.cards = obj.cards as Card[];
  if (obj.fees && typeof obj.fees === 'object') out.fees = obj.fees as Fees;
  if (Array.isArray(obj.collections)) {
    out.collections = obj.collections as Collection[];
  }
  if (Array.isArray(obj.hunts)) out.hunts = obj.hunts as Hunt[];
  if (Array.isArray(obj.targets)) out.targets = obj.targets as Target[];
  if (obj.filters && typeof obj.filters === 'object') {
    out.filters = normalizeFilterState(obj.filters as Partial<FilterState>);
  }
  if (typeof obj.sort === 'string') out.sort = obj.sort as SortPreset;
  if (typeof obj.psaToken === 'string') out.psaToken = obj.psaToken;
  if (typeof obj.nebulaOpen === 'boolean') out.nebulaOpen = obj.nebulaOpen;
  if (typeof obj.extensionLatestOnlyMode === 'boolean') {
    out.extensionLatestOnlyMode = obj.extensionLatestOnlyMode;
  }
  if (typeof obj.googleCseKey === 'string') out.googleCseKey = obj.googleCseKey;
  if (typeof obj.googleCseCx === 'string') out.googleCseCx = obj.googleCseCx;

  if (Object.keys(out).length === 0) {
    throw new Error('File does not contain any recognised portfolio fields.');
  }
  return out;
};

/**
 * Portfolio JSON export or NDJSON lines of cards (one `{...}` card per line).
 */
export const parsePortfolioImportFile = (raw: string): Partial<PortfolioSnapshot> => {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('Empty file.');
  const head = trimmed[0];
  if (head === '{' || head === '[') {
    try {
      return parseImport(trimmed);
    } catch (err) {
      const cards = parseNdjsonCardLines(raw);
      if (cards.length === 0) throw err instanceof Error ? err : new Error(String(err));
      return { cards };
    }
  }
  const cards = parseNdjsonCardLines(raw);
  if (cards.length === 0) {
    throw new Error('No cards found (expected portfolio JSON or NDJSON lines).');
  }
  return { cards };
};

export const updateCanonicalEbayListingTags = async (
  req: EbayListingTagPatchRequest
): Promise<EbayListingTagPatchResponse> => {
  const headers: Record<string, string> = buildApiHeaders({ 'Content-Type': 'application/json' });
  if (req.maintToken && req.maintToken.trim()) {
    headers['x-maint-token'] = req.maintToken.trim();
  }
  const r = await fetch(apiUrl('/api/ext/capture/ebay/listing-tags'), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      url: req.url,
      itemId: req.itemId ?? null,
      soldAt: req.soldAt ?? null,
      price: req.price ?? null,
      correctedPrice: req.correctedPrice ?? null,
      title: req.title ?? null,
      isGraded: req.isGraded,
      grader: req.grader ?? null,
      gradeTag: req.gradeTag ?? null,
      conditionTag: req.conditionTag ?? null,
      isLot: req.isLot === true ? true : req.isLot === false ? false : null,
      lotQuantity:
        typeof req.lotQuantity === 'number' && Number.isFinite(req.lotQuantity)
          ? Math.max(1, Math.round(req.lotQuantity))
          : null,
      pokemonCenterStamp:
        req.pokemonCenterStamp === true ? true : req.pokemonCenterStamp === false ? false : null,
      sealedInTitle: req.sealedInTitle === true ? true : req.sealedInTitle === false ? false : null,
    }),
  });
  const payload = (await r.json().catch(() => ({ error: `HTTP ${r.status}` }))) as
    | EbayListingTagPatchResponse
    | { error?: string };
  if (!r.ok || !payload || typeof payload !== 'object' || !('ok' in payload)) {
    throw new Error(
      typeof payload === 'object' && payload && 'error' in payload && payload.error
        ? String(payload.error)
        : `HTTP ${r.status}`
    );
  }
  return payload;
};
