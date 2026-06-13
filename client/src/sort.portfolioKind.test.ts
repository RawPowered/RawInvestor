import { describe, expect, it } from 'vitest';
import { effectivePortfolioKind, applyFilters, EMPTY_FILTERS } from './sort';
import type { Card } from './types';
import { computeMetrics, DEFAULT_FEES } from './math';
import type { EnrichedCard } from './sort';

const enrich = (c: Card): EnrichedCard => ({
  ...c,
  metrics: computeMetrics(c, DEFAULT_FEES),
});

describe('effectivePortfolioKind', () => {
  it('uses stored sealed/single when set', () => {
    expect(effectivePortfolioKind({ portfolioKind: 'sealed' }, 'single')).toBe('sealed');
    expect(effectivePortfolioKind({ portfolioKind: 'single' }, 'sealed')).toBe('single');
  });

  it('infers from scope when kind unset', () => {
    expect(effectivePortfolioKind({}, 'sealed')).toBe('sealed');
    expect(effectivePortfolioKind({}, 'single')).toBe('single');
    expect(effectivePortfolioKind({}, 'all')).toBe('single');
  });
});

describe('applyFilters portfolio kind scope', () => {
  it('includes unset kind on sealed tab via effective kind', () => {
    const card = enrich({
      id: '1',
      name: 'Booster Box',
      set: 'Set',
      raw: 10,
      grade9: 10,
      psa10: 10,
      p10: 0.5,
      p9: 0.5,
    } as Card);
    const out = applyFilters([card], { ...EMPTY_FILTERS, portfolioKindScope: 'sealed' });
    expect(out).toHaveLength(1);
  });
});
