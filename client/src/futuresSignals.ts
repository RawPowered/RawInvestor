import type { FuturesSignalResult, FuturesSourcePoint, FuturesSpikeFlag } from './types';

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

const mean = (xs: number[]): number => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

const stdDev = (xs: number[]): number => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const v = xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length;
  return Math.sqrt(v);
};

const quantile = (sortedAsc: number[], q: number): number | null => {
  if (!sortedAsc.length) return null;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const qq = clamp(q, 0, 1);
  const pos = qq * (sortedAsc.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedAsc[lo];
  const frac = pos - lo;
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * frac;
};

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return quantile(s, 0.5);
};

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

const toMs = (t: number): number => (t < 1_000_000_000_000 ? t * 1000 : t);

const windowDaysFromLabel = (label: string): number | null => {
  if (label === '1D') return 1;
  if (label === '7D') return 7;
  if (label === '30D') return 30;
  if (label === '90D') return 90;
  return null;
};

const pickDirection = (score: number): FuturesSignalResult['direction'] => {
  if (score >= 0.12) return 'up';
  if (score <= -0.12) return 'down';
  return 'flat';
};

const spikeFlagFromScore = (score: number): FuturesSpikeFlag => {
  if (score >= 0.72) return 'high';
  if (score >= 0.42) return 'watch';
  return 'none';
};

const uniqDayCount = (points: FuturesSourcePoint[]): number => {
  const days = new Set<number>();
  for (const p of points) {
    if (!Number.isFinite(p.at)) continue;
    const d = new Date(toMs(p.at));
    const utcDay = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    days.add(utcDay);
  }
  return days.size;
};

/**
 * Conservative "Futures" signal using robust stats:
 * - Direction: short-vs-mid median trend + pace acceleration + volatility damping
 * - Spike flag: price and pace outliers vs historical baseline
 * - Inflation/deflation risk percentages, bounded and explainable
 */
export const evaluateFuturesSignal = (args: {
  points: FuturesSourcePoint[];
  windowLabel: string;
  additionalAnomalyCount?: number;
  baselineLowPrice?: number | null;
  baselineHighPrice?: number | null;
}): FuturesSignalResult => {
  const pts = (args.points || [])
    .map((p) => ({ at: toMs(p.at), price: Number(p.price) }))
    .filter((p) => Number.isFinite(p.at) && Number.isFinite(p.price) && p.price > 0)
    .sort((a, b) => a.at - b.at);

  const windowDays = windowDaysFromLabel(args.windowLabel);
  const n = pts.length;
  const rangeStart = n ? pts[0].at : null;
  const rangeEnd = n ? pts[n - 1].at : null;

  if (n < 4) {
    return {
      direction: 'flat',
      directionConfidencePct: 24,
      anomalySpikeFlag: 'none',
      inflationRiskPct: 18,
      deflationRiskPct: 18,
      likelihoodUpPct: 34,
      likelihoodDownPct: 33,
      likelihoodFlatPct: 33,
      sampleCount: n,
      rangeStart,
      rangeEnd,
      explainers: [
        `Futures uses ${n} point${n === 1 ? '' : 's'} (${args.windowLabel}).`,
        'Insufficient sample size for directional conviction; staying neutral.',
      ],
      stats: {
        trendRaw: 0,
        paceAccel: 0,
        volRatio: 0,
        median: 0,
        q1: 0,
        q3: 0,
        baselineLowPrice:
          typeof args.baselineLowPrice === 'number' && Number.isFinite(args.baselineLowPrice)
            ? args.baselineLowPrice
            : null,
        baselineHighPrice:
          typeof args.baselineHighPrice === 'number' && Number.isFinite(args.baselineHighPrice)
            ? args.baselineHighPrice
            : null,
        additionalAnomalyCount: Math.max(0, Math.floor(args.additionalAnomalyCount || 0)),
      },
    };
  }

  const prices = pts.map((p) => p.price);
  const sorted = [...prices].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25) ?? sorted[0];
  const q2 = quantile(sorted, 0.5) ?? sorted[Math.floor(sorted.length / 2)];
  const q3 = quantile(sorted, 0.75) ?? sorted[sorted.length - 1];
  const iqr = Math.max(0.0001, q3 - q1);

  // Split into thirds to reduce endpoint noise.
  const third = Math.max(2, Math.floor(n / 3));
  const early = prices.slice(0, third);
  const recent = prices.slice(n - third);
  const earlyMedian = median(early) ?? early[0];
  const recentMedian = median(recent) ?? recent[recent.length - 1];
  const trendRaw = earlyMedian > 0 ? (recentMedian - earlyMedian) / earlyMedian : 0;

  // Pace acceleration: recent half vs earlier half.
  const half = Math.max(2, Math.floor(n / 2));
  const left = pts.slice(0, n - half);
  const right = pts.slice(n - half);
  const leftDays = Math.max(1, uniqDayCount(left));
  const rightDays = Math.max(1, uniqDayCount(right));
  const leftPace = left.length / leftDays;
  const rightPace = right.length / rightDays;
  const paceAccel = leftPace > 0 ? (rightPace - leftPace) / leftPace : rightPace > 0 ? 1 : 0;

  // Volatility penalty: high stddev relative to median reduces confidence.
  const sigma = stdDev(prices);
  const volRatio = q2 > 0 ? sigma / q2 : 0;
  const volPenalty = clamp(volRatio / 2.2, 0, 1); // 0=no penalty, 1=strong penalty

  const directionScore = trendRaw * 0.62 + paceAccel * 0.38;
  const direction = pickDirection(directionScore);
  const directionConfidencePct = Math.round(
    clamp(
      18 +
        Math.abs(directionScore) * 90 +
        Math.min(26, n * 0.8) -
        volPenalty * 30,
      5,
      95
    )
  );

  // Price anomaly checks (both upside and downside outliers).
  const highFence = q3 + 1.5 * iqr;
  const lowFence = q1 - 1.5 * iqr;
  const recentSlice = prices.slice(Math.max(0, n - Math.max(4, Math.floor(n * 0.2))));
  const highOutliers = recentSlice.filter((p) => p > highFence).length;
  const lowOutliers = recentSlice.filter((p) => p < lowFence).length;
  const highShare = recentSlice.length ? highOutliers / recentSlice.length : 0;
  const lowShare = recentSlice.length ? lowOutliers / recentSlice.length : 0;

  const additionalAnomaly = Math.max(0, Math.floor(args.additionalAnomalyCount || 0));
  const anomalyBoost = clamp(additionalAnomaly / 6, 0, 0.35);

  const spikeScore = clamp(
    highShare * 0.55 + Math.max(0, paceAccel) * 0.25 + Math.max(0, trendRaw) * 0.2 + anomalyBoost,
    0,
    1
  );
  const anomalySpikeFlag = spikeFlagFromScore(spikeScore);

  // Risk separation: nonlinear map emphasizes meaningful differences and reduces base clustering.
  const upDriver =
    Math.max(0, trendRaw) * 1.05 +
    Math.max(0, paceAccel) * 0.7 +
    highShare * 1.6 +
    anomalyBoost * 0.95 -
    volPenalty * 0.55;
  const downDriver =
    Math.max(0, -trendRaw) * 1.2 +
    Math.max(0, -paceAccel) * 0.75 +
    lowShare * 1.85 +
    volPenalty * 0.35;
  const inflationRiskPct = Math.round(clamp(sigmoid(upDriver - 0.72) * 100, 0, 100));
  const deflationRiskPct = Math.round(clamp(sigmoid(downDriver - 0.76) * 100, 0, 100));

  // Three-way direction likelihoods.
  const upBase = clamp(34 + directionScore * 42 - volPenalty * 12, 3, 95);
  const downBase = clamp(34 - directionScore * 42 - volPenalty * 12, 3, 95);
  const flatBase = clamp(100 - upBase - downBase, 3, 94);
  const sum = upBase + downBase + flatBase || 1;
  const likelihoodUpPct = Math.round((upBase / sum) * 100);
  const likelihoodDownPct = Math.round((downBase / sum) * 100);
  const likelihoodFlatPct = Math.max(0, 100 - likelihoodUpPct - likelihoodDownPct);

  const explainers: string[] = [];
  explainers.push(
    `Direction uses ${n} scoped points (${args.windowLabel}) with trend + pace acceleration, volatility-adjusted.`
  );
  explainers.push(
    `Drivers: trend ${(trendRaw * 100).toFixed(1)}%, pace ${(paceAccel * 100).toFixed(1)}%, vol penalty ${(volPenalty * 100).toFixed(0)}%.`
  );
  explainers.push(
    `Band median ${q2.toFixed(2)} (IQR ${iqr.toFixed(2)}), pace ${leftPace.toFixed(2)} -> ${rightPace.toFixed(2)} sales/day.`
  );
  if (anomalySpikeFlag !== 'none') {
    explainers.push(
      `Anomaly flag ${anomalySpikeFlag}: recent outlier share ${
        (highShare * 100).toFixed(1)
      }% above robust fence.`
    );
  } else {
    explainers.push('No statistically strong recent spike signal in scoped data.');
  }
  if (windowDays != null) {
    explainers.push(`Window=${windowDays}d anchored to latest observation date.`);
  } else {
    explainers.push('Window=All available observations.');
  }

  return {
    direction,
    directionConfidencePct,
    anomalySpikeFlag,
    inflationRiskPct,
    deflationRiskPct,
    likelihoodUpPct,
    likelihoodDownPct,
    likelihoodFlatPct,
    sampleCount: n,
    rangeStart,
    rangeEnd,
    explainers,
    stats: {
      trendRaw,
      paceAccel,
      volRatio,
      median: q2,
      q1,
      q3,
      baselineLowPrice:
        typeof args.baselineLowPrice === 'number' && Number.isFinite(args.baselineLowPrice)
          ? args.baselineLowPrice
          : null,
      baselineHighPrice:
        typeof args.baselineHighPrice === 'number' && Number.isFinite(args.baselineHighPrice)
          ? args.baselineHighPrice
          : null,
      additionalAnomalyCount: additionalAnomaly,
    },
  };
};
