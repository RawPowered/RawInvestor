import { describe, it, expect } from 'vitest';
import { computeMetrics, DEFAULT_FEES } from './cardMetrics.js';

describe('computeMetrics', () => {
  it('includes grading fees in totalInvested for singles', () => {
    const m = computeMetrics(
      { raw: 100, grade9: 200, psa10: 300, p10: 0.3, p9: 0.5, portfolioKind: 'single' },
      DEFAULT_FEES
    );
    expect(m.totalInvested).toBeGreaterThan(100);
    expect(m.ev).toBeDefined();
  });

  it('excludes grading fees for sealed and drives EV from raw exit', () => {
    const single = computeMetrics(
      { raw: 100, grade9: 0, psa10: 0, p10: 0.3, p9: 0.5, portfolioKind: 'single' },
      DEFAULT_FEES
    );
    const sealed = computeMetrics(
      { raw: 100, grade9: 0, psa10: 0, p10: 0.3, p9: 0.5, portfolioKind: 'sealed' },
      DEFAULT_FEES
    );
    expect(sealed.totalInvested).toBeLessThan(single.totalInvested);
    expect(sealed.ev).toBe(sealed.netFail);
  });
});
