import { describe, it, expect } from 'vitest';
import { renormalizeSealedSlotProbabilities } from './renormalizeSealedSlots';
import type { SealedPullSlot } from '../types';

const slot = (partial: Partial<SealedPullSlot> & Pick<SealedPullSlot, 'slotId' | 'label'>): SealedPullSlot => ({
  tableIndex: 0,
  rowIndex: 0,
  probability: null,
  resaleUsd: null,
  ...partial,
});

describe('renormalizeSealedSlotProbabilities', () => {
  it('rescales included rows to sum to 1', () => {
    const slots: SealedPullSlot[] = [
      slot({ slotId: 'a', label: 'A', probability: 0.5, excludeFromEv: false }),
      slot({ slotId: 'b', label: 'B', probability: 0.25, excludeFromEv: false }),
      slot({ slotId: 'x', label: 'X', probability: 0.25, excludeFromEv: true }),
    ];
    const out = renormalizeSealedSlotProbabilities(slots);
    const a = out.find((s) => s.slotId === 'a')!;
    const b = out.find((s) => s.slotId === 'b')!;
    const x = out.find((s) => s.slotId === 'x')!;
    expect(a.probability).toBeCloseTo(2 / 3, 5);
    expect(b.probability).toBeCloseTo(1 / 3, 5);
    expect(x.probability).toBe(0.25);
  });
});
