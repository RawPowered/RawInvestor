import type { Card, Fees, HuntCriteria, Target } from './types';
import { computeMetrics } from './math';

export type DealHuntThresholdSuggestion = {
  maxBidUsd: number;
  maxBinUsd: number;
  reason: string;
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

export const suggestDealHuntThresholds = (card: Card, fees: Fees): DealHuntThresholdSuggestion => {
  const metrics = computeMetrics(card, fees);
  const soldMedian = card.ebaySales?.median ?? null;
  const raw = Number(card.raw) || 0;
  const base = soldMedian && soldMedian > 0 ? soldMedian : raw;
  const bidFromBase = base * 0.88;
  const bidFromEv = Math.max(0, metrics.revenueFail * 0.9);
  const maxBidUsd = round2(Math.max(0, Math.min(bidFromBase || 0, bidFromEv || bidFromBase || 0)));
  const maxBinUsd = round2(maxBidUsd * 1.05);
  return {
    maxBidUsd,
    maxBinUsd,
    reason: soldMedian
      ? 'Anchored to eBay sold median with EV safety buffer.'
      : 'Anchored to raw market price with EV safety buffer.',
  };
};

export const buildTargetFromUrl = (
  listingUrl: string,
  cardId: string | undefined,
  huntId: string | undefined,
  suggestion: DealHuntThresholdSuggestion
): Target => ({
  id: crypto.randomUUID(),
  listingUrl: listingUrl.trim(),
  itemId: (listingUrl.match(/\/itm\/(\d{6,})/i) || [])[1],
  cardId,
  huntId,
  label: '',
  maxBidUsd: suggestion.maxBidUsd,
  maxBinUsd: suggestion.maxBinUsd,
  sniperEnabled: false,
  sniperLeadMs: 1500,
  armed: false,
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

export const mergeHuntCriteria = (
  suggestion: DealHuntThresholdSuggestion,
  criteria?: HuntCriteria
): DealHuntThresholdSuggestion => ({
  maxBidUsd: criteria?.maxBidUsd ?? suggestion.maxBidUsd,
  maxBinUsd: criteria?.maxBinUsd ?? suggestion.maxBinUsd,
  reason: suggestion.reason,
});
