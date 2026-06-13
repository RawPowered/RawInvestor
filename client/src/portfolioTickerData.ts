import type { EnrichedCard } from './sort';
import { summarizeSales, SALES_STATS_WINDOW_DAYS } from './pricing';
import { recentSalesOnOrAfterRelease } from './releaseFilter';

export type TickerCardRow = {
  id: string;
  /** Short label for the X-axis */
  label: string;
  name: string;
  set: string;
  ev: number;
  raw: number;
  psa10: number;
  /** Implied sales / month (raw bucket), from scraped sales + volume. */
  paceRaw: number;
  /** Implied sales / month (PSA 10 bucket). */
  paceP10: number;
};

const MAX_LABEL = 20;

export const truncateTickerLabel = (name: string, max = MAX_LABEL): string => {
  const s = `${name}`.trim();
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(1, max - 1))}…`;
};

/**
 * Top-N cards by **expected value** (same ordering as “opportunity”), with PC
 * prices and sell-pace metrics for the market-ticker charts.
 */
export const buildPortfolioTickerRows = (
  visible: EnrichedCard[],
  topN: number
): TickerCardRow[] => {
  const n = Math.max(1, Math.min(64, Math.floor(topN)));
  const sorted = [...visible].sort((a, b) => b.metrics.ev - a.metrics.ev);
  const top = sorted.slice(0, n);
  return top.map((c) => {
    const sales = recentSalesOnOrAfterRelease(c.recentSales, c.releaseDateMs);
    const rawPace = summarizeSales(
      sales,
      'raw',
      SALES_STATS_WINDOW_DAYS,
      c.salesVolume,
      c.raw,
      undefined,
      c.raw
    );
    const p10Pace = summarizeSales(
      sales,
      'psa10',
      SALES_STATS_WINDOW_DAYS,
      c.salesVolume,
      c.psa10,
      undefined,
      c.raw
    );
    return {
      id: c.id,
      label: truncateTickerLabel(c.name),
      name: c.name,
      set: c.set,
      ev: c.metrics.ev,
      raw: c.raw,
      psa10: c.psa10,
      paceRaw: rawPace.pacePerMonth,
      paceP10: p10Pace.pacePerMonth,
    };
  });
};
