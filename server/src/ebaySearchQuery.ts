/**
 * Canonical eBay keyword query for a card (matches client sold-search `_nkw`).
 */
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

export const ebaySoldSearchUrlForCard = (c: {
  name?: string | null;
  set?: string | null;
  cardNumber?: string | null;
}): string => ebaySoldSearchUrlForQuery(buildEbaySearchQuery(c));
