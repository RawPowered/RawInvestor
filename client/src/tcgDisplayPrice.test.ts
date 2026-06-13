import { describe, expect, it } from 'vitest';
import type { TcgplayerSalesSnapshot } from './types';
import {
  resolveTcgCapturedMarketPrice,
  resolveTcgDisplayMarketPrice,
  tcgCapturedDiffersFromDisplay,
} from './tcgDisplayPrice';

describe('resolveTcgDisplayMarketPrice', () => {
  it('prefers tcgplayerSummary NM market price', () => {
    expect(
      resolveTcgDisplayMarketPrice({
        tcgplayerSummary: {
          productId: 1,
          productName: 'x',
          setName: '',
          rarityName: null,
          marketPrice: 12.5,
          lowestPrice: null,
          lowestPriceWithShipping: null,
          medianPrice: null,
          listings: null,
          sellers: null,
          url: 'https://www.tcgplayer.com/product/1',
          fetchedAt: 0,
        },
        tcgplayerSalesSnapshot: {
          capturedAt: 0,
          sourceUrl: 'https://www.tcgplayer.com/product/1',
          context: { language: 'English', condition: 'Lightly Played', printing: null },
          captureMode: 'default',
          hasMore: false,
          rowCount: 0,
          comparisonMarketPrices: { nearMint: 11 },
          pricePoints: {
            marketPrice: 9,
            capturedMarketPrice: 9,
            mostRecentSale: null,
            listedMedian: null,
            currentQuantity: null,
            currentSellers: null,
          },
          latestSalesRows: [],
        },
      })
    ).toBe(12.5);
  });

  it('falls back to comparison nearMint when summary missing', () => {
    expect(
      resolveTcgDisplayMarketPrice({
        tcgplayerSummary: undefined,
        tcgplayerSalesSnapshot: {
          capturedAt: 0,
          sourceUrl: 'https://www.tcgplayer.com/product/1',
          context: { language: 'English', condition: null, printing: null },
          captureMode: 'default',
          hasMore: false,
          rowCount: 0,
          comparisonMarketPrices: { nearMint: 8.25 },
          pricePoints: {
            marketPrice: 7,
            mostRecentSale: null,
            listedMedian: null,
            currentQuantity: null,
            currentSellers: null,
          },
          latestSalesRows: [],
        },
      })
    ).toBe(8.25);
  });
});

describe('captured vs display', () => {
  it('detects when captured page price differs from NM display', () => {
    const card: Pick<import('./types').Card, 'tcgplayerSummary' | 'tcgplayerSalesSnapshot'> = {
      tcgplayerSummary: {
        productId: 1,
        productName: 'x',
        setName: '',
        rarityName: null,
        marketPrice: 10,
        lowestPrice: null,
        lowestPriceWithShipping: null,
        medianPrice: null,
        listings: null,
        sellers: null,
        url: 'https://www.tcgplayer.com/product/1',
        fetchedAt: 0,
      },
      tcgplayerSalesSnapshot: {
        capturedAt: 0,
        sourceUrl: 'https://www.tcgplayer.com/product/1',
        context: { language: 'English', condition: 'Lightly Played', printing: null },
        captureMode: 'default' as const,
        hasMore: false,
        rowCount: 0,
        pricePoints: {
          marketPrice: 7.5,
          capturedMarketPrice: 7.5,
          mostRecentSale: null,
          listedMedian: null,
          currentQuantity: null,
          currentSellers: null,
        },
        latestSalesRows: [],
      } satisfies TcgplayerSalesSnapshot,
    };
    expect(resolveTcgCapturedMarketPrice(card)).toBe(7.5);
    expect(tcgCapturedDiffersFromDisplay(card)).toBe(true);
  });
});
