import { describe, it, expect } from 'vitest';
import { computeRowSignalIcons, suggestAutoBin } from './rowSignals';
import type { CardMetrics } from './types';
import type { EnrichedCard } from './sort';

const metrics = (m: Partial<CardMetrics>): CardMetrics => ({
  totalInvested: 50,
  net10: 80,
  net9: 10,
  netFail: -20,
  pFail: 0.2,
  ev: 5,
  roiPct: 10,
  netRawNoGrade: 15,
  revenue10: 100,
  revenue9: 40,
  revenueFail: 20,
  ...m,
});

const card = (overrides: Partial<EnrichedCard>): EnrichedCard =>
  ({
    id: 'c1',
    name: 'Test',
    set: 'Promo Set',
    raw: 100,
    grade9: 150,
    psa10: 400,
    p10: 0.2,
    p9: 0.5,
    priceHistory: [],
    recentSales: [],
    metrics: metrics({}),
    ...overrides,
  }) as EnrichedCard;

describe('computeRowSignalIcons', () => {
  it('marks mustSell when ROI is strongly negative with no analytics (NGMI path)', () => {
    const icons = computeRowSignalIcons(
      card({
        metrics: metrics({ ev: -40, roiPct: -25, totalInvested: 60 }),
      })
    );
    expect(icons.mustSell).toBe(true);
    expect(icons.mustGrade).toBe(false);
  });

  it('marks goodCatch when paid well under raw', () => {
    const icons = computeRowSignalIcons(
      card({
        actualCost: 70,
        raw: 100,
        metrics: metrics({ ev: 2, roiPct: 4, totalInvested: 95 }),
      })
    );
    expect(icons.goodCatch).toBe(true);
  });
});

describe('suggestAutoBin', () => {
  it('suggests sell for strongly negative cards', () => {
    const decision = suggestAutoBin(
      card({
        metrics: metrics({ ev: -40, roiPct: -25, totalInvested: 60 }),
      })
    );
    expect(decision).toBe('sell');
  });

  it('suggests hold for strong positive but slow movers', () => {
    const decision = suggestAutoBin(
      card({
        metrics: metrics({ ev: 25, roiPct: 35, totalInvested: 50 }),
      })
    );
    expect(['hold', null]).toContain(decision);
  });
});
