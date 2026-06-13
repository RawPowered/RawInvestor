import type { SealedPullSlot } from '../types';

/** Scale probabilities on non-excluded slots so Σp = 1 (only rows with numeric probability). */
export const renormalizeSealedSlotProbabilities = (slots: SealedPullSlot[]): SealedPullSlot[] => {
  const active = slots.filter((s) => !s.excludeFromEv && s.probability != null && Number.isFinite(s.probability));
  const sum = active.reduce((a, s) => a + (s.probability ?? 0), 0);
  if (!Number.isFinite(sum) || sum <= 0) return slots;
  return slots.map((s) => {
    if (s.excludeFromEv || s.probability == null || !Number.isFinite(s.probability)) return s;
    return { ...s, probability: Math.min(1, Math.max(0, (s.probability / sum))) };
  });
};
