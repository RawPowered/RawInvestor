/** Mirrors server/src/ebaySearchQuery.ts — keep in sync. */

export const buildEbaySearchQuery = (c: {
  name?: string | null;
  set?: string | null;
  cardNumber?: string | null;
}): string => {
  const parts = [c.name, c.cardNumber, c.set]
    .map((p) => String(p ?? '').trim())
    .filter(Boolean);
  return (
    parts
      .join(' ')
      .replace(/\s*\(\d+\)\s*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'pokemon card'
  );
};

export const ebaySoldSearchUrlForQuery = (q: string): string => {
  const cleaned = q.trim() || 'pokemon card';
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(cleaned)}&LH_Sold=1&LH_Complete=1`;
};

export const ebaySoldSearchUrlFromCardFields = (c: {
  name?: string | null;
  set?: string | null;
  cardNumber?: string | null;
}): string => ebaySoldSearchUrlForQuery(buildEbaySearchQuery(c));
