import { randomUUID } from 'node:crypto';
import type { ScrapedCard } from './scraper.js';
import { parseCardHtml, slugFromUrl } from './scraper.js';
import { downloadImage } from './image.js';
import {
  defaultEmptyMeta,
  feesFromMetaDoc,
  getCardById,
  openAppPortfolioDb,
  readPortfolioMeta,
  upsertCardFull,
  writePortfolioMeta,
} from './portfolioCardsRepository.js';
import { normalizeForMatch } from './extensionCapture.js';
import { extractTcgplayerProductId, fetchTcgplayerProduct } from './tcgplayer.js';
import { canonicalizePricechartingUrl as canonicalizePricechartingUrlImpl } from './pricechartingCanonical.js';

const DEFAULT_P10 = 0.3;
const DEFAULT_P9 = 0.5;

const PC_FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

/** Re-export for callers that imported from `pricechartingSync`. */
export const canonicalizePricechartingUrl = canonicalizePricechartingUrlImpl;

export type PricechartingFetchResult = {
  scraped: ScrapedCard;
  slug: string;
  localImage: string | null;
  canonicalUrl: string;
};

/**
 * Fetch + parse a PriceCharting product page (same pipeline as Add Card → Fetch).
 */
export const fetchPricechartingProductWithImages = async (
  canonicalUrl: string,
  imagesDir: string
): Promise<PricechartingFetchResult> => {
  const pageRes = await fetch(canonicalUrl, { headers: PC_FETCH_HEADERS });
  if (!pageRes.ok) throw new Error(`PriceCharting responded ${pageRes.status}`);
  const html = await pageRes.text();
  const scraped = parseCardHtml(html, canonicalUrl);
  const slug = slugFromUrl(canonicalUrl);
  let localImage: string | null = null;
  if (scraped.imageUrl) {
    try {
      const dl = await downloadImage(scraped.imageUrl, slug, imagesDir);
      localImage = dl.relPath;
    } catch (e) {
      console.warn(`[image] download failed for ${scraped.imageUrl}:`, e);
    }
  }
  return { scraped, slug, localImage, canonicalUrl };
};

const pickPcProductId = (scraped: ScrapedCard): string | undefined => {
  const id = scraped.pcProductIds?.find((x) => String(x || '').trim());
  return id ? String(id).trim() : undefined;
};

const findExistingCardIdForPcUrl = (dataDir: string, normPc: string, pcProductId?: string): string | null => {
  const db = openAppPortfolioDb(dataDir);
  const row = db.prepare('SELECT id FROM cards WHERE norm_pc_url = ? LIMIT 1').get(normPc) as
    | { id: string }
    | undefined;
  if (row?.id) return row.id;
  if (pcProductId) {
    try {
      const row2 = db
        .prepare(`SELECT id FROM cards WHERE json_extract(payload_json, '$.priceChartingProductId') = ? LIMIT 1`)
        .get(pcProductId) as { id: string } | undefined;
      if (row2?.id) return row2.id;
    } catch {
      /* json1 unavailable — fall through */
    }
  }
  return null;
};

/**
 * Scrape a PriceCharting URL and upsert into the SQLite portfolio (same source data as `/api/scrape`).
 * When `created`, runs a TCGPlayer product fetch when a TCG URL is present (mirrors client Add Card enrichment).
 */
export type SyncPricechartingOptions = {
  /** When set, stored on the card (new or refresh). */
  portfolioKind?: 'single' | 'sealed';
};

export const syncPricechartingUrlIntoPortfolio = async (
  dataDir: string,
  imagesDir: string,
  rawUrl: string,
  opts?: SyncPricechartingOptions
): Promise<{ cardId: string; created: boolean }> => {
  const canonicalUrl = canonicalizePricechartingUrl(rawUrl);
  if (!canonicalUrl) throw new Error('Must be a valid pricecharting.com URL');

  const { scraped, localImage } = await fetchPricechartingProductWithImages(canonicalUrl, imagesDir);
  const normPc = normalizeForMatch(canonicalUrl);
  const pcPid = pickPcProductId(scraped);

  const meta = readPortfolioMeta(dataDir) ?? defaultEmptyMeta();
  const fees = feesFromMetaDoc(meta);

  const existingId = findExistingCardIdForPcUrl(dataDir, normPc, pcPid);
  const created = !existingId;
  const id = existingId ?? randomUUID();

  const existing = existingId ? getCardById(dataDir, existingId) : null;
  const now = Date.now();

  const tcgHrefRaw =
    typeof scraped.tcgplayerUrl === 'string' && scraped.tcgplayerUrl.trim()
      ? scraped.tcgplayerUrl.trim().split('#')[0].split('?')[0]
      : '';

  const kindFromScrape =
    scraped.suggestedPortfolioKind === 'sealed' ? ('sealed' as const) : null;
  const resolvedKind: 'single' | 'sealed' =
    opts?.portfolioKind === 'sealed' || opts?.portfolioKind === 'single'
      ? opts.portfolioKind
      : kindFromScrape === 'sealed'
        ? 'sealed'
        : (existing?.portfolioKind as 'single' | 'sealed' | undefined) === 'sealed'
          ? 'sealed'
          : 'single';

  const nextPriceHistory = (() => {
    if (!existing) {
      return [
        {
          at: now,
          source: 'initial',
          raw: scraped.raw || undefined,
          grade9: scraped.grade9 || undefined,
          psa10: scraped.psa10 || undefined,
        },
      ];
    }
    const prev = Array.isArray(existing.priceHistory) ? [...(existing.priceHistory as unknown[])] : [];
    prev.push({
      at: now,
      source: 'refresh',
      raw: scraped.raw || undefined,
      grade9: scraped.grade9 || undefined,
      psa10: scraped.psa10 || undefined,
    });
    return prev.slice(-650);
  })();

  const baseCard: Record<string, unknown> = {
    ...(existing ?? {}),
    id,
    name: scraped.name || String(existing?.name ?? ''),
    set: scraped.set || String(existing?.set ?? ''),
    cardNumber: scraped.cardNumber || String(existing?.cardNumber ?? ''),
    url: canonicalUrl,
    priceChartingProductId: pcPid ?? (existing?.priceChartingProductId as string | undefined),
    localImage: localImage ?? (existing?.localImage as string | null | undefined) ?? null,
    raw: scraped.raw,
    grade9: scraped.grade9,
    psa10: scraped.psa10,
    allPrices: scraped.allPrices,
    tcgplayerUrl: tcgHrefRaw || String(existing?.tcgplayerUrl ?? ''),
    recentSales: scraped.recentSales,
    salesVolume: scraped.salesVolume,
    releaseDateMs: scraped.releaseDateMs,
    lastRefreshedAt: now,
    p10: typeof existing?.p10 === 'number' ? existing.p10 : DEFAULT_P10,
    p9: typeof existing?.p9 === 'number' ? existing.p9 : DEFAULT_P9,
    portfolioKind: resolvedKind,
    priceHistory: nextPriceHistory,
  };

  if (existing && typeof existing.raw === 'number') {
    baseCard.previousPrices = {
      raw: existing.raw,
      grade9: typeof existing.grade9 === 'number' ? existing.grade9 : undefined,
      psa10: typeof existing.psa10 === 'number' ? existing.psa10 : undefined,
      at: typeof existing.lastRefreshedAt === 'number' ? existing.lastRefreshedAt : Date.now(),
    };
  }

  upsertCardFull(dataDir, baseCard, fees);

  if (created && tcgHrefRaw && /^https?:\/\/(www\.)?tcgplayer\.com\/product\/\d+/i.test(tcgHrefRaw)) {
    const pid = extractTcgplayerProductId(tcgHrefRaw);
    if (pid) {
      try {
        const snap = await fetchTcgplayerProduct(pid, tcgHrefRaw, {});
        const cur = getCardById(dataDir, id);
        if (cur) {
          const at = Date.now();
          const merged: Record<string, unknown> = {
            ...cur,
            tcgplayerSummary: { ...snap, fetchedAt: at },
            tcgplayerSelfHistory: [{ at, marketPrice: snap.marketPrice }],
          };
          upsertCardFull(dataDir, merged, fees);
        }
      } catch (e) {
        console.warn('[pricecharting/sync] TCG enrichment failed:', e);
      }
    }
  }

  const m = readPortfolioMeta(dataDir) ?? meta;
  writePortfolioMeta(dataDir, { ...m, updatedAt: Date.now() });

  return { cardId: id, created };
};
