import type { PriceSnapshot, RecentSale } from './types';

const MS_DAY = 24 * 3600 * 1000;
const MS_MIN = 60 * 1000;

/** Start of the UTC calendar day for a timestamp (filters align with epoch ms). */
export const startOfUtcDay = (ms: number): number => {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

/**
 * One chart snapshot per scraped sale (`source: 'pc_sale'`). Date-only strings
 * from PriceCharting often collapse many rows to the same epoch; we shift by
 * whole minutes within the same UTC day (per grade) so lines are visible.
 */
export const snapshotsFromRecentSales = (
  sales: RecentSale[] | undefined,
  releaseCutMs: number | null
): PriceSnapshot[] => {
  const rows = (sales ?? []).filter(
    (s) =>
      s.grade !== 'other' &&
      Number.isFinite(s.price) &&
      s.price > 0 &&
      (releaseCutMs == null || s.at >= releaseCutMs)
  );
  rows.sort(
    (a, b) =>
      a.at - b.at || (a.grade < b.grade ? -1 : 1) || a.price - b.price || 0
  );
  const perDayGrade = new Map<string, number>();
  const out: PriceSnapshot[] = [];
  for (const sale of rows) {
    const day = Math.floor(sale.at / MS_DAY);
    const gk = `${day}|${sale.grade}`;
    const slot = perDayGrade.get(gk) ?? 0;
    perDayGrade.set(gk, slot + 1);
    const at = sale.at + slot * MS_MIN;
    const snap: PriceSnapshot = { at, source: 'pc_sale' };
    if (sale.grade === 'raw') snap.raw = sale.price;
    else if (sale.grade === 'grade9') snap.grade9 = sale.price;
    else snap.psa10 = sale.price;
    out.push(snap);
  }
  return out;
};

/**
 * PriceCharting's matrix pins ~$5–$8 when a cell has no real sales yet. Those
 * prints must not look like trading days on our chart.
 *
 * - **Raw**: strip band values well below posted ungraded FMV, **or** well
 *   below the highest raw seen outside the band in the same history (so cheap
 *   posted refs still drop fake \$6 rows when real comps exist).
 * - **Grade 9 / PSA 10**: strip only when posted graded prices clearly sit
 *   above raw (so we do not strip legitimately cheap slabs).
 */
export const stripPcPlaceholderGradeFields = (
  history: PriceSnapshot[],
  refs: { raw: number; grade9: number; psa10: number }
): PriceSnapshot[] => {
  const r = Number(refs.raw) || 0;
  const gRef = Number(refs.grade9) || 0;
  const pRef = Number(refs.psa10) || 0;
  const emptyBandLo = 5.0;
  const emptyBandHi = 8.35;

  const sep =
    (gRef >= r * 2.2 && gRef >= 12) || (pRef >= r * 2.2 && pRef >= 12);

  /** Max raw observed outside the PC empty-cell band (proves real comps exist). */
  let maxRawOutsideBand = 0;
  for (const snap of history) {
    const v = snap.raw;
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    if (v < emptyBandLo || v > emptyBandHi) {
      maxRawOutsideBand = Math.max(maxRawOutsideBand, v);
    }
  }

  return history.map((snap) => {
    const out: PriceSnapshot = { ...snap };

    if (typeof out.raw === 'number' && out.raw >= emptyBandLo && out.raw <= emptyBandHi) {
      const stripVsPosted = r >= 12 && out.raw < r * 0.42;
      const stripVsPeers =
        maxRawOutsideBand >= 12 && out.raw < maxRawOutsideBand * 0.55;
      if (stripVsPosted || stripVsPeers) {
        delete out.raw;
      }
    }

    if (!sep) return out;

    if (
      typeof out.grade9 === 'number' &&
      out.grade9 >= emptyBandLo &&
      out.grade9 <= emptyBandHi &&
      gRef > 0 &&
      out.grade9 < gRef * 0.42
    ) {
      delete out.grade9;
    }
    if (
      typeof out.psa10 === 'number' &&
      out.psa10 >= emptyBandLo &&
      out.psa10 <= emptyBandHi &&
      pRef > 0 &&
      out.psa10 < pRef * 0.42
    ) {
      delete out.psa10;
    }
    return out;
  });
};

/**
 * Release-day cutoff + graded placeholder cleanup — what charts & signals should use.
 */
export const effectivePriceHistory = (
  history: PriceSnapshot[] | undefined,
  releaseDateMs: number | null | undefined,
  refs: { raw: number; grade9: number; psa10: number }
): PriceSnapshot[] => {
  const step1 = priceHistoryOnOrAfterRelease(history, releaseDateMs);
  return stripPcPlaceholderGradeFields(step1, refs);
};

/**
 * Ignore price history before the game's/card's release — PriceCharting often
 * back-fills charts with placeholder levels (~$6) before the item existed.
 */
export const priceHistoryOnOrAfterRelease = (
  history: PriceSnapshot[] | undefined,
  releaseDateMs: number | null | undefined
): PriceSnapshot[] => {
  const h = history ?? [];
  if (!h.length) return [];
  if (
    releaseDateMs == null ||
    !Number.isFinite(releaseDateMs) ||
    releaseDateMs <= 0
  ) {
    return h;
  }
  const cut = startOfUtcDay(releaseDateMs);
  return h.filter((p) => p.at >= cut);
};

/** Drop completed-sale rows before the card release (UTC day), same rule as price history. */
export const recentSalesOnOrAfterRelease = (
  sales: RecentSale[] | undefined,
  releaseDateMs: number | null | undefined
): RecentSale[] => {
  const s = sales ?? [];
  if (!s.length) return [];
  if (
    releaseDateMs == null ||
    !Number.isFinite(releaseDateMs) ||
    releaseDateMs <= 0
  ) {
    return s;
  }
  const cut = startOfUtcDay(releaseDateMs);
  return s.filter((x) => x.at >= cut);
};
