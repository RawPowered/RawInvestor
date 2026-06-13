import { describe, it, expect } from 'vitest';
import type { Card, CardMetrics } from './types';
import {
  applyFilters,
  applySort,
  comparators,
  EMPTY_FILTERS,
  UNASSIGNED,
  type EnrichedCard,
  type SortPreset,
} from './sort';

const mk = (
  overrides: Partial<Card> & { id: string; metrics?: Partial<CardMetrics> }
): EnrichedCard => ({
  id: overrides.id,
  name: overrides.name ?? 'Card',
  set: overrides.set ?? 'Set A',
  portfolioKind: overrides.portfolioKind,
  rarity: overrides.rarity,
  collectionId: overrides.collectionId,
  raw: overrides.raw ?? 10,
  grade9: overrides.grade9 ?? 30,
  psa10: overrides.psa10 ?? 100,
  p10: overrides.p10 ?? 0.3,
  p9: overrides.p9 ?? 0.5,
  releaseDateMs: overrides.releaseDateMs,
  metrics: {
    totalInvested: 40,
    net10: 50,
    net9: -5,
    netFail: -25,
    pFail: 0.2,
    ev: 10,
    roiPct: 25,
    netRawNoGrade: 12,
    revenue10: 90,
    revenue9: 35,
    revenueFail: 15,
    ...(overrides.metrics ?? {}),
  },
});

describe('comparators', () => {
  it.each<[SortPreset, string[]]>([
    ['ev_desc', ['c', 'a', 'b']],
    ['ev_asc', ['b', 'a', 'c']],
    ['roi_desc', ['a', 'c', 'b']],
    ['invested_asc', ['b', 'a', 'c']],
    ['upside_desc', ['c', 'b', 'a']],
    ['p10_desc', ['c', 'b', 'a']],
    ['raw_asc', ['b', 'a', 'c']],
    ['psa10_desc', ['c', 'b', 'a']],
  ])('sorts correctly with preset %s', (preset, expected) => {
    const items = [
      mk({ id: 'a', name: 'Alpha', raw: 20, psa10: 200, p10: 0.3, metrics: { ev: 40, roiPct: 80, totalInvested: 50 } }),
      mk({ id: 'b', name: 'Beta', raw: 10, psa10: 250, p10: 0.4, metrics: { ev: -10, roiPct: -5, totalInvested: 30 } }),
      mk({ id: 'c', name: 'Charlie', raw: 50, psa10: 500, p10: 0.5, metrics: { ev: 80, roiPct: 40, totalInvested: 120 } }),
    ];
    const sorted = applySort(items, preset).map((c) => c.id);
    expect(sorted).toEqual(expected);
  });

  it('ties break on name A-Z so order is deterministic', () => {
    const items = [
      mk({ id: '2', name: 'Zebra', metrics: { ev: 10 } }),
      mk({ id: '1', name: 'Alpha', metrics: { ev: 10 } }),
    ];
    expect(comparators.ev_desc(items[0], items[1])).toBeGreaterThan(0);
  });

  it('pushes NaN values to the end of the list', () => {
    const items = [
      mk({ id: 'good', metrics: { ev: 10 } }),
      mk({ id: 'bad', metrics: { ev: NaN } }),
    ];
    const sorted = applySort(items, 'ev_desc').map((c) => c.id);
    expect(sorted).toEqual(['good', 'bad']);
  });
});

describe('applyFilters', () => {
  const items = [
    mk({ id: 'a', name: 'Pikachu ex', set: 'Surging Sparks', collectionId: 'col1', metrics: { ev: 100 } }),
    mk({ id: 'b', name: 'Charizard', set: '151', collectionId: 'col2', metrics: { ev: -20 } }),
    mk({ id: 'c', name: 'Meowth', set: 'Phantasmal Flames', metrics: { ev: 5 } }),
  ];

  it('passes everything through with empty filters', () => {
    expect(applyFilters(items, EMPTY_FILTERS)).toHaveLength(3);
  });

  it('case-insensitively searches name + set + rarity', () => {
    expect(
      applyFilters(items, { ...EMPTY_FILTERS, search: 'PIKACHU' }).map((c) => c.id)
    ).toEqual(['a']);
    expect(
      applyFilters(items, { ...EMPTY_FILTERS, search: 'flames' }).map((c) => c.id)
    ).toEqual(['c']);
  });

  it('filters to the selected collections', () => {
    expect(
      applyFilters(items, { ...EMPTY_FILTERS, collectionIds: ['col1'] }).map((c) => c.id)
    ).toEqual(['a']);
  });

  it('treats UNASSIGNED as a first-class collection filter', () => {
    expect(
      applyFilters(items, { ...EMPTY_FILTERS, collectionIds: [UNASSIGNED] }).map(
        (c) => c.id
      )
    ).toEqual(['c']);
  });

  it('applies positive / negative EV-sign filters', () => {
    expect(
      applyFilters(items, { ...EMPTY_FILTERS, evSign: 'positive' }).map((c) => c.id)
    ).toEqual(['a', 'c']);
    expect(
      applyFilters(items, { ...EMPTY_FILTERS, evSign: 'negative' }).map((c) => c.id)
    ).toEqual(['b']);
  });

  it('composes multiple filters with AND semantics', () => {
    expect(
      applyFilters(items, {
        ...EMPTY_FILTERS,
        search: 'e',
        collectionIds: ['col1', 'col2'],
        evSign: 'positive',
      }).map((c) => c.id)
    ).toEqual(['a']);
  });

  it('filters by exact set names when sets[] is non-empty', () => {
    expect(
      applyFilters(items, { ...EMPTY_FILTERS, sets: ['151'] }).map((c) => c.id)
    ).toEqual(['b']);
  });

  it('filters by portfolio kind scope', () => {
    const singles = items.map((c) => ({ ...c, portfolioKind: 'single' as const }));
    const mixed = [
      ...singles,
      mk({ id: 'box', name: 'ETB', set: 'X', portfolioKind: 'sealed', metrics: { ev: 1 } }),
    ];
    expect(applyFilters(mixed, { ...EMPTY_FILTERS, portfolioKindScope: 'sealed' }).map((c) => c.id)).toEqual([
      'box',
    ]);
    expect(
      applyFilters(mixed, { ...EMPTY_FILTERS, portfolioKindScope: 'single' }).map((c) => c.id)
    ).toEqual(['a', 'b', 'c']);
    const unsetKind = [mk({ id: 'u1', name: 'Mystery', set: 'X', metrics: { ev: 1 } })];
    expect(
      applyFilters(unsetKind, { ...EMPTY_FILTERS, portfolioKindScope: 'sealed' }).map((c) => c.id)
    ).toEqual(['u1']);
  });

  it('filters by release year (UTC) and excludes unknown release dates', () => {
    const withDates = [
      mk({
        id: 'y1',
        name: 'A',
        set: 'S1',
        releaseDateMs: Date.UTC(2024, 0, 15),
        metrics: { ev: 1, netRawNoGrade: 1, net10: 1 },
      }),
      mk({
        id: 'y2',
        name: 'B',
        set: 'S2',
        releaseDateMs: Date.UTC(2025, 5, 1),
        metrics: { ev: 1, netRawNoGrade: 1, net10: 1 },
      }),
      mk({ id: 'y3', name: 'C', set: 'S3', metrics: { ev: 1, netRawNoGrade: 1, net10: 1 } }),
    ];
    expect(
      applyFilters(withDates, { ...EMPTY_FILTERS, releaseYears: [2024] }).map((c) => c.id)
    ).toEqual(['y1']);
  });

  it('filters pokemonName on card name substring only', () => {
    expect(
      applyFilters(items, { ...EMPTY_FILTERS, pokemonName: 'char' }).map((c) => c.id)
    ).toEqual(['b']);
  });

  it('applies profit lens filters', () => {
    const profitItems = [
      mk({ id: 'r', metrics: { ev: -5, netRawNoGrade: 10, net10: -1 } }),
      mk({ id: 'e', metrics: { ev: 3, netRawNoGrade: -2, net10: -1 } }),
      mk({ id: 't', metrics: { ev: -1, netRawNoGrade: -1, net10: 8 } }),
    ];
    expect(
      applyFilters(profitItems, { ...EMPTY_FILTERS, profitLens: 'raw_no_grade' }).map((c) => c.id)
    ).toEqual(['r']);
    expect(
      applyFilters(profitItems, { ...EMPTY_FILTERS, profitLens: 'grade_ev' }).map((c) => c.id)
    ).toEqual(['e']);
    expect(
      applyFilters(profitItems, { ...EMPTY_FILTERS, profitLens: 'psa10_win' }).map((c) => c.id)
    ).toEqual(['t']);
  });
});
