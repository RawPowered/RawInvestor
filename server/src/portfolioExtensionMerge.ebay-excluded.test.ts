import { describe, expect, it } from 'vitest';
import { normalizeEbayCapture, validateCapturePayload } from './extensionCapture.js';
import { buildEbaySnapshotForCard } from './portfolioExtensionMerge.js';

describe('buildEbaySnapshotForCard excluded listings', () => {
  it('puts excludedListings into rejectedListings with listing_mismatch', () => {
    const payload = validateCapturePayload({
      source: 'ebay',
      url:
        'https://www.ebay.com/sch/i.html?_nkw=test%20card%2025&LH_Sold=1&LH_Complete=1',
      data: {
        query: 'test card 25',
        listings: [
          {
            title: 'Test Card 25 NM Pokemon',
            price: 12,
            soldAt: 1_700_000_000_000,
            itemId: '111111111111',
            itemUrl: 'https://www.ebay.com/itm/111111111111',
          },
        ],
        excludedListings: [
          {
            title: 'Bad alignment row',
            price: 4.35,
            soldAt: 1_700_000_000_001,
            itemId: '222222222222',
            itemUrl: 'https://www.ebay.com/itm/222222222222',
          },
        ],
      },
    });
    const n = normalizeEbayCapture(payload);
    expect(n).not.toBeNull();
    const card = {
      id: 'c1',
      name: 'Test Card',
      set: 'Set',
      cardNumber: '25',
      raw: 10,
      grade9: 50,
      psa10: 100,
    };
    const snap = buildEbaySnapshotForCard(payload, n!, card as Record<string, unknown>);
    expect(snap).not.toBeNull();
    const rejected = (snap as { rejectedListings: Array<{ filterReason: string; itemId: string | null }> })
      .rejectedListings;
    const mm = rejected.filter((r) => r.filterReason === 'listing_mismatch');
    expect(mm.length).toBe(1);
    expect(mm[0].itemId).toBe('222222222222');
    const listings = (snap as { listings: Array<{ itemId: string | null }> }).listings;
    expect(listings.some((r) => r.itemId === '222222222222')).toBe(false);
  });
});
