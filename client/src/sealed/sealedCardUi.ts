import type { Card } from '../types';

export const isSealedCard = (c: Pick<Card, 'portfolioKind'>): boolean => c.portfolioKind === 'sealed';

export const showPresaleBadge = (releaseDateMs: number | null | undefined): boolean => {
  if (releaseDateMs == null || !Number.isFinite(releaseDateMs) || releaseDateMs <= 0) return false;
  return releaseDateMs > Date.now();
};
