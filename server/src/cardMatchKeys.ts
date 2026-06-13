import { normalizeForMatch } from './extensionCapture.js';

const tcgProductId = (raw: string): string | null => {
  try {
    const u = new URL(String(raw || '').trim());
    if (!/^tcgplayer\.com$/i.test(u.hostname.replace(/^www\./, ''))) return null;
    const m = u.pathname.match(/\/product\/(\d+)/i);
    return m ? m[1] : null;
  } catch {
    return null;
  }
};

export const resolveTcgUrl = (card: Record<string, unknown>): string => {
  const u = String(card.tcgplayerUrl ?? '').trim();
  if (/^https?:\/\/(www\.)?tcgplayer\.com\/product\/\d+/i.test(u)) {
    return u.split('#')[0].split('?')[0];
  }
  const s = card.tcgplayerSummary as Record<string, unknown> | null | undefined;
  const su = s && typeof s.url === 'string' ? s.url.trim() : '';
  if (/^https?:\/\/(www\.)?tcgplayer\.com\/product\/\d+/i.test(su)) {
    return su.split('#')[0].split('?')[0];
  }
  return '';
};

const ebaySoldSearchUrlForCard = (card: Record<string, unknown>): string => {
  const parts = [card.name, card.cardNumber, card.set]
    .map((x) => String(x ?? '').trim())
    .filter(Boolean);
  const q = parts.join(' ').replace(/\s+/g, ' ').trim() || 'pokemon card';
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}&LH_Sold=1&LH_Complete=1`;
};

const ebaySearchUrlForCard = (card: Record<string, unknown>): string => {
  const parts = [card.name, card.cardNumber, card.set]
    .map((x) => String(x ?? '').trim())
    .filter(Boolean);
  const q = parts.join(' ').replace(/\s+/g, ' ').trim() || 'pokemon card';
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}`;
};

/**
 * Denormalized keys for SQL indexing + extension merge targeting.
 */
export const buildCardMatchKeys = (card: Record<string, unknown>) => {
  const pcUrl = String(card.url ?? '').trim();
  const normPc = pcUrl ? normalizeForMatch(pcUrl) : '';

  const tcgUrl = resolveTcgUrl(card);
  const normTcg = tcgUrl ? normalizeForMatch(tcgUrl) : '';
  const tcgPid = tcgProductId(tcgUrl) || tcgProductId(pcUrl) || null;

  const ebaySold = normalizeForMatch(ebaySoldSearchUrlForCard(card));
  const ebayActive = normalizeForMatch(ebaySearchUrlForCard(card));

  return {
    normPcUrl: normPc || null,
    normTcgUrl: normTcg || null,
    tcgProductId: tcgPid,
    ebaySoldNorm: ebaySold || null,
    ebayActiveNorm: ebayActive || null,
  };
};
