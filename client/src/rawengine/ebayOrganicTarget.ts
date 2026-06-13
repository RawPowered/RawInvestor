/** Parsed eBay sold-search target URL for organic navigation + tests. */

export type EbaySoldTargetParsed = {
  nkwDecoded: string;
  graded: 'Yes' | 'No' | null;
  lhSold: boolean;
  lhComplete: boolean;
};

export function parseEbaySoldTargetUrl(targetUrl: string): EbaySoldTargetParsed | null {
  try {
    const u = new URL(String(targetUrl || '').trim());
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (host !== 'ebay.com' && host !== 'm.ebay.com') return null;
    const nkw = u.searchParams.get('_nkw');
    if (nkw == null || nkw === '') return null;
    const gradedRaw = u.searchParams.get('Graded');
    const graded = gradedRaw === 'Yes' || gradedRaw === 'No' ? gradedRaw : null;
    return {
      nkwDecoded: decodeURIComponent(nkw).replace(/\+/g, ' '),
      graded,
      lhSold: u.searchParams.get('LH_Sold') === '1',
      lhComplete: u.searchParams.get('LH_Complete') === '1',
    };
  } catch {
    return null;
  }
}
