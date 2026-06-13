import { describe, expect, it } from 'vitest';
import { ebayNkwFromUrl, tcgProductIdFromUrl, verifyTabUrlForQuickFetch } from './tabUrlVerify';

describe('tabUrlVerify', () => {
  it('matches TCG product id ignoring query', () => {
    const target = 'https://www.tcgplayer.com/product/12345/pokemon-card';
    const actual = 'https://www.tcgplayer.com/product/12345/foo?bar=1';
    expect(tcgProductIdFromUrl(target)).toBe('12345');
    expect(
      verifyTabUrlForQuickFetch({ kind: 'tcgplayer', targetUrl: target, actualUrl: actual }).ok
    ).toBe(true);
  });

  it('matches eBay _nkw', () => {
    const target =
      'https://www.ebay.com/sch/i.html?_nkw=test+card&LH_Sold=1&LH_Complete=1';
    const actual =
      'https://www.ebay.com/sch/i.html?_nkw=test+card&_pgn=2&LH_Sold=1&LH_Complete=1';
    expect(ebayNkwFromUrl(target)).toBe('test card');
    expect(
      verifyTabUrlForQuickFetch({ kind: 'ebay', targetUrl: target, actualUrl: actual }).ok
    ).toBe(true);
  });
});
