import type { TcgplayerSelfPricePoint } from './types';

const MAX = 500;

/** Append a TCGplayer market snapshot; skips noisy duplicates (same price within 2 min). */
export const appendTcgplayerSelfSample = (
  existing: TcgplayerSelfPricePoint[] | undefined,
  marketPrice: number,
  at: number
): TcgplayerSelfPricePoint[] => {
  if (!Number.isFinite(marketPrice) || marketPrice < 0 || !Number.isFinite(at)) {
    return [...(existing ?? [])];
  }
  const cur = [...(existing ?? [])];
  const last = cur[cur.length - 1];
  if (
    last &&
    Math.abs(last.marketPrice - marketPrice) < 1e-6 &&
    at - last.at < 2 * 60 * 1000
  ) {
    return cur;
  }
  cur.push({ at, marketPrice });
  return cur.slice(-MAX);
};
