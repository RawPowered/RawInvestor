/**
 * TCGPlayer set / catalog browse URLs → product ids → mp-search-api enrichment.
 */
import { fetchTcgplayerProductDetailsApi, buildTcgplayerNearMintProductUrl } from './tcgplayer.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const PRODUCT_LINK_ABSOLUTE_RE = /tcgplayer\.com\/product\/(\d+)/gi;
/** Search/grid pages often use href="/product/123/..." without the domain. */
const PRODUCT_LINK_PATH_RE = /\/product\/(\d+)/g;

const normalizeHost = (host: string): string => host.replace(/^www\./i, '').toLowerCase();

/** TCGPlayer catalog search URLs are SPAs; treat like `/search/pokemon/...`. */
export const isTcgplayerSearchUrl = (u: URL): boolean => u.pathname.includes('/search/');

/** Catalog/browse pages only — not content articles (those use /api/tcgplayer/content-article). */
export const assertTcgplayerCatalogBrowseUrl = (raw: string): URL => {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new Error('Invalid URL');
  }
  const h = normalizeHost(u.hostname);
  if (h !== 'tcgplayer.com') throw new Error('URL must be on tcgplayer.com');
  if (!/^https?:$/i.test(u.protocol)) throw new Error('URL must be http(s)');
  if (u.pathname.includes('/content/article')) {
    throw new Error('That URL is a TCGPlayer article — use Fetch on the buyer\'s guide field instead');
  }
  return u;
};

export const extractTcgplayerProductIdsFromHtml = (html: string): number[] => {
  const ids = new Set<number>();
  let m: RegExpExecArray | null;
  PRODUCT_LINK_ABSOLUTE_RE.lastIndex = 0;
  while ((m = PRODUCT_LINK_ABSOLUTE_RE.exec(html)) !== null) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n > 0) ids.add(n);
  }
  PRODUCT_LINK_PATH_RE.lastIndex = 0;
  while ((m = PRODUCT_LINK_PATH_RE.exec(html)) !== null) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n > 0) ids.add(n);
  }
  return [...ids].sort((a, b) => a - b);
};

const fetchCatalogHtmlHttp = async (url: string): Promise<string> => {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`Catalog page HTTP ${res.status}`);
  return res.text();
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const fetchCatalogHtmlPlaywright = async (
  url: string,
  warnings: string[],
  opts: { searchPage: boolean }
): Promise<string> => {
  let chromium: typeof import('playwright').chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new Error(
      process.env.NODE_ENV === 'production'
        ? 'Browser automation is not available. Reinstall Raw Investor from the official installer, or contact support.'
        : 'Playwright is not installed or catalog page had no product links in static HTML. Install with: npm install playwright && npx playwright install chromium'
    );
  }
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    if (opts.searchPage) {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 90000 });
      try {
        await page.waitForSelector('a[href*="/product/"]', { timeout: 45000 });
      } catch {
        warnings.push(
          'Catalog (search): product links did not appear within 45s — continuing with partial HTML.'
        );
      }
      for (let i = 0; i < 4; i += 1) {
        await page.evaluate(
          'window.scrollTo(0, Math.max(document.body.scrollHeight, document.documentElement.scrollHeight))'
        );
        await sleep(750);
      }
      await sleep(3500);
    } else {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
      await sleep(2500);
    }
    const html = await page.content();
    await context.close();
    return html;
  } finally {
    await browser.close();
  }
};

export type TcgplayerCatalogPreviewItem = {
  productId: number;
  productName: string;
  setName: string;
  rarityName: string | null;
  marketPrice: number;
  lowestPrice: number | null;
  medianPrice: number | null;
  url: string;
  imageUrl?: string | null;
};

const MAX_IDS = 500;
const BATCH_CONCURRENCY = 6;

const enrichIds = async (
  ids: number[],
  warnings: string[]
): Promise<TcgplayerCatalogPreviewItem[]> => {
  const out: TcgplayerCatalogPreviewItem[] = [];
  for (let i = 0; i < ids.length; i += BATCH_CONCURRENCY) {
    const chunk = ids.slice(i, i + BATCH_CONCURRENCY);
    const settled = await Promise.allSettled(
      chunk.map((id) =>
        fetchTcgplayerProductDetailsApi(id, buildTcgplayerNearMintProductUrl(id))
      )
    );
    settled.forEach((r, j) => {
      const id = chunk[j];
      if (r.status === 'fulfilled') {
        const d = r.value;
        out.push({
          productId: d.productId,
          productName: d.productName,
          setName: d.setName,
          rarityName: d.rarityName,
          marketPrice: d.marketPrice,
          lowestPrice: d.lowestPrice,
          medianPrice: d.medianPrice,
          url: `https://www.tcgplayer.com/product/${d.productId}`,
          imageUrl: d.imageUrl ?? null,
        });
      } else {
        const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
        warnings.push(`Product ${id}: ${msg}`);
      }
    });
  }
  return out;
};

export type CatalogPreviewResult = {
  items: TcgplayerCatalogPreviewItem[];
  warnings: string[];
  productIdCount: number;
};

/** Enrich explicit product ids (e.g. from article HTML) — same pipeline as catalog browse pages. */
export const previewTcgplayerProductIds = async (inputIds: number[]): Promise<CatalogPreviewResult> => {
  const warnings: string[] = [];
  let ids = [...new Set(inputIds.map((n) => Math.floor(Number(n))).filter((n) => Number.isFinite(n) && n > 0))];
  ids.sort((a, b) => a - b);
  if (ids.length === 0) {
    throw new Error('No valid TCGPlayer product ids provided.');
  }
  if (ids.length > MAX_IDS) {
    warnings.push(`Received ${ids.length} ids; only the first ${MAX_IDS} will be loaded.`);
    ids = ids.slice(0, MAX_IDS);
  }
  const items = await enrichIds(ids, warnings);
  return { items, warnings, productIdCount: ids.length };
};

export const previewTcgplayerCatalog = async (rawUrl: string): Promise<CatalogPreviewResult> => {
  const u = assertTcgplayerCatalogBrowseUrl(rawUrl);
  const warnings: string[] = [];
  const searchPage = isTcgplayerSearchUrl(u);
  let html: string;
  let ids: number[];

  if (searchPage) {
    try {
      html = await fetchCatalogHtmlPlaywright(u.toString(), warnings, { searchPage: true });
      ids = extractTcgplayerProductIdsFromHtml(html);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      warnings.push(`Rendered catalog fetch failed: ${msg}`);
      ids = [];
    }
  } else {
    html = await fetchCatalogHtmlHttp(u.toString());
    ids = extractTcgplayerProductIdsFromHtml(html);
    if (ids.length === 0) {
      try {
        html = await fetchCatalogHtmlPlaywright(u.toString(), warnings, { searchPage: false });
        ids = extractTcgplayerProductIdsFromHtml(html);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        warnings.push(`Rendered catalog fetch failed: ${msg}`);
      }
    }
  }

  if (ids.length === 0) {
    throw new Error(
      'No /product/{id} links found in page HTML — try a catalog or search URL after filters load, use Load linked products from an article, or paste product URLs manually.'
    );
  }
  if (ids.length > MAX_IDS) {
    warnings.push(`Found ${ids.length} product links; only the first ${MAX_IDS} will be loaded.`);
    ids = ids.slice(0, MAX_IDS);
  }
  const items = await enrichIds(ids, warnings);
  return { items, warnings, productIdCount: ids.length };
};
