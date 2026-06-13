/** Verify embedded RawEngine tabs match the Quick Fetch target (TCG product id, eBay _nkw). */

export type CaptureSiteKind = 'tcgplayer' | 'ebay';

const truncateUrl = (url: string, max = 120): string => {
  const s = String(url || '');
  return s.length <= max ? s : `${s.slice(0, max)}…`;
};

export const tcgProductIdFromUrl = (url: string): string | null => {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/product\/(\d+)/i);
    return m ? m[1] : null;
  } catch {
    return null;
  }
};

export const ebayNkwFromUrl = (url: string): string | null => {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (host !== 'ebay.com' && host !== 'm.ebay.com') return null;
    const nkw = u.searchParams.get('_nkw');
    if (nkw == null || nkw === '') return null;
    return nkw;
  } catch {
    return null;
  }
};

export const verifyTabUrlForQuickFetch = (args: {
  kind: CaptureSiteKind;
  targetUrl: string;
  actualUrl: string;
}): { ok: true } | { ok: false; reason: string } => {
  const { kind, targetUrl, actualUrl } = args;
  if (!actualUrl || actualUrl === 'about:blank') {
    return { ok: false, reason: 'Tab has no loaded URL' };
  }
  if (kind === 'tcgplayer') {
    const want = tcgProductIdFromUrl(targetUrl);
    const got = tcgProductIdFromUrl(actualUrl);
    if (!want) return { ok: false, reason: 'Invalid target TCG URL' };
    if (!got) {
      return {
        ok: false,
        reason: `Expected TCGPlayer product page, got: ${truncateUrl(actualUrl)}`,
      };
    }
    if (want !== got) {
      return {
        ok: false,
        reason: `TCG product id mismatch (expected ${want}, tab shows ${got})`,
      };
    }
    return { ok: true };
  }
  const wantNkw = ebayNkwFromUrl(targetUrl);
  const gotNkw = ebayNkwFromUrl(actualUrl);
  if (!wantNkw) return { ok: false, reason: 'Invalid target eBay URL' };
  if (!gotNkw) {
    return {
      ok: false,
      reason: `Expected eBay search URL, got: ${truncateUrl(actualUrl)}`,
    };
  }
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  if (norm(wantNkw) !== norm(gotNkw)) {
    return {
      ok: false,
      reason: `eBay _nkw mismatch (expected "${wantNkw.slice(0, 96)}", tab has "${gotNkw.slice(0, 96)}")`,
    };
  }
  return { ok: true };
};
