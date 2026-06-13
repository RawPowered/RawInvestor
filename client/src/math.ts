import type { Card, CardMetrics, Fees } from './types';

export const DEFAULT_FEES: Fees = {
  gradingFee: 25,
  shipToGrader: 15,
  shipFromGrader: 0,
  saleFeePct: 0.1325,
  saleFeeFlat: 0.3,
  shipToBuyer: 5,
};

export const DEFAULT_PROBS = { p10: 0.3, p9: 0.5 } as const;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Net revenue after sale fees + outbound shipping (before cost basis). */
export const revenueAt = (salePrice: number, fees: Fees): number => {
  if (!salePrice) return 0;
  return salePrice * (1 - fees.saleFeePct) - fees.saleFeeFlat - fees.shipToBuyer;
};

export const computeMetrics = (card: Card, fees: Fees): CardMetrics => {
  const raw = Number(card.raw) || 0;
  const grade9 = Number(card.grade9) || 0;
  const psa10 = Number(card.psa10) || 0;

  // Use the amount YOU paid for this copy if we have it; fall back to raw
  // market price for cards that predate the "Paid" column.
  const purchasePrice =
    typeof card.actualCost === 'number' && card.actualCost > 0
      ? card.actualCost
      : raw;

  // Inbound shipping (what you paid to receive the card). Zeroed out when the
  // "FREE" toggle is on, regardless of the stored number.
  const inboundShipping = card.freeShipping
    ? 0
    : Number(card.shippingCost) || 0;

  const rawOnlyBasis = purchasePrice + inboundShipping;

  const isSealed = card.portfolioKind === 'sealed';

  const totalInvested = isSealed
    ? rawOnlyBasis
    : purchasePrice +
      inboundShipping +
      fees.gradingFee +
      fees.shipToGrader +
      fees.shipFromGrader;

  const revenue10 = revenueAt(psa10, fees);
  const revenue9 = revenueAt(grade9, fees);
  const revenueFail = revenueAt(raw, fees);

  const netRawNoGrade = revenueFail - rawOnlyBasis;

  const net10 = psa10 ? revenue10 - totalInvested : -totalInvested;
  const net9 = grade9 ? revenue9 - totalInvested : -totalInvested;
  const netFail = revenueFail - totalInvested;

  let p10 = clamp01(card.p10);
  let p9 = clamp01(card.p9);
  if (isSealed) {
    p10 = 0;
    p9 = 0;
  }
  const pFail = clamp01(1 - p10 - p9);

  const ev = p10 * net10 + p9 * net9 + pFail * netFail;
  const roiPct = totalInvested > 0 ? (ev / totalInvested) * 100 : 0;

  return {
    totalInvested: round2(totalInvested),
    net10: round2(net10),
    net9: round2(net9),
    netFail: round2(netFail),
    pFail: round2(pFail),
    ev: round2(ev),
    roiPct: round2(roiPct),
    netRawNoGrade: round2(netRawNoGrade),
    revenue10: round2(revenue10),
    revenue9: round2(revenue9),
    revenueFail: round2(revenueFail),
  };
};

/**
 * Derive p10 / p9 from PSA population counts. Anything below PSA 9 counts as
 * the "fail" outcome for EV purposes.
 */
export const probsFromPsaPop = (
  grades: Array<{ grade: string; population: number; qualifiedPopulation: number }>
): { p10: number; p9: number; total: number } => {
  let p10Count = 0;
  let p9Count = 0;
  let total = 0;
  for (const g of grades) {
    const n = g.population + g.qualifiedPopulation;
    total += n;
    const label = g.grade;
    if (/\b10\b/.test(label)) p10Count += n;
    else if (/\b9(?:\.5)?\b/.test(label)) p9Count += n;
  }
  if (total === 0) return { p10: 0, p9: 0, total: 0 };
  return {
    p10: round2(p10Count / total),
    p9: round2(p9Count / total),
    total,
  };
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export const fmtMoney = (n: number): string => {
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

export const fmtPct = (n: number): string =>
  `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
