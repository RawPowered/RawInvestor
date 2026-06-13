/**
 * Single source of truth for PriceCharting product URLs (matches GET /api/scrape).
 */
export const canonicalizePricechartingUrl = (raw: string): string | null => {
  let url = String(raw || '')
    .trim()
    .replace(/\/+$/, '');
  try {
    const u = new URL(url);
    if (!/^([a-z0-9-]+\.)*pricecharting\.com$/i.test(u.hostname)) return null;
    if (/^m\.pricecharting\.com$/i.test(u.hostname)) u.hostname = 'www.pricecharting.com';
    return u.toString();
  } catch {
    return null;
  }
};
