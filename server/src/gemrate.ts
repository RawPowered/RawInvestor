/**

 * Proxy to gemrate.com's Universal Population Report.

 *

 * GemRate sits behind Cloudflare. Server-side `fetch` gets 403; we use Playwright

 * to load the site, pass the challenge, then call JSON APIs from the page context.

 *

 *   POST /universal-search-query  Body: {"query": "..."}

 *   GET  /card-details?gemrate_id=…  Header: X-Card-Details-Token (from page HTML)

 */



const GEMRATE_ORIGIN = 'https://www.gemrate.com';

const CF_SETTLE_MS = 2500;



const UA =

  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';



const playwrightMissingMessage = (): string =>

  process.env.NODE_ENV === 'production'

    ? 'Browser automation is not available. Reinstall Raw Investor from the official installer, or contact support.'

    : 'Playwright is not installed. From the server folder run: npm install playwright && npx playwright install chromium';



const loadChromium = async () => {

  try {

    return (await import('playwright')).chromium;

  } catch {

    throw new Error(playwrightMissingMessage());

  }

};



/** Load a GemRate path in headless Chromium, then run `fn` with the page (Cloudflare cookies set). */

const runWithGemRatePage = async <T>(

  path: string,

  fn: (page: import('playwright').Page) => Promise<T>

): Promise<T> => {

  const chromium = await loadChromium();

  const browser = await chromium.launch({ headless: true });

  try {

    const context = await browser.newContext({

      userAgent: UA,

      extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },

    });

    const page = await context.newPage();

    const url = path.startsWith('http') ? path : `${GEMRATE_ORIGIN}${path}`;

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

    await page.waitForTimeout(CF_SETTLE_MS);

    return await fn(page);

  } finally {

    await browser.close();

  }

};



export type GemRateCandidate = {

  gemrateId: string;

  description: string;

  populationType: string; // "Universal" | "PSA" | "BGS" | "SGC" | "CGC"

  totalPopulation: number;

  /** Deep-link that opens the full breakdown on GemRate. */

  detailUrl: string;

};



export type GemRateSearchResult = {

  query: string;

  candidates: GemRateCandidate[];

};



/** PSA 10 share + Universal Gems+ rate from GemRate card-details (after token bootstrap). */

export type GemRateCardSummary = {

  psa10Pct: number | null;

  universalGemsPct: number | null;

  description?: string;

};



const normalizeSearchRows = (raw: unknown, q: string): GemRateCandidate[] => {

  if (!Array.isArray(raw)) {

    throw new Error('GemRate search returned unexpected payload (not an array)');

  }

  return raw

    .map((r) => {

      const row = r as Record<string, unknown>;

      const id = String(row['gemrate_id'] ?? '');

      if (!id) return null;

      return {

        gemrateId: id,

        description: String(row['description'] ?? ''),

        populationType: String(row['population_type'] ?? ''),

        totalPopulation: Number(row['total_population'] ?? 0) || 0,

        detailUrl: `${GEMRATE_ORIGIN}/universal-search?q=${encodeURIComponent(

          q

        )}&gemrate_id=${encodeURIComponent(id)}`,

      } satisfies GemRateCandidate;

    })

    .filter((c): c is GemRateCandidate => c !== null);

};



const parseCardDetailsJson = (data: Record<string, unknown>): GemRateCardSummary => {

  const totalPop = Number(data['total_population'] ?? 0);

  const gemsPlus = Number(data['total_gems_or_greater'] ?? 0);

  const universalGemsPct =

    totalPop > 0 && Number.isFinite(gemsPlus)

      ? Math.round((gemsPlus / totalPop) * 10000) / 100

      : null;



  const popData = data['population_data'];

  let psa10Pct: number | null = null;

  if (Array.isArray(popData)) {

    const psaRow = popData.find(

      (row) => String((row as Record<string, unknown>)?.['grader'] ?? '').toLowerCase() === 'psa'

    ) as Record<string, unknown> | undefined;

    if (psaRow) {

      const grades = psaRow['grades'] as Record<string, unknown> | undefined;

      const g10 = Number(grades?.['g10'] ?? 0);

      const cardTotal = Number(psaRow['card_total_grades'] ?? 0);

      if (cardTotal > 0 && Number.isFinite(g10) && g10 >= 0) {

        psa10Pct = Math.round((g10 / cardTotal) * 10000) / 100;

      }

    }

  }



  return {

    psa10Pct,

    universalGemsPct,

    description: typeof data['description'] === 'string' ? data['description'] : undefined,

  };

};



export const searchGemRate = async (query: string): Promise<GemRateSearchResult> => {

  const q = query.trim();

  if (!q) return { query: q, candidates: [] };



  const raw = await runWithGemRatePage('/universal-search', async (page) =>

    page.evaluate(async (searchQuery: string) => {

      const res = await fetch('/universal-search-query', {

        method: 'POST',

        headers: {

          'Content-Type': 'application/json',

          Accept: 'application/json, text/javascript, */*; q=0.01',

          'X-Requested-With': 'XMLHttpRequest',

        },

        body: JSON.stringify({ query: searchQuery }),

      });

      if (!res.ok) {

        throw new Error(`GemRate search ${res.status}: ${res.statusText}`);

      }

      return res.json();

    }, q)

  );



  return { query: q, candidates: normalizeSearchRows(raw, q) };

};



/**

 * GemRate's `/card-details` JSON requires `X-Card-Details-Token`, which is

 * embedded in the universal-search HTML for the same `gemrate_id`.

 */

export const fetchGemRateCardSummary = async (

  gemrateId: string

): Promise<GemRateCardSummary | null> => {

  const id = gemrateId.trim();

  if (!id) return null;



  const path = `/universal-search?gemrate_id=${encodeURIComponent(id)}`;



  return runWithGemRatePage(path, async (page) => {

    const html = await page.content();

    const tokenM = html.match(/const cardDetailsToken = "([^"]+)"/);

    if (!tokenM?.[1]) return null;



    const data = await page.evaluate(

      async ({ gid, token }) => {

        const res = await fetch(`/card-details?gemrate_id=${encodeURIComponent(gid)}`, {

          headers: {

            Accept: 'application/json',

            'X-Card-Details-Token': token,

          },

        });

        if (!res.ok) return null;

        return res.json() as Promise<Record<string, unknown>>;

      },

      { gid: id, token: tokenM[1] }

    );



    if (!data || typeof data !== 'object') return null;

    return parseCardDetailsJson(data);

  });

};



/**

 * Build a high-signal GemRate query string from a PriceCharting-scraped card.

 * Includes the number to disambiguate same-name cards across sets.

 */

export const buildGemRateQuery = (card: {

  name: string;

  set: string;

  cardNumber: string;

}): string => {

  const parts = [card.name, card.cardNumber, card.set]

    .map((p) => (p ?? '').trim())

    .filter(Boolean);

  // Strip parenthetical suffixes from name e.g. "Pikachu ex (238)" -> "Pikachu ex"

  return parts.join(' ').replace(/\s*\(\d+\)\s*/g, ' ').replace(/\s+/g, ' ').trim();

};


