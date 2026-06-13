import { describe, it, expect } from 'vitest';
import {
  effectivePriceHistory,
  priceHistoryOnOrAfterRelease,
  recentSalesOnOrAfterRelease,
  snapshotsFromRecentSales,
  stripPcPlaceholderGradeFields,
  startOfUtcDay,
} from './releaseFilter';
import type { RecentSale } from './types';
import type { PriceSnapshot } from './types';

const march14 = Date.parse('2025-03-14');
const day = 24 * 3600 * 1000;

describe('startOfUtcDay', () => {
  it('normalizes to UTC midnight', () => {
    const lo = startOfUtcDay(march14);
    const d = new Date(lo);
    expect(d.getUTCHours()).toBe(0);
    expect(d.getUTCMinutes()).toBe(0);
    expect(d.getUTCSeconds()).toBe(0);
  });
});

describe('priceHistoryOnOrAfterRelease', () => {
  it('passes through when release is unknown', () => {
    const h = [{ at: 100, raw: 5 }];
    expect(priceHistoryOnOrAfterRelease(h, undefined)).toEqual(h);
    expect(priceHistoryOnOrAfterRelease(h, null)).toEqual(h);
  });

  it('drops points strictly before release UTC day', () => {
    const cut = startOfUtcDay(march14);
    const out = priceHistoryOnOrAfterRelease(
      [
        { at: cut - 24 * 3600 * 1000, raw: 6 },
        { at: cut + 3600 * 1000, raw: 4 },
      ],
      march14
    );
    expect(out).toHaveLength(1);
    expect(out[0].raw).toBe(4);
  });
});

describe('recentSalesOnOrAfterRelease', () => {
  it('filters sale timestamps the same way', () => {
    const cut = startOfUtcDay(march14);
    const out = recentSalesOnOrAfterRelease(
      [
        { at: cut - 1000, grade: 'raw', price: 6 },
        { at: cut + 1000, grade: 'raw', price: 5 },
      ],
      march14
    );
    expect(out).toHaveLength(1);
    expect(out[0].price).toBe(5);
  });
});

describe('stripPcPlaceholderGradeFields', () => {
  const refs = { raw: 4, grade9: 19, psa10: 36 };

  it('removes ~$6 grade9/psa10 when posted prices are much higher', () => {
    const h: PriceSnapshot[] = [
      { at: 1, grade9: 6, psa10: 6, raw: 4 },
      { at: 2, grade9: 18, psa10: 35, raw: 4 },
    ];
    const out = stripPcPlaceholderGradeFields(h, refs);
    expect(out[0].grade9).toBeUndefined();
    expect(out[0].psa10).toBeUndefined();
    expect(out[0].raw).toBe(4);
    expect(out[1].grade9).toBe(18);
    expect(out[1].psa10).toBe(35);
  });

  it('keeps legitimate cheap graded sales near refs', () => {
    const h: PriceSnapshot[] = [{ at: 1, grade9: 17, psa10: 34, raw: 4 }];
    const out = stripPcPlaceholderGradeFields(h, refs);
    expect(out[0].grade9).toBe(17);
    expect(out[0].psa10).toBe(34);
  });

  it('strips ~$6 raw when posted raw is much higher even if graded sep is false', () => {
    const refsLoGraded = { raw: 52, grade9: 8, psa10: 8 };
    const h: PriceSnapshot[] = [{ at: 1, raw: 6.1, grade9: 8 }];
    const out = stripPcPlaceholderGradeFields(h, refsLoGraded);
    expect(out[0].raw).toBeUndefined();
    expect(out[0].grade9).toBe(8);
  });

  it('strips ~$6 raw using peer highs when posted ref is low but history has real raw', () => {
    const refs = { raw: 3.5, grade9: 5, psa10: 5 };
    const h: PriceSnapshot[] = [
      { at: 1, raw: 6.0 },
      { at: 2, raw: 6.2 },
      { at: 3, raw: 45 },
      { at: 4, raw: 48 },
    ];
    const out = stripPcPlaceholderGradeFields(h, refs);
    expect(out[0].raw).toBeUndefined();
    expect(out[1].raw).toBeUndefined();
    expect(out[2].raw).toBe(45);
    expect(out[3].raw).toBe(48);
  });
});

describe('snapshotsFromRecentSales', () => {
  it('maps one snapshot per sale with pc_sale source', () => {
    const sales: RecentSale[] = [
      { at: 1000, grade: 'psa10', price: 500 },
      { at: 2000, grade: 'grade9', price: 80 },
    ];
    const out = snapshotsFromRecentSales(sales, null);
    expect(out).toHaveLength(2);
    expect(out[0].source).toBe('pc_sale');
    expect(out[0].psa10).toBe(500);
    expect(out[1].grade9).toBe(80);
  });

  it('offsets same UTC day + grade by one minute so x does not collapse', () => {
    const t = Date.parse('2026-04-10T00:00:00Z');
    const sales: RecentSale[] = [
      { at: t, grade: 'psa10', price: 100 },
      { at: t, grade: 'psa10', price: 110 },
    ];
    const out = snapshotsFromRecentSales(sales, null);
    expect(out[0].at).toBe(t);
    expect(out[1].at).toBe(t + 60 * 1000);
  });

  it('respects release cutoff', () => {
    const cut = startOfUtcDay(march14);
    const sales: RecentSale[] = [
      { at: cut - 1000, grade: 'raw', price: 5 },
      { at: cut + 1000, grade: 'raw', price: 6 },
    ];
    const out = snapshotsFromRecentSales(sales, cut);
    expect(out).toHaveLength(1);
    expect(out[0].raw).toBe(6);
  });
});

describe('effectivePriceHistory', () => {
  it('chains release filter and placeholder strip', () => {
    const refs = { raw: 4, grade9: 20, psa10: 36 };
    const cut = startOfUtcDay(march14);
    const out = effectivePriceHistory(
      [
        { at: cut - day, grade9: 6, psa10: 6, raw: 4 },
        { at: cut + day, grade9: 6, psa10: 6, raw: 4 },
      ],
      march14,
      refs
    );
    expect(out).toHaveLength(1);
    expect(out[0].grade9).toBeUndefined();
    expect(out[0].psa10).toBeUndefined();
  });
});
