/**
 * TCGplayer **market chart** history (Martech weekly table on the product page).
 *
 * Strategy (in order):
 * 1. **XHR** — optional `PCGR_TCGPLAYER_HISTORY_URL_TEMPLATE` env (e.g. paste a
 *    DevTools-copied JSON URL; use `{productId}` placeholder), or return none.
 * 2. **Playwright** — load the product URL and read the accessibility table
 *    (`table[data-testid="History_Line"]` or fallbacks).
 *
 * Self-sampled history (append on each `/api/tcgplayer/product` refresh) is
 * handled on the client; see `tcgplayerSelfHistory.ts` in the client package.
 */

import { extractTcgplayerProductId, buildTcgplayerNearMintProductUrl } from './tcgplayer.js';

export type TcgplayerHistoryPoint = {
  at: number;
  marketPrice: number;
  /** Third table column when present (often weekly sales $ on TCGplayer). */
  volumeUsd?: number | null;
};

export type TcgplayerHistoryFetchResult = {
  points: TcgplayerHistoryPoint[];
  source: 'xhr_env' | 'playwright' | 'none';
  fetchedAt: number;
  hint?: string;
};

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export const parseUsdCell = (s: string): number | null => {
  const m = String(s).match(/\$?\s*([\d,]+\.?\d*)/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * Parses "M/D to M/D" (TCGplayer weekly rows) to epoch ms at **end** of range (UTC noon approx).
 * Handles year wrap (e.g. 12/20 to 1/3) using `refYear` for the start week.
 */
export const parseMartechWeekRangeToEndMs = (dateRange: string, refYear: number): number | null => {
  const m = String(dateRange)
    .trim()
    .match(/(\d{1,2})\/(\d{1,2})\s+to\s+(\d{1,2})\/(\d{1,2})/i);
  if (!m) return null;
  const m1 = parseInt(m[1], 10);
  const d1 = parseInt(m[2], 10);
  const m2 = parseInt(m[3], 10);
  const d2 = parseInt(m[4], 10);
  if ([m1, d1, m2, d2].some((x) => !Number.isFinite(x))) return null;

  let yEnd = refYear;
  if (m2 < m1 || (m2 === m1 && d2 < d1)) yEnd = refYear + 1;
  const end = new Date(yEnd, m2 - 1, d2, 12, 0, 0, 0);
  const t = end.getTime();
  return Number.isFinite(t) ? t : null;
};

const TABLE_ROW_SELECTORS = [
  'table[data-testid="History_Line"] tbody tr',
  '.martech-charts-history table tbody tr',
  '.price-guide__market-price-history-graph-container table tbody tr',
];

export const parseRowsFromTableHtml = (
  rows: { cells: string[] }[],
  refYear: number
): TcgplayerHistoryPoint[] => {
  const out: TcgplayerHistoryPoint[] = [];
  for (const { cells } of rows) {
    if (cells.length < 2) continue;
    const at = parseMartechWeekRangeToEndMs(cells[0], refYear);
    const marketPrice = parseUsdCell(cells[1]);
    if (at == null || marketPrice == null) continue;
    const vol = cells.length >= 3 ? parseUsdCell(cells[2]) : null;
    out.push({
      at,
      marketPrice,
      volumeUsd: vol != null && vol >= 0 ? vol : null,
    });
  }
  out.sort((a, b) => a.at - b.at);
  const dedup: TcgplayerHistoryPoint[] = [];
  for (const p of out) {
    const prev = dedup[dedup.length - 1];
    if (prev && prev.at === p.at && prev.marketPrice === p.marketPrice) continue;
    dedup.push(p);
  }
  return dedup;
};

/** Optional: `PCGR_TCGPLAYER_HISTORY_URL_TEMPLATE` with `{productId}` replaced. JSON = array of points or `{ points }`. */
export const tryFetchTcgplayerHistoryFromEnv = async (
  productId: number,
  refererUrl: string
): Promise<TcgplayerHistoryPoint[] | null> => {
  const tpl = String(process.env.PCGR_TCGPLAYER_HISTORY_URL_TEMPLATE || '').trim();
  if (!tpl || !tpl.includes('{productId}')) return null;
  const url = tpl.replace(/\{productId\}/g, String(productId));
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'application/json',
      Referer: refererUrl,
      Origin: 'https://www.tcgplayer.com',
    },
  });
  if (!res.ok) return null;
  const j = (await res.json()) as unknown;
  const arr = Array.isArray(j)
    ? j
    : j && typeof j === 'object' && Array.isArray((j as { points?: unknown }).points)
      ? (j as { points: unknown[] }).points
      : null;
  if (!arr?.length) return null;
  const out: TcgplayerHistoryPoint[] = [];
  for (const row of arr) {
    if (!row || typeof row !== 'object') continue;
    const o = row as Record<string, unknown>;
    const at = typeof o.at === 'number' ? o.at : typeof o.t === 'number' ? o.t : NaN;
    const marketPrice =
      typeof o.marketPrice === 'number'
        ? o.marketPrice
        : typeof o.price === 'number'
          ? o.price
          : NaN;
    if (Number.isFinite(at) && Number.isFinite(marketPrice) && marketPrice >= 0) {
      out.push({ at, marketPrice });
    }
  }
  return out.length ? out.sort((a, b) => a.at - b.at) : null;
};

export const fetchTcgplayerChartHistoryPlaywright = async (
  productPageUrl: string
): Promise<TcgplayerHistoryPoint[]> => {
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

  const browser = await chromium.launch({ headless: true });
  const refYear = new Date().getFullYear();
  try {
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
    });
    await page.goto(productPageUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    let rows: { cells: string[] }[] | null = null;
    for (const sel of TABLE_ROW_SELECTORS) {
      try {
        await page.waitForSelector(sel, { timeout: 20000 });
        rows = await page.$$eval(sel, (trs) =>
          trs.map((tr) => ({
            cells: [...tr.querySelectorAll('td')].map((td) => td.textContent?.trim() ?? ''),
          }))
        );
        if (rows?.length) break;
      } catch {
        rows = null;
      }
    }
    if (!rows?.length) return [];
    return parseRowsFromTableHtml(rows, refYear);
  } finally {
    await browser.close();
  }
};

export const fetchTcgplayerMarketHistory = async (productPageUrl: string): Promise<TcgplayerHistoryFetchResult> => {
  const fetchedAt = Date.now();
  const trimmed = productPageUrl.trim();
  const productId = extractTcgplayerProductId(trimmed);
  if (!productId) {
    return {
      points: [],
      source: 'none',
      fetchedAt,
      hint: 'Invalid tcgplayer.com product URL.',
    };
  }

  const nearMintUrl = buildTcgplayerNearMintProductUrl(productId, trimmed);

  try {
    const fromEnv = await tryFetchTcgplayerHistoryFromEnv(productId, nearMintUrl);
    if (fromEnv?.length) {
      return { points: fromEnv, source: 'xhr_env', fetchedAt };
    }
  } catch {
    /* fall through */
  }

  try {
    const pts = await fetchTcgplayerChartHistoryPlaywright(nearMintUrl);
    if (pts.length) {
      return { points: pts, source: 'playwright', fetchedAt };
    }
    return {
      points: [],
      source: 'none',
      fetchedAt,
      hint:
        process.env.NODE_ENV === 'production'
          ? 'No chart rows found. Open the product page, choose Near Mint + range (1Y), then retry. If the problem continues, reinstall Raw Investor from the official installer.'
          : 'No chart rows found. Open the product page, choose Near Mint + range (1Y), then retry. If Playwright is not installed, run: npx playwright install chromium (from server/).',
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      points: [],
      source: 'none',
      fetchedAt,
      hint: msg,
    };
  }
};
