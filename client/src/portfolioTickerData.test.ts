import { describe, it, expect } from 'vitest';
import { buildPortfolioTickerRows, truncateTickerLabel } from './portfolioTickerData';
import type { EnrichedCard } from './sort';
const card = (id: string, name: string, ev: number, raw: number, psa10: number): EnrichedCard => ({
  id,
  name,
  set: 'Test',
  raw,
  grade9: 1,
  psa10,
  p10: 0.3,
  p9: 0.5,
  metrics: {
    totalInvested: 10,
    net10: 1,
    net9: 1,
    netFail: 1,
    pFail: 0.2,
    ev,
    roiPct: 0,
    netRawNoGrade: 1,
    revenue10: 1,
    revenue9: 1,
    revenueFail: 1,
  },
});

describe('truncateTickerLabel', () => {
  it('truncates long names', () => {
    expect(truncateTickerLabel('A'.repeat(30), 10).length).toBeLessThanOrEqual(11);
  });
});

describe('buildPortfolioTickerRows', () => {
  it('orders by EV descending and caps count', () => {
    const visible: EnrichedCard[] = [
      card('1', 'Low', 1, 5, 10),
      card('2', 'High', 99, 5, 10),
      card('3', 'Mid', 50, 5, 10),
    ];
    const rows = buildPortfolioTickerRows(visible, 2);
    expect(rows.map((r) => r.id)).toEqual(['2', '3']);
    expect(rows[0].ev).toBe(99);
  });
});
