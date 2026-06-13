import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchEbaySoldSummary,
  getEbayAccessToken,
  resetEbayTokenCacheForTests,
  summarizeSoldListings,
  type EbaySoldListing,
} from './ebay.js';

describe('summarizeSoldListings', () => {
  it('computes distribution + pace from sold rows', () => {
    const listings: EbaySoldListing[] = [
      { itemId: '1', title: 'A', soldAt: Date.parse('2026-04-01T00:00:00Z'), price: 100, currency: 'USD' },
      { itemId: '2', title: 'B', soldAt: Date.parse('2026-04-02T00:00:00Z'), price: 110, currency: 'USD' },
      { itemId: '3', title: 'C', soldAt: Date.parse('2026-04-03T00:00:00Z'), price: 140, currency: 'USD' },
    ];
    const out = summarizeSoldListings('pikachu', listings, 30, Date.parse('2026-04-04T00:00:00Z'));
    expect(out.count).toBe(3);
    expect(out.low).toBe(100);
    expect(out.median).toBe(110);
    expect(out.high).toBe(140);
    expect(out.pacePerMonth).toBeCloseTo(3, 5);
    expect(out.source).toBe('ebay_marketplace_insights');
  });
});

describe('eBay auth + search', () => {
  const originalFetch = global.fetch;
  const originalClientId = process.env.EBAY_CLIENT_ID;
  const originalClientSecret = process.env.EBAY_CLIENT_SECRET;

  beforeEach(() => {
    process.env.EBAY_CLIENT_ID = 'test-client-id';
    process.env.EBAY_CLIENT_SECRET = 'test-client-secret';
    process.env.EBAY_ENV = 'production';
    resetEbayTokenCacheForTests();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.EBAY_CLIENT_ID = originalClientId;
    process.env.EBAY_CLIENT_SECRET = originalClientSecret;
    resetEbayTokenCacheForTests();
  });

  it('caches OAuth token until expiration', async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'abc', expires_in: 7200 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'should-not-hit', expires_in: 7200 }),
      });
    global.fetch = mock as unknown as typeof fetch;
    const t1 = await getEbayAccessToken();
    const t2 = await getEbayAccessToken();
    expect(t1).toBe('abc');
    expect(t2).toBe('abc');
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('maps marketplace insights rows into normalized sold summary', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'token', expires_in: 7200 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          itemSales: [
            {
              itemId: 'it1',
              title: 'Pikachu ex #238',
              soldDate: '2026-04-01T12:00:00.000Z',
              soldPrice: { value: '99.99', currency: 'USD' },
              itemWebUrl: 'https://www.ebay.com/itm/it1',
            },
            {
              itemId: 'it2',
              title: 'Pikachu ex #238 PSA 10',
              soldDate: '2026-04-03T12:00:00.000Z',
              soldPrice: { value: 140, currency: 'USD' },
            },
          ],
        }),
      }) as unknown as typeof fetch;

    const out = await fetchEbaySoldSummary('pikachu ex 238', { windowDays: 30, limit: 50 });
    expect(out.count).toBe(2);
    expect(out.low).toBeCloseTo(99.99, 2);
    expect(out.high).toBe(140);
    expect(out.currency).toBe('USD');
    expect(out.listings[0]?.itemId).toBe('it1');
  });

  it('caches sold summary responses for identical queries', async () => {
    const insightsBody = {
      itemSales: [
        {
          itemId: 'cache1',
          title: 'Cached card',
          soldDate: '2026-04-01T12:00:00.000Z',
          soldPrice: { value: '25', currency: 'USD' },
        },
      ],
    };
    const mock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'token', expires_in: 7200 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => insightsBody,
      });
    global.fetch = mock as unknown as typeof fetch;

    const a = await fetchEbaySoldSummary('cached query', { windowDays: 30, limit: 50 });
    const b = await fetchEbaySoldSummary('cached query', { windowDays: 30, limit: 50 });
    expect(a.count).toBe(1);
    expect(b.count).toBe(1);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('surfaces marketplace insights permission errors', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'token', expires_in: 7200 }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: async () => ({
          errors: [{ longMessage: 'Insufficient permissions to fulfill the request.' }],
        }),
      }) as unknown as typeof fetch;

    await expect(fetchEbaySoldSummary('denied', { windowDays: 7, limit: 10 })).rejects.toThrow(
      /Marketplace Insights/i
    );
  });
});
