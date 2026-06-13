import { describe, expect, it } from 'vitest';
import { dedupeEbayListings, mergeDualGradedEbayCaptures } from './ebayQuickFetch';
import type { EbayExtensionListing } from '../types';

describe('mergeDualGradedEbayCaptures', () => {
  it('dedupes listings across graded passes by item id', () => {
    const shared: EbayExtensionListing = {
      title: 'Test Card',
      price: 10,
      soldAt: Date.now(),
      itemId: '12345',
      itemUrl: 'https://www.ebay.com/itm/12345',
      isGraded: false,
    };
    const capNo = {
      data: {
        listings: [shared],
        query: 'pikachu',
        captureStats: { pagesScanned: 2, gradedFacetApplied: true },
      },
    };
    const capYes = {
      data: {
        listings: [{ ...shared, price: 11 }],
        query: 'pikachu',
        captureStats: { pagesScanned: 3, gradedFacetApplied: true },
      },
    };
    const merged = mergeDualGradedEbayCaptures(
      capNo,
      capYes,
      'https://www.ebay.com/sch/i.html?_nkw=pikachu&LH_Sold=1&LH_Complete=1'
    );
    expect(merged.listings.length).toBe(1);
    expect(merged.ebayDualCaptureStats?.gradedNoRows).toBe(1);
    expect(merged.ebayDualCaptureStats?.gradedYesRows).toBe(1);
  });

  it('infers graded ACE from title when extension leaves isGraded false', () => {
    const aceRow: EbayExtensionListing = {
      title:
        'Pokémon TCG Bubble Mew EX Paldean Fates Sir Ace 10 Gem Mint Card 232/091',
      price: 899.65,
      soldAt: Date.now(),
      itemId: '206082095308',
      itemUrl: 'https://www.ebay.com/itm/206082095308',
      isGraded: false,
    };
    const merged = mergeDualGradedEbayCaptures(
      { data: { listings: [aceRow], query: 'mew', captureStats: {} } },
      { data: { listings: [], query: 'mew', captureStats: {} } },
      'https://www.ebay.com/sch/i.html?_nkw=mew&LH_Sold=1&LH_Complete=1'
    );
    expect(merged.listings[0]?.isGraded).toBe(true);
    expect(merged.listings[0]?.grader).toBe('ACE');
    expect(merged.listings[0]?.gradeTag).toContain('ACE');
  });
});

describe('mergeDualGradedEbayCaptures out-of-order', () => {
  it('merges when Yes pass is supplied before No in argument order', () => {
    const noRow = {
      data: {
        listings: [{ title: 'A', price: 5, soldAt: 1, itemId: '1', itemUrl: null, isGraded: false }],
        captureStats: { pagesScanned: 2, gradedFacetApplied: true },
      },
    };
    const yesRow = {
      data: {
        listings: [{ title: 'B', price: 6, soldAt: 2, itemId: '2', itemUrl: null, isGraded: true }],
        captureStats: { pagesScanned: 3, gradedFacetApplied: true },
      },
    };
    const merged = mergeDualGradedEbayCaptures(
      yesRow,
      noRow,
      'https://www.ebay.com/sch/i.html?_nkw=test&LH_Sold=1&LH_Complete=1'
    );
    expect(merged.listings.length).toBe(2);
    expect(merged.ebayDualCaptureStats?.gradedNoRows).toBe(1);
    expect(merged.ebayDualCaptureStats?.gradedYesRows).toBe(1);
  });
});

describe('dedupeEbayListings', () => {
  it('merges duplicate item ids', () => {
    const a: EbayExtensionListing = {
      title: 'A',
      price: 1,
      soldAt: 1,
      itemId: '99',
      itemUrl: null,
    };
    const b: EbayExtensionListing = { ...a, price: 2 };
    expect(dedupeEbayListings([a, b])).toHaveLength(1);
  });
});
