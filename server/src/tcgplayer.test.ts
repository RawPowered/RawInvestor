import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  buildTcgplayerNearMintProductUrl,
  extractTcgplayerContextFromUrl,
  extractTcgplayerProductId,
  fetchTcgplayerProduct,
  parseUsdValue,
  TCGPLAYER_NEAR_MINT_CONDITION,
  TCGPLAYER_NEAR_MINT_LANGUAGE,
} from './tcgplayer.js';

vi.mock('playwright', () => {
  const page = {
    setExtraHTTPHeaders: vi.fn(async () => {}),
    goto: vi.fn(async () => {}),
    waitForTimeout: vi.fn(async () => {}),
    url: vi.fn(() => 'https://www.tcgplayer.com/product/1?Language=English&Condition=Near+Mint&page=1'),
    evaluate: vi.fn(async () => ['Near Mint Comparison Prices Market Price $12.35']),
    textContent: vi.fn(async () => 'Market Price $12.35'),
    close: vi.fn(async () => {}),
    locator: vi.fn(() => ({
      first: () => ({
        fill: async () => {},
        click: async () => {},
      }),
    })),
    waitForURL: vi.fn(async () => {}),
  };
  const context = {
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => {}),
    storageState: vi.fn(async () => ({})),
  };
  const browser = {
    newContext: vi.fn(async () => context),
    close: vi.fn(async () => {}),
  };
  return {
    chromium: {
      launch: vi.fn(async () => browser),
    },
  };
});

describe('extractTcgplayerProductId', () => {
  it('parses id from standard product URLs', () => {
    expect(
      extractTcgplayerProductId(
        'https://www.tcgplayer.com/product/662195/pokemon-me02-phantasmal-flames-meowth?page=1'
      )
    ).toBe(662195);
  });

  it('returns null when no product segment', () => {
    expect(extractTcgplayerProductId('https://www.tcgplayer.com/')).toBeNull();
  });
});

describe('buildTcgplayerNearMintProductUrl', () => {
  it('builds canonical Near Mint URL from bare product id', () => {
    const out = buildTcgplayerNearMintProductUrl(662195);
    expect(out).toBe(
      'https://www.tcgplayer.com/product/662195?Language=English&Condition=Near+Mint&page=1'
    );
  });

  it('strips slug, Printing, and other query params', () => {
    const out = buildTcgplayerNearMintProductUrl(
      123,
      'https://www.tcgplayer.com/product/123/pokemon-slug?Language=Japanese&Condition=Lightly+Played&Printing=Holofoil&foo=bar'
    );
    const u = new URL(out);
    expect(u.pathname).toBe('/product/123');
    expect(u.searchParams.get('Language')).toBe(TCGPLAYER_NEAR_MINT_LANGUAGE);
    expect(u.searchParams.get('Condition')).toBe(TCGPLAYER_NEAR_MINT_CONDITION);
    expect(u.searchParams.get('page')).toBe('1');
    expect(u.searchParams.get('Printing')).toBeNull();
  });
});

describe('fetchTcgplayerProduct', () => {
  const origFetch = global.fetch;
  beforeEach(() => {
    global.fetch = vi.fn() as unknown as typeof fetch;
    delete process.env.PCGR_TCGPLAYER_REQUIRE_AUTH;
  });
  afterEach(() => {
    global.fetch = origFetch;
  });

  it('GETs mp-search-api with Near Mint referer and maps fields', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        productId: 1,
        productName: 'Pikachu',
        setName: 'Base Set',
        rarityName: 'Rare',
        marketPrice: 12.5,
        lowestPrice: 10,
        lowestPriceWithShipping: 11,
        medianPrice: 11.25,
        listings: 42,
        sellers: 30,
      }),
    }) as unknown as typeof fetch;

    const out = await fetchTcgplayerProduct(1, 'https://www.tcgplayer.com/product/1/x');
    expect(global.fetch).toHaveBeenCalledOnce();
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toContain('/v1/product/1/details');
    const hdrs = init.headers as Record<string, string>;
    expect(hdrs.Referer).toBe(
      'https://www.tcgplayer.com/product/1?Language=English&Condition=Near+Mint&page=1'
    );
    expect(out.marketPrice).toBe(12.35);
    expect(out.productName).toBe('Pikachu');
    expect(out.listings).toBe(42);
    expect(out.medianPrice).toBe(11.25);
    expect(out.sellers).toBe(30);
    expect(out.source).toBe('playwright_exact_url');
    expect(out.apiMarketPrice).toBe(12.5);
    expect(out.priceDriftVsApi).toBeCloseTo(-0.15);
    expect(out.capturedContext.language).toBe('English');
    expect(out.capturedContext.condition).toBe('Near Mint');
    expect(out.url).toContain('Condition=Near+Mint');
  });
});

describe('helpers', () => {
  it('parses usd strings', () => {
    expect(parseUsdValue('$1,234.56')).toBeCloseTo(1234.56);
    expect(parseUsdValue('n/a')).toBeNull();
  });

  it('extracts tcg url query context', () => {
    const ctx = extractTcgplayerContextFromUrl(
      'https://www.tcgplayer.com/product/123?Language=English&Condition=Near+Mint&Printing=Holofoil'
    );
    expect(ctx.language).toBe('English');
    expect(ctx.condition).toBe('Near Mint');
    expect(ctx.printing).toBe('Holofoil');
  });
});
