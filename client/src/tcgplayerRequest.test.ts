import { describe, expect, it } from 'vitest';
import { buildTcgplayerProductFetchUrl, ensureTcgplayerNearMintUrl } from './tcgplayerRequest';

describe('ensureTcgplayerNearMintUrl', () => {
  it('normalizes bare product URL to Near Mint params', () => {
    expect(ensureTcgplayerNearMintUrl('https://www.tcgplayer.com/product/662195')).toBe(
      'https://www.tcgplayer.com/product/662195?Language=English&Condition=Near+Mint&page=1'
    );
  });

  it('strips Printing and slug from input URL', () => {
    const out = ensureTcgplayerNearMintUrl(
      'https://www.tcgplayer.com/product/517047/pokemon?Language=English&Condition=Near+Mint&Printing=Holofoil'
    );
    const u = new URL(out);
    expect(u.pathname).toBe('/product/517047');
    expect(u.searchParams.get('Condition')).toBe('Near Mint');
    expect(u.searchParams.get('Printing')).toBeNull();
  });
});

describe('buildTcgplayerProductFetchUrl', () => {
  it('encodes Near Mint URL + forceRefresh', () => {
    const input = 'https://www.tcgplayer.com/product/517047/pokemon';
    const out = buildTcgplayerProductFetchUrl(input, 123456789);
    expect(out).toContain('/api/tcgplayer/product?url=');
    expect(out).toContain(encodeURIComponent(ensureTcgplayerNearMintUrl(input)));
    expect(out).toContain('forceRefresh=123456789');
  });
});
