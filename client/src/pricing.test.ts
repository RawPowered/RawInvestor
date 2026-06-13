import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SELL_PRICING_POLICY,
  MIN_SALES_FOR_DISTRIBUTION,
  computeSellPriceTargets,
  computePace,
  combineSalesPace,
  extractCrossGraders,
  filterSalesForGradeWindow,
  formatSalesCadenceReport,
  quantile,
  salePassesGradedSemantics,
  summarizeSales,
} from './pricing';
import type { GradePrice, RecentSale } from './types';

const day = 24 * 3600 * 1000;
const now = Date.parse('2026-04-18T00:00:00Z');

/** Sales over the last N days for a specific grade at given prices. */
const makeSales = (
  grade: 'raw' | 'grade9' | 'psa10',
  entries: Array<{ daysAgo: number; price: number }>
): RecentSale[] =>
  entries.map((e) => ({
    at: now - e.daysAgo * day,
    grade,
    price: e.price,
  }));

/** Generate N daily sales with linearly increasing prices for use in the
 *  distribution-mode tests (any size >= MIN_SALES_FOR_DISTRIBUTION works). */
const linearSales = (
  grade: 'raw' | 'grade9' | 'psa10',
  count: number,
  startPrice: number,
  step: number,
  firstDaysAgo = 1
): RecentSale[] =>
  Array.from({ length: count }, (_, i) => ({
    at: now - (firstDaysAgo + i) * day,
    grade,
    price: startPrice + i * step,
  }));

describe('quantile', () => {
  it('returns null for empty input', () => {
    expect(quantile([], 0.5)).toBeNull();
  });
  it('returns the single value for n=1', () => {
    expect(quantile([42], 0.75)).toBe(42);
  });
  it('matches type-7 linear interpolation for known values', () => {
    expect(quantile([10, 20, 30, 40, 50], 0.5)).toBe(30);
    expect(quantile([10, 20, 30, 40, 50], 0.25)).toBe(20);
    expect(quantile([10, 20, 30, 40, 50], 0.75)).toBe(40);
  });
  it('interpolates between ranks', () => {
    expect(quantile([1, 2, 3, 4], 0.25)).toBeCloseTo(1.75, 3);
  });
  it('clamps out-of-range q values', () => {
    expect(quantile([1, 2, 3], -0.5)).toBe(1);
    expect(quantile([1, 2, 3], 1.5)).toBe(3);
  });
});

describe('computeSellPriceTargets', () => {
  it('returns platform and direct targets from market price', () => {
    const out = computeSellPriceTargets(100, DEFAULT_SELL_PRICING_POLICY);
    expect(out.marketPrice).toBe(100);
    expect(out.optimalEbayPrice).toBeCloseTo(129.87, 2);
    expect(out.optimalWhatnotPrice).toBeCloseTo(121.95, 2);
    expect(out.directCashAppOffer).toBeCloseTo(88, 2);
  });

  it('returns zeros when market price is invalid', () => {
    expect(computeSellPriceTargets(0).optimalEbayPrice).toBe(0);
    expect(computeSellPriceTargets(-10).directCashAppOffer).toBe(0);
  });
});

describe('computePace', () => {
  it('prefers observed per-grade sales over scraped site-wide volume', () => {
    const sales = makeSales('psa10', [
      { daysAgo: 1, price: 100 },
      { daysAgo: 5, price: 110 },
      { daysAgo: 10, price: 105 },
    ]);
    const pace = computePace(sales, 'psa10', { month: 999 }, 30, now);
    expect(pace.source).toBe('observed');
    expect(pace.pacePerMonth).toBeCloseTo(3, 3);
  });

  it('falls back to scraped monthly volume when no observations exist', () => {
    const pace = computePace([], 'psa10', { month: 47 }, 30, now);
    expect(pace.source).toBe('scraped');
    expect(pace.pacePerMonth).toBe(47);
  });

  it('derives monthly from weekly when only week is scraped', () => {
    const pace = computePace([], 'psa10', { week: 4 }, 30, now);
    expect(pace.source).toBe('scraped');
    expect(pace.pacePerMonth).toBeCloseTo(4 * (30 / 7), 3);
  });

  it('returns zero + "none" when nothing is available', () => {
    const pace = computePace([], 'psa10', undefined, 30, now);
    expect(pace.source).toBe('none');
    expect(pace.pacePerMonth).toBe(0);
  });

  it('scales observed sales to 30 days', () => {
    const sales = makeSales('raw', [
      { daysAgo: 1, price: 10 },
      { daysAgo: 2, price: 11 },
      { daysAgo: 3, price: 12 },
      { daysAgo: 4, price: 13 },
      { daysAgo: 5, price: 14 },
    ]);
    const pace = computePace(sales, 'raw', undefined, 10, now);
    expect(pace.pacePerMonth).toBeCloseTo(15, 3);
  });
});

describe('summarizeSales - no-data branch', () => {
  it('returns "no_data" when sales are empty AND no PC reference is given', () => {
    const s = summarizeSales([], 'psa10', 30, undefined, undefined, now);
    expect(s.count).toBe(0);
    expect(s.referenceMode).toBe('no_data');
    expect(s.suggestion.list).toBeNull();
    expect(s.pushHigher.advice).toBe('insufficient');
  });

  it('ignores sales outside the window when deciding count', () => {
    const sales = makeSales('psa10', [
      { daysAgo: 1, price: 100 },
      { daysAgo: 45, price: 200 },
    ]);
    const s = summarizeSales(sales, 'psa10', 30, undefined, 150, now);
    expect(s.count).toBe(1);
    expect(s.high).toBe(100);
  });

  it('ignores sales from other grades', () => {
    const sales = [
      ...makeSales('psa10', [{ daysAgo: 1, price: 200 }]),
      ...makeSales('raw', [
        { daysAgo: 1, price: 10 },
        { daysAgo: 2, price: 12 },
        { daysAgo: 3, price: 14 },
      ]),
    ];
    const s = summarizeSales(sales, 'raw', 30, undefined, 12, now);
    expect(s.count).toBe(3);
    expect(s.high).toBe(14);
    expect(s.low).toBe(10);
  });
});

describe('summarizeSales - PC fallback branch (<10 sales)', () => {
  it('falls back to PC reference when there are no sales at all', () => {
    const s = summarizeSales([], 'psa10', 30, undefined, 200, now);
    expect(s.referenceMode).toBe('pc_fallback');
    expect(s.referencePrice).toBe(200);
    expect(s.pushHigher.advice).toBe('pc_reference');
    expect(s.pushHigher.label).toMatch(/PC REFERENCE/i);
    expect(s.suggestion.list).toBe(200);
  });

  it('falls back to PC reference when below the MIN threshold', () => {
    // 5 sales < MIN=10
    const sales = makeSales('psa10', [
      { daysAgo: 1, price: 195 },
      { daysAgo: 4, price: 198 },
      { daysAgo: 8, price: 201 },
      { daysAgo: 12, price: 204 },
      { daysAgo: 16, price: 207 },
    ]);
    const s = summarizeSales(sales, 'psa10', 30, undefined, 200, now);
    expect(s.count).toBe(5);
    expect(s.count).toBeLessThan(MIN_SALES_FOR_DISTRIBUTION);
    expect(s.referenceMode).toBe('pc_fallback');
    expect(s.referencePrice).toBe(200);
  });

  it('builds symmetric floor / list / stretch bands around the PC price', () => {
    const s = summarizeSales([], 'psa10', 30, undefined, 100, now);
    expect(s.suggestion.floor).toBeCloseTo(90, 2);
    expect(s.suggestion.list).toBe(100);
    expect(s.suggestion.stretch).toBeCloseTo(115, 2);
  });

  it('still surfaces observed low/high/mean for display context', () => {
    const sales = makeSales('psa10', [
      { daysAgo: 1, price: 180 },
      { daysAgo: 5, price: 220 },
    ]);
    const s = summarizeSales(sales, 'psa10', 30, undefined, 200, now);
    expect(s.referenceMode).toBe('pc_fallback');
    expect(s.low).toBe(180);
    expect(s.high).toBe(220);
  });
});

describe('summarizeSales - observed distribution branch (>=10 sales)', () => {
  it('reaches the observed branch exactly at MIN_SALES_FOR_DISTRIBUTION', () => {
    const sales = linearSales('psa10', MIN_SALES_FOR_DISTRIBUTION, 100, 10);
    const s = summarizeSales(sales, 'psa10', 30, undefined, 999, now);
    expect(s.referenceMode).toBe('observed');
    expect(s.count).toBe(MIN_SALES_FOR_DISTRIBUTION);
  });

  it('PUSH HIGHER when pace is strong AND the high tail is well-populated', () => {
    const sales = linearSales('psa10', 10, 100, 5, 1);
    const s = summarizeSales(sales, 'psa10', 30, undefined, undefined, now);
    expect(s.pacePerMonth).toBeGreaterThanOrEqual(4);
    expect(s.pushHigher.advice).toBe('push_higher');
    expect(s.pushHigher.confidence).toBe('high');
  });

  it('HOLD AT MEDIAN when pace is slow (<2/month) even with >=10 sales', () => {
    // 12 sales spread over 365 days = ~1/month
    const sales = Array.from({ length: 12 }, (_, i) => ({
      at: now - (i + 1) * 30 * day,
      grade: 'psa10' as const,
      price: 100 + i * 5,
    }));
    const s = summarizeSales(sales, 'psa10', 365, undefined, undefined, now);
    expect(s.referenceMode).toBe('observed');
    expect(s.pacePerMonth).toBeLessThan(2);
    expect(s.pushHigher.advice).toBe('hold_median');
  });

  it('flags outlier when the top sale is >=1.6x the P75', () => {
    // 9 bunched sales + 1 flyer (needs 10+ to reach observed branch)
    const sales = makeSales('psa10', [
      { daysAgo: 1, price: 100 },
      { daysAgo: 3, price: 101 },
      { daysAgo: 5, price: 102 },
      { daysAgo: 7, price: 103 },
      { daysAgo: 9, price: 104 },
      { daysAgo: 11, price: 105 },
      { daysAgo: 13, price: 106 },
      { daysAgo: 15, price: 107 },
      { daysAgo: 17, price: 108 },
      { daysAgo: 19, price: 500 },
    ]);
    const s = summarizeSales(sales, 'psa10', 30, undefined, undefined, now);
    expect(s.referenceMode).toBe('observed');
    expect(s.pushHigher.advice).toBe('list_at_p75');
    expect(s.pushHigher.reason).toMatch(/outlier/i);
  });

  it('computes low/high/median with >=10 sales', () => {
    const sales = linearSales('psa10', 10, 100, 10);
    const s = summarizeSales(sales, 'psa10', 30, undefined, undefined, now);
    expect(s.low).toBe(100);
    expect(s.high).toBe(190);
    // Median of 10 evenly-spaced values is midpoint of the middle two
    expect(s.median).toBe(145);
  });
});

describe('graded vs raw semantics — shipping / loose comps in PSA buckets', () => {
  it('rejects sub-plausible prices in grade9 when PC separates graded from raw', () => {
    expect(salePassesGradedSemantics('grade9', 6, 20, 4)).toBe(false);
    expect(salePassesGradedSemantics('grade9', 8, 20, 4)).toBe(true);
    expect(salePassesGradedSemantics('psa10', 6, 75, 4)).toBe(false);
    expect(salePassesGradedSemantics('grade9', 6, 8, 6)).toBe(true); // no separation
  });

  it('strips clustered ~$6 prints from raw when FMV is lower and enough real sales remain', () => {
    const low = 3.5;
    const sales: RecentSale[] = [];
    for (let i = 0; i < 14; i++) {
      sales.push({
        at: now - (i + 1) * day,
        grade: 'raw',
        price: 6.2,
      });
    }
    for (let i = 0; i < 12; i++) {
      sales.push({
        at: now - (16 + i) * day,
        grade: 'raw',
        price: 2.5 + i * 0.15,
      });
    }
    const cutoff = now - 30 * day;
    const rows = filterSalesForGradeWindow(sales, 'raw', cutoff, low, low);
    expect(rows.every((s) => s.price < 5 || s.price > 8)).toBe(true);
    expect(rows.length).toBeGreaterThanOrEqual(8);
  });

  it('strips ~$6 raw matrix band when posted raw is high (matches history cleanup)', () => {
    const junk = Array.from({ length: 12 }, (_, i) => ({
      at: now - (i + 1) * day,
      grade: 'raw' as const,
      price: 6.0 + (i % 2) * 0.25,
    }));
    const clean = linearSales('raw', 18, 38, 2, 2);
    const sales = [...junk, ...clean];
    const out = summarizeSales(sales, 'raw', 30, undefined, 53, now, 53);
    expect(out.count).toBe(18);
    expect(out.low ?? 0).toBeGreaterThanOrEqual(30);
    expect(out.median ?? 0).toBeGreaterThan(20);
    expect(out.p25 ?? 0).toBeGreaterThan(8);
  });

  it('drops mis-tagged $6 rows from grade9 stats when raw + grade9 refs are passed', () => {
    const junk: RecentSale[] = Array.from({ length: 15 }, (_, i) => ({
      at: now - (i + 1) * day,
      grade: 'grade9' as const,
      price: 6,
    }));
    const clean = linearSales('grade9', 15, 22, 2);
    const out = summarizeSales(
      [...junk, ...clean],
      'grade9',
      30,
      undefined,
      20,
      now,
      4
    );
    expect(out.low ?? 0).toBeGreaterThanOrEqual(10);
    expect(out.count).toBe(15);
  });
});

describe('summarizeSales - sanity band vs PC reference price', () => {
  it('drops sales below 10% of the PC reference price (shipping-cost leakage)', () => {
    // 12 clean sales near $500 plus 15 bogus $6 entries (previous bug's output).
    const clean = linearSales('psa10', 12, 480, 5);
    const junk: RecentSale[] = Array.from({ length: 15 }, (_, i) => ({
      at: now - (i + 1) * day,
      grade: 'psa10',
      price: 6,
    }));
    const out = summarizeSales(
      [...clean, ...junk], 'psa10', 30, undefined, 500, now
    );
    expect(out.count).toBe(12);
    expect(out.low).toBeGreaterThanOrEqual(50);
    expect(out.high).toBeLessThanOrEqual(600);
    expect(out.referenceMode).toBe('observed');
  });

  it('drops sales above 500% of the PC reference price (runaway outliers)', () => {
    const clean = linearSales('raw', 12, 50, 2);
    const junk: RecentSale[] = [
      { at: now - day, grade: 'raw', price: 9999 },
    ];
    const out = summarizeSales(
      [...clean, ...junk], 'raw', 30, undefined, 55, now
    );
    expect(out.count).toBe(12);
    expect(out.high ?? 0).toBeLessThan(9999);
  });

  it('keeps all sales when no PC reference price is provided', () => {
    const mixed: RecentSale[] = [
      { at: now - day, grade: 'psa10', price: 6 },
      { at: now - 2 * day, grade: 'psa10', price: 500 },
    ];
    const out = summarizeSales(mixed, 'psa10', 30, undefined, undefined, now);
    expect(out.count).toBe(2);
  });

  it('pace count honours the same sanity band', () => {
    // 5 real sales at $500, 20 $6 junk entries. Pace should reflect only the 5.
    const clean = linearSales('psa10', 5, 480, 5);
    const junk: RecentSale[] = Array.from({ length: 20 }, (_, i) => ({
      at: now - (i + 1) * day,
      grade: 'psa10',
      price: 6,
    }));
    const pace = computePace([...clean, ...junk], 'psa10', undefined, 30, now, 500, 5);
    // 5 sales in 30 days -> 5/month exactly.
    expect(pace.pacePerMonth).toBeCloseTo(5, 3);
    expect(pace.source).toBe('observed');
  });
});

describe('formatSalesCadenceReport', () => {
  it('emits per-grade lines with window counts', () => {
    const sales: RecentSale[] = [
      { at: now - 3 * day, grade: 'psa10', price: 500 },
      { at: now - 10 * day, grade: 'psa10', price: 510 },
      { at: now - 40 * day, grade: 'psa10', price: 520 },
      { at: now - 2 * day, grade: 'raw', price: 50 },
    ];
    const text = formatSalesCadenceReport(sales, now);
    expect(text).toContain('PSA 10');
    expect(text).toContain('RAW');
    expect(text).toMatch(/PSA 10[\s\S]*7d:\s*1/);
    expect(text).toMatch(/PSA 10[\s\S]*30d:\s*2/);
    expect(text).toMatch(/PSA 10[\s\S]*90d:\s*3/);
  });

  it('returns an empty string when there are no sales', () => {
    expect(formatSalesCadenceReport([], now)).toBe('');
  });
});

describe('extractCrossGraders', () => {
  const matrix: GradePrice[] = [
    { key: 'ungraded', label: 'Ungraded', price: 20 },
    { key: 'grade_9', label: 'Grade 9', price: 80 },
    { key: 'grade_9_5', label: 'Grade 9.5', price: 120 },
    { key: 'psa_10', label: 'PSA 10', price: 200 },
    { key: 'cgc_10', label: 'CGC 10', price: 180 },
    { key: 'cgc_10_pristine', label: 'CGC 10 Pristine', price: 320 },
    { key: 'bgs_10', label: 'BGS 10', price: 240 },
    { key: 'bgs_10_black', label: 'BGS 10 Black', price: 900 },
    { key: 'sgc_10', label: 'SGC 10', price: 170 },
    { key: 'tag_10', label: 'TAG 10', price: 210 },
  ];

  it('returns empty array when allPrices is missing or empty', () => {
    expect(extractCrossGraders(undefined, 10, 100)).toEqual([]);
    expect(extractCrossGraders([], 10, 100)).toEqual([]);
  });

  it('picks only grade-10 rows across supported graders', () => {
    const out = extractCrossGraders(matrix, 20, 200);
    const keys = out.map((p) => p.key);
    expect(keys).toContain('psa_10');
    expect(keys).toContain('cgc_10');
    expect(keys).toContain('cgc_10_pristine');
    expect(keys).toContain('bgs_10_black');
    expect(keys).toContain('sgc_10');
    expect(keys).toContain('tag_10');
    expect(keys).not.toContain('ungraded');
    expect(keys).not.toContain('grade_9_5');
  });

  it('orders PSA first, then CGC/BGS/SGC/TAG, each sorted by price desc', () => {
    const out = extractCrossGraders(matrix, 20, 200);
    expect(out[0].company).toBe('PSA');
    // Within CGC: pristine ($320) should come before regular ($180)
    const cgc = out.filter((p) => p.company === 'CGC');
    expect(cgc.map((p) => p.price)).toEqual([320, 180]);
    // Within BGS: Black ($900) before regular ($240)
    const bgs = out.filter((p) => p.company === 'BGS');
    expect(bgs.map((p) => p.price)).toEqual([900, 240]);
  });

  it('computes premium vs raw and delta vs PSA 10', () => {
    const out = extractCrossGraders(matrix, 20, 200);
    const cgcPristine = out.find((p) => p.key === 'cgc_10_pristine')!;
    expect(cgcPristine.premiumVsRaw).toBeCloseTo(16, 3); // 320/20
    expect(cgcPristine.deltaVsPsa10).toBeCloseTo(0.6, 3); // (320-200)/200
    const sgc = out.find((p) => p.key === 'sgc_10')!;
    expect(sgc.deltaVsPsa10).toBeCloseTo(-0.15, 3); // (170-200)/200
  });

  it('returns null ratios when raw or PSA price is missing/zero', () => {
    const out = extractCrossGraders(matrix, 0, 0);
    const psa = out.find((p) => p.key === 'psa_10')!;
    expect(psa.premiumVsRaw).toBeNull();
    expect(psa.deltaVsPsa10).toBeNull();
  });

  it('skips rows with non-positive prices', () => {
    const bad: GradePrice[] = [
      { key: 'psa_10', label: 'PSA 10', price: 0 },
      { key: 'cgc_10', label: 'CGC 10', price: -5 },
      { key: 'bgs_10', label: 'BGS 10', price: 150 },
    ];
    const out = extractCrossGraders(bad, 20, 200);
    expect(out.map((p) => p.key)).toEqual(['bgs_10']);
  });
});

describe('combineSalesPace', () => {
  const pc = summarizeSales(
    linearSales('raw', 12, 50, 2),
    'raw',
    30,
    undefined,
    60,
    now,
    60
  );

  it('falls back to PC when eBay is absent', () => {
    const out = combineSalesPace('raw', pc, null);
    expect(out.source).toBe('pc');
    expect(out.pacePerMonth).toBeCloseTo(pc.pacePerMonth, 6);
  });

  it('uses eBay when eBay sample/pace is stronger', () => {
    const pcThin = summarizeSales([], 'raw', 30, undefined, 60, now, 60);
    const out = combineSalesPace('raw', pcThin, {
      query: 'pikachu',
      windowDays: 30,
      fetchedAt: now,
      count: 30,
      low: 40,
      median: 85,
      high: 140,
      mean: 82,
      p25: 70,
      p75: 95,
      pacePerMonth: 30,
      pacePerWeek: 7,
      source: 'ebay_marketplace_insights',
      currency: 'USD',
      listings: [],
    });
    expect(out.source).toBe('ebay');
    expect(out.referencePrice).toBe(85);
  });

  it('returns hybrid when both sources have healthy sample sizes', () => {
    const out = combineSalesPace('raw', pc, {
      query: 'charizard',
      windowDays: 30,
      fetchedAt: now,
      count: 10,
      low: 40,
      median: 63,
      high: 90,
      mean: 62,
      p25: 55,
      p75: 70,
      pacePerMonth: 10,
      pacePerWeek: 2.3,
      source: 'ebay_marketplace_insights',
      currency: 'USD',
      listings: [],
    });
    expect(out.source).toBe('hybrid');
    expect(out.pacePerMonth).toBeGreaterThan(0);
    expect(out.count).toBe(pc.count + 10);
  });
});
