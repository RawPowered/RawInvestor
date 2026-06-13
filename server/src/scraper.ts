import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';

export type GradePrice = {
  /** Normalized identifier, e.g. "ungraded", "grade_9", "grade_9_5", "psa_10", "bgs_10_black". */
  key: string;
  /** Display label exactly as shown on PriceCharting, e.g. "Grade 9.5", "BGS 10 Black". */
  label: string;
  price: number;
};

export type ScrapedCard = {
  url: string;
  name: string;
  set: string;
  /** Card number extracted from the title, e.g. "106" from "Meowth #106". */
  cardNumber: string;
  /** When PC lists Genre "Sealed Product", client may default row kind to sealed. */
  suggestedPortfolioKind?: 'single' | 'sealed' | null;
  /** Parsed from "Release Date" on the product page; used to drop pre-release chart junk. */
  releaseDateMs: number | null;
  raw: number;
  grade9: number;
  psa10: number;
  /** Full grade matrix from PriceCharting's #full-prices table, in source order. */
  allPrices: GradePrice[];
  imageUrl: string | null;
  /** Best-effort recent-sales history scraped from PriceCharting. Each entry
   *  is one observed completed sale, so exactly one of raw/grade9/psa10 is
   *  populated. Empty when the page has no recent-sales table. */
  recentSales: RecentSale[];
  /** Best-effort volume numbers scraped off the page (e.g. "Sales This Week").
   *  Any field may be undefined if the page doesn't display that stat. These
   *  are site-wide aggregates across all graders, not per-grade. */
  salesVolume: SalesVolume;
  /** Canonical tcgplayer.com product URL when PriceCharting exposes a TCGPlayer ID. */
  tcgplayerUrl: string | null;
  /**
   * Catalog product IDs read from `data-product-id` on the page (see PC HTML).
   * Used to verify collection-import rows match the scraped product.
   */
  pcProductIds: string[];
};

export type SalesVolume = {
  week?: number;
  month?: number;
  year?: number;
  total?: number;
};

export type RecentSale = {
  /** Epoch ms of the sale. */
  at: number;
  /** Which grade bucket the sale falls into. */
  grade: 'raw' | 'grade9' | 'psa10' | 'other';
  price: number;
  /** Raw grade label as scraped, for debugging. */
  label?: string;
};

/** Max rows from one sales table so a huge early table does not starve PSA/G9 tables. */
const RECENT_SALES_PER_TABLE_CAP = 150;
/** Cap merged rows (newest wins) so payloads stay bounded. */
const RECENT_SALES_TOTAL_CAP = 500;

/** ISO-ish date parser that handles PriceCharting's "YYYY-MM-DD" and
 *  "Mon DD, YYYY" formats, and the "X days ago" relative strings.
 *  Date-only strings use **local noon** so UIs do not show every sale at 12:00 AM. */
export const parseSaleDate = (txt: string): number | null => {
  if (!txt) return null;
  const t = txt.trim();
  const now = Date.now();
  if (/^today$/i.test(t)) return now;
  if (/^yesterday$/i.test(t)) return now - 24 * 3600 * 1000;
  const relMatch = t.match(/^(\d+)\s+(day|week|month|year)s?\s+ago$/i);
  if (relMatch) {
    const n = parseInt(relMatch[1], 10);
    const mult: Record<string, number> = {
      day: 24 * 3600 * 1000,
      week: 7 * 24 * 3600 * 1000,
      month: 30 * 24 * 3600 * 1000,
      year: 365 * 24 * 3600 * 1000,
    };
    return now - n * mult[relMatch[2].toLowerCase()];
  }

  const isoDay = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDay) {
    const y = Number(isoDay[1]);
    const mo = Number(isoDay[2]) - 1;
    const da = Number(isoDay[3]);
    return new Date(y, mo, da, 12, 0, 0, 0).getTime();
  }

  const parsed = Date.parse(t);
  if (!Number.isFinite(parsed)) return null;

  const hasExplicitTime =
    /(?:^|[\s,;T])\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?/i.test(t) ||
    /t\d{2}:\d{2}/i.test(t);
  if (hasExplicitTime) return parsed;

  const d = new Date(parsed);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0).getTime();
};

/** Bucket a free-text grade label into one of our three tracked grades. */
const bucketGrade = (label: string): RecentSale['grade'] => {
  const s = label.toLowerCase();
  if (/\bpsa\s*10\b|graded\s*10\b/.test(s)) return 'psa10';
  if (/\bgrade\s*9(?!\.5)\b|\bpsa\s*9(?!\.5)\b/.test(s)) return 'grade9';
  if (/\bungraded\b|\braw\b|\bloose\b/.test(s)) return 'raw';
  return 'other';
};

const normalizeLabel = (label: string): string =>
  label
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/\./g, '_')
    .replace(/[^a-z0-9_]/g, '');

export const parsePrice = (txt: string): number => {
  if (!txt) return NaN;
  const m = txt.replace(/\s+/g, ' ').match(/\$?\s*([\d,]+(?:\.\d+)?)/);
  if (!m) return NaN;
  const n = parseFloat(m[1].replace(/,/g, ''));
  return isNaN(n) ? NaN : n;
};

const medianOf = (vals: number[]): number | null => {
  const arr = vals.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (!arr.length) return null;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
};

/**
 * Convert a PriceCharting URL into a filesystem-safe slug we can use for
 * both image filenames and cache keys.
 */
/**
 * Best-effort "Release Date" from the PC details block (table row, dt/dd, or
 * inline "Release Date: …" text). Null when not found or unparseable.
 */
export const extractReleaseDateMs = (
  $: ReturnType<typeof cheerio.load>
): number | null => {
  let found: number | null = null;

  const tryParse = (txt: string): boolean => {
    const t = txt.trim();
    if (!t || t === '-' || /^n\/?a$/i.test(t)) return false;
    const p = Date.parse(t);
    if (Number.isFinite(p)) {
      found = p;
      return true;
    }
    return false;
  };

  $('tr').each((_, tr) => {
    if (found != null) return false;
    const $tr = $(tr);
    const ch = $tr.children('td, th');
    if (ch.length < 2) return;
    const label = $(ch[0]).text().trim().toLowerCase();
    if (!/release\s*date/.test(label)) return;
    // Second cell is the date whether the label was td or th (PC uses th+td).
    const val = $(ch[1]).text().trim();
    if (tryParse(val)) return false;
  });

  // Some layouts: two td columns where the value is not the second child.
  if (found == null) {
    $('tr').each((_, tr) => {
      if (found != null) return false;
      const $tr = $(tr);
      const label = $tr.find('td, th').first().text().trim().toLowerCase();
      if (!/release\s*date/.test(label)) return;
      const tds = $tr.find('td');
      if (tds.length >= 2) {
        const val = $(tds[1]).text().trim();
        if (tryParse(val)) return false;
      }
    });
  }

  if (found == null) {
    $('dt').each((_, dt) => {
      if (found != null) return false;
      const t = $(dt).text().trim().toLowerCase();
      if (!/release\s*date/.test(t)) return;
      tryParse($(dt).next('dd').first().text());
    });
  }

  if (found == null) {
    const body = $.root().text().replace(/\s+/g, ' ');
    const m =
      body.match(/release\s*date\s*[:\s]+([^\n\r|]{4,40}?)(?:\||Published|Genre|$)/i) ||
      body.match(/release\s*date\s*[:\s]+([A-Za-z]+\s+\d{1,2},\s*\d{4})/i);
    if (m) tryParse(m[1]);
  }

  return found;
};

/** Genre line from product details (e.g. "Sealed Product", "Pokemon Card"). */
export const extractGenreLabel = ($: ReturnType<typeof cheerio.load>): string => {
  let found = '';
  $('tr').each((_, tr) => {
    if (found) return false;
    const $tr = $(tr);
    const ch = $tr.children('td, th');
    if (ch.length < 2) return;
    const label = $(ch[0]).text().trim().toLowerCase();
    if (!/^genre\b/.test(label)) return;
    found = $(ch[1]).text().trim();
    return false;
  });
  if (!found) {
    $('dt').each((_, dt) => {
      if (found) return false;
      const t = $(dt).text().trim().toLowerCase();
      if (!/^genre\b/.test(t)) return;
      found = $(dt).next('dd').first().text().trim();
      return false;
    });
  }
  return found;
};

export const slugFromUrl = (url: string): string => {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/^\/+|\/+$/g, '');
    return path.replace(/\//g, '_').replace(/[^a-z0-9_-]/gi, '').toLowerCase() || 'card';
  } catch {
    return 'card';
  }
};

/**
 * TCGPlayer product URL from PriceCharting card details.
 * Looks for a "TCGPlayer ID" label in table/dl/text layouts.
 */
export const extractTcgplayerUrl = (
  $: ReturnType<typeof cheerio.load>
): string | null => {
  let productId: number | null = null;
  let directUrl: string | null = null;

  const parseMaybeId = (txt: string): number | null => {
    const m = txt.match(/\b(\d{4,})\b/);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const normalizeDirectProductUrl = (raw: string): string | null => {
    const s = String(raw || '').trim();
    if (!s) return null;
    const decodeCandidates = [s];
    try {
      decodeCandidates.push(decodeURIComponent(s));
    } catch {
      // ignore malformed encoding
    }
    for (const cand of decodeCandidates) {
      const m = cand.match(/https?:\/\/(?:www\.)?tcgplayer\.com\/product\/(\d+)/i);
      if (m) return `https://www.tcgplayer.com/product/${m[1]}`;
      if (/^https?:\/\/(?:www\.)?tcgplayer\.com\/product\/\d+/i.test(cand)) {
        const u = cand.split('#')[0].split('?')[0];
        const id = parseMaybeId(u);
        if (id) return `https://www.tcgplayer.com/product/${id}`;
      }
    }
    return null;
  };

  const tryCell = (label: string, value: string): boolean => {
    if (!/tcgplayer\s*id/i.test(label)) return false;
    const n = parseMaybeId(value);
    if (!n) return false;
    productId = n;
    return true;
  };

  $('tr').each((_, tr) => {
    if (productId != null) return false;
    const $tr = $(tr);
    const ch = $tr.children('td, th');
    if (ch.length < 2) return;
    const label = $(ch[0]).text().trim();
    const value = $(ch[1]).text().trim();
    if (tryCell(label, value)) return false;
  });

  if (productId == null) {
    $('dt').each((_, dt) => {
      if (productId != null) return false;
      const label = $(dt).text().trim();
      const value = $(dt).next('dd').first().text().trim();
      if (tryCell(label, value)) return false;
    });
  }

  if (productId == null) {
    const body = $.root().text().replace(/\s+/g, ' ');
    const m = body.match(/tcgplayer\s*id\s*[:\s]+(\d{4,})/i);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > 0) productId = n;
    }
  }

  // Affiliate/offer links may contain direct product URL in href or query params.
  if (productId == null && !directUrl) {
    $('a[href]').each((_, a) => {
      if (productId != null || directUrl) return false;
      const href = String($(a).attr('href') || '').trim();
      if (!href) return;
      const immediate = normalizeDirectProductUrl(href);
      if (immediate) {
        directUrl = immediate;
        return false;
      }
      try {
        const base = href.startsWith('http') ? undefined : 'https://www.pricecharting.com';
        const u = new URL(href, base);
        const paramCandidates = ['u', 'url', 'target', 'dest', 'destination'];
        for (const k of paramCandidates) {
          const v = u.searchParams.get(k);
          if (!v) continue;
          const parsed = normalizeDirectProductUrl(v);
          if (parsed) {
            directUrl = parsed;
            return false;
          }
        }
      } catch {
        // ignore malformed href
      }
    });
  }

  if (!directUrl) {
    const body = $.html();
    const m = body.match(/https?:\/\/(?:www\.)?tcgplayer\.com\/product\/(\d+)/i);
    if (m) {
      directUrl = `https://www.tcgplayer.com/product/${m[1]}`;
    }
  }

  if (directUrl) return directUrl;
  return productId ? `https://www.tcgplayer.com/product/${productId}` : null;
};

/**
 * Pure parser. Takes the raw HTML of a PriceCharting card page and returns
 * normalized data. No network I/O here — keeps it unit-testable.
 */
/** Collect PriceCharting numeric catalog IDs from `data-product-id` attributes. */
export const extractPcProductIds = ($: cheerio.CheerioAPI): string[] => {
  const gather = (root: cheerio.Cheerio<AnyNode>) => {
    const ids = new Set<string>();
    root.find('[data-product-id]').each((_, el) => {
      const v = String($(el).attr('data-product-id') || '').trim();
      if (/^\d+$/.test(v)) ids.add(v);
    });
    return ids;
  };
  const scoped = $('#product_details');
  let ids = scoped.length ? gather(scoped) : new Set<string>();
  if (ids.size === 0) ids = gather($('body'));
  return [...ids];
};

export const parseCardHtml = (html: string, url: string): ScrapedCard => {
  const $ = cheerio.load(html);
  const releaseDateMs = extractReleaseDateMs($);
  const genreLabel = extractGenreLabel($);
  const suggestedPortfolioKind = /\bsealed\s+product\b/i.test(genreLabel)
    ? ('sealed' as const)
    : null;
  const tcgplayerUrl = extractTcgplayerUrl($);
  const pcProductIds = extractPcProductIds($);

  const name =
    $('h1#product_name').clone().children('a').remove().end().text().trim() ||
    $('h1#product_name').text().trim() ||
    $('h1').first().text().trim();

  const setName =
    $('h1#product_name a').first().text().trim() ||
    $('#product_console a, .console-name a').first().text().trim() ||
    $('#product_console, .console-name').first().text().trim();

  // Card number lives in the product name (e.g. "Meowth #106") or in the URL.
  // Prefer the product name so we don't confuse e.g. "3" in a set name.
  let cardNumber = '';
  const h1Text = $('h1#product_name').text().trim();
  const numMatch = h1Text.match(/#\s*([0-9]+[a-zA-Z]?)/);
  if (numMatch) cardNumber = numMatch[1];
  if (!cardNumber) {
    // Fallback: last numeric segment of the URL slug
    // e.g. /game/pokemon-phantasmal-flames/meowth-106 -> 106
    const urlMatch = url.match(/-(\d+)(?:\/|$)/);
    if (urlMatch) cardNumber = urlMatch[1];
  }

  const prices: { raw?: number; grade9?: number; psa10?: number } = {};

  // Strategy 1 — header-aware parse of the summary pricing table.
  // On Pokemon card pages the columns are: Ungraded | Grade 9 | Grade 9.5 | PSA 10.
  // #new_price is Grade 9.5 (NOT PSA 10) so we can't trust raw IDs — use headers.
  const summaryTable = $('table').filter((_, t) => {
    const txt = $(t).find('th').text().toLowerCase();
    return txt.includes('psa 10') && txt.includes('ungraded');
  }).first();

  if (summaryTable.length) {
    const headers: string[] = [];
    summaryTable.find('tr').first().find('th').each((_, th) => {
      headers.push($(th).text().trim().toLowerCase());
    });
    const priceRow = summaryTable
      .find('tr')
      .filter((_, tr) => $(tr).find('td .price, td.price').length > 0)
      .first();
    const cells = priceRow.find('td').toArray();
    cells.forEach((td, i) => {
      const header = headers[i] || '';
      const priceTxt = $(td).find('.price').first().text() || $(td).text();
      const val = parsePrice(priceTxt);
      if (isNaN(val)) return;
      if (/ungraded|raw|loose/.test(header) && prices.raw == null) prices.raw = val;
      else if (/^grade\s*9\s*$/.test(header) && prices.grade9 == null) prices.grade9 = val;
      else if (/psa\s*10/.test(header) && prices.psa10 == null) prices.psa10 = val;
    });
  }

  // Strategy 2 — row-label fallback for detail tables further down the page.
  $('table tr').each((_, tr) => {
    const $tr = $(tr);
    const label = $tr.find('td, th').first().text().trim().toLowerCase();
    if (!label) return;
    const priceTxt =
      $tr.find('.price, .js-price').first().text() ||
      $tr.find('td, th').eq(1).text();
    const val = parsePrice(priceTxt);
    if (isNaN(val)) return;
    if (prices.raw == null && /^(ungraded|raw|loose)\b/.test(label)) prices.raw = val;
    if (prices.grade9 == null && /^grade\s*9(?!\.5)\b/.test(label)) prices.grade9 = val;
    if (prices.psa10 == null && /^psa\s*10\b|^graded\s*10\b/.test(label)) prices.psa10 = val;
  });

  // Strategy 3 — raw ID fallback for non-card product types.
  const byId = (id: string): number => {
    const cell = $(`#${id}`);
    if (!cell.length) return NaN;
    return parsePrice(cell.find('.price, .js-price').first().text() || cell.text());
  };
  if (prices.raw == null) {
    const v = byId('used_price');
    if (!isNaN(v)) prices.raw = v;
  }

  // Full price matrix from the #full-prices details table further down the page.
  // Order matters — we preserve PriceCharting's source order for display.
  const allPrices: GradePrice[] = [];
  const seen = new Set<string>();
  $('#full-prices table tr').each((_, tr) => {
    const $tr = $(tr);
    const label = $tr.find('td').eq(0).text().trim();
    const priceTxt = $tr.find('td.price, td .price').first().text().trim() ||
      $tr.find('td').eq(1).text().trim();
    if (!label || !priceTxt || priceTxt === '-') return;
    const val = parsePrice(priceTxt);
    if (isNaN(val)) return;
    const key = normalizeLabel(label);
    if (seen.has(key)) return;
    seen.add(key);
    allPrices.push({ key, label, price: val });
  });

  // Image: PriceCharting wraps the main card scan in `<div id="product_details">
  // <div class="cover"><a><img src="..."></a></div></div>`. Fall back to any
  // storage.googleapis.com/images.pricecharting.com URL, then og:image.
  let imageUrl: string | null =
    $('#product_details .cover img').first().attr('src') ||
    $('div.cover img').first().attr('src') ||
    $('img#product_image').attr('src') ||
    $('meta[property="og:image"]').attr('content') ||
    null;

  if (!imageUrl) {
    // Last resort: regex-scan the HTML for a PC image CDN URL.
    const m = html.match(
      /https?:\/\/(?:storage\.googleapis\.com\/images\.pricecharting\.com|images\.pricecharting\.com)\/[^\s"'<>]+\.(?:jpe?g|png|webp)/i
    );
    if (m) imageUrl = m[0];
  }

  if (imageUrl && imageUrl.startsWith('//')) imageUrl = 'https:' + imageUrl;

  // Recent sales table. PriceCharting usually exposes this as a table with
  // an id or class hinting at sales/auctions/completed listings.
  //
  // Extraction is HEADER-AWARE so we don't accidentally pick the Shipping
  // column (which on some pages precedes Price and holds constant ~$6
  // values) as the sale price. Columns are classified by their header
  // label; rows with no classifiable grade are SKIPPED, not defaulted to
  // raw (which previously mis-bucketed half the table).
  const recentSalesScratch: RecentSale[] = [];
  $('table').each((_, t) => {
    const $t = $(t);
    const headerCells = $t.find('thead th, thead td');
    const headers: string[] = (
      headerCells.length
        ? headerCells
        : $t.find('tr').first().find('th, td')
    ).toArray().map((th) => $(th).text().trim().toLowerCase());
    const headerText = headers.join(' ');
    if (!/date|sold|listing/.test(headerText)) return;
    if (!/price|sold|total|bid/.test(headerText)) return;

    // Classify each header column.
    let dateCol = -1;
    let priceCol = -1;
    let priceColScore = -1;
    let gradeCol = -1;
    const shippingCols = new Set<number>();
    headers.forEach((h, i) => {
      if (/\bdate\b|\bsold\s+on\b|\bended?\b/.test(h) && dateCol === -1) dateCol = i;
      if (/\bshipping\b|\bpostage\b|\bfee[s]?\b|\bs\&h\b|\bship\b/.test(h)) shippingCols.add(i);
      if (/\bgrade\b|\bcondition\b|\btype\b|\bgrader\b/.test(h) && gradeCol === -1) gradeCol = i;
      // Score price candidates - "sold for" beats "total" beats "price".
      let score = -1;
      if (/\bsold\s+for\b|\bsold\s+price\b/.test(h)) score = 3;
      else if (/\btotal\b/.test(h)) score = 2;
      else if (/\bprice\b|\bamount\b|\bbid\b/.test(h)) score = 1;
      if (score > priceColScore && !shippingCols.has(i)) {
        priceColScore = score;
        priceCol = i;
      }
    });

    // Grade context from the table itself: id="psa10_sales", class="grade9_sales"
    // or a preceding <h2>/<h3> with "PSA 10 Sales" etc.
    const tableCtx = (
      ($t.attr('id') || '') + ' ' +
      ($t.attr('class') || '') + ' ' +
      ($t.prevAll('h1, h2, h3, h4, caption').first().text() || '')
    ).toLowerCase();
    const tableGrade: RecentSale['grade'] | null =
      /(psa_?10|psa-?10|psa\s*10)/.test(tableCtx) ? 'psa10' :
      /(grade_?9|grade-?9|grade\s*9)(?!\.5)/.test(tableCtx) ? 'grade9' :
      /(ungraded|raw|loose)/.test(tableCtx) ? 'raw' :
      null;

    let rowsThisTable = 0;
    const pendingRows: Array<{
      at: number;
      price: number;
      grade: RecentSale['grade'] | null;
      label?: string;
    }> = [];
    $t.find('tbody tr, tr').each((_, tr) => {
      if (rowsThisTable >= RECENT_SALES_PER_TABLE_CAP) return false;
      const cells = $(tr).find('td').toArray().map((td) => $(td).text().trim());
      if (cells.length < 2) return;

      // Resolve date index - prefer the classified column; fall back to any
      // cell matching a date-like pattern.
      let dateIdx = dateCol;
      if (dateIdx === -1 || !cells[dateIdx]) {
        cells.forEach((c, i) => {
          if (dateIdx === -1 && /^\d{4}-\d{2}-\d{2}\b|\d+\s+(day|week|month|year)s?\s+ago|^(today|yesterday)$/i.test(c)) {
            dateIdx = i;
          }
        });
      }
      if (dateIdx === -1) return;

      // Resolve price index: classified column first, else the LARGEST $ value
      // in the row (which is almost always the sale price - shipping is tiny,
      // fees are tiny, only the sale price is substantial).
      let priceIdx = priceCol;
      let priceVal = priceIdx >= 0 ? parsePrice(cells[priceIdx] || '') : NaN;
      if (!Number.isFinite(priceVal) || priceVal <= 0) {
        let bestIdx = -1;
        let bestVal = -1;
        cells.forEach((c, i) => {
          if (shippingCols.has(i)) return;
          if (i === dateIdx) return;
          // Require an actual $ so "PSA 10" in the grade column isn't
          // misread as $10.
          if (!/\$/.test(c)) return;
          const v = parsePrice(c);
          if (Number.isFinite(v) && v > bestVal) {
            bestVal = v;
            bestIdx = i;
          }
        });
        priceIdx = bestIdx;
        priceVal = bestVal;
      }
      if (priceIdx === -1 || !Number.isFinite(priceVal) || priceVal <= 1) return;

      // Resolve grade: prefer the table's own context; then the header-classified
      // grade column; then scan the whole row. Rows with no grade are SKIPPED
      // so unknown rows don't pollute the "raw" bucket.
      let gradeLabel = '';
      let grade: RecentSale['grade'] | null = tableGrade;
      if (!grade && gradeCol >= 0 && cells[gradeCol]) {
        gradeLabel = cells[gradeCol];
        const bucketed = bucketGrade(gradeLabel);
        if (bucketed !== 'other') grade = bucketed;
      }
      if (!grade) {
        // Scan all non-date/price cells (full row text) for grade words.
        const rowText = cells.filter((_, i) => i !== dateIdx && i !== priceIdx).join(' ');
        const bucketed = bucketGrade(rowText);
        if (bucketed !== 'other') {
          grade = bucketed;
          gradeLabel = rowText;
        }
      }
      const at = parseSaleDate(cells[dateIdx]);
      if (at == null) return;
      pendingRows.push({ at, grade, price: priceVal, label: gradeLabel || undefined });
      rowsThisTable += 1;
    });

    // Some PC layouts don't expose table grade context in headers/ids. Infer
    // table bucket from median price against current card anchors.
    let inferredTableGrade: RecentSale['grade'] | null = null;
    if (!tableGrade && pendingRows.some((r) => !r.grade)) {
      const med = medianOf(pendingRows.map((r) => r.price));
      if (med != null && med > 0) {
        const anchors: Array<{ grade: RecentSale['grade']; price: number }> = [];
        if (Number.isFinite(prices.raw) && (prices.raw ?? 0) > 0) anchors.push({ grade: 'raw', price: prices.raw as number });
        if (Number.isFinite(prices.grade9) && (prices.grade9 ?? 0) > 0) anchors.push({ grade: 'grade9', price: prices.grade9 as number });
        if (Number.isFinite(prices.psa10) && (prices.psa10 ?? 0) > 0) anchors.push({ grade: 'psa10', price: prices.psa10 as number });
        let best: { grade: RecentSale['grade']; relErr: number } | null = null;
        for (const a of anchors) {
          const relErr = Math.abs(med - a.price) / a.price;
          if (!best || relErr < best.relErr) best = { grade: a.grade, relErr };
        }
        // Require reasonably-close anchor so Grade 7/8/9.5 tables aren't
        // misclassified into raw/9/10 buckets.
        if (best && best.relErr <= 0.22) inferredTableGrade = best.grade;
      }
    }

    for (const row of pendingRows) {
      const grade = row.grade ?? inferredTableGrade;
      if (!grade) continue;
      recentSalesScratch.push({
        at: row.at,
        grade,
        price: row.price,
        label: row.label,
      });
    }
  });

  const dedup = new Map<string, RecentSale>();
  for (const s of recentSalesScratch) {
    const k = `${Math.round(s.at)}|${s.grade}|${s.price.toFixed(2)}`;
    if (!dedup.has(k)) dedup.set(k, s);
  }
  const recentSalesDeduped = Array.from(dedup.values());
  recentSalesDeduped.sort((a, b) => a.at - b.at);
  const recentSales =
    recentSalesDeduped.length <= RECENT_SALES_TOTAL_CAP
      ? recentSalesDeduped
      : recentSalesDeduped.slice(-RECENT_SALES_TOTAL_CAP);

  // Sales volume stats. PriceCharting renders these in a few places -
  // sometimes a small sidebar box, sometimes a "Sales" section. We look
  // for labelled numbers matching common patterns like "Sales This Week"
  // or "Monthly Sales". Missing fields stay undefined.
  const salesVolume: SalesVolume = {};
  const bodyText = $('body').text().replace(/\s+/g, ' ');
  const volumeRegexes: Array<[keyof SalesVolume, RegExp]> = [
    ['week',  /(?:sales\s+this\s+week|weekly\s+sales|this\s+week)\s*:?\s*([0-9,]+)/i],
    ['month', /(?:sales\s+this\s+month|monthly\s+sales|this\s+month|30[-\s]?day\s+sales)\s*:?\s*([0-9,]+)/i],
    ['year',  /(?:sales\s+this\s+year|yearly\s+sales|annual\s+sales)\s*:?\s*([0-9,]+)/i],
    ['total', /(?:total\s+sales|all[-\s]?time\s+sales|lifetime\s+sales)\s*:?\s*([0-9,]+)/i],
  ];
  for (const [key, re] of volumeRegexes) {
    const m = bodyText.match(re);
    if (m) {
      const n = parseInt(m[1].replace(/,/g, ''), 10);
      if (Number.isFinite(n) && n >= 0) salesVolume[key] = n;
    }
  }

  // Secondary pattern - PriceCharting sometimes uses structured <dt>/<dd>
  // or <th>/<td> pairs for these stats. Walk any such pairings as a fallback.
  if (salesVolume.week == null || salesVolume.month == null) {
    $('dt, th').each((_, el) => {
      const label = $(el).text().trim().toLowerCase();
      const next = $(el).next('dd, td').text().trim();
      if (!next) return;
      const num = parseInt(next.replace(/[,\s]/g, ''), 10);
      if (!Number.isFinite(num) || num < 0) return;
      if (salesVolume.week == null && /(weekly|this\s+week)/.test(label)) salesVolume.week = num;
      else if (salesVolume.month == null && /(monthly|this\s+month|30[-\s]?day)/.test(label)) salesVolume.month = num;
      else if (salesVolume.year == null && /(yearly|this\s+year|annual)/.test(label)) salesVolume.year = num;
      else if (salesVolume.total == null && /(total|all[-\s]?time|lifetime)\s+sales/.test(label)) salesVolume.total = num;
    });
  }

  return {
    url,
    name: name || '',
    set: setName || '',
    cardNumber,
    suggestedPortfolioKind,
    releaseDateMs,
    raw: prices.raw ?? 0,
    grade9: prices.grade9 ?? 0,
    psa10: prices.psa10 ?? 0,
    allPrices,
    imageUrl,
    recentSales,
    salesVolume,
    tcgplayerUrl,
    pcProductIds,
  };
};
