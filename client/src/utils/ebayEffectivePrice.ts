import type { EbayExtensionListing } from '../types';

/** Prefer per-unit price when captured (multi-lot listings); else total sale price. */
export const ebayEffectivePrice = (r: Pick<EbayExtensionListing, 'price' | 'unitPrice'>): number => {
  const unit = Number(r.unitPrice);
  if (Number.isFinite(unit) && unit > 0) return unit;
  return Number(r.price);
};
