import { describe, expect, it } from 'vitest';
import { evaluateSealedOpenVsKeep } from './sealedOpenEv';
import type { Fees, SealedPullSlot } from '../types';
import { DEFAULT_FEES, revenueAt } from '../math';

const fees: Fees = { ...DEFAULT_FEES };

describe('evaluateSealedOpenVsKeep', () => {
  it('returns incomplete when no slots', () => {
    const r = evaluateSealedOpenVsKeep(10, [], fees);
    expect(r.kpi).toBe('Sealed Edge');
    expect(r.label).toMatch(/pull mapping/i);
  });

  it('equal EV → Keep Sealed', () => {
    const gross = 250;
    const netFromOneSale = revenueAt(gross, fees);
    const slots: SealedPullSlot[] = [
      {
        slotId: 'a',
        tableIndex: 0,
        rowIndex: 0,
        label: 'Only',
        probability: 1,
        resaleUsd: gross,
      },
    ];
    const r = evaluateSealedOpenVsKeep(netFromOneSale, slots, fees);
    expect(r.label).toBe('Keep Sealed');
    expect(r.tone).toBe('neutral');
  });

  it('EV(open) clearly above net sealed → Favor opening', () => {
    const slots: SealedPullSlot[] = [
      {
        slotId: 'a',
        tableIndex: 0,
        rowIndex: 0,
        label: 'God pack',
        probability: 1,
        resaleUsd: 500,
      },
    ];
    const r = evaluateSealedOpenVsKeep(5, slots, fees);
    expect(r.label).toBe('Favor opening');
    expect(r.tone).toBe('good');
  });

  it('ignores excludeFromEv slots for completeness and EV', () => {
    const slots: SealedPullSlot[] = [
      {
        slotId: 'x',
        tableIndex: 0,
        rowIndex: 0,
        label: 'Skip',
        probability: null,
        resaleUsd: null,
        excludeFromEv: true,
      },
      {
        slotId: 'y',
        tableIndex: 0,
        rowIndex: 1,
        label: 'Hit',
        probability: 1,
        resaleUsd: 500,
      },
    ];
    const r = evaluateSealedOpenVsKeep(5, slots, fees);
    expect(r.label).toBe('Favor opening');
  });

  it('returns neutral when every slot excluded', () => {
    const slots: SealedPullSlot[] = [
      {
        slotId: 'x',
        tableIndex: 0,
        rowIndex: 0,
        label: 'Skip',
        probability: 1,
        resaleUsd: 10,
        excludeFromEv: true,
      },
    ];
    const r = evaluateSealedOpenVsKeep(10, slots, fees);
    expect(r.label).toMatch(/No slots in EV/i);
  });
});
