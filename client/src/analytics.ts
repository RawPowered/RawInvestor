import type {
  GradeAnalytics,
  PriceAction,
  PriceSignal,
  PriceSnapshot,
} from './types';

/**
 * Pull a single-grade time series out of the raw priceHistory array.
 * Points where that grade wasn't sampled are skipped (so a sales seed row
 * that only observed a PSA 10 sale still contributes to the PSA 10 series,
 * but not to raw / grade9).
 */
export const seriesForGrade = (
  history: PriceSnapshot[],
  grade: 'raw' | 'grade9' | 'psa10'
): Array<{ at: number; price: number }> => {
  const out: Array<{ at: number; price: number }> = [];
  for (const s of history) {
    const v = s[grade];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
      out.push({ at: s.at, price: v });
    }
  }
  // Sort oldest-first, de-dup same-millisecond entries keeping the last.
  out.sort((a, b) => a.at - b.at);
  return out;
};

export const mean = (xs: number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length;

/** Population standard deviation (division by n, not n-1). Preferred here
 *  because the price history is the full known observation, not a sample. */
export const stdDev = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const m = mean(xs);
  const v = xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length;
  return Math.sqrt(v);
};

/**
 * Ordinary least-squares slope (price-per-day) for a time series.
 * Returns 0 for any degenerate case (< 2 points, zero time span).
 */
export const linearSlopePerDay = (
  series: Array<{ at: number; price: number }>
): number => {
  if (series.length < 2) return 0;
  const t0 = series[0].at;
  const xs = series.map((p) => (p.at - t0) / (24 * 3600 * 1000));
  const ys = series.map((p) => p.price);
  const n = xs.length;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  if (den === 0) return 0;
  return num / den;
};

/** Standard deviation of the residuals around the OLS trend line. Used as
 *  the "one sigma" spread for best/worst case projections. */
/** Milliseconds per calendar day — used only for slope + span maths. */
const DAY_MS = 24 * 3600 * 1000;

/**
 * Clamp a naive linear extrapolation (`slopePerDay * horizonDays`, optionally
 * pre-damped) so projections stay anchored to **observed price dispersion**.
 *
 * Thin scrapes often stack many prints into a short calendar window or leap
 * from cheap raw comps to pricey graded sales — OLS slope times 90 days then
 * looks like forward guidance ("$564 realistic") while the printed range is
 * ~$40. That is not mixing data; it is unstable extrapolation. Here we treat
 * the historical min–max band as the maximum credible swing over the horizon
 * unless that band is degenerate (then we fall back to a % of spot).
 */
export const clampTrendDelta = (params: {
  rawDelta: number;
  current: number;
  minObserved: number;
  maxObserved: number;
}): { delta: number; trendLimited: boolean } => {
  const { rawDelta, current, minObserved, maxObserved } = params;
  const observedRange =
    maxObserved > minObserved ? maxObserved - minObserved : 0;
  const swing =
    observedRange > 0
      ? Math.max(observedRange * 1.25, current * 0.18)
      : current * 0.2;
  const delta = Math.max(-swing, Math.min(swing, rawDelta));
  const trendLimited =
    Math.abs(delta - rawDelta) > Math.max(1e-6, Math.abs(rawDelta) * 1e-9);
  return { delta, trendLimited };
};

const residualStdDev = (
  series: Array<{ at: number; price: number }>,
  slopePerDay: number
): number => {
  if (series.length < 2) return 0;
  const t0 = series[0].at;
  const xs = series.map((p) => (p.at - t0) / (24 * 3600 * 1000));
  const ys = series.map((p) => p.price);
  const my = mean(ys);
  const mx = mean(xs);
  // Intercept so the trend line passes through (mx, my)
  const intercept = my - slopePerDay * mx;
  const residuals = ys.map((y, i) => y - (slopePerDay * xs[i] + intercept));
  return stdDev(residuals);
};

/**
 * Build the buyer-side signal: are we a good price to BUY at right now?
 *
 * Core logic:
 *  - If price is significantly BELOW mean and trending up  -> BUY NOW (reversion+momentum)
 *  - If price is BELOW mean and still falling              -> wait, might get cheaper
 *  - If price is ABOVE mean and falling                    -> wait, revert toward mean
 *  - If price is ABOVE mean and rising                     -> hold/skip, expensive
 *  - Near mean + rising                                    -> buy now (fair value, momentum)
 *  - Near mean + flat/falling                              -> wait/hold
 */
const buyerSignal = (
  zScore: number,
  slopePerDay: number,
  n: number
): PriceSignal => {
  if (n < 3) {
    return {
      action: 'hold',
      label: 'Not enough data',
      reason: `Need at least 3 price points, have ${n}. Refresh a few times over the next days/weeks.`,
      confidence: 'low',
    };
  }
  const slopeDirection =
    Math.abs(slopePerDay) < 0.01 ? 'flat' : slopePerDay > 0 ? 'up' : 'down';
  const zBucket = zScore < -0.5 ? 'low' : zScore > 0.5 ? 'high' : 'mid';
  const confidence = (zBucket !== 'mid' && slopeDirection !== 'flat') ? 'high'
    : zBucket !== 'mid' || slopeDirection !== 'flat' ? 'medium' : 'low';

  if (zBucket === 'low' && slopeDirection === 'up') {
    return {
      action: 'buy_now',
      label: 'BUY NOW',
      reason: 'Price is below its historical mean and starting to climb - a classic entry window.',
      confidence,
    };
  }
  if (zBucket === 'low') {
    return {
      action: 'wait_to_buy',
      label: 'WAIT (may drop further)',
      reason: 'Price is below mean but still falling. Watch for a reversal before entering.',
      confidence,
    };
  }
  if (zBucket === 'high' && slopeDirection === 'down') {
    return {
      action: 'wait_to_buy',
      label: 'WAIT (reverting down)',
      reason: 'Price is elevated vs history and trending down - cheaper entry likely.',
      confidence,
    };
  }
  if (zBucket === 'high') {
    return {
      action: 'wait_to_buy',
      label: 'SKIP (expensive)',
      reason: 'Price is elevated vs history and still rising. Risk/reward is poor for new buyers.',
      confidence,
    };
  }
  // mid
  if (slopeDirection === 'up') {
    return {
      action: 'buy_now',
      label: 'BUY NOW (fair value)',
      reason: 'Price is near the historical mean with an uptrend - acceptable entry.',
      confidence,
    };
  }
  if (slopeDirection === 'down') {
    return {
      action: 'wait_to_buy',
      label: 'WAIT (drifting down)',
      reason: 'Price is near mean but drifting down - a better entry is likely.',
      confidence,
    };
  }
  return {
    action: 'hold',
    label: 'NEUTRAL',
    reason: 'Price is near the historical mean with no clear trend.',
    confidence,
  };
};

/**
 * Seller-side signal: should you sell now or hold?
 */
const sellerSignal = (
  zScore: number,
  slopePerDay: number,
  n: number
): PriceSignal => {
  if (n < 3) {
    return {
      action: 'hold',
      label: 'Not enough data',
      reason: `Need at least 3 price points, have ${n}. Refresh a few times over the next days/weeks.`,
      confidence: 'low',
    };
  }
  const slopeDirection =
    Math.abs(slopePerDay) < 0.01 ? 'flat' : slopePerDay > 0 ? 'up' : 'down';
  const zBucket = zScore < -0.5 ? 'low' : zScore > 0.5 ? 'high' : 'mid';
  const confidence = (zBucket !== 'mid' && slopeDirection !== 'flat') ? 'high'
    : zBucket !== 'mid' || slopeDirection !== 'flat' ? 'medium' : 'low';

  if (zBucket === 'high' && slopeDirection === 'down') {
    return {
      action: 'sell_now',
      label: 'SELL NOW',
      reason: 'Price is elevated AND reverting downward - lock in gains before it drops more.',
      confidence,
    };
  }
  if (zBucket === 'high' && slopeDirection === 'up') {
    return {
      action: 'hold_sell_later',
      label: 'HOLD (momentum)',
      reason: 'Price is elevated but still rising. A higher sell is plausible if the trend holds.',
      confidence,
    };
  }
  if (zBucket === 'high') {
    return {
      action: 'sell_now',
      label: 'SELL NOW',
      reason: 'Price is historically expensive and momentum is flat - good time to exit.',
      confidence,
    };
  }
  if (zBucket === 'low' && slopeDirection === 'up') {
    return {
      action: 'hold_sell_later',
      label: 'HOLD (recovering)',
      reason: 'Price is below mean but recovering. Sell after it climbs back toward mean.',
      confidence,
    };
  }
  if (zBucket === 'low') {
    return {
      action: 'hold_sell_later',
      label: 'HOLD (near bottom)',
      reason: 'Price is below mean. Selling here locks in a loss vs history.',
      confidence,
    };
  }
  // mid
  if (slopeDirection === 'up') {
    return {
      action: 'hold_sell_later',
      label: 'HOLD (uptrend)',
      reason: 'Price is at fair value with upward momentum - better sell likely ahead.',
      confidence,
    };
  }
  if (slopeDirection === 'down') {
    return {
      action: 'sell_now',
      label: 'SELL NOW',
      reason: 'Price is at fair value but trending down - selling now beats selling lower later.',
      confidence,
    };
  }
  return {
    action: 'hold',
    label: 'NEUTRAL',
    reason: 'Price is near the historical mean with no clear trend.',
    confidence,
  };
};

/**
 * Full analytics rollup for a single grade. Handles degenerate cases
 * (empty series, 1-2 points) without throwing; UI reads `n` to decide
 * what to render.
 */
export const analyzeGrade = (
  history: PriceSnapshot[],
  grade: 'raw' | 'grade9' | 'psa10',
  current: number,
  horizonDays = 90
): GradeAnalytics => {
  const series = seriesForGrade(history, grade);
  const prices = series.map((p) => p.price);
  const n = series.length;
  const min = prices.length ? Math.min(...prices) : 0;
  const max = prices.length ? Math.max(...prices) : 0;
  const m = mean(prices);
  const sd = stdDev(prices);
  const slopePerDay = linearSlopePerDay(series);
  const firstPrice = prices[0] ?? 0;
  const totalPctChange =
    firstPrice > 0 ? ((current - firstPrice) / firstPrice) * 100 : 0;
  const positionInRange =
    max > min ? (current - min) / (max - min) : NaN;
  const zScore = sd > 0 ? (current - m) / sd : 0;

  const residualSigma = residualStdDev(series, slopePerDay);

  const spanDays =
    series.length >= 2
      ? Math.max(
          (series[series.length - 1].at - series[0].at) / DAY_MS,
          1e-12
        )
      : 0;

  /** Down-weight extrapolation when we have not watched long enough or have
   *  few distinct prints — full weight only at ~45d+ span and ~8+ points. */
  const coverage =
    Math.min(1, spanDays / 45) * Math.min(1, n / 8);

  const rawDelta = slopePerDay * horizonDays * coverage;
  const { delta, trendLimited: clampHit } = clampTrendDelta({
    rawDelta,
    current,
    minObserved: min,
    maxObserved: max,
  });

  /** Forward view was constrained vs a naive straight-line continuation. */
  const projectionCapped =
    n >= 3 && (clampHit || coverage < 0.999);

  const realistic = Math.max(0, current + delta);
  const bestCase = Math.max(0, realistic + residualSigma);
  const worstCase = Math.max(0, realistic - residualSigma);

  return {
    grade,
    n,
    firstAt: series[0]?.at ?? null,
    lastAt: series[series.length - 1]?.at ?? null,
    min,
    max,
    mean: m,
    stdDev: sd,
    current,
    slopePerDay,
    totalPctChange,
    positionInRange,
    zScore,
    projection: {
      days: horizonDays,
      realistic,
      bestCase,
      worstCase,
      trendLimited: projectionCapped,
    },
    buyerSignal: buyerSignal(zScore, slopePerDay, n),
    sellerSignal: sellerSignal(zScore, slopePerDay, n),
  };
};

/** Human label for an action, used by the signal badge. */
export const actionBadge = (
  action: PriceAction
): { color: string; bg: string; border: string } => {
  switch (action) {
    case 'buy_now':
      return { color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200' };
    case 'sell_now':
      return { color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200' };
    case 'wait_to_buy':
      return { color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200' };
    case 'hold_sell_later':
      return { color: 'text-blue-700', bg: 'bg-blue-50', border: 'border-blue-200' };
    case 'hold':
    default:
      return { color: 'text-slate-600', bg: 'bg-slate-50', border: 'border-slate-200' };
  }
};
