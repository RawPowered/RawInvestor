import type { EbayActiveListing, Target, TargetProbe } from '../types';

const sameProbe = (a: TargetProbe | undefined, b: TargetProbe): boolean => {
  if (!a) return false;
  return (
    a.endsAtMs === b.endsAtMs &&
    a.currentBid === b.currentBid &&
    a.buyItNow === b.buyItNow &&
    a.highBidderAboveThreshold === b.highBidderAboveThreshold &&
    a.parseOk === b.parseOk
  );
};

export const buildTargetProbe = (row: EbayActiveListing, target: Pick<Target, 'maxBidUsd' | 'maxBinUsd'>): TargetProbe => {
  const currentBid =
    typeof row.currentBid === 'number' && Number.isFinite(row.currentBid) && row.currentBid > 0 ? row.currentBid : null;
  const buyItNow =
    typeof row.buyItNow === 'number' && Number.isFinite(row.buyItNow) && row.buyItNow > 0 ? row.buyItNow : null;
  const endsAtMs =
    typeof row.endsAtMs === 'number' && Number.isFinite(row.endsAtMs) && row.endsAtMs > 0 ? row.endsAtMs : null;
  const price = typeof row.price === 'number' && Number.isFinite(row.price) && row.price > 0 ? row.price : null;

  const maxBid = target.maxBidUsd;
  const maxBin = target.maxBinUsd ?? target.maxBidUsd;

  const bidLike = currentBid ?? (row.listingKind === 'auction' ? price : null);
  const binLike = buyItNow ?? (row.listingKind === 'bin' ? price : null);

  let highBidderAboveThreshold = false;
  if (bidLike != null && bidLike > maxBid) highBidderAboveThreshold = true;
  if (binLike != null && binLike > maxBin) highBidderAboveThreshold = true;

  const parseOk = endsAtMs != null || bidLike != null || binLike != null;

  return {
    atMs: Date.now(),
    currentBid,
    buyItNow,
    endsAtMs,
    parseOk,
    highBidderAboveThreshold,
  };
};

export const targetProbeUnchanged = (prev: TargetProbe | undefined, next: TargetProbe): boolean =>
  sameProbe(prev, next);
