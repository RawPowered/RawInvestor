import type { PriceChartingCollectionRow } from '../pricechartingBulkImport';

export const normalizePcUrl = (url: string | null | undefined): string | null => {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (!/pricecharting\.com$/i.test(u.hostname)) return null;
    return u.pathname.replace(/\/+$/, '').toLowerCase();
  } catch {
    return null;
  }
};

export const slugifyPcPart = (input: string): string =>
  input
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9#\s-]/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Trim, strip trailing slash, and map m.pricecharting.com → www for API/scraper consistency. */
export const normalizePricechartingFetchUrl = (raw: string): string | null => {
  const t = raw.trim().replace(/\/+$/, '');
  if (!t) return null;
  try {
    const u = new URL(t);
    if (!/^([a-z0-9-]+\.)*pricecharting\.com$/i.test(u.hostname)) return null;
    if (/^m\.pricecharting\.com$/i.test(u.hostname)) u.hostname = 'www.pricecharting.com';
    return u.toString();
  } catch {
    return null;
  }
};

export const buildPcUrlFromCollectionRow = (row: PriceChartingCollectionRow): string | null => {
  const setSlug = slugifyPcPart(row.consoleName);
  const nameRaw = row.productName.trim();
  const m = nameRaw.match(/^(.*?)\s*#\s*([a-z0-9-]+)\s*$/i);
  if (!setSlug || !m) return null;
  const nameSlug = slugifyPcPart(m[1]);
  const number = m[2].toLowerCase();
  if (!nameSlug || !number) return null;
  return `https://www.pricecharting.com/game/${setSlug}/${nameSlug}-${number}`;
};
