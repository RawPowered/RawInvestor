import { describe, expect, it } from 'vitest';
import type { Card } from '../../types';
import {
  cardHasDualEbayPassBuffers,
  DualEbayPartialBuffersError,
  ebayBaselineFromCard,
  ebaySnapshotAdvanced,
} from './pollExtensionCapture';

const cardWithSnap = (snap: NonNullable<Card['ebayExtensionSnapshot']>): Card =>
  ({ id: 'c1', ebayExtensionSnapshot: snap }) as Card;

describe('ebaySnapshotAdvanced', () => {
  const baseline = { capturedAt: 1000, rowCount: 10, listingCount: 10 };

  it('true when capturedAt increases', () => {
    expect(
      ebaySnapshotAdvanced(
        cardWithSnap({
          capturedAt: 1001,
          rowCount: 10,
          listings: Array(10).fill({ itemId: '1', itemUrl: 'https://ebay.com/1' }),
        } as NonNullable<Card['ebayExtensionSnapshot']>),
        baseline
      )
    ).toBe(true);
  });

  it('true when rowCount increases but capturedAt unchanged', () => {
    expect(
      ebaySnapshotAdvanced(
        cardWithSnap({
          capturedAt: 1000,
          rowCount: 12,
          listings: Array(12).fill({ itemId: '1', itemUrl: 'https://ebay.com/1' }),
        } as NonNullable<Card['ebayExtensionSnapshot']>),
        baseline
      )
    ).toBe(true);
  });

  it('false when snapshot unchanged', () => {
    expect(
      ebaySnapshotAdvanced(
        cardWithSnap({
          capturedAt: 1000,
          rowCount: 10,
          listings: Array(10).fill({ itemId: '1', itemUrl: 'https://ebay.com/1' }),
        } as NonNullable<Card['ebayExtensionSnapshot']>),
        baseline
      )
    ).toBe(false);
  });

  it('false when snapshot missing', () => {
    expect(ebaySnapshotAdvanced({ id: 'c1' } as Card, baseline)).toBe(false);
  });

  it('true for graded-yes pass when sourceUrl lane changes with same row count', () => {
    expect(
      ebaySnapshotAdvanced(
        cardWithSnap({
          capturedAt: 1000,
          rowCount: 91,
          sourceUrl: 'https://www.ebay.com/sch/i.html?Graded=yes&LH_Sold=1&LH_Complete=1',
          listings: Array(91).fill({ itemId: '1', itemUrl: 'https://ebay.com/1' }),
        } as NonNullable<Card['ebayExtensionSnapshot']>),
        {
          capturedAt: 1000,
          rowCount: 91,
          listingCount: 91,
          sourceUrl: 'https://www.ebay.com/sch/i.html?Graded=no&LH_Sold=1&LH_Complete=1',
        },
        { expectedPass: 'ebay-graded-yes' }
      )
    ).toBe(true);
  });

  it('true for graded-yes when capturePass advances', () => {
    expect(
      ebaySnapshotAdvanced(
        cardWithSnap({
          capturedAt: 1000,
          rowCount: 91,
          capturePass: 'ebay-graded-yes',
          listings: Array(91).fill({ itemId: '1', itemUrl: 'https://ebay.com/1' }),
        } as NonNullable<Card['ebayExtensionSnapshot']>),
        {
          capturedAt: 1000,
          rowCount: 91,
          listingCount: 91,
          capturePass: 'ebay-graded-no',
        },
        { expectedPass: 'ebay-graded-yes' }
      )
    ).toBe(true);
  });
});

describe('ebayBaselineFromCard', () => {
  it('uses floor for capturedAt', () => {
    const b = ebayBaselineFromCard(
      cardWithSnap({
        capturedAt: 500,
        rowCount: 3,
        listings: [],
      } as unknown as NonNullable<Card['ebayExtensionSnapshot']>),
      900
    );
    expect(b.capturedAt).toBe(900);
  });
});

describe('cardHasDualEbayPassBuffers', () => {
  it('true when both pass snapshots have listings', () => {
    const snap = {
      capturedAt: 1,
      sourceUrl: 'https://ebay.com',
      query: 'q',
      captureMode: 'default' as const,
      hasMore: false,
      rowCount: 2,
      listings: [
        { soldAt: 1, price: 1, title: 'a', itemId: '1', itemUrl: 'https://ebay.com/1' },
        { soldAt: 2, price: 2, title: 'b', itemId: '2', itemUrl: 'https://ebay.com/2' },
      ],
    };
    expect(
      cardHasDualEbayPassBuffers({
        ebayExtensionSnapshotNo: snap,
        ebayExtensionSnapshotYes: { ...snap, rowCount: 1, listings: snap.listings.slice(0, 1) },
      })
    ).toBe(true);
  });

  it('false when only one pass present', () => {
    expect(
      cardHasDualEbayPassBuffers({
        ebayExtensionSnapshotNo: {
          capturedAt: 1,
          sourceUrl: 'u',
          query: 'q',
          captureMode: 'default',
          hasMore: false,
          rowCount: 1,
          listings: [{ soldAt: 1, price: 1, title: 'a', itemId: '1', itemUrl: 'https://ebay.com/1' }],
        },
      })
    ).toBe(false);
  });
});

describe('DualEbayPartialBuffersError', () => {
  it('records missing pass', () => {
    const card = { id: 'c1' } as Card;
    const err = new DualEbayPartialBuffersError(card, 'ebay-graded-no');
    expect(err.missingPass).toBe('ebay-graded-no');
    expect(err.card).toBe(card);
  });
});
