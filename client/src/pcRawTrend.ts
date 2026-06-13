import type { Card, PriceSnapshot, RecentSale } from './types';
import { effectivePriceHistory, recentSalesOnOrAfterRelease } from './releaseFilter';

const EPS = 0.05;

export type PcRawTrend = {
  pct: number;
  dir: 'up' | 'down' | 'flat';
};

const dirFromPct = (pct: number): PcRawTrend['dir'] => {
  if (!Number.isFinite(pct) || Math.abs(pct) < EPS) return 'flat';
  return pct > 0 ? 'up' : 'down';
};

/**
 * Trend of PC **raw** from the last two history snapshots that carry a raw
 * price (oldest-first; compares the last two such observations).
 */
export const pcRawTrendFromHistory = (history: PriceSnapshot[] | undefined): PcRawTrend | null => {
  if (!history?.length) return null;
  const withRaw = history.filter(
    (h) => typeof h.raw === 'number' && Number.isFinite(h.raw) && (h.raw as number) > 0
  );
  if (withRaw.length < 2) return null;
  const prior = withRaw[withRaw.length - 2]!.raw as number;
  const latest = withRaw[withRaw.length - 1]!.raw as number;
  if (prior <= 0) return null;
  const pct = ((latest - prior) / prior) * 100;
  return { pct, dir: dirFromPct(pct) };
};

/** Last two completed **raw** sales from PriceCharting (after release filter). */
export const pcRawTrendFromRecentRawSales = (sales: RecentSale[] | undefined): PcRawTrend | null => {
  const rows = (sales ?? [])
    .filter((s) => s.grade === 'raw' && Number.isFinite(s.price) && s.price > 0)
    .sort((a, b) => a.at - b.at);
  if (rows.length < 2) return null;
  const prior = rows[rows.length - 2]!.price;
  const latest = rows[rows.length - 1]!.price;
  if (prior <= 0) return null;
  const pct = ((latest - prior) / prior) * 100;
  return { pct, dir: dirFromPct(pct) };
};

/** Fallback: last refresh snapshot vs current raw (single step). */
export const pcRawTrendFromPrevious = (card: Pick<Card, 'raw' | 'previousPrices'>): PcRawTrend | null => {
  const prev = card.previousPrices?.raw;
  const cur = card.raw;
  if (typeof prev !== 'number' || !Number.isFinite(prev) || prev <= 0) return null;
  if (typeof cur !== 'number' || !Number.isFinite(cur)) return null;
  const pct = ((cur - prev) / prev) * 100;
  return { pct, dir: dirFromPct(pct) };
};

export type PcRawTrendCardInput = Pick<
  Card,
  'raw' | 'priceHistory' | 'previousPrices' | 'releaseDateMs' | 'grade9' | 'psa10' | 'recentSales'
>;

/**
 * PC raw % move for the master list: (1) last two raw prints in **effective**
 * price history (release + placeholder rules, same as charts), else (2) last
 * two **raw** rows in `recentSales`, else (3) prior refresh vs current raw.
 */
export const pcRawTrendForMasterList = (card: PcRawTrendCardInput): PcRawTrend | null => {
  const eff = effectivePriceHistory(card.priceHistory, card.releaseDateMs, {
    raw: card.raw,
    grade9: card.grade9,
    psa10: card.psa10,
  });
  const sales = recentSalesOnOrAfterRelease(card.recentSales, card.releaseDateMs);
  return (
    pcRawTrendFromHistory(eff) ??
    pcRawTrendFromRecentRawSales(sales) ??
    pcRawTrendFromPrevious(card)
  );
};
