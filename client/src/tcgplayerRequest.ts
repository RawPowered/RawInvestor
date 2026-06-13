import { apiUrl } from './apiBase';

export const TCGPLAYER_NEAR_MINT_LANGUAGE = 'English';
export const TCGPLAYER_NEAR_MINT_CONDITION = 'Near Mint';
export const TCGPLAYER_NEAR_MINT_PAGE = '1';

const extractTcgplayerProductId = (url: string): number | null => {
  const m = url.trim().match(/tcgplayer\.com\/product\/(\d+)/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Canonical Near Mint product URL — strips slug, Printing, and other query params. */
export const ensureTcgplayerNearMintUrl = (productUrl: string): string => {
  const id = extractTcgplayerProductId(productUrl);
  if (!id) return productUrl.trim();
  const u = new URL(`https://www.tcgplayer.com/product/${id}`);
  u.searchParams.set('Language', TCGPLAYER_NEAR_MINT_LANGUAGE);
  u.searchParams.set('Condition', TCGPLAYER_NEAR_MINT_CONDITION);
  u.searchParams.set('page', TCGPLAYER_NEAR_MINT_PAGE);
  return u.toString();
};

export const buildTcgplayerProductFetchUrl = (productUrl: string, now = Date.now()): string =>
  apiUrl(
    `/api/tcgplayer/product?url=${encodeURIComponent(ensureTcgplayerNearMintUrl(productUrl))}&forceRefresh=${now}`
  );
