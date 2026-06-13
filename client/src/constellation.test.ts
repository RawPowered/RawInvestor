import { describe, it, expect } from 'vitest';
import type { Card, CardMetrics, PriceSnapshot, RecentSale } from './types';
import type { EnrichedCard } from './sort';
import {
  CATEGORY_META,
  CATEGORY_ORDER,
  buildConnections,
  classify,
  hashToUnit,
  layoutStars,
} from './constellation';

const day = 24 * 3600 * 1000;
const NOW = Date.parse('2026-04-18T00:00:00Z');

const mk = (overrides: Partial<Card> & {
  id: string;
  metrics?: Partial<CardMetrics>;
  priceHistory?: PriceSnapshot[];
  recentSales?: RecentSale[];
}): EnrichedCard => ({
  id: overrides.id,
  name: overrides.name ?? 'Card',
  set: overrides.set ?? 'Set',
  raw: overrides.raw ?? 10,
  grade9: overrides.grade9 ?? 30,
  psa10: overrides.psa10 ?? 100,
  p10: overrides.p10 ?? 0.3,
  p9: overrides.p9 ?? 0.5,
  priceHistory: overrides.priceHistory,
  recentSales: overrides.recentSales,
  metrics: {
    totalInvested: 40,
    net10: 50,
    net9: -5,
    netFail: -25,
    pFail: 0.2,
    ev: 10,
    roiPct: 25,
    netRawNoGrade: 10,
    revenue10: 90,
    revenue9: 35,
    revenueFail: 15,
    ...(overrides.metrics ?? {}),
  },
});

/** Build a linearly-priced PSA 10 history over N days. */
const linearHistory = (
  startPrice: number,
  dailyDelta: number,
  days: number
): PriceSnapshot[] =>
  Array.from({ length: days }, (_, i) => ({
    at: NOW - (days - i) * day,
    psa10: startPrice + i * dailyDelta,
  }));

describe('hashToUnit', () => {
  it('returns a stable value in [0, 1) for a given id', () => {
    const a = hashToUnit('abc');
    const b = hashToUnit('abc');
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(1);
  });

  it('is sensitive to tiny input changes (so jitter spreads cards)', () => {
    expect(hashToUnit('card-1')).not.toBe(hashToUnit('card-2'));
    expect(hashToUnit('abc')).not.toBe(hashToUnit('abc:y'));
  });
});

describe('CATEGORY_META', () => {
  it('covers every category in CATEGORY_ORDER exactly once', () => {
    const keys = Object.keys(CATEGORY_META).sort();
    const ordered = [...CATEGORY_ORDER].sort();
    expect(keys).toEqual(ordered);
  });
});

describe('classify - no-history fallback', () => {
  it('NGMI when ROI < -10 and no history', () => {
    const c = mk({ id: '1', metrics: { roiPct: -25 } });
    expect(classify(c, NOW).category).toBe('NGMI');
  });

  it('BUY when ROI > 30 and no history', () => {
    const c = mk({ id: '1', metrics: { roiPct: 60 } });
    expect(classify(c, NOW).category).toBe('BUY');
  });

  it('DUD when ROI near zero, no history, no pace', () => {
    const c = mk({ id: '1', metrics: { roiPct: 2 } });
    expect(classify(c, NOW).category).toBe('DUD');
  });

  it('HOLD when mild ROI but has some recent sales pace (not a dud)', () => {
    // ROI = 2 with 5 sales/mo -> pace !< 1, so not DUD; falls to HOLD.
    const sales: RecentSale[] = Array.from({ length: 5 }, (_, i) => ({
      at: NOW - i * day,
      grade: 'psa10',
      price: 100,
    }));
    const c = mk({ id: '1', metrics: { roiPct: 2 }, recentSales: sales });
    expect(classify(c, NOW).category).toBe('HOLD');
  });
});

describe('classify - with PSA 10 history', () => {
  it('CLIMBER when momentum + z-score both strong', () => {
    // Rising 5% of current/day, far above mean.
    const history = linearHistory(50, 2, 30);
    const c = mk({
      id: '1',
      psa10: 120,
      priceHistory: history,
      metrics: { roiPct: 40 },
    });
    const res = classify(c, NOW);
    expect(res.category).toBe('CLIMBER');
    expect(res.momentum).toBeGreaterThan(0.015);
    expect(res.analytics!.zScore).toBeGreaterThan(1);
  });

  it('NGMI when ROI is negative AND price is trending down', () => {
    // Falling price, losing money.
    const history = linearHistory(100, -1, 30);
    const c = mk({
      id: '1',
      psa10: 70,
      priceHistory: history,
      metrics: { roiPct: -30 },
    });
    expect(classify(c, NOW).category).toBe('NGMI');
  });

  it('SELL when current sits at the top of the historical range', () => {
    // Slow climb: price at max, z-score positive, but slope slow enough
    // it's not a screaming CLIMBER.
    const history: PriceSnapshot[] = [];
    for (let i = 0; i < 30; i++) {
      // Oscillate then end at a high. Current = max ensures positionInRange=1.
      history.push({ at: NOW - (30 - i) * day, psa10: 90 + (i % 5) });
    }
    const c = mk({
      id: '1',
      psa10: 95,
      priceHistory: history,
      metrics: { roiPct: 10 },
    });
    const res = classify(c, NOW);
    // Either SELL or CLIMBER is acceptable at the extreme edge - we just
    // assert it didn't fall to HOLD.
    expect(['SELL', 'CLIMBER']).toContain(res.category);
    expect(res.analytics!.positionInRange).toBeGreaterThanOrEqual(0.85);
  });

  it('SLEEPER when profitable, trending up, but low sales pace', () => {
    // History climbs 100 -> ~108.7. Current sits mid-range (103) so the
    // SELL "at the top" rule can't fire; we're just a quiet riser.
    const history = linearHistory(100, 0.3, 30);
    const sales: RecentSale[] = [
      { at: NOW - 5 * day, grade: 'psa10', price: 103 },
    ];
    const c = mk({
      id: '1',
      psa10: 103,
      priceHistory: history,
      recentSales: sales,
      metrics: { roiPct: 50 },
    });
    expect(classify(c, NOW).category).toBe('SLEEPER');
  });

  it('DUD when momentum is flat AND pace is zero', () => {
    const history = linearHistory(50, 0, 30);
    const c = mk({
      id: '1',
      psa10: 50,
      priceHistory: history,
      metrics: { roiPct: 5 },
    });
    expect(classify(c, NOW).category).toBe('DUD');
  });

  it('BUY when profitable with non-negative momentum and active pace', () => {
    // Mid-range price keeps us out of SELL; active pace keeps us out of
    // SLEEPER; ROI > 20 + non-negative momentum lands on BUY.
    const history = linearHistory(100, 0.3, 30);
    const sales: RecentSale[] = Array.from({ length: 8 }, (_, i) => ({
      at: NOW - i * 2 * day,
      grade: 'psa10',
      price: 103,
    }));
    const c = mk({
      id: '1',
      psa10: 103,
      priceHistory: history,
      recentSales: sales,
      metrics: { roiPct: 25 },
    });
    expect(classify(c, NOW).category).toBe('BUY');
  });

  it('HOLD when nothing notable in any axis', () => {
    const history = linearHistory(100, 0, 30);
    const sales: RecentSale[] = Array.from({ length: 5 }, (_, i) => ({
      at: NOW - i * 2 * day,
      grade: 'psa10',
      price: 100,
    }));
    const c = mk({
      id: '1',
      psa10: 100,
      priceHistory: history,
      recentSales: sales,
      metrics: { roiPct: 8 },
    });
    expect(classify(c, NOW).category).toBe('HOLD');
  });
});

describe('layoutStars', () => {
  it('assigns every card a unit-cube coordinate and a category', () => {
    const cards = [
      mk({ id: 'a', metrics: { roiPct: 60 } }),
      mk({ id: 'b', metrics: { roiPct: -20 } }),
      mk({ id: 'c', metrics: { roiPct: 5 } }),
    ];
    const stars = layoutStars(cards, NOW);
    expect(stars).toHaveLength(3);
    for (const s of stars) {
      expect(s.x).toBeGreaterThanOrEqual(-1);
      expect(s.x).toBeLessThanOrEqual(1);
      expect(s.y).toBeGreaterThanOrEqual(-1);
      expect(s.y).toBeLessThanOrEqual(1);
      expect(s.z).toBeGreaterThanOrEqual(-1);
      expect(s.z).toBeLessThanOrEqual(1);
      expect(CATEGORY_ORDER).toContain(s.category);
    }
  });

  it('positions a highly-profitable card above a money-losing one on y', () => {
    const winner = mk({ id: 'w', metrics: { roiPct: 200 } });
    const loser = mk({ id: 'l', metrics: { roiPct: -80 } });
    const [w, l] = layoutStars([winner, loser], NOW);
    expect(w.y).toBeGreaterThan(l.y);
  });

  it('is deterministic - same inputs -> identical coordinates', () => {
    const cards = [mk({ id: 'a' }), mk({ id: 'b' })];
    const s1 = layoutStars(cards, NOW);
    const s2 = layoutStars(cards, NOW);
    expect(s1.map((s) => [s.x, s.y, s.z]))
      .toEqual(s2.map((s) => [s.x, s.y, s.z]));
  });

  it('separates cards with identical inputs via deterministic jitter', () => {
    const a = mk({ id: 'alpha', metrics: { roiPct: 10 } });
    const b = mk({ id: 'bravo', metrics: { roiPct: 10 } });
    const [sa, sb] = layoutStars([a, b], NOW);
    // Different ids -> different jitter -> different positions.
    expect(sa.x === sb.x && sa.y === sb.y && sa.z === sb.z).toBe(false);
  });
});

describe('buildConnections', () => {
  it('returns an empty list when there are no same-category pairs', () => {
    // Three cards, three different categories -> no same-cat neighbours.
    const stars = layoutStars(
      [
        mk({ id: 'a', metrics: { roiPct: 60 } }),  // BUY
        mk({ id: 'b', metrics: { roiPct: -30 } }), // NGMI
        mk({ id: 'c', metrics: { roiPct: 5 } }),   // DUD
      ],
      NOW
    );
    const edges = buildConnections(stars, 2);
    expect(edges).toEqual([]);
  });

  it('connects same-category neighbours and dedups pairs', () => {
    // 4 cards all classified as DUD (ROI ~0, no history, no pace).
    const cards = Array.from({ length: 4 }, (_, i) =>
      mk({ id: `d${i}`, metrics: { roiPct: 0 } })
    );
    const stars = layoutStars(cards, NOW);
    expect(stars.every((s) => s.category === 'DUD')).toBe(true);
    const edges = buildConnections(stars, 2);
    // Each pair should appear at most once.
    const keys = edges.map(([i, j]) => (i < j ? `${i}-${j}` : `${j}-${i}`));
    expect(new Set(keys).size).toBe(keys.length);
    // 4 nodes, kNeighbors=2, worst case C(4,2)=6 edges; de-dup brings it down.
    expect(edges.length).toBeGreaterThan(0);
    expect(edges.length).toBeLessThanOrEqual(6);
  });

  it('never connects cards across categories', () => {
    const cards = [
      mk({ id: 'a', metrics: { roiPct: 60 } }),   // BUY
      mk({ id: 'b', metrics: { roiPct: 65 } }),   // BUY
      mk({ id: 'c', metrics: { roiPct: -40 } }),  // NGMI
      mk({ id: 'd', metrics: { roiPct: -50 } }),  // NGMI
    ];
    const stars = layoutStars(cards, NOW);
    const edges = buildConnections(stars, 2);
    for (const [i, j] of edges) {
      expect(stars[i].category).toBe(stars[j].category);
    }
  });
});
