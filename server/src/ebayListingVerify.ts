/**
 * Heuristic match between a portfolio card and an eBay listing title (sold search comp).
 * Used to flag suspicious high RAW comps before archiving.
 */
export const scoreListingTitleMatch = (input: {
  name: string;
  set?: string;
  cardNumber?: string;
  listingTitle: string;
}): { ok: boolean; reason: string } => {
  const title = String(input.listingTitle || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (!title.trim()) return { ok: false, reason: 'empty_title' };

  const nameWords = String(input.name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/g, ''))
    .filter((w) => w.length > 2);
  const hits = nameWords.filter((w) => w.length && title.includes(w)).length;
  const ratio = nameWords.length ? hits / nameWords.length : 0;
  if (nameWords.length >= 2 && ratio < 0.35) {
    return { ok: false, reason: 'title_name_mismatch' };
  }

  const num = String(input.cardNumber || '').trim();
  if (num.length >= 2) {
    const nNorm = num.toLowerCase().replace(/[^a-z0-9]/g, '');
    const reSlash = new RegExp(`\\b${num.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    const inTitle =
      title.includes(num.toLowerCase()) ||
      (nNorm.length >= 2 && title.includes(nNorm)) ||
      reSlash.test(input.listingTitle);
    if (!inTitle) {
      return { ok: false, reason: 'card_number_missing' };
    }
  }

  const setStr = String(input.set || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (setStr.length >= 4) {
    const setWords = setStr.split(/\s+/).filter((w) => w.length > 3);
    if (setWords.length >= 2) {
      const setHit = setWords.some((w) => title.includes(w));
      if (!setHit) return { ok: false, reason: 'set_hint_missing' };
    }
  }

  return { ok: true, reason: 'ok' };
};

const decodeBasicEntities = (s: string): string =>
  String(s || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');

export const extractListingTitleFromEbayItemHtml = (html: string): string | null => {
  const og = html.match(/property=["']og:title["']\s+content=["']([^"']+)["']/i);
  if (og?.[1]) return decodeBasicEntities(og[1]).trim();
  const tw = html.match(/property=["']twitter:title["']\s+content=["']([^"']+)["']/i);
  if (tw?.[1]) return decodeBasicEntities(tw[1]).trim();
  const m = html.match(/<title[^>]*>([^<]{6,400})<\/title>/i);
  return m?.[1] ? decodeBasicEntities(m[1]).replace(/\s+/g, ' ').trim() : null;
};

export const fetchEbayItemPageTitle = async (itemUrl: string): Promise<string | null> => {
  const res = await fetch(itemUrl, {
    redirect: 'follow',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!res.ok) return null;
  const html = await res.text();
  return extractListingTitleFromEbayItemHtml(html);
};
