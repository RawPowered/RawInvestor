import { describe, expect, it } from 'vitest';
import {
  dayOverDayBaseline,
  deltaUsdAndPct,
  formatElapsedAfterPrior,
  lastSnapshotAtOrBefore,
  lastSnapshotBeforeUtcDay,
  firstObservationWithGrade,
  priorObservationWithGrade,
  yExtentForPriceChart,
  yExtentForRows,
} from './priceHistoryDeltas';

describe('priorObservationWithGrade', () => {
  it('walks backward skipping rows missing the grade', () => {
    const h = [
      { at: 1, raw: 10 },
      { at: 2, raw: 11 },
      { at: 3, grade9: 50 },
      { at: 4, raw: 12, grade9: 51 },
    ];
    const p = priorObservationWithGrade(h, 3, 'raw');
    expect(p?.index).toBe(1);
    expect(p?.snapshot.raw).toBe(11);
  });
});

describe('firstObservationWithGrade', () => {
  it('returns earliest row with that grade', () => {
    const h = [
      { at: 1, grade9: 40 },
      { at: 2, raw: 10 },
      { at: 3, raw: 12 },
    ];
    const f = firstObservationWithGrade(h, 'raw');
    expect(f?.index).toBe(1);
    expect(f?.snapshot.raw).toBe(10);
  });
});

describe('deltaUsdAndPct', () => {
  it('returns null pct when baseline is zero but price moved', () => {
    expect(deltaUsdAndPct(0, 5)).toEqual({ usd: 5, pct: null });
  });
  it('returns zero pct when both zero', () => {
    expect(deltaUsdAndPct(0, 0)).toEqual({ usd: 0, pct: 0 });
  });
  it('computes pct', () => {
    expect(deltaUsdAndPct(100, 110).pct).toBeCloseTo(10);
    expect(deltaUsdAndPct(100, 90).pct).toBeCloseTo(-10);
  });
});

describe('formatElapsedAfterPrior', () => {
  it('uses minutes in mid range', () => {
    const a = 0;
    const b = 5 * 60 * 1000;
    expect(formatElapsedAfterPrior(b, a)).toMatch(/min after prior/);
  });
});

describe('lastSnapshotBeforeUtcDay', () => {
  it('returns last row strictly before UTC start of refresh day', () => {
    const refresh = Date.UTC(2026, 3, 18, 15, 0, 0);
    const h = [
      { at: Date.UTC(2026, 3, 16, 12, 0, 0), raw: 1 },
      { at: Date.UTC(2026, 3, 17, 23, 0, 0), raw: 2 },
      { at: Date.UTC(2026, 3, 18, 8, 0, 0), raw: 3 },
    ];
    expect(lastSnapshotBeforeUtcDay(h, refresh)?.raw).toBe(2);
  });
});

describe('lastSnapshotAtOrBefore', () => {
  it('returns newest row with at <= ms', () => {
    const h = [
      { at: 100, raw: 1 },
      { at: 200, raw: 2 },
      { at: 300, raw: 3 },
    ];
    expect(lastSnapshotAtOrBefore(h, 250)?.raw).toBe(2);
    expect(lastSnapshotAtOrBefore(h, 100)?.raw).toBe(1);
  });
});

describe('dayOverDayBaseline', () => {
  it('prefers calendar-prior-day snapshot over 24h rule when both exist', () => {
    const refresh = Date.UTC(2026, 3, 18, 10, 0, 0);
    const h = [
      { at: Date.UTC(2026, 3, 17, 12, 0, 0), raw: 10 },
      { at: Date.UTC(2026, 3, 18, 2, 0, 0), raw: 11 },
    ];
    const b = dayOverDayBaseline(h, refresh);
    expect(b?.raw).toBe(10);
  });
  it('returns null when nothing is strictly before refresh time', () => {
    const t = Date.UTC(2026, 3, 18, 10, 0, 0);
    const h = [{ at: t, raw: 1 }];
    expect(dayOverDayBaseline(h, t)).toBeNull();
  });
});

describe('yExtentForRows', () => {
  it('returns null for empty finite set', () => {
    expect(yExtentForRows([{ raw: null, grade9: null, psa10: null }])).toBeNull();
  });
  it('pads range', () => {
    const e = yExtentForRows([{ raw: 100, grade9: null, psa10: 200 }]);
    expect(e).not.toBeNull();
    expect(e![0]).toBeLessThan(100);
    expect(e![1]).toBeGreaterThan(200);
  });
});

describe('yExtentForPriceChart', () => {
  it('clips a lone outlier so the bulk band gets vertical space', () => {
    type Pt = { raw: number | null; grade9: number | null; psa10: number | null };
    const rows: Pt[] = Array.from({ length: 50 }, (_, i) => ({
      raw: 48 + (i % 4),
      grade9: null,
      psa10: null,
    }));
    rows.push({ raw: null, grade9: null, psa10: 900 });
    const e = yExtentForPriceChart(rows);
    expect(e).not.toBeNull();
    expect(e![1]).toBeLessThan(900);
    expect(e![0]).toBeLessThanOrEqual(52);
  });
});
