export const buildGemRateQuery = (c: {
  name: string;
  set: string;
  cardNumber?: string;
}): string =>
  [c.name, c.cardNumber, c.set]
    .map((p) => (p ?? '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s*\(\d+\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

import { buildEbaySearchQuery } from './ebaySearchQuery';

export const buildEbayQuery = (c: {
  name: string;
  set: string;
  cardNumber?: string;
}): string => buildEbaySearchQuery(c);
