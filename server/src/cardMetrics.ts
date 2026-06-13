/** Mirrors client `math.ts` computeMetrics + sort helpers for cached columns on the server. */

export type Fees = {
  gradingFee: number;
  shipToGrader: number;
  shipFromGrader: number;
  saleFeePct: number;
  saleFeeFlat: number;
  shipToBuyer: number;
};

export const DEFAULT_FEES: Fees = {
  gradingFee: 25,
  shipToGrader: 15,
  shipFromGrader: 0,
  saleFeePct: 0.1325,
  saleFeeFlat: 0.3,
  shipToBuyer: 5,
};

export type CardMetrics = {
  totalInvested: number;
  net10: number;
  net9: number;
  netFail: number;
  pFail: number;
  ev: number;
  roiPct: number;
  netRawNoGrade: number;
};

export type CardLike = {
  raw?: number;
  grade9?: number;
  psa10?: number;
  p10?: number;
  p9?: number;
  actualCost?: number;
  shippingCost?: number;
  freeShipping?: boolean;
  potentialValue?: number;
  /** Sealed products: no grading spend in basis; EV uses sell-as-sealed (raw) only. */
  portfolioKind?: string;
};

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export const revenueAt = (salePrice: number, fees: Fees): number => {
  if (!salePrice) return 0;
  return salePrice * (1 - fees.saleFeePct) - fees.saleFeeFlat - fees.shipToBuyer;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export const computeMetrics = (card: CardLike, fees: Fees): CardMetrics => {
  const raw = Number(card.raw) || 0;
  const grade9 = Number(card.grade9) || 0;
  const psa10 = Number(card.psa10) || 0;

  const purchasePrice =
    typeof card.actualCost === 'number' && card.actualCost > 0 ? card.actualCost : raw;

  const inboundShipping = card.freeShipping ? 0 : Number(card.shippingCost) || 0;

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

  let p10 = clamp01(Number(card.p10) || 0);
  let p9 = clamp01(Number(card.p9) || 0);
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
  };
};

const entryPoint = (c: CardLike): number => {
  const raw = Number(c.raw) || 0;
  const paid = typeof c.actualCost === 'number' && c.actualCost > 0 ? c.actualCost : raw;
  const ship = c.freeShipping ? 0 : Number(c.shippingCost) || 0;
  return paid + ship;
};

export const truePossibleRoiPct = (c: CardLike & { potentialValue?: number }): number => {
  const potential = c.potentialValue;
  const entry = entryPoint(c);
  if (typeof potential !== 'number' || !Number.isFinite(potential) || entry <= 0) return NaN;
  return ((potential - entry) / entry) * 100;
};

export const rawUngradedRoiPct = (c: CardLike): number => {
  const entry = entryPoint(c);
  if (entry <= 0) return NaN;
  const raw = Number(c.raw) || 0;
  return ((raw - entry) / entry) * 100;
};

export const upsidePsa10MinusRaw = (c: CardLike): number => {
  const psa10 = Number(c.psa10) || 0;
  const raw = Number(c.raw) || 0;
  return psa10 - raw;
};
