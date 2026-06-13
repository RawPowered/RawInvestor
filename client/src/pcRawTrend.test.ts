import { describe, it, expect } from 'vitest';
import {
  pcRawTrendFromHistory,
  pcRawTrendFromPrevious,
  pcRawTrendFromRecentRawSales,
  pcRawTrendForMasterList,
} from './pcRawTrend';

describe('pcRawTrendFromHistory', () => {
  it('returns null when fewer than two raw points', () => {
    expect(pcRawTrendFromHistory([{ at: 1, raw: 10 }])).toBeNull();
    expect(pcRawTrendFromHistory(undefined)).toBeNull();
  });

  it('uses last two snapshots that have raw', () => {
    const h = [
      { at: 1, raw: 100 },
      { at: 2, grade9: 50 },
      { at: 3, raw: 110 },
    ];
    const t = pcRawTrendFromHistory(h);
    expect(t?.pct).toBeCloseTo(10, 5);
    expect(t?.dir).toBe('up');
  });
});

describe('pcRawTrendFromPrevious', () => {
  it('compares raw to previousPrices.raw', () => {
    expect(
      pcRawTrendFromPrevious({
        raw: 90,
        previousPrices: { raw: 100, grade9: 1, psa10: 1, at: 1 },
      })
    ).toEqual({ pct: -10, dir: 'down' });
  });
});

describe('pcRawTrendFromRecentRawSales', () => {
  it('uses last two raw sales by time', () => {
    const t = pcRawTrendFromRecentRawSales([
      { at: 1, grade: 'raw', price: 100 },
      { at: 2, grade: 'psa10', price: 500 },
      { at: 3, grade: 'raw', price: 110 },
    ]);
    expect(t?.pct).toBeCloseTo(10, 5);
    expect(t?.dir).toBe('up');
  });
});

describe('pcRawTrendForMasterList', () => {
  it('prefers history over previousPrices', () => {
    const t = pcRawTrendForMasterList({
      raw: 200,
      grade9: 1,
      psa10: 1,
      previousPrices: { raw: 100, grade9: 1, psa10: 1, at: 1 },
      priceHistory: [
        { at: 1, raw: 10 },
        { at: 2, raw: 20 },
      ],
    });
    expect(t?.pct).toBeCloseTo(100, 5);
  });

  it('falls back to recent raw sales when history has one raw point', () => {
    const t = pcRawTrendForMasterList({
      raw: 50,
      grade9: 40,
      psa10: 200,
      priceHistory: [{ at: 1, raw: 50, source: 'initial' }],
      recentSales: [
        { at: 10, grade: 'raw', price: 40 },
        { at: 20, grade: 'raw', price: 44 },
      ],
    });
    expect(t?.pct).toBeCloseTo(10, 5);
    expect(t?.dir).toBe('up');
  });
});
