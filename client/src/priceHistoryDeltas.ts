import type { PriceSnapshot } from './types';
import { startOfUtcDay } from './releaseFilter';

export type ChartGradeKey = 'raw' | 'grade9' | 'psa10';

const DAY_MS = 24 * 3600 * 1000;

/** Newest snapshot strictly before the UTC calendar day that contains `dayContainingMs`. */
export function lastSnapshotBeforeUtcDay(
  sortedOldestFirst: PriceSnapshot[],
  dayContainingMs: number
): PriceSnapshot | null {
  const boundary = startOfUtcDay(dayContainingMs);
  for (let i = sortedOldestFirst.length - 1; i >= 0; i--) {
    const s = sortedOldestFirst[i];
    if (s.at < boundary) return s;
  }
  return null;
}

/** Newest snapshot with `at <= ms` (history sorted oldest → newest). */
export function lastSnapshotAtOrBefore(
  sortedOldestFirst: PriceSnapshot[],
  ms: number
): PriceSnapshot | null {
  for (let i = sortedOldestFirst.length - 1; i >= 0; i--) {
    const s = sortedOldestFirst[i];
    if (s.at <= ms) return s;
  }
  return null;
}

/**
 * Baseline for "move since last day": last print before the UTC start of the
 * refresh day; if none (only same-day data), fall back to the last print at
 * least ~24h before `lastRefreshedAt`. Excludes points at or after refresh time.
 */
export function dayOverDayBaseline(
  sortedOldestFirst: PriceSnapshot[],
  lastRefreshedAt: number
): PriceSnapshot | null {
  if (!Number.isFinite(lastRefreshedAt) || lastRefreshedAt <= 0) return null;
  const byCal = lastSnapshotBeforeUtcDay(sortedOldestFirst, lastRefreshedAt);
  const cand = byCal ?? lastSnapshotAtOrBefore(sortedOldestFirst, lastRefreshedAt - DAY_MS);
  if (!cand || cand.at >= lastRefreshedAt) return null;
  return cand;
}

/** Earliest row with a finite value for `grade` (history oldest → newest). */
export function firstObservationWithGrade(
  history: PriceSnapshot[],
  grade: ChartGradeKey
): { snapshot: PriceSnapshot; index: number } | null {
  for (let i = 0; i < history.length; i++) {
    const v = history[i][grade];
    if (typeof v === 'number' && Number.isFinite(v)) {
      return { snapshot: history[i], index: i };
    }
  }
  return null;
}

/** Latest row at or before `fromIndex` that has a finite value for `grade`. */
export function priorObservationWithGrade(
  history: PriceSnapshot[],
  fromIndex: number,
  grade: ChartGradeKey
): { snapshot: PriceSnapshot; index: number } | null {
  for (let j = fromIndex - 1; j >= 0; j--) {
    const v = history[j][grade];
    if (typeof v === 'number' && Number.isFinite(v)) {
      return { snapshot: history[j], index: j };
    }
  }
  return null;
}

export function deltaUsdAndPct(
  from: number,
  to: number
): { usd: number; pct: number | null } {
  const usd = to - from;
  if (!Number.isFinite(from) || !Number.isFinite(to)) return { usd, pct: null };
  if (Math.abs(from) < 1e-9) return { usd, pct: usd === 0 ? 0 : null };
  return { usd, pct: (usd / from) * 100 };
}

/** Human-readable elapsed time from the earlier observation to the later one. */
export function formatElapsedAfterPrior(msLater: number, msEarlier: number): string {
  const sec = Math.max(0, Math.floor((msLater - msEarlier) / 1000));
  if (sec < 90) return 'moments after prior point';
  const min = Math.floor(sec / 60);
  if (min < 90) return `${min} min after prior point`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h after prior point`;
  const day = Math.floor(hr / 24);
  if (day < 14) return `${day}d after prior point`;
  if (day < 60) return `${Math.floor(day / 7)} wk after prior point`;
  return `${Math.floor(day / 30)} mo after prior point`;
}

export function yExtentForRows(
  rows: ReadonlyArray<{
    raw: number | null;
    grade9: number | null;
    psa10: number | null;
  }>
): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const r of rows) {
    for (const k of ['raw', 'grade9', 'psa10'] as const) {
      const v = r[k];
      if (typeof v === 'number' && Number.isFinite(v)) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  const span = hi - lo;
  const pad = span > 0 ? span * 0.06 : Math.max(hi * 0.04, 1);
  return [Math.max(0, lo - pad), hi + pad];
}

/**
 * Y-axis domain for a multi-grade chart: use ~2nd–98th percentile of all
 * positive finite prices so one PSA spike does not flatten raw near the axis.
 */
export function yExtentForPriceChart(
  rows: ReadonlyArray<{
    raw: number | null;
    grade9: number | null;
    psa10: number | null;
    tcgMarket?: number | null;
  }>
): [number, number] | null {
  const vals: number[] = [];
  for (const r of rows) {
    for (const k of ['raw', 'grade9', 'psa10'] as const) {
      const v = r[k];
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) vals.push(v);
    }
    const t = r.tcgMarket;
    if (typeof t === 'number' && Number.isFinite(t) && t > 0) vals.push(t);
  }
  if (vals.length === 0) return null;
  vals.sort((a, b) => a - b);
  const n = vals.length;
  const loIdx = Math.max(0, Math.floor((n - 1) * 0.02));
  const hiIdx = Math.min(n - 1, Math.ceil((n - 1) * 0.98));
  const lo = vals[loIdx];
  const hi = vals[hiIdx];
  const span = hi - lo;
  const pad = span > 0 ? span * 0.08 : Math.max(hi * 0.05, 1);
  return [Math.max(0, lo - pad), hi + pad];
}
