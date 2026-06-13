import { describe, expect, it } from 'vitest';
import { mergeDualGradedEbayCaptures, type EbayExtractPayload } from './ebayQuickFetch';

const payload = (listings: { itemId: string; soldAt: number; price: number; title: string }[]): EbayExtractPayload =>
  ({
    data: {
      listings: listings.map((r) => ({
        ...r,
        itemUrl: `https://ebay.com/itm/${r.itemId}`,
      })),
      captureStats: { pagesScanned: 2, gradedFacetApplied: true },
    },
  }) as EbayExtractPayload;

describe('mergeDualGradedEbayCaptures', () => {
  it('merges graded no and yes passes with dual stats', () => {
    const capNo = payload([
      { itemId: 'a', soldAt: 1000, price: 10, title: 'raw a' },
      { itemId: 'b', soldAt: 2000, price: 20, title: 'raw b' },
    ]);
    const capYes = payload([{ itemId: 'c', soldAt: 3000, price: 30, title: 'graded c' }]);
    const merged = mergeDualGradedEbayCaptures(capNo, capYes, 'https://www.ebay.com/sch/i.html?_nkw=test');
    expect(merged.rowCount).toBe(3);
    expect(merged.ebayDualCaptureStats?.gradedNoRows).toBe(2);
    expect(merged.ebayDualCaptureStats?.gradedYesRows).toBe(1);
  });

  it('dedupes same itemId across passes', () => {
    const capNo = payload([{ itemId: 'x', soldAt: 1000, price: 10, title: 'dup' }]);
    const capYes = payload([{ itemId: 'x', soldAt: 1000, price: 10, title: 'dup' }]);
    const merged = mergeDualGradedEbayCaptures(capNo, capYes, 'https://www.ebay.com/sch/i.html?_nkw=test');
    expect(merged.rowCount).toBe(1);
  });
});
