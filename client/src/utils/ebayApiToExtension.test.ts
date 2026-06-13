import { describe, expect, it } from 'vitest';
import {
  ebayRowScanKeyClient,
  ebaySalesSummaryToExtensionListings,
  mergeEbaySoldSources,
  resolveEbaySoldDisplay,
} from './ebayApiToExtension';
import type { Card, EbayExtensionListing, EbayExtensionSnapshot, EbaySalesSummary } from '../types';

const minimalApiSummary = (
  listings: EbaySalesSummary['listings']
): EbaySalesSummary => ({
  query: 'pikachu',
  windowDays: 30,
  count: listings.length,
  low: null,
  median: null,
  high: null,
  mean: null,
  p25: null,
  p75: null,
  pacePerMonth: 0,
  pacePerWeek: 0,
  currency: 'USD',
  fetchedAt: Date.now(),
  listings,
  source: 'ebay_marketplace_insights',
});

const minimalExtSnap = (listings: EbayExtensionListing[]): EbayExtensionSnapshot => ({
  sourceUrl: 'https://www.ebay.com/sch/i.html?_nkw=test',
  query: 'pikachu',
  capturedAt: Date.now(),
  captureMode: 'default',
  hasMore: false,
  rowCount: listings.length,
  listings,
});

const extListing = (overrides: Partial<EbayExtensionListing> = {}): EbayExtensionListing => ({
  title: 'Pikachu ex',
  price: 50,
  soldAt: Date.parse('2026-04-01T12:00:00Z'),
  itemId: 'abc123',
  itemUrl: 'https://www.ebay.com/itm/abc123',
  ...overrides,
});

describe('ebayApiToExtension', () => {
  it('dedupes extension and API rows by item id', () => {
    const ext = minimalExtSnap([extListing({ price: 50 })]);
    const api = minimalApiSummary([
      {
        itemId: 'abc123',
        title: 'Pikachu ex',
        price: 51,
        soldAt: Date.parse('2026-04-01T12:00:00Z'),
        currency: 'USD',
      },
    ]);
    const merged = mergeEbaySoldSources(ext, api);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.price).toBe(50);
  });

  it('maps API summary rows to extension listing shape', () => {
    const api = minimalApiSummary([
      {
        itemId: 'x1',
        title: 'Card',
        price: 9.99,
        soldAt: 100,
        currency: 'USD',
      },
    ]);
    const rows = ebaySalesSummaryToExtensionListings(api);
    expect(rows[0]?.itemUrl).toBe('https://www.ebay.com/itm/x1');
    expect(rows[0]?.listingKind).toBe('unknown');
  });

  it('prefers fresh extension snapshot over API-only display', () => {
    const card = {
      name: 'Pikachu',
      set: 'Base',
      cardNumber: '25',
      ebayExtensionSnapshot: minimalExtSnap([extListing()]),
      ebaySales: null,
    } satisfies Pick<Card, 'name' | 'set' | 'cardNumber' | 'ebayExtensionSnapshot' | 'ebaySales'>;
    const d = resolveEbaySoldDisplay(card);
    expect(d.source).toBe('extension');
    expect(d.listings).toHaveLength(1);
  });

  it('falls back to API when extension is empty', () => {
    const card = {
      name: 'Pikachu',
      set: 'Base',
      cardNumber: '25',
      ebayExtensionSnapshot: null,
      ebaySales: minimalApiSummary([
        {
          itemId: 'z9',
          title: 'Card',
          price: 12,
          soldAt: 200,
          currency: 'USD',
        },
      ]),
    } satisfies Pick<Card, 'name' | 'set' | 'cardNumber' | 'ebayExtensionSnapshot' | 'ebaySales'>;
    const d = resolveEbaySoldDisplay(card);
    expect(d.source).toBe('api');
    expect(d.listings[0]?.itemId).toBe('z9');
  });

  it('uses day|price|title key when item id missing', () => {
    const k1 = ebayRowScanKeyClient({
      soldAt: Date.parse('2026-04-01T00:00:00Z'),
      price: 10,
      title: 'Hello!',
      itemId: null,
    });
    const k2 = ebayRowScanKeyClient({
      soldAt: Date.parse('2026-04-01T12:00:00Z'),
      price: 10,
      title: 'Hello!',
      itemId: null,
    });
    expect(k1).toBe(k2);
  });
});
