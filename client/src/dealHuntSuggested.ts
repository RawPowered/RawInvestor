import type { EbayActiveListing } from './types';

export const listingFitsSuggestedWatch = (
  row: EbayActiveListing,
  maxBidUsd: number,
  rawOnly: boolean
): boolean => {
  if (!(maxBidUsd > 0)) return false;
  const price =
    typeof row.currentBid === 'number' && Number.isFinite(row.currentBid) && row.currentBid > 0
      ? row.currentBid
      : row.price;
  if (!(price > 0) || price > maxBidUsd) return false;
  if (rawOnly && row.isGraded === true) return false;
  return true;
};
