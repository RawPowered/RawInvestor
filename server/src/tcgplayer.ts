/**
 * TCGPlayer product pricing.
 *
 * Primary source: exact product-page UI metric (Playwright).
 * Fallback source: mp-search-api `/details` endpoint.
 *
 * @see https://www.tcgplayer.com/product/{id}/…
 */
import { dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';

const SEARCH_API = 'https://mp-search-api.tcgplayer.com/v1/product';
const LOGIN_URL = 'https://www.tcgplayer.com/login';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export type TcgComparisonMarketPrices = {
  nearMint?: number | null;
  lightlyPlayed?: number | null;
  moderatelyPlayed?: number | null;
  heavilyPlayed?: number | null;
  damaged?: number | null;
};

export type TcgplayerProductSnapshot = {
  productId: number;
  productName: string;
  setName: string;
  rarityName: string | null;
  marketPrice: number;
  lowestPrice: number | null;
  lowestPriceWithShipping: number | null;
  medianPrice: number | null;
  listings: number | null;
  sellers: number | null;
  url: string;
  /** When present (mp-search-api / catalog batch). */
  imageUrl?: string | null;
  comparisonMarketPrices?: TcgComparisonMarketPrices;
  source: 'playwright_exact_url' | 'api_details';
  capturedFromUrl: string;
  capturedContext: {
    language: string | null;
    condition: string | null;
    printing: string | null;
  };
  usedAuth: boolean;
  apiMarketPrice: number | null;
  priceDriftVsApi: number | null;
  captureHint?: string;
};

type TcgFetchOptions = {
  forceRefresh?: boolean;
};

type ApiDetailsSnapshot = Omit<
  TcgplayerProductSnapshot,
  'source' | 'capturedFromUrl' | 'capturedContext' | 'usedAuth' | 'apiMarketPrice' | 'priceDriftVsApi'
>;

type PageMarketCapture = {
  marketPrice: number;
  comparisonMarketPrices?: TcgComparisonMarketPrices;
  listedMedian?: number | null;
  currentQuantity?: number | null;
  currentSellers?: number | null;
  usedAuth: boolean;
  capturedFromUrl: string;
  hint?: string;
};

/** Extract numeric product id from a tcgplayer.com product URL. */
export const extractTcgplayerProductId = (url: string): number | null => {
  const m = url.trim().match(/tcgplayer\.com\/product\/(\d+)/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export const parseUsdValue = (s: string): number | null => {
  const m = String(s).match(/\$?\s*([\d,]+(?:\.\d{1,2})?)/);
  if (!m) return null;
  const n = Number.parseFloat(m[1].replace(/,/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export const extractTcgplayerContextFromUrl = (url: string): TcgplayerProductSnapshot['capturedContext'] => {
  try {
    const u = new URL(url);
    const pick = (...keys: string[]): string | null => {
      for (const k of keys) {
        const v = u.searchParams.get(k) ?? u.searchParams.get(k.toLowerCase()) ?? u.searchParams.get(k.toUpperCase());
        if (v && v.trim()) return v.trim();
      }
      return null;
    };
    return {
      language: pick('Language', 'language', 'lang'),
      condition: pick('Condition', 'condition'),
      printing: pick('Printing', 'printing', 'print'),
    };
  } catch {
    return { language: null, condition: null, printing: null };
  }
};

export const TCGPLAYER_NEAR_MINT_LANGUAGE = 'English';
export const TCGPLAYER_NEAR_MINT_CONDITION = 'Near Mint';
export const TCGPLAYER_NEAR_MINT_PAGE = '1';

/** Canonical Near Mint product URL — strips slug, Printing, and other query params. */
export const buildTcgplayerNearMintProductUrl = (productId: number, pageUrl?: string): string => {
  const id = extractTcgplayerProductId(pageUrl ?? '') ?? productId;
  const u = new URL(`https://www.tcgplayer.com/product/${id}`);
  u.searchParams.set('Language', TCGPLAYER_NEAR_MINT_LANGUAGE);
  u.searchParams.set('Condition', TCGPLAYER_NEAR_MINT_CONDITION);
  u.searchParams.set('page', TCGPLAYER_NEAR_MINT_PAGE);
  return u.toString();
};

const fetchFromApiDetails = async (productId: number, referer: string): Promise<ApiDetailsSnapshot> => {
  const res = await fetch(`${SEARCH_API}/${productId}/details`, {
    headers: {
      'User-Agent': UA,
      Accept: 'application/json',
      Referer: referer,
      Origin: 'https://www.tcgplayer.com',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    },
  });
  if (!res.ok) {
    throw new Error(`TCGPlayer search API ${res.status}: ${res.statusText}`);
  }

  const row = (await res.json()) as Record<string, unknown>;
  const marketPrice = Number(row['marketPrice'] ?? NaN);
  if (!Number.isFinite(marketPrice) || marketPrice < 0) {
    throw new Error('TCGPlayer response missing marketPrice');
  }
  const low = row['lowestPrice'];
  const lowShip = row['lowestPriceWithShipping'];
  const med = row['medianPrice'];
  const listings = row['listings'];
  const sellers = row['sellers'];
  let imageUrl: string | null = null;
  for (const k of ['imageUrl', 'smallImageUrl', 'customListingImage'] as const) {
    const v = row[k];
    if (typeof v === 'string' && /^https?:\/\//i.test(v.trim())) {
      imageUrl = v.trim();
      break;
    }
  }
  return {
    productId: Number(row['productId'] ?? productId) || productId,
    productName: String(row['productName'] ?? '').trim() || `Product ${productId}`,
    setName: String(row['setName'] ?? '').trim(),
    rarityName: row['rarityName'] != null ? String(row['rarityName']).trim() : null,
    marketPrice,
    lowestPrice: typeof low === 'number' && Number.isFinite(low) ? low : null,
    lowestPriceWithShipping:
      typeof lowShip === 'number' && Number.isFinite(lowShip) ? lowShip : null,
    medianPrice: typeof med === 'number' && Number.isFinite(med) ? med : null,
    listings: typeof listings === 'number' && Number.isFinite(listings) ? listings : null,
    sellers: typeof sellers === 'number' && Number.isFinite(sellers) ? sellers : null,
    url: referer,
    imageUrl,
  };
};

/** mp-search-api `/details` only (no Playwright). Used for catalog batch enrichment. */
export const fetchTcgplayerProductDetailsApi = async (
  productId: number,
  referer: string
): Promise<ApiDetailsSnapshot> => fetchFromApiDetails(productId, referer);

const extractMarketPriceFromPageText = (text: string): number | null => {
  const compact = String(text).replace(/\s+/g, ' ').trim();
  const nearMint = compact.match(/\bnear\s*mint\b[\s\S]{0,220}?\bmarket\s*price\b[\s\S]{0,40}?\$([\d,]+(?:\.\d{1,2})?)/i);
  if (nearMint) return parseUsdValue(nearMint[1]);
  return null;
};

export const parseComparisonMarketPricesFromPageText = (text: string): TcgComparisonMarketPrices => {
  const compact = String(text).replace(/\s+/g, ' ').trim();
  const pick = (labelPattern: string): number | null => {
    const m = compact.match(
      new RegExp(`${labelPattern}[\\s\\S]{0,220}?\\bmarket\\s*price\\b[\\s\\S]{0,40}?\\$([\\d,]+(?:\\.\\d{1,2})?)`, 'i')
    );
    return m ? parseUsdValue(m[1]) : null;
  };
  return {
    nearMint: pick('\\bnear\\s*mint\\b'),
    lightlyPlayed: pick('\\blightly\\s*played\\b'),
    moderatelyPlayed: pick('\\bmoderately\\s*played\\b'),
    heavilyPlayed: pick('\\bheavily\\s*played\\b'),
    damaged: pick('\\bdamaged\\b'),
  };
};

const extractCountFromLabel = (text: string, labelPattern: RegExp): number | null => {
  const m = text.match(labelPattern);
  if (!m) return null;
  const n = Number.parseInt(String(m[1]).replace(/,/g, ''), 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

const extractListedMedianFromPageText = (text: string): number | null => {
  const compact = String(text).replace(/\s+/g, ' ').trim();
  const m = compact.match(/\blisted\s*median\b[\s\S]{0,40}?\$([\d,]+(?:\.\d{1,2})?)/i);
  if (!m) return null;
  return parseUsdValue(m[1]);
};

const attemptTcgplayerLogin = async (
  page: import('playwright').Page,
  email: string,
  password: string
): Promise<boolean> => {
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  const emailSel = 'input[type="email"], input[name="email"], input#email';
  const passSel = 'input[type="password"], input[name="password"], input#password';
  const submitSel = 'button[type="submit"], button:has-text("Sign in"), button:has-text("Sign In")';
  await page.locator(emailSel).first().fill(email);
  await page.locator(passSel).first().fill(password);
  await page.locator(submitSel).first().click();
  try {
    await page.waitForURL((url) => !/\/login/i.test(url.toString()), { timeout: 25000 });
    return true;
  } catch {
    return false;
  }
};

const captureMarketFromPage = async (productUrl: string): Promise<PageMarketCapture> => {
  let chromium: typeof import('playwright').chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new Error(
      process.env.NODE_ENV === 'production'
        ? 'Browser automation is not available. Reinstall Raw Investor from the official installer, or contact support.'
        : 'Playwright is not installed. From the server folder run: npm install playwright && npx playwright install chromium'
    );
  }

  const authStatePath = String(process.env.PCGR_TCGPLAYER_AUTH_STATE_PATH || '').trim();
  const email = String(process.env.PCGR_TCGPLAYER_EMAIL || '').trim();
  const password = String(process.env.PCGR_TCGPLAYER_PASSWORD || '').trim();
  let usedAuth = false;
  let hint: string | undefined;

  const browser = await chromium.launch({ headless: true });
  try {
    let context: import('playwright').BrowserContext;
    if (authStatePath && existsSync(authStatePath)) {
      context = await browser.newContext({ storageState: authStatePath });
      usedAuth = true;
    } else {
      context = await browser.newContext();
      if (email && password) {
        const loginPage = await context.newPage();
        const ok = await attemptTcgplayerLogin(loginPage, email, password);
        await loginPage.close();
        if (ok) {
          usedAuth = true;
          if (authStatePath) {
            await mkdir(dirname(authStatePath), { recursive: true });
            const state = await context.storageState();
            await writeFile(authStatePath, JSON.stringify(state, null, 2), 'utf8');
          }
        } else {
          hint = 'TCGPlayer login bootstrap failed; continuing without auth session.';
        }
      }
    }

    const page = await context.newPage();
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
    await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2200);
    const finalUrl = page.url();
    const extracted = await page.evaluate(() => {
      const doc = (globalThis as { document?: { querySelectorAll: (selector: string) => ArrayLike<unknown> } })
        .document;
      const nodes = doc ? Array.from(doc.querySelectorAll('tr, div, li, section')) : [];
      const rows = nodes
        .map((el) =>
          String(((el as { textContent?: string | null })?.textContent || '')).replace(/\s+/g, ' ').trim()
        )
        .filter((t) => t && /(market\s*price|listed\s*median|current\s*quantity|current\s*sellers)/i.test(t))
        .slice(0, 600);
      const prioritized = rows
        .map((txt) => {
          let score = 0;
          if (/near\s*mint/i.test(txt)) score += 3;
          if (/comparison\s*prices/i.test(txt)) score += 2;
          if (/price\s*points/i.test(txt)) score += 2;
          if (/sales\s*history/i.test(txt)) score += 1;
          if (/chart/i.test(txt)) score -= 1;
          return { txt, score };
        })
        .sort((a, b) => b.score - a.score);
      return prioritized.map((x) => x.txt);
    });
    let marketPrice: number | null = null;
    let listedMedian: number | null = null;
    let currentQuantity: number | null = null;
    let currentSellers: number | null = null;
    for (const t of extracted) {
      if (!/near\s*mint/i.test(t)) continue;
      marketPrice = extractMarketPriceFromPageText(t);
      if (listedMedian == null) listedMedian = extractListedMedianFromPageText(t);
      if (currentQuantity == null) {
        currentQuantity = extractCountFromLabel(t, /\bcurrent\s*quantity\b[\s:]*([\d,]+)/i);
      }
      if (currentSellers == null) {
        currentSellers = extractCountFromLabel(t, /\bcurrent\s*sellers\b[\s:]*([\d,]+)/i);
      }
      if (marketPrice != null) break;
    }
    let bodyText = '';
    if (marketPrice == null) {
      const fullText = await page.textContent('body');
      bodyText = fullText || '';
      marketPrice = extractMarketPriceFromPageText(bodyText);
      if (listedMedian == null) listedMedian = extractListedMedianFromPageText(bodyText);
      if (currentQuantity == null) {
        currentQuantity = extractCountFromLabel(bodyText, /\bcurrent\s*quantity\b[\s:]*([\d,]+)/i);
      }
      if (currentSellers == null) {
        currentSellers = extractCountFromLabel(bodyText, /\bcurrent\s*sellers\b[\s:]*([\d,]+)/i);
      }
    }
    if (!bodyText) {
      bodyText = (await page.textContent('body')) || '';
    }
    await context.close();
    if (marketPrice == null) {
      throw new Error('Could not extract Near Mint Market Price from TCGPlayer page text.');
    }
    const comparisonMarketPrices = parseComparisonMarketPricesFromPageText(bodyText);
    return {
      marketPrice,
      comparisonMarketPrices,
      listedMedian,
      currentQuantity,
      currentSellers,
      usedAuth,
      capturedFromUrl: finalUrl,
      hint,
    };
  } finally {
    await browser.close();
  }
};

export const fetchTcgplayerProduct = async (
  productId: number,
  pageUrl?: string,
  opts?: TcgFetchOptions
): Promise<TcgplayerProductSnapshot> => {
  const nearMintUrl = buildTcgplayerNearMintProductUrl(productId, pageUrl);
  const base = await fetchFromApiDetails(productId, nearMintUrl);
  const capturedContext = {
    language: TCGPLAYER_NEAR_MINT_LANGUAGE,
    condition: TCGPLAYER_NEAR_MINT_CONDITION,
    printing: null as string | null,
  };
  let pageSnap: PageMarketCapture | null = null;
  let captureHint: string | undefined;

  try {
    pageSnap = await captureMarketFromPage(nearMintUrl);
  } catch (e) {
    captureHint = e instanceof Error ? e.message : String(e);
  }

  const marketPrice = pageSnap?.marketPrice ?? base.marketPrice;
  const apiFallbackHint =
    !pageSnap && Number.isFinite(base.marketPrice)
      ? 'Playwright Near Mint scrape unavailable; using mp-search-api marketPrice (may differ from NM page).'
      : undefined;
  // Keep "Load" resilient by default: no auth is required for fallback details.
  return {
    ...base,
    marketPrice,
    url: nearMintUrl,
    comparisonMarketPrices: pageSnap?.comparisonMarketPrices,
    medianPrice:
      typeof pageSnap?.listedMedian === 'number' && Number.isFinite(pageSnap.listedMedian)
        ? pageSnap.listedMedian
        : base.medianPrice,
    listings:
      typeof pageSnap?.currentQuantity === 'number' && Number.isFinite(pageSnap.currentQuantity)
        ? pageSnap.currentQuantity
        : base.listings,
    sellers:
      typeof pageSnap?.currentSellers === 'number' && Number.isFinite(pageSnap.currentSellers)
        ? pageSnap.currentSellers
        : base.sellers,
    source: pageSnap ? 'playwright_exact_url' : 'api_details',
    capturedFromUrl: pageSnap?.capturedFromUrl || nearMintUrl,
    capturedContext,
    usedAuth: pageSnap?.usedAuth ?? false,
    apiMarketPrice: base.marketPrice,
    priceDriftVsApi: Number.isFinite(marketPrice) ? marketPrice - base.marketPrice : null,
    captureHint: pageSnap?.hint || captureHint || apiFallbackHint || (opts?.forceRefresh ? undefined : undefined),
  };
};
