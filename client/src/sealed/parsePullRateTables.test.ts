import { describe, expect, it } from 'vitest';
import {
  mergeSealedPullSlots,
  parseProbabilityFromCell,
  parsePullRateTables,
} from './parsePullRateTables';
import type { PullRateGuide, SealedPullSlot } from '../types';

describe('parseProbabilityFromCell', () => {
  it('parses percents', () => {
    expect(parseProbabilityFromCell('12.5%')).toBeCloseTo(0.125);
    expect(parseProbabilityFromCell('100%')).toBe(1);
  });
  it('parses 1-in-N', () => {
    expect(parseProbabilityFromCell('1 in 8')).toBeCloseTo(1 / 8);
  });
  it('parses fraction', () => {
    expect(parseProbabilityFromCell('1/4')).toBeCloseTo(0.25);
  });
});

describe('parsePullRateTables', () => {
  it('reads probabilities from a percent column', () => {
    const guide: PullRateGuide = {
      sourceUrl: 'https://example.com',
      fetchedAt: 1,
      tables: [
        {
          headers: ['Card', 'Pull rate'],
          rows: [
            ['Chase A', '50%'],
            ['Chase B', '50%'],
          ],
        },
      ],
    };
    const { slots, confidence } = parsePullRateTables(guide);
    expect(slots).toHaveLength(2);
    expect(slots[0].probability).toBeCloseTo(0.5);
    expect(slots[1].probability).toBeCloseTo(0.5);
    expect(confidence).toBe('high');
  });

  it('merge preserves resale when re-parsing', () => {
    const parsed: SealedPullSlot[] = [
      {
        slotId: 'a',
        tableIndex: 0,
        rowIndex: 0,
        label: 'X',
        probability: 0.5,
        resaleUsd: null,
      },
    ];
    const existing: SealedPullSlot[] = [
      {
        slotId: 'a',
        tableIndex: 0,
        rowIndex: 0,
        label: 'X',
        probability: 0.4,
        resaleUsd: 99,
      },
    ];
    const merged = mergeSealedPullSlots(parsed, existing);
    expect(merged[0].probability).toBeCloseTo(0.5);
    expect(merged[0].resaleUsd).toBe(99);
  });

  it('merge preserves excludeFromEv from existing slot', () => {
    const parsed: SealedPullSlot[] = [
      {
        slotId: 'a',
        tableIndex: 0,
        rowIndex: 0,
        label: 'X',
        probability: 0.5,
        resaleUsd: null,
      },
    ];
    const existing: SealedPullSlot[] = [
      {
        slotId: 'a',
        tableIndex: 0,
        rowIndex: 0,
        label: 'X',
        probability: 0.5,
        resaleUsd: null,
        excludeFromEv: true,
      },
    ];
    const merged = mergeSealedPullSlots(parsed, existing);
    expect(merged[0].excludeFromEv).toBe(true);
  });
});
