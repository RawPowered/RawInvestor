/**
 * Fetch and parse TCGPlayer editorial / content article pages (buyer's guides, etc.).
 */
import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import { extractTcgplayerProductIdsFromHtml } from './tcgplayerCatalog.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export type ContentArticleTable = {
  headers: string[];
  rows: string[][];
};

export type ContentArticlePayload = {
  title: string;
  excerpt: string;
  tables: ContentArticleTable[];
  /** tcgplayer.com/product/{id} links embedded in article HTML (e.g. Buy buttons). */
  linkedProductIds: number[];
};

const MAX_LINKED_PRODUCT_IDS = 500;

const normalizeLinkedProductIds = (html: string): number[] => {
  const raw = extractTcgplayerProductIdsFromHtml(html);
  const uniq = [...new Set(raw)].filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  return uniq.slice(0, MAX_LINKED_PRODUCT_IDS);
};

const normalizeHost = (host: string): string => host.replace(/^www\./i, '').toLowerCase();

export const assertTcgplayerArticleUrl = (raw: string): URL => {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new Error('Invalid URL');
  }
  const h = normalizeHost(u.hostname);
  if (h !== 'tcgplayer.com') throw new Error('URL must be on tcgplayer.com');
  if (!u.pathname.includes('/content/article')) {
    throw new Error('URL must be a TCGPlayer content article (/content/article/…)');
  }
  return u;
};

/** UUID segment in paths like `/content/article/{slug}/{uuid}/` */
const ARTICLE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Extract article id from a TCGPlayer article URL (last matching path segment). */
export const extractTcgplayerArticleUuid = (u: URL): string | null => {
  for (const seg of u.pathname.split('/').filter(Boolean).reverse()) {
    try {
      const decoded = decodeURIComponent(seg);
      if (ARTICLE_UUID_RE.test(decoded)) return decoded;
    } catch {
      /* ignore */
    }
  }
  return null;
};

const INFINITE_ARTICLE = (uuid: string) =>
  `https://infinite-api.tcgplayer.com/content/article/${encodeURIComponent(uuid)}/`;

const cellText = ($: cheerio.CheerioAPI, el: AnyNode): string =>
  $(el).text().replace(/\s+/g, ' ').trim();

export const parseTcgplayerArticleHtml = (html: string): ContentArticlePayload => {
  const $ = cheerio.load(html);
  const title =
    $('h1').first().text().replace(/\s+/g, ' ').trim() ||
    $('title').first().text().replace(/\s+/g, ' ').trim() ||
    '';
  const root =
    $('article').first().length > 0
      ? $('article').first()
      : $('main').first().length > 0
        ? $('main').first()
        : $('body');
  const firstP = root.find('p').first().text().replace(/\s+/g, ' ').trim();
  const excerpt = firstP.length > 280 ? `${firstP.slice(0, 277)}…` : firstP;

  const tables: ContentArticleTable[] = [];
  root.find('table').each((_, table) => {
    const rows: string[][] = [];
    $(table)
      .find('tr')
      .each((__, tr) => {
        const cells = $(tr)
          .find('th, td')
          .toArray()
          .map((c) => cellText($, c));
        if (cells.some((x) => x.length > 0)) rows.push(cells);
      });
    if (rows.length === 0) return;
    tables.push({ headers: rows[0], rows: rows.slice(1) });
  });

  const normalized = tables.filter((tb) => tb.headers.length > 0 || tb.rows.length > 0);

  const linkedProductIds = normalizeLinkedProductIds(html);

  return { title, excerpt, tables: normalized, linkedProductIds };
};

type InfiniteArticleJson = {
  result?: {
    article?: {
      title?: string;
      body?: string;
      teaser?: string;
    };
  };
};

/**
 * TCGPlayer article pages are SPAs (empty shell); real HTML lives on Infinite API.
 */
const fetchTcgplayerArticleFromInfiniteApi = async (uuid: string): Promise<ContentArticlePayload | null> => {
  const res = await fetch(INFINITE_ARTICLE(uuid), {
    headers: {
      'User-Agent': UA,
      Accept: 'application/json',
      Referer: 'https://www.tcgplayer.com/',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!res.ok) return null;
  let json: InfiniteArticleJson;
  try {
    json = (await res.json()) as InfiniteArticleJson;
  } catch {
    return null;
  }
  const art = json.result?.article;
  const bodyHtml = typeof art?.body === 'string' ? art.body.trim() : '';
  if (!bodyHtml) return null;

  const parsed = parseTcgplayerArticleHtml(`<article>${bodyHtml}</article>`);
  const apiTitle = typeof art?.title === 'string' ? art.title.replace(/\s+/g, ' ').trim() : '';
  const title = apiTitle || parsed.title;

  const teaserRaw = typeof art?.teaser === 'string' ? art.teaser.replace(/\s+/g, ' ').trim() : '';
  const excerpt =
    parsed.excerpt ||
    (teaserRaw.length > 280 ? `${teaserRaw.slice(0, 277)}…` : teaserRaw);

  const linkedProductIds = normalizeLinkedProductIds(bodyHtml);

  return { title, excerpt, tables: parsed.tables, linkedProductIds };
};

export const fetchTcgplayerContentArticle = async (articleUrl: string): Promise<ContentArticlePayload> => {
  const u = assertTcgplayerArticleUrl(articleUrl);
  const uuid = extractTcgplayerArticleUuid(u);
  if (uuid) {
    try {
      const fromApi = await fetchTcgplayerArticleFromInfiniteApi(uuid);
      if (fromApi) return fromApi;
    } catch {
      /* fall through to HTML fetch */
    }
  }

  const res = await fetch(articleUrl, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`TCGPlayer article HTTP ${res.status}`);
  const html = await res.text();
  return parseTcgplayerArticleHtml(html);
};

export type BuyersGuideSearchItem = { title: string; link: string };

/** Optional Google Programmable Search (Custom Search JSON API). */
export const searchBuyersGuideArticles = async (
  query: string,
  env: { apiKey?: string; cx?: string }
): Promise<{ configured: boolean; items: BuyersGuideSearchItem[]; error?: string }> => {
  const key = env.apiKey?.trim();
  const cx = env.cx?.trim();
  if (!key || !cx) {
    return { configured: false, items: [] };
  }
  const q = `${query} site:tcgplayer.com/content/article`.trim();
  const u = new URL('https://www.googleapis.com/customsearch/v1');
  u.searchParams.set('key', key);
  u.searchParams.set('cx', cx);
  u.searchParams.set('q', q);
  const res = await fetch(u.toString());
  if (!res.ok) {
    const t = await res.text();
    return { configured: true, items: [], error: `Google CSE HTTP ${res.status}: ${t.slice(0, 200)}` };
  }
  const j = (await res.json()) as {
    items?: Array<{ title?: string; link?: string }>;
  };
  const items = (j.items ?? [])
    .map((it) => ({
      title: String(it.title || '').trim(),
      link: String(it.link || '').trim(),
    }))
    .filter((it) => it.link.includes('tcgplayer.com/content/article'));
  return { configured: true, items };
};
