import type { Card, TcgComparisonMarketPrices } from './types';

type TcgPriceCard = Pick<Card, 'tcgplayerSummary' | 'tcgplayerSalesSnapshot'>;

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;

export const resolveNmFromComparison = (
  comparison?: TcgComparisonMarketPrices | null
): number | null => num(comparison?.nearMint);

/** Headline TCG market price — always Near Mint English when available. */
export const resolveTcgDisplayMarketPrice = (card: TcgPriceCard): number | null => {
  const fromSummary = num(card.tcgplayerSummary?.marketPrice);
  if (fromSummary != null) return fromSummary;
  const fromComparison = resolveNmFromComparison(card.tcgplayerSalesSnapshot?.comparisonMarketPrices);
  if (fromComparison != null) return fromComparison;
  return null;
};

export const resolveTcgCapturedMarketPrice = (card: TcgPriceCard): number | null => {
  const snap = card.tcgplayerSalesSnapshot;
  if (!snap) return null;
  return (
    num(snap.pricePoints.capturedMarketPrice) ??
    num(snap.pricePoints.marketPrice)
  );
};

export const tcgCapturedDiffersFromDisplay = (card: TcgPriceCard): boolean => {
  const display = resolveTcgDisplayMarketPrice(card);
  const captured = resolveTcgCapturedMarketPrice(card);
  if (display == null || captured == null) return false;
  return Math.abs(display - captured) >= 0.005;
};
