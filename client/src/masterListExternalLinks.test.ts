import { describe, it, expect } from 'vitest';
import {
  ebayListingUrlForRow,
  ebaySearchUrlForCard,
  ebaySoldSearchUrlForCard,
  ebaySoldSearchUrlForCardWithGraded,
  ebaySoldSearchUrlForItemId,
  resolveEbayListingItemId,
  resolveTcgplayerProductUrl,
} from './masterListExternalLinks';

describe('ebaySearchUrlForCard', () => {
  it('builds eBay search URL from name and set', () => {
    const u = ebaySearchUrlForCard({ name: 'Pikachu', set: 'Base', cardNumber: '58' });
    expect(u).toContain('https://www.ebay.com/sch/i.html');
    expect(decodeURIComponent(u.split('_nkw=')[1]?.split('&')[0] ?? '')).toContain('Pikachu');
  });
});

describe('ebaySoldSearchUrlForCard', () => {
  it('adds sold + completed filters', () => {
    const u = ebaySoldSearchUrlForCard({ name: 'Mew', set: 'Promo', cardNumber: '1' });
    expect(u).toContain('LH_Sold=1');
    expect(u).toContain('LH_Complete=1');
  });
});

describe('ebaySoldSearchUrlForCardWithGraded', () => {
  it('adds Graded facet param', () => {
    const card = { name: 'Eevee', set: 'SVP', cardNumber: '173' };
    expect(ebaySoldSearchUrlForCardWithGraded(card, 'no')).toContain('Graded=No');
    expect(ebaySoldSearchUrlForCardWithGraded(card, 'yes')).toContain('Graded=Yes');
  });
});

describe('resolveEbayListingItemId', () => {
  it('prefers itemId field', () => {
    expect(resolveEbayListingItemId({ itemId: '1234567890', itemUrl: null })).toBe('1234567890');
  });

  it('extracts id from itemUrl when field missing', () => {
    expect(
      resolveEbayListingItemId({
        itemId: null,
        itemUrl: 'https://www.ebay.com/itm/206082095308?hash=abc',
      })
    ).toBe('206082095308');
  });
});

describe('ebayListingUrlForRow', () => {
  it('builds canonical itm URL from embedded id', () => {
    expect(
      ebayListingUrlForRow({
        itemId: null,
        itemUrl: 'https://www.ebay.com/itm/1234567890',
      })
    ).toBe('https://www.ebay.com/itm/1234567890');
  });

  it('falls back to itemUrl when no id', () => {
    expect(
      ebayListingUrlForRow({
        itemId: null,
        itemUrl: 'https://www.ebay.com/sch/i.html?_nkw=test',
      })
    ).toBe('https://www.ebay.com/sch/i.html?_nkw=test');
  });
});

describe('ebaySoldSearchUrlForItemId', () => {
  it('returns sold SERP with item id as query when valid', () => {
    const u = ebaySoldSearchUrlForItemId('1234567890');
    expect(u).toContain('LH_Sold=1');
    expect(u).toContain('LH_Complete=1');
    expect(u).toContain(encodeURIComponent('1234567890'));
  });

  it('returns null for invalid id', () => {
    expect(ebaySoldSearchUrlForItemId('')).toBeNull();
    expect(ebaySoldSearchUrlForItemId('12')).toBeNull();
  });
});

describe('resolveTcgplayerProductUrl', () => {
  it('reads product URL from tcgplayerUrl as Near Mint link', () => {
    expect(
      resolveTcgplayerProductUrl({
        tcgplayerUrl: 'https://www.tcgplayer.com/product/1/foo?x=1',
        tcgplayerSummary: null,
      })
    ).toBe('https://www.tcgplayer.com/product/1?Language=English&Condition=Near+Mint&page=1');
  });

  it('falls back to summary url as Near Mint link', () => {
    expect(
      resolveTcgplayerProductUrl({
        tcgplayerUrl: '',
        tcgplayerSummary: {
          productId: 1,
          productName: 'x',
          setName: '',
          rarityName: null,
          marketPrice: 1,
          lowestPrice: null,
          lowestPriceWithShipping: null,
          medianPrice: null,
          listings: null,
          sellers: null,
          url: 'https://www.tcgplayer.com/product/99/',
          fetchedAt: 0,
        },
      })
    ).toBe('https://www.tcgplayer.com/product/99?Language=English&Condition=Near+Mint&page=1');
  });
});
