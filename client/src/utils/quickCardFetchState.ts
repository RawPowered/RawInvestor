import type { Card } from '../types';

/** Card has had at least one successful Full Fetch (explicit stamp or legacy deep eBay capture). */
export function hasCompletedFullFetch(card: Card | null | undefined): boolean {
  if (!card) return false;
  if (typeof card.lastFullFetchAt === 'number' && card.lastFullFetchAt > 0) return true;
  return card.ebayExtensionSnapshot?.captureMode === 'deep';
}

export type QuickCardFetchMode = 'quick' | 'full';
