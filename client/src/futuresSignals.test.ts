import { describe, it, expect } from 'vitest';
import { evaluateFuturesSignal } from './futuresSignals';

const day = 24 * 3600 * 1000;
const anchor = Date.parse('2026-04-25T00:00:00Z');

const makePoints = (entries: Array<{ daysAgo: number; price: number }>) =>
  entries.map((e) => ({ at: anchor - e.daysAgo * day, price: e.price }));

describe('evaluateFuturesSignal', () => {
  it('classifies a stable uptrend as up with non-trivial confidence', () => {
    const points = makePoints([
      { daysAgo: 30, price: 2.1 },
      { daysAgo: 26, price: 2.2 },
      { daysAgo: 22, price: 2.3 },
      { daysAgo: 18, price: 2.5 },
      { daysAgo: 14, price: 2.7 },
      { daysAgo: 10, price: 2.9 },
      { daysAgo: 6, price: 3.0 },
      { daysAgo: 3, price: 3.2 },
      { daysAgo: 1, price: 3.35 },
    ]);
    const out = evaluateFuturesSignal({ points, windowLabel: '30D' });
    expect(out.direction).toBe('up');
    expect(out.directionConfidencePct).toBeGreaterThanOrEqual(45);
    expect(out.sampleCount).toBe(points.length);
  });

  it('flags high anomaly risk on spike-heavy tail', () => {
    const base: Array<{ daysAgo: number; price: number }> = [];
    for (let i = 25; i >= 8; i -= 1) base.push({ daysAgo: i, price: 2.4 + (i % 3) * 0.08 });
    const points = makePoints([
      ...base,
      { daysAgo: 7, price: 2.6 },
      { daysAgo: 6, price: 2.7 },
      { daysAgo: 5, price: 6.2 },
      { daysAgo: 4, price: 6.8 },
      { daysAgo: 3, price: 7.1 },
      { daysAgo: 2, price: 7.4 },
      { daysAgo: 1, price: 7.9 },
    ]);
    const out = evaluateFuturesSignal({
      points,
      windowLabel: '30D',
      additionalAnomalyCount: 4,
    });
    expect(['watch', 'high']).toContain(out.anomalySpikeFlag);
    expect(out.inflationRiskPct).toBeGreaterThan(out.deflationRiskPct);
    expect(out.inflationRiskPct).toBeGreaterThanOrEqual(50);
  });

  it('keeps risk percentages and likelihoods bounded', () => {
    const points = makePoints([
      { daysAgo: 12, price: 5.0 },
      { daysAgo: 10, price: 5.1 },
      { daysAgo: 8, price: 4.9 },
      { daysAgo: 6, price: 5.0 },
      { daysAgo: 4, price: 5.05 },
      { daysAgo: 2, price: 4.95 },
      { daysAgo: 1, price: 5.0 },
    ]);
    const out = evaluateFuturesSignal({ points, windowLabel: '7D' });
    expect(out.inflationRiskPct).toBeGreaterThanOrEqual(0);
    expect(out.inflationRiskPct).toBeLessThanOrEqual(100);
    expect(out.deflationRiskPct).toBeGreaterThanOrEqual(0);
    expect(out.deflationRiskPct).toBeLessThanOrEqual(100);
    expect(out.likelihoodUpPct + out.likelihoodDownPct + out.likelihoodFlatPct).toBe(100);
  });

  it('returns neutral-ish output on sparse data', () => {
    const points = makePoints([
      { daysAgo: 5, price: 3.2 },
      { daysAgo: 2, price: 3.5 },
      { daysAgo: 1, price: 3.4 },
    ]);
    const out = evaluateFuturesSignal({ points, windowLabel: '30D' });
    expect(out.direction).toBe('flat');
    expect(out.sampleCount).toBe(3);
    expect(out.directionConfidencePct).toBeLessThanOrEqual(35);
  });
});
