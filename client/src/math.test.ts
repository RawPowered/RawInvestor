import { describe, it, expect } from 'vitest';
import { computeMetrics, DEFAULT_FEES, fmtMoney, fmtPct, probsFromPsaPop, revenueAt } from './math';
import type { Card } from './types';

const mkCard = (overrides: Partial<Card> = {}): Card => ({
  id: 'test',
  name: 'Test Card',
  set: 'Test Set',
  raw: 20,
  grade9: 50,
  psa10: 200,
  p10: 0.3,
  p9: 0.5,
  ...overrides,
});

describe('computeMetrics', () => {
  it('computes total invested as raw + grading + shipping', () => {
    const m = computeMetrics(mkCard({ raw: 20 }), DEFAULT_FEES);
    // 20 + 25 + 15 + 0 = 60
    expect(m.totalInvested).toBe(60);
  });

  it('net10 reflects eBay fees and shipping to buyer', () => {
    // psa10 = 200; sale fee = 13.25%; flat = 0.30; shipToBuyer = 5
    // revenue = 200 * 0.8675 - 0.30 - 5 = 173.5 - 5.30 = 168.20
    // invested = 60 -> net10 = 108.20
    const m = computeMetrics(mkCard({ raw: 20, psa10: 200 }), DEFAULT_FEES);
    expect(m.net10).toBeCloseTo(168.2 - 60, 2);
  });

  it('pFail is 1 - p10 - p9, clamped to >= 0', () => {
    const m1 = computeMetrics(mkCard({ p10: 0.3, p9: 0.5 }), DEFAULT_FEES);
    expect(m1.pFail).toBeCloseTo(0.2, 10);

    const m2 = computeMetrics(mkCard({ p10: 0.7, p9: 0.5 }), DEFAULT_FEES);
    expect(m2.pFail).toBe(0);
  });

  it('EV is probability-weighted across the three outcomes', () => {
    const card = mkCard({ raw: 20, grade9: 50, psa10: 200, p10: 0.3, p9: 0.5 });
    const m = computeMetrics(card, DEFAULT_FEES);
    const expected = 0.3 * m.net10 + 0.5 * m.net9 + 0.2 * m.netFail;
    expect(m.ev).toBeCloseTo(expected, 1);
  });

  it('ROI% is EV / invested * 100', () => {
    const m = computeMetrics(mkCard(), DEFAULT_FEES);
    expect(m.roiPct).toBeCloseTo((m.ev / m.totalInvested) * 100, 2);
  });

  it('actualCost overrides the market raw price in the cost basis', () => {
    // Paid $10 for a $20-market card -> invested = 10 + 25 + 15 = 50
    const m = computeMetrics(mkCard({ raw: 20, actualCost: 10 }), DEFAULT_FEES);
    expect(m.totalInvested).toBe(50);
  });

  it('actualCost falls back to raw when unset, zero, or negative', () => {
    const base = computeMetrics(mkCard({ raw: 20 }), DEFAULT_FEES).totalInvested;
    expect(computeMetrics(mkCard({ raw: 20, actualCost: 0 }), DEFAULT_FEES).totalInvested).toBe(base);
    expect(computeMetrics(mkCard({ raw: 20, actualCost: -5 }), DEFAULT_FEES).totalInvested).toBe(base);
  });

  it('shippingCost adds to cost basis', () => {
    // Paid $10 raw + $4 shipping = $14 before fees -> 14 + 25 + 15 = 54
    const m = computeMetrics(
      mkCard({ raw: 10, actualCost: 10, shippingCost: 4 }),
      DEFAULT_FEES
    );
    expect(m.totalInvested).toBe(54);
  });

  it('freeShipping zeros out shippingCost regardless of the stored number', () => {
    const m = computeMetrics(
      mkCard({ raw: 10, actualCost: 10, shippingCost: 99, freeShipping: true }),
      DEFAULT_FEES
    );
    // 10 + 0 + 25 + 15 = 50
    expect(m.totalInvested).toBe(50);
  });

  it('netRawNoGrade is raw sale net vs purchase + inbound only (no grading fees)', () => {
    const m = computeMetrics(mkCard({ raw: 50, actualCost: 10, shippingCost: 2 }), DEFAULT_FEES);
    const revenueFail = 50 * (1 - DEFAULT_FEES.saleFeePct) - DEFAULT_FEES.saleFeeFlat - DEFAULT_FEES.shipToBuyer;
    const expected = revenueFail - 12;
    expect(m.netRawNoGrade).toBeCloseTo(expected, 2);
  });

  it('handles zero invested safely (no division by zero)', () => {
    const fees = { ...DEFAULT_FEES, gradingFee: 0, shipToGrader: 0, shipFromGrader: 0 };
    const m = computeMetrics(mkCard({ raw: 0 }), fees);
    expect(m.totalInvested).toBe(0);
    expect(m.roiPct).toBe(0);
    expect(Number.isFinite(m.ev)).toBe(true);
  });

  it('a card with failing grade that sells raw below invested is -EV', () => {
    const m = computeMetrics(
      mkCard({ raw: 100, grade9: 110, psa10: 120, p10: 0, p9: 0 }),
      DEFAULT_FEES
    );
    expect(m.pFail).toBe(1);
    expect(m.ev).toBeLessThan(0);
    expect(m.roiPct).toBeLessThan(0);
  });

  it('sealed omits grading from totalInvested and EV tracks raw exit only', () => {
    const single = computeMetrics(mkCard({ raw: 100, p10: 0.3, p9: 0.5 }), DEFAULT_FEES);
    const sealed = computeMetrics(
      mkCard({ raw: 100, p10: 0.3, p9: 0.5, portfolioKind: 'sealed' }),
      DEFAULT_FEES
    );
    expect(sealed.totalInvested).toBeLessThan(single.totalInvested);
    expect(sealed.ev).toBe(sealed.netFail);
  });
});

describe('revenueAt + breakdown', () => {
  it('exposes revenue components in metrics for the expanded view', () => {
    const m = computeMetrics(mkCard({ raw: 20, grade9: 50, psa10: 200 }), DEFAULT_FEES);
    expect(m.revenue10).toBeCloseTo(revenueAt(200, DEFAULT_FEES), 2);
    expect(m.revenue9).toBeCloseTo(revenueAt(50, DEFAULT_FEES), 2);
    expect(m.revenueFail).toBeCloseTo(revenueAt(20, DEFAULT_FEES), 2);
  });

  it('revenueAt returns 0 for a 0 sale price (card that did not sell)', () => {
    expect(revenueAt(0, DEFAULT_FEES)).toBe(0);
  });
});

describe('probsFromPsaPop', () => {
  it('derives p10 / p9 from PSA population counts', () => {
    const { p10, p9, total } = probsFromPsaPop([
      { grade: 'PSA 10', population: 300, qualifiedPopulation: 0 },
      { grade: 'PSA 9', population: 500, qualifiedPopulation: 0 },
      { grade: 'PSA 8', population: 200, qualifiedPopulation: 0 },
    ]);
    expect(total).toBe(1000);
    expect(p10).toBeCloseTo(0.3, 2);
    expect(p9).toBeCloseTo(0.5, 2);
  });

  it('buckets PSA 9.5 into p9', () => {
    const { p9 } = probsFromPsaPop([
      { grade: 'PSA 10', population: 0, qualifiedPopulation: 0 },
      { grade: 'PSA 9.5', population: 50, qualifiedPopulation: 0 },
      { grade: 'PSA 9', population: 50, qualifiedPopulation: 0 },
    ]);
    expect(p9).toBeCloseTo(1, 2);
  });

  it('returns zeros for an empty population', () => {
    expect(probsFromPsaPop([])).toEqual({ p10: 0, p9: 0, total: 0 });
  });

  it('includes qualified populations in the counts', () => {
    const { p10, total } = probsFromPsaPop([
      { grade: 'PSA 10', population: 10, qualifiedPopulation: 5 },
      { grade: 'PSA 9', population: 10, qualifiedPopulation: 0 },
    ]);
    expect(total).toBe(25);
    expect(p10).toBeCloseTo(15 / 25, 2);
  });
});

describe('formatting', () => {
  it('fmtMoney handles negatives', () => {
    expect(fmtMoney(-12.5)).toBe('-$12.50');
  });
  it('fmtMoney formats thousands', () => {
    expect(fmtMoney(1234.5)).toBe('$1,234.50');
  });
  it('fmtPct shows sign', () => {
    expect(fmtPct(12.345)).toBe('+12.3%');
    expect(fmtPct(-5)).toBe('-5.0%');
  });
});
