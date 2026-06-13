import { describe, it, expect } from 'vitest';
import { parsePortfolioImportFile } from './serverSync';

describe('parsePortfolioImportFile', () => {
  it('parses full JSON export shape', () => {
    const raw = JSON.stringify({
      version: 1,
      cards: [{ id: 'a', name: 'x', raw: 1, grade9: 2, psa10: 3, p10: 0.3, p9: 0.5 }],
      fees: { gradingFee: 20 },
    });
    const out = parsePortfolioImportFile(raw);
    expect(out.cards?.length).toBe(1);
    expect(out.fees?.gradingFee).toBe(20);
  });

  it('parses NDJSON card lines', () => {
    const raw = '{"id":"b","name":"y","raw":1,"grade9":2,"psa10":3,"p10":0.3,"p9":0.5}\n';
    const out = parsePortfolioImportFile(raw);
    expect(out.cards?.length).toBe(1);
    expect(out.cards?.[0]?.id).toBe('b');
  });
});
