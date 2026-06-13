import path from 'node:path';
import { promises as fs } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  closeExtensionCaptureStore,
  findLatestExtensionCapture,
  listExtensionCaptureHistory,
  normalizeEbayCapture,
  normalizeForMatch,
  normalizeTcgCapture,
  parsePokemonCenterStampFromTitle,
  parseSealedInTitle,
  saveExtensionCapture,
  updateLatestEbayCaptureListingTags,
  validateCapturePayload,
} from './extensionCapture.js';

describe('validateCapturePayload', () => {
  it('accepts tcgplayer payload', () => {
    const out = validateCapturePayload({
      source: 'tcgplayer',
      url: 'https://www.tcgplayer.com/product/517047/example',
      data: { marketPrice: 76.06 },
    });
    expect(out.source).toBe('tcgplayer');
    expect(out.data.marketPrice).toBe(76.06);
  });

  it('rejects wrong host', () => {
    expect(() =>
      validateCapturePayload({
        source: 'tcgplayer',
        url: 'https://example.com/nope',
        data: {},
      })
    ).toThrow(/not allowed/i);
  });

  it('canonicalizes m.pricecharting.com capture URL to www', () => {
    const out = validateCapturePayload({
      source: 'pricecharting',
      url: 'https://m.pricecharting.com/game/pokemon-card/example',
      data: { rawPrice: 1.5 },
    });
    expect(out.url).toMatch(/^https:\/\/www\.pricecharting\.com\//);
    expect(
      normalizeForMatch('https://m.pricecharting.com/game/pokemon-card/example')
    ).toBe(normalizeForMatch('https://www.pricecharting.com/game/pokemon-card/example'));
  });

  it('detects Pokémon Center in eBay title (case, accent, Stamped / Stamp / phrase)', () => {
    expect(parsePokemonCenterStampFromTitle("N's Zekrom ( Pokemon Center Stamp ) sealed")).toBe(true);
    expect(parsePokemonCenterStampFromTitle('PC ETB POKEMON CENTER promo Zekrom SEALED')).toBe(true);
    expect(parsePokemonCenterStampFromTitle('Pokemon Center Stamped NM')).toBe(true);
    expect(parsePokemonCenterStampFromTitle('Pok\u00E9mon Center exclusive')).toBe(true);
    expect(parsePokemonCenterStampFromTitle('Black Star Promo SEALED centering')).toBe(false);
  });

  it('detects sealed in eBay title (word boundary)', () => {
    expect(parseSealedInTitle('PROMO SEALED in sleeve')).toBe(true);
    expect(parseSealedInTitle('Sealed plastic')).toBe(true);
    expect(parseSealedInTitle('factory sealed pack')).toBe(true);
    expect(parseSealedInTitle('unsealed listing')).toBe(false);
  });

  it('normalizeForMatch aligns eBay sold URLs with and without LH_Complete', () => {
    const withComplete = normalizeForMatch(
      'https://www.ebay.com/sch/i.html?_nkw=pikachu+vmax&LH_Sold=1&LH_Complete=1'
    );
    const soldOnly = normalizeForMatch(
      'https://www.ebay.com/sch/i.html?_nkw=pikachu+vmax&LH_Sold=1'
    );
    expect(withComplete).toBe(soldOnly);
    expect(withComplete).toMatch(/c=1$/);
  });

  it('accepts eBay sold search payload', () => {
    const out = validateCapturePayload({
      source: 'ebay',
      url:
        'https://www.ebay.com/sch/i.html?_nkw=pikachu%20vmax&_sop=12&LH_Sold=1&LH_Complete=1',
      data: {
        query: 'pikachu vmax',
        listings: [
          { title: 'A', price: 12.5, soldAt: 1_700_000_000_000, itemId: '1', itemUrl: 'https://www.ebay.com/itm/1' },
        ],
      },
    });
    expect(out.source).toBe('ebay');
    const norm = normalizeEbayCapture(out);
    expect(norm?.listings.length).toBe(1);
    expect(norm?.listings[0].price).toBe(12.5);
    expect(norm?.excludedListings?.length ?? 0).toBe(0);
  });

  it('normalizes excludedListings from extension scrape', () => {
    const out = validateCapturePayload({
      source: 'ebay',
      url:
        'https://www.ebay.com/sch/i.html?_nkw=pikachu%20vmax&_sop=12&LH_Sold=1&LH_Complete=1',
      data: {
        query: 'pikachu vmax',
        listings: [
          { title: 'Ok raw card', price: 10, soldAt: 1_700_000_000_000, itemId: '111', itemUrl: 'https://www.ebay.com/itm/111' },
        ],
        excludedListings: [
          {
            title: 'Mismatch row',
            price: 4.35,
            soldAt: 1_700_000_000_001,
            itemId: '222',
            itemUrl: 'https://www.ebay.com/itm/222',
            excludeReason: 'listing_mismatch',
          },
        ],
      },
    });
    const norm = normalizeEbayCapture(out);
    expect(norm?.excludedListings.length).toBe(1);
    expect(norm?.excludedListings[0].itemId).toBe('222');
    expect(norm?.excludedListings[0].price).toBe(4.35);
  });
});

describe('saveExtensionCapture', () => {
  it('persists and returns latest capture', async () => {
    const tmp = path.resolve(process.cwd(), `.tmp-test-captures-${Date.now()}-a`);
    const payload = validateCapturePayload({
      source: 'pricecharting',
      url: 'https://www.pricecharting.com/game/pokemon/test-card',
      data: { rawPrice: 12.34 },
      capturedAt: 1714060000000,
    });
    await saveExtensionCapture(tmp, payload);
    const hit = await findLatestExtensionCapture(
      tmp,
      'pricecharting',
      'https://www.pricecharting.com/game/pokemon/test-card'
    );
    expect(hit?.source).toBe('pricecharting');
    expect(hit?.data.rawPrice).toBe(12.34);
    closeExtensionCaptureStore(tmp);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('finds latest capture by normalized URL', async () => {
    const tmp = path.resolve(process.cwd(), `.tmp-test-captures-${Date.now()}-b`);
    const p1 = validateCapturePayload({
      source: 'tcgplayer',
      url: 'https://www.tcgplayer.com/product/517047/name?Language=English&Condition=Near+Mint',
      data: { marketPrice: 75.0 },
      capturedAt: 1714060000000,
    });
    const p2 = validateCapturePayload({
      source: 'tcgplayer',
      url: 'https://www.tcgplayer.com/product/517047/name?Language=English&Condition=Lightly+Played',
      data: { marketPrice: 76.0 },
      capturedAt: 1714060001000,
    });
    await saveExtensionCapture(tmp, p1);
    await saveExtensionCapture(tmp, p2);
    const hit = await findLatestExtensionCapture(
      tmp,
      'tcgplayer',
      'https://www.tcgplayer.com/product/517047/name?Language=English&Condition=Near+Mint'
    );
    expect(hit?.data.marketPrice).toBe(75.0);
    closeExtensionCaptureStore(tmp);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('normalizes tcg rows and history list', async () => {
    const tmp = path.resolve(process.cwd(), `.tmp-test-captures-${Date.now()}-c`);
    const p = validateCapturePayload({
      source: 'tcgplayer',
      url: 'https://www.tcgplayer.com/product/680480/name?Language=English&Condition=Near+Mint',
      data: {
        productId: 680480,
        captureMode: 'default',
        hasMore: true,
        rowCount: 2,
        pricePoints: { marketPrice: 9.39, currentQuantity: 688, currentSellers: 252 },
        latestSalesRows: [
          { at: 1714060000000, condition: 'NM Holofoil', qty: 1, price: 9.41 },
          { at: 1714060000500, condition: 'nm  holofoil', qty: 1, price: 9.41 },
          { at: 1714063600000, condition: 'NM Holofoil', qty: 2, price: 9.4 },
        ],
      },
    });
    await saveExtensionCapture(tmp, p);
    const hist = await listExtensionCaptureHistory(
      tmp,
      'tcgplayer',
      {
        url: 'https://www.tcgplayer.com/product/680480/name?Language=English&Condition=Near+Mint',
        limit: 10,
      }
    );
    expect(hist.captures.length).toBe(1);
    const norm = normalizeTcgCapture(hist.captures[0]);
    expect(norm?.productId).toBe(680480);
    expect(norm?.latestSalesRows.length).toBe(2);
    expect(norm?.latestSalesRows[0].condition).toBe('nm holofoil');
    expect(norm?.pricePoints.marketPrice).toBe(9.39);
    closeExtensionCaptureStore(tmp);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('patch matches listing by itemId parsed from itemUrl when itemId field is empty', async () => {
    const tmp = path.resolve(process.cwd(), `.tmp-test-captures-${Date.now()}-ebay-patch`);
    const soldUrl =
      'https://www.ebay.com/sch/i.html?_nkw=meowth%20phantasmal&_sop=12&LH_Sold=1&LH_Complete=1';
    const t = 1_770_000_000_000;
    const payload = validateCapturePayload({
      source: 'ebay',
      url: soldUrl,
      data: {
        query: 'meowth phantasmal',
        listings: [
          {
            title: 'Pokemon Card Meowth',
            price: 74.97,
            soldAt: t,
            itemId: null,
            itemUrl: 'https://www.ebay.com/itm/123456789012',
          },
        ],
      },
      capturedAt: 1714060000000,
    });
    await saveExtensionCapture(tmp, payload);
    const updated = await updateLatestEbayCaptureListingTags(tmp, {
      url: soldUrl,
      itemId: '123456789012',
      soldAt: t,
      price: 74.97,
      correctedPrice: 75.0,
      title: 'Pokemon Card Meowth',
      isGraded: true,
      grader: 'ACE',
      gradeTag: 'ACE 10',
      conditionTag: null,
      isLot: false,
      lotQuantity: 1,
      pokemonCenterStamp: false,
      sealedInTitle: false,
    });
    expect(updated).not.toBeNull();
    const listings = (updated!.capture.data as { listings: Array<{ price: number; itemUrl?: string | null }> })
      .listings;
    expect(listings[0].price).toBe(75.0);
    closeExtensionCaptureStore(tmp);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('patch finds listing by itemId when card sourceUrl does not match capture normalized_url', async () => {
    const tmp = path.resolve(process.cwd(), `.tmp-test-captures-${Date.now()}-ebay-patch-url-miss`);
    const storedUrl =
      'https://www.ebay.com/sch/i.html?_nkw=Other%20Search%20Tokens&LH_Sold=1&LH_Complete=1';
    const clientSourceUrl =
      'https://www.ebay.com/sch/i.html?_nkw=Elite%20Trainer%20Box%20%5BPokemon%20Center%5D%20Pokemon%20Perfect%20Order&LH_Sold=1&LH_Complete=1';
    const t = 1_771_351_200_000;
    const payload = validateCapturePayload({
      source: 'ebay',
      url: storedUrl,
      data: {
        query: 'other',
        listings: [
          {
            title: 'Elite Trainer Box [Pokemon Center] Pokemon Perfect Order',
            price: 432.05,
            soldAt: t,
            itemId: '168166407817',
            itemUrl: 'https://www.ebay.com/itm/168166407817',
          },
        ],
      },
      capturedAt: 1714060000000,
    });
    await saveExtensionCapture(tmp, payload);
    const updated = await updateLatestEbayCaptureListingTags(tmp, {
      url: clientSourceUrl,
      itemId: '168166407817',
      soldAt: t,
      price: 432.05,
      correctedPrice: null,
      title: 'Elite Trainer Box [Pokemon Center] Pokemon Perfect Order',
      isGraded: true,
      grader: 'PSA',
      gradeTag: '10',
      conditionTag: null,
      isLot: false,
      lotQuantity: 1,
      pokemonCenterStamp: false,
      sealedInTitle: false,
    });
    expect(updated).not.toBeNull();
    const listings = (updated!.capture.data as { listings: Array<{ grader?: string | null; gradeTag?: string | null }> })
      .listings;
    expect(listings[0].grader).toBe('PSA');
    expect(listings[0].gradeTag).toBe('10');
    closeExtensionCaptureStore(tmp);
    await fs.rm(tmp, { recursive: true, force: true });
  });
});
