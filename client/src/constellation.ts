import { analyzeGrade } from './analytics';
import { SALES_STATS_WINDOW_DAYS } from './pricing';
import type { GradeAnalytics, PriceSnapshot, RecentSale } from './types';
import {
  effectivePriceHistory,
  recentSalesOnOrAfterRelease,
} from './releaseFilter';
import type { EnrichedCard } from './sort';

/**
 * Seven-way behavioural classification used by the 3D Nebula view.
 *
 * Categories are chosen so every portfolio card lands in exactly one bucket
 * and the taxonomy stays intuitive for someone scanning a starfield:
 *
 *  - BUY       Undervalued right now with non-negative momentum.
 *  - SELL      At / near the top of its historical range with good momentum.
 *  - HOLD      Mid-range, not much happening either way.
 *  - SLEEPER   Thin volume + quietly trending up + still profitable.
 *  - CLIMBER   Momentum and z-score both firmly positive - breakout.
 *  - DUD       Flat price and nobody's trading it. Dead weight.
 *  - NGMI      Losing money AND losing momentum. Exit candidate.
 *
 * Classification runs on PSA 10 history first (that's the investment target),
 * falling back to grade 9 then raw when a card has no PSA 10 data yet.
 */
export type CardCategory =
  | 'BUY'
  | 'SELL'
  | 'HOLD'
  | 'SLEEPER'
  | 'CLIMBER'
  | 'DUD'
  | 'NGMI';

export type CategoryMeta = {
  label: string;
  /** Primary stroke / accent colour. */
  color: string;
  /** Halo colour - lighter shade used for CSS glow. */
  glow: string;
  /** One-line description shown in the legend tooltip. */
  description: string;
};

export const CATEGORY_META: Record<CardCategory, CategoryMeta> = {
  BUY:     { label: 'Buy',     color: '#10b981', glow: '#34d399', description: 'Positive ROI% and non-negative momentum - undervalued entry points.' },
  SELL:    { label: 'Sell',    color: '#f59e0b', glow: '#fbbf24', description: 'Near top of historical range with above-mean price.' },
  HOLD:    { label: 'Hold',    color: '#64748b', glow: '#94a3b8', description: 'Mid-range price, flat trend. No strong edge either way.' },
  SLEEPER: { label: 'Sleeper', color: '#8b5cf6', glow: '#a78bfa', description: 'Quiet market, slow pace, but profitable and trending up.' },
  CLIMBER: { label: 'Climber', color: '#06b6d4', glow: '#22d3ee', description: 'Strong slope + elevated z-score - active breakout.' },
  DUD:     { label: 'Dud',     color: '#71717a', glow: '#a1a1aa', description: 'No momentum and no sales pace - dead weight.' },
  NGMI:    { label: 'NGMI',    color: '#ef4444', glow: '#f87171', description: 'Negative ROI% AND falling price. Exit candidate.' },
};

export const CATEGORY_ORDER: CardCategory[] = [
  'CLIMBER',
  'SELL',
  'BUY',
  'SLEEPER',
  'HOLD',
  'DUD',
  'NGMI',
];

/**
 * A single card projected into the classification + 3D-coordinate universe.
 *
 * Coordinates are in a unit cube [-1, 1]^3. The NebulaView is responsible
 * for scaling them into pixels + applying camera rotation each frame.
 */
export type CardStar = {
  id: string;
  card: EnrichedCard;
  category: CardCategory;
  x: number;
  y: number;
  z: number;
  /** The analytics we leaned on (may be null when the card has no history). */
  analytics: GradeAnalytics | null;
  /** Raw classification inputs, exposed so the hover panel can display them
   *  without recomputing. */
  roi: number;
  /** Slope per day divided by mean price (dimensionless daily growth rate). */
  momentum: number;
  /** PSA 10 sales pace (sales/mo), falls back to scraped salesVolume.month. */
  pacePerMonth: number;
};

/** Which grade's history should this card be classified from? */
const pickGrade = (history: PriceSnapshot[]): 'psa10' | 'grade9' | 'raw' => {
  const h = history;
  const has = (g: 'psa10' | 'grade9' | 'raw') =>
    h.some((s) => typeof s[g] === 'number' && (s[g] as number) > 0);
  if (has('psa10')) return 'psa10';
  if (has('grade9')) return 'grade9';
  return 'raw';
};

const currentForGrade = (
  card: EnrichedCard,
  grade: 'psa10' | 'grade9' | 'raw'
): number => {
  if (grade === 'psa10') return card.psa10;
  if (grade === 'grade9') return card.grade9;
  return card.raw;
};

const paceForGrade = (
  sales: RecentSale[],
  grade: 'psa10' | 'grade9' | 'raw',
  now: number
): number => {
  const cutoff = now - SALES_STATS_WINDOW_DAYS * 24 * 3600 * 1000;
  return sales.filter((s) => s.grade === grade && s.at >= cutoff).length;
};

export type Classification = {
  category: CardCategory;
  analytics: GradeAnalytics | null;
  roi: number;
  momentum: number;
  pacePerMonth: number;
};

/**
 * Classify a single card. Pure function; safe to call with sparse or
 * fully-absent history. When we can't compute meaningful analytics we
 * fall through to ROI-only heuristics so the card still gets a sensible
 * bucket instead of everything piling into HOLD.
 */
export const classify = (
  card: EnrichedCard,
  now: number = Date.now()
): Classification => {
  const roi = card.metrics.roiPct;
  const history = effectivePriceHistory(card.priceHistory, card.releaseDateMs, {
    raw: card.raw,
    grade9: card.grade9,
    psa10: card.psa10,
  });
  const sales = recentSalesOnOrAfterRelease(
    card.recentSales,
    card.releaseDateMs
  );
  const grade = pickGrade(history);
  const current = currentForGrade(card, grade);
  const hasHistory = history.length >= 2;
  const analytics: GradeAnalytics | null = hasHistory
    ? analyzeGrade(history, grade, current)
    : null;
  // When history exists, pace stays grade-scoped so it matches the analytics.
  // Without history we have no grade anchor, so sum pace across any grade -
  // otherwise a card with only, say, PSA 10 sales would look like a DUD.
  const pacePerMonth = hasHistory
    ? paceForGrade(sales, grade, now)
    : paceForGrade(sales, 'psa10', now) +
      paceForGrade(sales, 'grade9', now) +
      paceForGrade(sales, 'raw', now);

  const momentum =
    analytics && analytics.mean > 0
      ? analytics.slopePerDay / analytics.mean
      : 0;

  // Priority decision tree. The order matters: the first rule that fires
  // wins, so strong signals (NGMI, CLIMBER) take precedence over weaker
  // ones (BUY, HOLD).
  let category: CardCategory;

  if (!analytics || analytics.n < 2) {
    // No history - lean on ROI alone.
    if (roi < -10) category = 'NGMI';
    else if (roi > 30) category = 'BUY';
    else if (pacePerMonth < 1 && Math.abs(roi) < 10) category = 'DUD';
    else category = 'HOLD';
  } else if (roi < -10 && momentum < -0.003) {
    category = 'NGMI';
  } else if (momentum > 0.015 && analytics.zScore > 1.0) {
    category = 'CLIMBER';
  } else if (
    Number.isFinite(analytics.positionInRange) &&
    analytics.positionInRange > 0.85 &&
    analytics.zScore > 0.5
  ) {
    category = 'SELL';
  } else if (momentum > 0.002 && pacePerMonth < 3 && roi > 30) {
    category = 'SLEEPER';
  } else if (pacePerMonth < 1 && Math.abs(momentum) < 0.002) {
    category = 'DUD';
  } else if (roi > 20 && momentum >= 0) {
    category = 'BUY';
  } else {
    category = 'HOLD';
  }

  return { category, analytics, roi, momentum, pacePerMonth };
};

/** FNV-1a style hash → [0, 1). Deterministic per card id so "random" jitter
 *  is stable between renders. */
export const hashToUnit = (s: string): number => {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h % 100000) / 100000;
};

const clamp = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v;

/**
 * Lay out every card as a 3D star in the unit cube.
 *
 * Axis scaling:
 *  - x: tanh-compressed momentum. Flat cards sit near x=0.
 *  - y: tanh-compressed ROI/50. A card at 50% ROI ends up near y=0.46.
 *  - z: log-compressed pace, centred so an "average" mover sits near z=0.
 *
 * A small deterministic jitter is added so coincident (ROI, momentum, pace)
 * cards don't stack on top of each other in the rendering.
 */
export const layoutStars = (
  cards: EnrichedCard[],
  now: number = Date.now()
): CardStar[] => {
  return cards.map((card) => {
    const { category, analytics, roi, momentum, pacePerMonth } = classify(card, now);
    const xRaw = Math.tanh(momentum * 30);
    const yRaw = Math.tanh(roi / 50);
    const zRaw = Math.tanh(Math.log(pacePerMonth + 1) / 2) - 0.2;

    // Jitter: small, deterministic, per-card. Keeps cards from stacking
    // without materially changing their classification position.
    const j1 = (hashToUnit(card.id) - 0.5) * 0.22;
    const j2 = (hashToUnit(card.id + ':y') - 0.5) * 0.22;
    const j3 = (hashToUnit(card.id + ':z') - 0.5) * 0.22;

    return {
      id: card.id,
      card,
      category,
      x: clamp(xRaw + j1, -1, 1),
      y: clamp(yRaw + j2, -1, 1),
      z: clamp(zRaw + j3, -1, 1),
      analytics,
      roi,
      momentum,
      pacePerMonth,
    };
  });
};

/**
 * Build web connections between nearest neighbours within each category.
 *
 * Only same-category pairs are connected (that's what makes the web read
 * as "constellations" - a Climber cluster, a Dud cluster, etc). For each
 * star we connect its `kNeighbors` closest same-category siblings by
 * 3D Euclidean distance. Edges are deduplicated so each pair appears once.
 */
export const buildConnections = (
  stars: CardStar[],
  kNeighbors = 2
): Array<[number, number]> => {
  const edges: Array<[number, number]> = [];
  const seen = new Set<string>();
  for (let i = 0; i < stars.length; i++) {
    const a = stars[i];
    const neighbours: Array<{ j: number; d: number }> = [];
    for (let j = 0; j < stars.length; j++) {
      if (j === i) continue;
      const b = stars[j];
      if (b.category !== a.category) continue;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dz = a.z - b.z;
      neighbours.push({ j, d: dx * dx + dy * dy + dz * dz });
    }
    neighbours.sort((p, q) => p.d - q.d);
    for (const { j } of neighbours.slice(0, kNeighbors)) {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push([i, j]);
    }
  }
  return edges;
};
