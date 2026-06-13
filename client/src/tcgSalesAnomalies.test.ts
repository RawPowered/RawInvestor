import { describe, expect, it } from 'vitest';
import { buildTcgSalesAnomalies } from './tcgSalesAnomalies';

describe('buildTcgSalesAnomalies', () => {
  it('returns insufficient history for sparse rows', () => {
    const out = buildTcgSalesAnomalies([{ at: Date.now(), condition: null, qty: 1, price: 10 }]);
    expect(out[0].kind).toBe('insufficient_history');
  });

  it('detects volume/price anomaly patterns', () => {
    const now = Date.now();
    const rows = [
      ...Array.from({ length: 20 }, (_, i) => ({
        at: now - (i + 1) * 24 * 60 * 60 * 1000,
        condition: 'NM',
        qty: 1,
        price: 10,
      })),
      ...Array.from({ length: 8 }, (_, i) => ({
        at: now - i * 3 * 60 * 60 * 1000,
        condition: 'NM',
        qty: 5,
        price: 14,
      })),
    ];
    const out = buildTcgSalesAnomalies(rows, now);
    expect(out.some((x) => x.kind === 'volume_spike' || x.kind === 'price_spike')).toBe(true);
  });
});
