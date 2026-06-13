import { describe, it, expect } from 'vitest';
import { buildExportBlob, exportFilename, parseImport } from './serverSync';
import type { PortfolioSnapshot } from './serverSync';
import { EMPTY_FILTERS } from './sort';

const baseSnapshot = (): PortfolioSnapshot => ({
  cards: [
    {
      id: '1',
      name: 'Test',
      set: 'Test Set',
      raw: 10,
      grade9: 30,
      psa10: 100,
      p10: 0.3,
      p9: 0.5,
    },
  ],
  fees: {
    gradingFee: 20,
    shipToGrader: 5,
    shipFromGrader: 5,
    saleFeePct: 0.13,
    saleFeeFlat: 0,
    shipToBuyer: 5,
  },
  collections: [],
  filters: EMPTY_FILTERS,
  sort: 'ev_desc',
  psaToken: '',
  nebulaOpen: false,
  extensionLatestOnlyMode: true,
  googleCseKey: '',
  googleCseCx: '',
});

describe('buildExportBlob + exportFilename', () => {
  it('produces a JSON blob that parseImport round-trips without loss', async () => {
    const snap = baseSnapshot();
    const blob = buildExportBlob(snap, 1_700_000_000_000);
    expect(blob.type).toBe('application/json');
    const text = await blob.text();
    const out = parseImport(text);
    expect(out.cards).toEqual(snap.cards);
    expect(out.fees).toEqual(snap.fees);
    expect(out.sort).toBe('ev_desc');
  });

  it('stamps the requested timestamp and schema version', async () => {
    const text = await buildExportBlob(baseSnapshot(), 1234).text();
    const parsed = JSON.parse(text);
    expect(parsed.version).toBe(1);
    expect(parsed.updatedAt).toBe(1234);
  });

  it('exportFilename uses the ISO date from the given timestamp', () => {
    const t = Date.parse('2026-04-18T23:59:59Z');
    expect(exportFilename(t)).toBe('raw-investor-portfolio-2026-04-18.json');
  });
});

describe('parseImport', () => {
  it('throws a descriptive error on invalid JSON', () => {
    expect(() => parseImport('not json')).toThrow(/valid JSON/i);
  });

  it('throws when the top level is not an object', () => {
    expect(() => parseImport('[]')).toThrow(/object/i);
    expect(() => parseImport('"hi"')).toThrow(/object/i);
    expect(() => parseImport('null')).toThrow(/object/i);
  });

  it('throws when no recognised portfolio fields are present', () => {
    expect(() => parseImport('{"some":"thing"}')).toThrow(/recognised/i);
  });

  it('keeps only the fields it understands (ignores extra keys)', () => {
    const raw = JSON.stringify({
      cards: [{ id: 'x' }],
      somethingElse: 42,
    });
    const out = parseImport(raw);
    expect(out.cards).toEqual([{ id: 'x' }]);
    expect((out as Record<string, unknown>).somethingElse).toBeUndefined();
  });

  it('type-guards cards and collections to arrays', () => {
    const raw = JSON.stringify({ cards: 'not-an-array', collections: {} });
    expect(() => parseImport(raw)).toThrow(/recognised/i);
  });

  it('accepts partial imports (e.g. just fees)', () => {
    const raw = JSON.stringify({ fees: { gradingFee: 15 } });
    const out = parseImport(raw);
    expect(out.fees).toEqual({ gradingFee: 15 });
    expect(out.cards).toBeUndefined();
  });
});
