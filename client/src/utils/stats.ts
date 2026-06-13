import type { Card } from '../types';
import type { EnrichedCard } from '../sort';

export const entryPointForCard = (c: Card): number => {
  const paid = typeof c.actualCost === 'number' && c.actualCost > 0 ? c.actualCost : c.raw;
  const inbound = c.freeShipping ? 0 : Number(c.shippingCost) || 0;
  return paid + inbound;
};

export const championRosterScore = (c: EnrichedCard): number => {
  const entry = entryPointForCard(c);
  const hasPotential = typeof c.potentialValue === 'number' && Number.isFinite(c.potentialValue);
  if (!hasPotential || entry <= 0) return c.metrics.ev;
  const potentialNet = (c.potentialValue as number) - entry;
  const potentialRoiPct = (potentialNet / entry) * 100;
  return potentialNet + potentialRoiPct * 0.35;
};

export const quantileLocal = (sortedAsc: number[], q: number): number | null => {
  if (!sortedAsc.length) return null;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const clamped = Math.min(1, Math.max(0, q));
  const pos = clamped * (sortedAsc.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedAsc[lo];
  const frac = pos - lo;
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * frac;
};

export const medianLocal = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return quantileLocal(s, 0.5);
};
