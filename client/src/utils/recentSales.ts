import type { PriceSnapshot, RecentSale, ScrapeResponse } from '../types';
import { SALES_STATS_WINDOW_DAYS } from '../pricing';
import { snapshotsFromRecentSales, startOfUtcDay } from '../releaseFilter';

export const buildSeedHistory = (data: ScrapeResponse): PriceSnapshot[] => {
  const cut =
    data.releaseDateMs != null && Number.isFinite(data.releaseDateMs) && data.releaseDateMs > 0
      ? startOfUtcDay(data.releaseDateMs)
      : null;
  const history: PriceSnapshot[] = [
    ...snapshotsFromRecentSales(data.recentSales, cut),
    {
      at: Date.now(),
      source: 'initial',
      raw: data.raw || undefined,
      grade9: data.grade9 || undefined,
      psa10: data.psa10 || undefined,
    },
  ];
  history.sort((a, b) => a.at - b.at);
  return history;
};

export const mergeRecentSales = (prev: RecentSale[] | undefined, next: RecentSale[] | undefined): RecentSale[] => {
  const windowMs = SALES_STATS_WINDOW_DAYS * 24 * 3600 * 1000;
  const cutoff = Date.now() - windowMs;
  const merged = [...(prev ?? []), ...(next ?? [])];
  const seen = new Set<string>();
  const out: RecentSale[] = [];
  for (const s of merged) {
    if (s.at < cutoff) continue;
    const k = `${s.at}|${s.grade}|${s.price}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  out.sort((a, b) => a.at - b.at);
  return out.slice(-550);
};

export const pickLatestPcSale = (sales: RecentSale[] | undefined): RecentSale | null => {
  if (!sales?.length) return null;
  return sales.reduce((a, b) => (b.at > a.at ? b : a));
};

export const saleGradeShort = (sale: RecentSale): string =>
  sale.label?.trim() ||
  (sale.grade === 'raw'
    ? 'Raw'
    : sale.grade === 'grade9'
      ? 'Grade 9'
      : sale.grade === 'psa10'
        ? 'PSA 10'
        : 'Other');
