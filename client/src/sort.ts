import type { Card, CardMetrics } from './types';

/**
 * Logical sort presets exposed to the user. Each preset is a stable comparator
 * so ties fall back to name A-Z, which keeps row order predictable across
 * repeated renders (important because React is keyed by card.id).
 */
export type SortPreset =
  | 'ev_desc'
  | 'ev_asc'
  | 'roi_desc'
  | 'roi_asc'
  | 'true_roi_desc'
  | 'true_roi_asc'
  | 'raw_roi_desc'
  | 'raw_roi_asc'
  | 'invested_asc'
  | 'invested_desc'
  | 'upside_desc'
  | 'p10_desc'
  | 'raw_asc'
  | 'psa10_desc'
  | 'name_asc'
  | 'name_desc'
  | 'set_asc';

export const SORT_LABELS: Record<SortPreset, string> = {
  ev_desc: 'Best EV (highest first)',
  ev_asc: 'Worst EV (lowest first)',
  roi_desc: 'Best ROI %',
  roi_asc: 'Worst ROI %',
  true_roi_desc: 'True possible ROI % (highest first)',
  true_roi_asc: 'True possible ROI % (lowest first)',
  raw_roi_desc: 'Raw ungraded ROI % (highest first)',
  raw_roi_asc: 'Raw ungraded ROI % (lowest first)',
  invested_asc: 'Cheapest to buy in',
  invested_desc: 'Most invested',
  upside_desc: 'Biggest upside (PSA 10 \u2212 Raw)',
  p10_desc: 'Most likely to PSA 10',
  raw_asc: 'Lowest raw price',
  psa10_desc: 'Highest PSA 10 price',
  name_asc: 'Name A \u2192 Z',
  name_desc: 'Name Z \u2192 A',
  set_asc: 'Set A \u2192 Z',
};

export type EnrichedCard = Card & {
  metrics: CardMetrics;
  /** Master-list Nebula-aligned icon flags (optional; filled in App). */
  rowSignalIcons?: import('./rowSignals').RowSignalIcons;
};

const byName = (a: EnrichedCard, b: EnrichedCard): number =>
  a.name.localeCompare(b.name);

/**
 * Direction-aware numeric comparator that always pushes NaN/undefined values
 * to the end, regardless of whether we're sorting ascending or descending.
 * Using a flag keeps the comparator bodies clean and the "bad-values-last"
 * guarantee honest in both directions.
 */
const cmpNum = (a: number, b: number, dir: 'asc' | 'desc'): number => {
  const aBad = !Number.isFinite(a);
  const bBad = !Number.isFinite(b);
  if (aBad && bBad) return 0;
  if (aBad) return 1;
  if (bBad) return -1;
  return dir === 'asc' ? a - b : b - a;
};

const entryPoint = (c: EnrichedCard): number => {
  const paid = typeof c.actualCost === 'number' && c.actualCost > 0 ? c.actualCost : c.raw;
  const ship = c.freeShipping ? 0 : Number(c.shippingCost) || 0;
  return paid + ship;
};

const truePossibleRoiPct = (c: EnrichedCard): number => {
  const potential = c.potentialValue;
  const entry = entryPoint(c);
  if (typeof potential !== 'number' || !Number.isFinite(potential) || entry <= 0) return NaN;
  return ((potential - entry) / entry) * 100;
};

const rawUngradedRoiPct = (c: EnrichedCard): number => {
  const entry = entryPoint(c);
  if (entry <= 0) return NaN;
  return ((c.raw - entry) / entry) * 100;
};

export const comparators: Record<SortPreset, (a: EnrichedCard, b: EnrichedCard) => number> = {
  ev_desc: (a, b) => cmpNum(a.metrics.ev, b.metrics.ev, 'desc') || byName(a, b),
  ev_asc: (a, b) => cmpNum(a.metrics.ev, b.metrics.ev, 'asc') || byName(a, b),
  roi_desc: (a, b) => cmpNum(a.metrics.roiPct, b.metrics.roiPct, 'desc') || byName(a, b),
  roi_asc: (a, b) => cmpNum(a.metrics.roiPct, b.metrics.roiPct, 'asc') || byName(a, b),
  true_roi_desc: (a, b) => cmpNum(truePossibleRoiPct(a), truePossibleRoiPct(b), 'desc') || byName(a, b),
  true_roi_asc: (a, b) => cmpNum(truePossibleRoiPct(a), truePossibleRoiPct(b), 'asc') || byName(a, b),
  raw_roi_desc: (a, b) => cmpNum(rawUngradedRoiPct(a), rawUngradedRoiPct(b), 'desc') || byName(a, b),
  raw_roi_asc: (a, b) => cmpNum(rawUngradedRoiPct(a), rawUngradedRoiPct(b), 'asc') || byName(a, b),
  invested_asc: (a, b) => cmpNum(a.metrics.totalInvested, b.metrics.totalInvested, 'asc') || byName(a, b),
  invested_desc: (a, b) => cmpNum(a.metrics.totalInvested, b.metrics.totalInvested, 'desc') || byName(a, b),
  upside_desc: (a, b) => cmpNum(a.psa10 - a.raw, b.psa10 - b.raw, 'desc') || byName(a, b),
  p10_desc: (a, b) => cmpNum(a.p10, b.p10, 'desc') || byName(a, b),
  raw_asc: (a, b) => cmpNum(a.raw, b.raw, 'asc') || byName(a, b),
  psa10_desc: (a, b) => cmpNum(a.psa10, b.psa10, 'desc') || byName(a, b),
  name_asc: byName,
  name_desc: (a, b) => byName(b, a),
  set_asc: (a, b) => a.set.localeCompare(b.set) || byName(a, b),
};

export type EvSign = 'all' | 'positive' | 'negative';

/** Master-list profitability shortcuts (AND-combined with EV sign, etc.). */
export type ProfitLens =
  | 'all'
  /** {@link CardMetrics.netRawNoGrade} > 0 — flip at raw without grading spend. */
  | 'raw_no_grade'
  /** {@link CardMetrics.ev} > 0 — probability-weighted grading lottery. */
  | 'grade_ev'
  /** {@link CardMetrics.net10} > 0 — profit if the card gems PSA 10. */
  | 'psa10_win';

export type PortfolioKindScope = 'all' | 'single' | 'sealed';

/** Stored kind when set; otherwise infer from active portfolio tab (matches server COALESCE). */
export const effectivePortfolioKind = (
  card: Pick<Card, 'portfolioKind'>,
  scope: PortfolioKindScope = 'all'
): 'single' | 'sealed' => {
  if (card.portfolioKind === 'sealed') return 'sealed';
  if (card.portfolioKind === 'single') return 'single';
  if (scope === 'sealed') return 'sealed';
  if (scope === 'single') return 'single';
  return 'single';
};

export type FilterState = {
  /** Substring match across name, set, rarity. Case-insensitive. */
  search: string;
  /** When non-empty, only cards whose collectionId is in this set are shown.
   *  The sentinel "__unassigned__" matches cards with no collectionId. */
  collectionIds: string[];
  evSign: EvSign;
  /** Exact `Card.set` values; empty = all sets. */
  sets: string[];
  /** Release years (UTC) from `releaseDateMs`; empty = any year. Cards with no release date never match when this is non-empty. */
  releaseYears: number[];
  /** Substring on `Card.name` only (case-insensitive). */
  pokemonName: string;
  profitLens: ProfitLens;
  /** Limit list to singles, sealed products, or both. */
  portfolioKindScope: PortfolioKindScope;
};

export const EMPTY_FILTERS: FilterState = {
  search: '',
  collectionIds: [],
  evSign: 'all',
  sets: [],
  releaseYears: [],
  pokemonName: '',
  profitLens: 'all',
  portfolioKindScope: 'single',
};

export const UNASSIGNED = '__unassigned__';

/** UTC calendar year from PriceCharting release timestamp, or null if unknown. */
export const releaseYearUtc = (c: Pick<Card, 'releaseDateMs'>): number | null => {
  const ms = c.releaseDateMs;
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms).getUTCFullYear();
};

const isProfitLens = (v: unknown): v is ProfitLens =>
  v === 'all' || v === 'raw_no_grade' || v === 'grade_ev' || v === 'psa10_win';

const isPortfolioKindScope = (v: unknown): v is PortfolioKindScope =>
  v === 'all' || v === 'single' || v === 'sealed';

export const applyFilters = (
  cards: EnrichedCard[],
  filters: FilterState
): EnrichedCard[] => {
  const q = filters.search.trim().toLowerCase();
  const wantCollections = new Set(filters.collectionIds);
  const filteringCollections = wantCollections.size > 0;
  const wantSets = new Set(filters.sets);
  const filteringSets = wantSets.size > 0;
  const wantYears = new Set(filters.releaseYears);
  const filteringYears = wantYears.size > 0;
  const poke = filters.pokemonName.trim().toLowerCase();
  const lens = filters.profitLens;
  const pkScope = filters.portfolioKindScope;

  return cards.filter((c) => {
    if (q) {
      const hay = `${c.name} ${c.set} ${c.rarity ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (filteringCollections) {
      const key = c.collectionId || UNASSIGNED;
      if (!wantCollections.has(key)) return false;
    }
    if (filteringSets && !wantSets.has(c.set)) return false;
    if (filteringYears) {
      const y = releaseYearUtc(c);
      if (y === null || !wantYears.has(y)) return false;
    }
    if (poke) {
      if (!c.name.toLowerCase().includes(poke)) return false;
    }
    if (lens === 'raw_no_grade' && !(c.metrics.netRawNoGrade > 0)) return false;
    if (lens === 'grade_ev' && !(c.metrics.ev > 0)) return false;
    if (lens === 'psa10_win' && !(c.metrics.net10 > 0)) return false;
    if (filters.evSign === 'positive' && c.metrics.ev < 0) return false;
    if (filters.evSign === 'negative' && c.metrics.ev >= 0) return false;
    const kind = effectivePortfolioKind(c, pkScope);
    if (pkScope === 'single' && kind !== 'single') return false;
    if (pkScope === 'sealed' && kind !== 'sealed') return false;
    return true;
  });
};

/** Merge persisted filters with defaults when new fields are added. */
export const normalizeFilterState = (parsed: Partial<FilterState> | null | undefined): FilterState => {
  const p = parsed ?? {};
  return {
    ...EMPTY_FILTERS,
    search: typeof p.search === 'string' ? p.search : EMPTY_FILTERS.search,
    collectionIds: Array.isArray(p.collectionIds)
      ? p.collectionIds.filter((x): x is string => typeof x === 'string')
      : EMPTY_FILTERS.collectionIds,
    evSign:
      p.evSign === 'positive' || p.evSign === 'negative' || p.evSign === 'all' ? p.evSign : EMPTY_FILTERS.evSign,
    sets: Array.isArray(p.sets)
      ? p.sets.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      : EMPTY_FILTERS.sets,
    releaseYears: Array.isArray(p.releaseYears)
      ? p.releaseYears.filter((x): x is number => typeof x === 'number' && Number.isFinite(x))
      : EMPTY_FILTERS.releaseYears,
    pokemonName: typeof p.pokemonName === 'string' ? p.pokemonName : EMPTY_FILTERS.pokemonName,
    profitLens: isProfitLens(p.profitLens) ? p.profitLens : EMPTY_FILTERS.profitLens,
    portfolioKindScope: isPortfolioKindScope(p.portfolioKindScope)
      ? p.portfolioKindScope
      : EMPTY_FILTERS.portfolioKindScope,
  };
};

export const applySort = (
  cards: EnrichedCard[],
  preset: SortPreset
): EnrichedCard[] => [...cards].sort(comparators[preset]);
