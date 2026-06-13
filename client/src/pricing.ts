import type {
  CrossGraderCompany,
  CrossGraderPrice,
  GradePrice,
  PriceAdvice,
  EbaySalesSummary,
  CombinedSalesPace,
  RecentSale,
  SellPriceTargets,
  SellPricingPolicy,
  SalesPaceSummary,
  SalesVolume,
} from './types';

/**
 * Below this many observed sales, the per-grade distribution is too noisy
 * to trust. We fall back to PriceCharting's posted price - it's the best
 * aggregate math available and already accounts for eBay fees, outliers,
 * and sell-through rate on their end.
 */
export const MIN_SALES_FOR_DISTRIBUTION = 10;

/**
 * Default rolling window for sale counts, pace, and price distribution.
 * PriceCharting only surfaces roughly the last ~30 days of completed sales in
 * pages we scrape — we do not have their full all-time tape, so all sale-based
 * stats use this horizon (not an arbitrary long lookback).
 */
export const SALES_STATS_WINDOW_DAYS = 30;

export const DEFAULT_SELL_PRICING_POLICY: SellPricingPolicy = {
  ebayFeeRate: 0.13,
  whatnotFeeRate: 0.08,
  targetMarginRate: 0.1,
  directOfferDiscountRate: 0.88,
};

const roundMoney = (value: number): number => Math.round(value * 100) / 100;

export const computeSellPriceTargets = (
  marketPrice: number,
  policy: SellPricingPolicy = DEFAULT_SELL_PRICING_POLICY
): SellPriceTargets => {
  const market = Number.isFinite(marketPrice) && marketPrice > 0 ? marketPrice : 0;
  if (market <= 0) {
    return {
      marketPrice: 0,
      optimalEbayPrice: 0,
      optimalWhatnotPrice: 0,
      directCashAppOffer: 0,
    };
  }
  const ebayNetRate = Math.max(0.05, 1 - policy.ebayFeeRate - policy.targetMarginRate);
  const whatnotNetRate = Math.max(0.05, 1 - policy.whatnotFeeRate - policy.targetMarginRate);
  return {
    marketPrice: roundMoney(market),
    optimalEbayPrice: roundMoney(market / ebayNetRate),
    optimalWhatnotPrice: roundMoney(market / whatnotNetRate),
    directCashAppOffer: roundMoney(market * policy.directOfferDiscountRate),
  };
};

/**
 * Quantile using linear interpolation between closest ranks (the "type 7"
 * quantile - same as numpy's default and Excel's PERCENTILE.INC).
 *
 * Returns null for empty input so callers can easily distinguish "no data"
 * from "legitimately zero".
 */
export const quantile = (sortedAsc: number[], q: number): number | null => {
  if (sortedAsc.length === 0) return null;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const clamped = Math.min(1, Math.max(0, q));
  const pos = clamped * (sortedAsc.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedAsc[lo];
  const frac = pos - lo;
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * frac;
};

const mean = (xs: number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length;

const stdDev = (xs: number[]): number => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const v = xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length;
  return Math.sqrt(v);
};

/**
 * Pick the best pace signal we can build:
 *  - Prefer the page-scraped `salesVolume.month` when present (site-wide truth
 *    across all graders/sellers).
 *  - Otherwise fall back to counting our own observed sales in the window and
 *    scaling to 30 days.
 *
 * Returns both `monthPace` and a `source` flag so the UI can be honest about
 * whether the number is measured or estimated.
 */
export const computePace = (
  sales: RecentSale[],
  grade: 'raw' | 'grade9' | 'psa10',
  volume: SalesVolume | undefined,
  windowDays: number,
  now: number,
  pcReferencePrice?: number,
  rawPcPrice?: number
): { pacePerMonth: number; pacePerWeek: number; source: 'scraped' | 'observed' | 'none' } => {
  // Scraped volume is site-wide (not per-grade). Use it only when we have no
  // per-grade observations, since mixing total-volume with grade-specific
  // stats would be misleading.
  const cutoff = now - windowDays * 24 * 3600 * 1000;
  const anchor =
    typeof pcReferencePrice === 'number' && pcReferencePrice > 0
      ? pcReferencePrice
      : null;
  const rawAnchor =
    typeof rawPcPrice === 'number' && rawPcPrice > 0 ? rawPcPrice : null;
  const observed = filterSalesForGradeWindow(
    sales,
    grade,
    cutoff,
    anchor,
    rawAnchor
  );
  if (observed.length > 0) {
    const pacePerMonth = (observed.length / windowDays) * 30;
    return {
      pacePerMonth,
      pacePerWeek: pacePerMonth / (30 / 7),
      source: 'observed',
    };
  }
  if (volume && typeof volume.month === 'number') {
    return {
      pacePerMonth: volume.month,
      pacePerWeek: volume.week ?? volume.month / (30 / 7),
      source: 'scraped',
    };
  }
  if (volume && typeof volume.week === 'number') {
    return {
      pacePerMonth: volume.week * (30 / 7),
      pacePerWeek: volume.week,
      source: 'scraped',
    };
  }
  return { pacePerMonth: 0, pacePerWeek: 0, source: 'none' };
};

/**
 * Decide whether to push for the higher end of the distribution.
 *
 * Heuristics (conservative):
 *  - count < 3         -> insufficient data, hold the median
 *  - pace < 2/month    -> slow mover, list at p75 but expect wait time
 *  - top-tail has <=1  -> the "high" is likely an outlier - DON'T chase it
 *  - pace >= 4/month AND at least 3 sales at or above p75 -> push stretch price
 *  - otherwise         -> list at p75
 */
const decidePushHigher = (
  prices: number[],
  p75: number | null,
  pacePerMonth: number
): SalesPaceSummary['pushHigher'] => {
  const count = prices.length;
  if (count < 3) {
    return {
      advice: 'insufficient',
      label: 'NEED MORE DATA',
      reason: `Only ${count} observed sale${count === 1 ? '' : 's'} in the window. Wait for more before pricing aggressively.`,
      confidence: 'low',
    };
  }
  if (pacePerMonth < 2) {
    return {
      advice: 'hold_median',
      label: 'HOLD AT MEDIAN',
      reason: 'Pace is slow (<2 sales/month). Listing high will mean a long wait; price at median for a realistic sale.',
      confidence: 'medium',
    };
  }
  // Outlier detection: the max sale is a flyer if it's far above P75, since
  // the quantile can sit in the clustered lows when there is one extreme
  // top sale. Ratio-based check is robust to the count-based one, which
  // misfires when a single outlier drags nothing else with it.
  const max = prices[prices.length - 1];
  const hasOutlier = p75 != null && p75 > 0 && max > p75 * 1.6;
  if (hasOutlier) {
    return {
      advice: 'list_at_p75',
      label: 'LIST AT P75',
      reason: `The top sale ($${max.toFixed(0)}) is ${(max / (p75 || 1)).toFixed(1)}x the P75 - likely an outlier. List at P75 for a repeatable price.`,
      confidence: 'medium',
    };
  }
  const highTail = p75 != null ? prices.filter((p) => p >= p75).length : 0;
  if (pacePerMonth >= 4 && highTail >= 3) {
    return {
      advice: 'push_higher',
      label: 'PUSH HIGHER',
      reason: `Strong market (${pacePerMonth.toFixed(1)}/mo) and ${highTail} sales at or above P75. Listing at P90 is realistic.`,
      confidence: 'high',
    };
  }
  return {
    advice: 'list_at_p75',
    label: 'LIST AT P75',
    reason: `Healthy pace (${pacePerMonth.toFixed(1)}/mo). P75 balances a fair sell price against time-on-market.`,
    confidence: 'medium',
  };
};

/**
 * Build a PC-reference-based suggestion when observed sales are too thin.
 * PriceCharting's posted price is treated as the authoritative "list" price,
 * and floor / stretch are derived as symmetric bands around it.
 *
 *   floor:   -10%  (accept a quick sale)
 *   list:    PC price (what the market actually clears at)
 *   stretch: +15%  (only realistic if the card is presentation-grade)
 */
const buildPcFallbackSuggestion = (
  pcPrice: number
): SalesPaceSummary['suggestion'] => ({
  floor: Math.round(pcPrice * 0.9 * 100) / 100,
  list: pcPrice,
  stretch: Math.round(pcPrice * 1.15 * 100) / 100,
});

const buildPcFallbackSignal = (
  grade: 'raw' | 'grade9' | 'psa10',
  pcPrice: number,
  count: number
): SalesPaceSummary['pushHigher'] => ({
  advice: 'pc_reference',
  label: 'USE PC REFERENCE',
  reason:
    count === 0
      ? `No ${grade} sales observed. Using PriceCharting's $${pcPrice.toFixed(2)} as the list price - PC already averages recent eBay sales and filters outliers.`
      : `Only ${count} observed sale${count === 1 ? '' : 's'} (need ${MIN_SALES_FOR_DISTRIBUTION} for a reliable distribution). Falling back to PriceCharting's $${pcPrice.toFixed(2)} reference.`,
  confidence: 'medium',
});

/**
 * Full sales-pace summary for a single grade, computed over the last N days
 * of observed sales.
 *
 * When observations are sparse (< MIN_SALES_FOR_DISTRIBUTION) and a
 * `pcReferencePrice` is supplied, the suggestion block is built from PC's
 * posted price instead of from noisy quantiles. The distribution fields
 * (low/median/high/etc.) still reflect the observed sales so the UI can
 * display them for context.
 *
 * Safe to call with empty input.
 */
/**
 * Sanity band against the PC posted price. Anything outside [10%, 500%] of
 * the posted number is almost certainly a parse error (shipping cost grabbed
 * as price, wrong-grade row, bad fixture, etc.) and would poison the
 * distribution. We only apply the band when a PC price is known.
 */
const SANITY_LOW = 0.1;
const SANITY_HIGH = 5.0;

/** eBay tracked / USPS clickspring cluster — shipping is often parsed as ~$6. */
const SHIPPING_CLUSTER_LO = 5.05;
const SHIPPING_CLUSTER_HI = 7.55;

/**
 * When PSA 9 / PSA 10 posted prices are far above raw, loose cards and
 * mis-tagged rows often pollute graded buckets at raw-ish dollar amounts.
 */
export const salePassesGradedSemantics = (
  grade: 'raw' | 'grade9' | 'psa10',
  price: number,
  gradedPcPrice: number | undefined | null,
  rawPcPrice: number | undefined | null
): boolean => {
  if (grade === 'raw') return true;
  const g =
    typeof gradedPcPrice === 'number' &&
    Number.isFinite(gradedPcPrice) &&
    gradedPcPrice > 0
      ? gradedPcPrice
      : 0;
  const r =
    typeof rawPcPrice === 'number' && Number.isFinite(rawPcPrice) && rawPcPrice > 0
      ? rawPcPrice
      : 0;
  if (g <= 0 || r <= 0) return true;
  // Cheap slabs where graded isn't meaningfully separable from raw — don't guess.
  if (g < r * 2.2) return true;

  const minGraded = Math.max(g * 0.34, r * 1.65);
  return price + 1e-9 >= minGraded;
};

/**
 * When ungraded FMV is low but a third of rows sit in the ~$6 shipping band,
 * those prints are usually mis-parsed shipping — not hammer prices.
 */
const stripRawShippingCluster = (
  rows: RecentSale[],
  rawPcPrice: number
): RecentSale[] => {
  if (rows.length < 12 || rawPcPrice <= 0) return rows;
  // Card already trades inside / above the cluster — leave alone.
  if (rawPcPrice >= SHIPPING_CLUSTER_LO - 0.25) return rows;

  const inCluster = rows.filter(
    (s) =>
      s.price >= SHIPPING_CLUSTER_LO && s.price <= SHIPPING_CLUSTER_HI
  );
  if (inCluster.length / rows.length < 0.32) return rows;

  const rest = rows.filter(
    (s) => s.price < SHIPPING_CLUSTER_LO || s.price > SHIPPING_CLUSTER_HI
  );
  if (rest.length >= 8 && rest.length >= rows.length * 0.38) return rest;
  return rows;
};

/** Same ~$5–$8.35 empty-matrix band as `releaseFilter` price history cleanup. */
const RAW_MATRIX_LO = 5.0;
const RAW_MATRIX_HI = 8.35;

/**
 * When posted raw is clearly above the matrix band, drop raw "sales" in that
 * band that sit far below FMV — shipping / empty cells, not real hammer prices.
 * (The low-FMV shipping-cluster path stays in {@link stripRawShippingCluster}.)
 */
const stripHighFmvRawMatrixBand = (
  rows: RecentSale[],
  rawPcAnchor: number
): RecentSale[] => {
  if (rawPcAnchor < 12) return rows;
  return rows.filter(
    (s) =>
      !(
        s.price >= RAW_MATRIX_LO &&
        s.price <= RAW_MATRIX_HI &&
        s.price < rawPcAnchor * 0.42
      )
  );
};

/** Shared row filter so pace counts and histograms match exactly. */
export const filterSalesForGradeWindow = (
  sales: RecentSale[],
  grade: 'raw' | 'grade9' | 'psa10',
  cutoff: number,
  gradedPcAnchor: number | null,
  rawPcAnchor: number | null
): RecentSale[] => {
  let rows = sales.filter((s) => {
    if (s.grade !== grade || s.at < cutoff) return false;
    if (!Number.isFinite(s.price) || s.price <= 0) return false;
    if (gradedPcAnchor != null) {
      if (s.price < gradedPcAnchor * SANITY_LOW) return false;
      if (s.price > gradedPcAnchor * SANITY_HIGH) return false;
    }
    if (
      !salePassesGradedSemantics(
        grade,
        s.price,
        gradedPcAnchor ?? undefined,
        rawPcAnchor ?? undefined
      )
    ) {
      return false;
    }
    return true;
  });

  if (grade === 'raw' && rawPcAnchor != null && rawPcAnchor > 0) {
    rows = stripRawShippingCluster(rows, rawPcAnchor);
    rows = stripHighFmvRawMatrixBand(rows, rawPcAnchor);
  }
  return rows;
};

const MS_PER_DAY = 24 * 3600 * 1000;

/**
 * Plain-text cadence summary (Raw / Grade 9 / PSA 10) from whatever sales are
 * in `sales` — typically the merged scrape set after release-date filtering.
 */
export const formatSalesCadenceReport = (
  sales: RecentSale[],
  now: number = Date.now()
): string => {
  const tiers: Array<{ grade: 'raw' | 'grade9' | 'psa10'; label: string }> = [
    { grade: 'raw', label: 'RAW' },
    { grade: 'grade9', label: 'GRADE 9' },
    { grade: 'psa10', label: 'PSA 10' },
  ];
  const lines: string[] = [];
  for (const { grade, label } of tiers) {
    const arr = sales.filter((s) => s.grade === grade);
    if (arr.length === 0) continue;
    const c7 = arr.filter((s) => s.at >= now - 7 * MS_PER_DAY).length;
    const c30 = arr.filter((s) => s.at >= now - 30 * MS_PER_DAY).length;
    const c90 = arr.filter((s) => s.at >= now - 90 * MS_PER_DAY).length;
    const perDay7 = c7 / 7;
    const perDay30 = c30 / 30;
    const perWeek30 = (c30 / 30) * 7;
    const per30From90 = c90 / 3;
    lines.push(
      `${label.padEnd(8)} n=${String(arr.length).padStart(4)}  ` +
        `7d:${String(c7).padStart(3)} (${perDay7.toFixed(2)}/d)  ` +
        `30d:${String(c30).padStart(3)} (${perDay30.toFixed(2)}/d, ${perWeek30.toFixed(1)}/wk)  ` +
        `90d:${String(c90).padStart(3)} (~${per30From90.toFixed(1)}/30d)`
    );
  }
  return lines.join('\n');
};

export const summarizeSales = (
  sales: RecentSale[],
  grade: 'raw' | 'grade9' | 'psa10',
  windowDays: number,
  volume: SalesVolume | undefined,
  pcReferencePrice?: number,
  now: number = Date.now(),
  rawPcPrice?: number
): SalesPaceSummary => {
  const cutoff = now - windowDays * 24 * 3600 * 1000;
  const pcAnchor =
    typeof pcReferencePrice === 'number' && pcReferencePrice > 0
      ? pcReferencePrice
      : null;
  const rawAnchor =
    typeof rawPcPrice === 'number' && rawPcPrice > 0 ? rawPcPrice : null;

  const filteredRows = filterSalesForGradeWindow(
    sales,
    grade,
    cutoff,
    pcAnchor,
    rawAnchor
  );
  const inWindow = filteredRows.map((s) => s.price).sort((a, b) => a - b);

  const count = inWindow.length;
  const pace = computePace(
    sales,
    grade,
    volume,
    windowDays,
    now,
    pcAnchor ?? undefined,
    rawPcPrice
  );
  const pcPrice = pcAnchor;

  const low = count ? inWindow[0] : null;
  const high = count ? inWindow[inWindow.length - 1] : null;
  const p25 = quantile(inWindow, 0.25);
  const median = quantile(inWindow, 0.5);
  const p75 = quantile(inWindow, 0.75);
  const p90 = quantile(inWindow, 0.9);
  const avg = count ? mean(inWindow) : null;
  const sd = count ? stdDev(inWindow) : null;

  // Branch 1: enough sales for a real distribution.
  if (count >= MIN_SALES_FOR_DISTRIBUTION) {
    return {
      grade,
      windowDays,
      count,
      pacePerMonth: pace.pacePerMonth,
      pacePerWeek: pace.pacePerWeek,
      low,
      p25,
      median,
      mean: avg,
      p75,
      p90,
      high,
      stdDev: sd,
      suggestion: {
        floor: p25,
        list: p75,
        stretch: p90,
      },
      pushHigher: decidePushHigher(inWindow, p75, pace.pacePerMonth),
      referenceMode: 'observed',
      referencePrice: median,
    };
  }

  // Branch 2: thin observations but we have a PC anchor - PC's posted
  // price is our source of truth.
  if (pcPrice != null) {
    return {
      grade,
      windowDays,
      count,
      pacePerMonth: pace.pacePerMonth,
      pacePerWeek: pace.pacePerWeek,
      low,
      p25,
      median,
      mean: avg,
      p75,
      p90,
      high,
      stdDev: sd,
      suggestion: buildPcFallbackSuggestion(pcPrice),
      pushHigher: buildPcFallbackSignal(grade, pcPrice, count),
      referenceMode: 'pc_fallback',
      referencePrice: pcPrice,
    };
  }

  // Branch 3: no data at all (empty sales AND no PC price).
  return {
    grade,
    windowDays,
    count,
    pacePerMonth: pace.pacePerMonth,
    pacePerWeek: pace.pacePerWeek,
    low,
    p25,
    median,
    mean: avg,
    p75,
    p90,
    high,
    stdDev: sd,
    suggestion: { floor: null, list: null, stretch: null },
    pushHigher: {
      advice: 'insufficient',
      label: 'NO DATA',
      reason: `No ${grade} sales observed and no PriceCharting price to fall back on. Refresh the card to seed the history.`,
      confidence: 'low',
    },
    referenceMode: 'no_data',
    referencePrice: null,
  };
};

const paceConfidence = (pacePerMonth: number, count: number): 'low' | 'medium' | 'high' => {
  if (count >= 20 || pacePerMonth >= 8) return 'high';
  if (count >= 8 || pacePerMonth >= 3) return 'medium';
  return 'low';
};

/**
 * Merge PC and eBay pace snapshots into one explainable signal.
 * - Prefer the source with stronger sample size and recency.
 * - Use hybrid mode when both sources are meaningfully populated.
 */
export const combineSalesPace = (
  grade: 'raw' | 'grade9' | 'psa10',
  pc: SalesPaceSummary,
  ebay: EbaySalesSummary | null
): CombinedSalesPace => {
  const ebayCount = ebay?.count ?? 0;
  const pcCount = pc.count;
  const ebayFreshness = ebay ? Math.max(0, Date.now() - ebay.fetchedAt) : Number.POSITIVE_INFINITY;
  const ebayFreshScore = Number.isFinite(ebayFreshness) ? Math.max(0, 1 - ebayFreshness / (7 * 24 * 3600 * 1000)) : 0;
  const pcScore = pcCount * 1.15 + pc.pacePerMonth * 0.5;
  const ebayScore = ebayCount * 1.15 + (ebay?.pacePerMonth ?? 0) * 0.5 + ebayFreshScore;

  if (!ebay || ebayCount === 0) {
    return {
      grade,
      source: 'pc',
      confidence: paceConfidence(pc.pacePerMonth, pcCount),
      pacePerMonth: pc.pacePerMonth,
      pacePerWeek: pc.pacePerWeek,
      referencePrice: pc.referencePrice,
      count: pcCount,
      windowDays: pc.windowDays,
      pc,
      ebay: null,
    };
  }

  const bothStrong = pcCount >= 4 && ebayCount >= 4;
  if (bothStrong) {
    const pacePerMonth = (pc.pacePerMonth * pcScore + ebay.pacePerMonth * ebayScore) / (pcScore + ebayScore);
    const pacePerWeek = pacePerMonth / (30 / 7);
    const referencePrice = ebay.median ?? pc.referencePrice;
    const confidence = paceConfidence(pacePerMonth, pcCount + ebayCount);
    return {
      grade,
      source: 'hybrid',
      confidence,
      pacePerMonth,
      pacePerWeek,
      referencePrice,
      count: pcCount + ebayCount,
      windowDays: Math.max(pc.windowDays, ebay.windowDays),
      pc,
      ebay,
    };
  }

  const pickEbay = ebayScore > pcScore;
  if (pickEbay) {
    return {
      grade,
      source: 'ebay',
      confidence: paceConfidence(ebay.pacePerMonth, ebayCount),
      pacePerMonth: ebay.pacePerMonth,
      pacePerWeek: ebay.pacePerWeek,
      referencePrice: ebay.median ?? pc.referencePrice,
      count: ebayCount,
      windowDays: ebay.windowDays,
      pc,
      ebay,
    };
  }

  return {
    grade,
    source: 'pc',
    confidence: paceConfidence(pc.pacePerMonth, pcCount),
    pacePerMonth: pc.pacePerMonth,
    pacePerWeek: pc.pacePerWeek,
    referencePrice: pc.referencePrice,
    count: pcCount,
    windowDays: pc.windowDays,
    pc,
    ebay,
  };
};

/** Human-readable color hint for the advice badge. Mirrors actionBadge
 *  in analytics.ts for consistency. */
export const adviceBadge = (
  advice: PriceAdvice
): { color: string; bg: string; border: string } => {
  switch (advice) {
    case 'push_higher':
      return { color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200' };
    case 'list_at_p75':
      return { color: 'text-blue-700', bg: 'bg-blue-50', border: 'border-blue-200' };
    case 'hold_median':
      return { color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200' };
    case 'pc_reference':
      return { color: 'text-violet-700', bg: 'bg-violet-50', border: 'border-violet-200' };
    case 'insufficient':
    default:
      return { color: 'text-slate-600', bg: 'bg-slate-50', border: 'border-slate-200' };
  }
};

/**
 * Recognize a grader-10 entry from the allPrices matrix. We match the
 * normalized `key` from scraper.ts (e.g. "bgs_10_black" -> BGS).
 */
const GRADER_PATTERNS: Array<{ test: RegExp; company: CrossGraderCompany }> = [
  { test: /^psa_10/, company: 'PSA' },
  { test: /^cgc_10/, company: 'CGC' },
  { test: /^sgc_10/, company: 'SGC' },
  { test: /^bgs_10/, company: 'BGS' },
  { test: /^tag_10/, company: 'TAG' },
  { test: /^ace_10/, company: 'ACE' },
];

const classifyGrader = (key: string): CrossGraderCompany | null => {
  for (const p of GRADER_PATTERNS) {
    if (p.test.test(key)) return p.company;
  }
  return null;
};

/**
 * Pull every grade-10 entry across graders from the full PriceCharting
 * price matrix, plus computed premium ratios vs raw + PSA 10. Useful when
 * PSA 10 sales are thin and the user wants to see how PC values PSA vs
 * the alternatives (CGC/SGC/BGS/TAG/ACE).
 *
 * Sorted by company priority (PSA first, then CGC/BGS/SGC/TAG, other last)
 * then by descending price within a company.
 */
export const extractCrossGraders = (
  allPrices: GradePrice[] | undefined,
  rawPrice: number | undefined,
  psa10Price: number | undefined
): CrossGraderPrice[] => {
  if (!allPrices || allPrices.length === 0) return [];
  const out: CrossGraderPrice[] = [];
  for (const p of allPrices) {
    const company = classifyGrader(p.key);
    if (!company) continue;
    if (!Number.isFinite(p.price) || p.price <= 0) continue;
    const premiumVsRaw =
      rawPrice && rawPrice > 0 ? p.price / rawPrice : null;
    const deltaVsPsa10 =
      psa10Price && psa10Price > 0 ? (p.price - psa10Price) / psa10Price : null;
    out.push({
      key: p.key,
      label: p.label,
      company,
      price: p.price,
      premiumVsRaw,
      deltaVsPsa10,
    });
  }
  const priority: Record<CrossGraderCompany, number> = {
    PSA: 0,
    CGC: 1,
    BGS: 2,
    SGC: 3,
    TAG: 4,
    ACE: 5,
    OTHER: 6,
  };
  out.sort((a, b) => {
    const cmp = priority[a.company] - priority[b.company];
    if (cmp !== 0) return cmp;
    return b.price - a.price;
  });
  return out;
};
