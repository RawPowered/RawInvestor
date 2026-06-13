import type {
  Card,
  CardLanguageTag,
  EbayExtensionListing,
  EbayExtensionSnapshot,
  EbayFilteredListing,
  TcgComparisonMarketPrices,
  TcgplayerProductSummary,
  TcgplayerSalesSnapshot,
} from '../types';
import { fmtMoney } from '../math';
import { startOfUtcDay } from '../releaseFilter';
import { effectivePokemonCenterStamp, effectiveSealedInTitle } from '../ebayStamp';
import { formatRelative, toEpochMsLoose } from '../utils/time';
import { apiUrl, buildApiHeaders } from '../apiBase';
import { enrichEbayListingFromTitle } from '../utils/ebayTitleMeta';
import { inferLanguageTag } from '../plugins/cardLanguageDetect';
import { resolveNmFromComparison } from '../tcgDisplayPrice';

type ExtTcgNormalized = {
  productId: number | null;
  context: {
    language: string | null;
    condition: string | null;
    printing: string | null;
  };
  captureMode: 'default' | 'deep';
  rowCount: number;
  hasMore: boolean;
  comparisonMarketPrices?: TcgComparisonMarketPrices;
  pricePoints: {
    marketPrice: number | null;
    capturedMarketPrice?: number | null;
    mostRecentSale: number | null;
    listedMedian: number | null;
    currentQuantity: number | null;
    currentSellers: number | null;
  };
  latestSalesRows: Array<{
    at: number;
    condition: string | null;
    qty: number;
    price: number;
    languageTag?: CardLanguageTag;
    hasPhoto?: boolean | null;
    suspiciousLanguagePump?: boolean;
    suspiciousReason?: string | null;
  }>;
};

type ExtEbayListingNorm = {
  title: string;
  price: number;
  unitPrice?: number;
  lotQuantity?: number;
  isLot?: boolean;
  soldAt: number;
  itemId: string | null;
  itemUrl: string | null;
  gradeTag?: string | null;
  grader?: 'PSA' | 'CGC' | 'BGS' | 'SGC' | 'TAG' | 'ACE' | 'AI' | null;
  isGraded?: boolean;
  conditionTag?: 'NM' | 'LP' | 'MP' | 'HP' | 'DMG' | null;
  languageTag?: CardLanguageTag;
  hasPhoto?: boolean | null;
  suspiciousLanguagePump?: boolean;
  suspiciousReason?: string | null;
  listingKind?: 'auction' | 'bin' | 'unknown';
  currentBid?: number | null;
  buyItNow?: number | null;
  bidCount?: number | null;
  endsAtMs?: number | null;
  freeShipping?: boolean;
  shippingCost?: number | null;
  bestOfferAccepted?: boolean;
};

type ExtEbayNormalized = {
  query: string;
  captureMode: 'default' | 'deep';
  hasMore: boolean;
  rowCount: number;
  listings: ExtEbayListingNorm[];
  excludedListings?: ExtEbayListingNorm[];
};

export type ExtCaptureResponse = {
  capture: {
    source: 'tcgplayer' | 'pricecharting' | 'ebay';
    url: string;
    capturedAt?: number;
    data: Record<string, unknown>;
  } | null;
  normalized?: ExtTcgNormalized | ExtEbayNormalized | null;
};

export const applyExtensionTcgCapture = (
  summary: TcgplayerProductSummary,
  ext: ExtCaptureResponse['capture']
): TcgplayerProductSummary => {
  if (!ext || ext.source !== 'tcgplayer') return summary;
  const market = typeof ext.data.marketPrice === 'number' ? ext.data.marketPrice : null;
  const listing = typeof ext.data.listingPrice === 'number' ? ext.data.listingPrice : null;
  const trendPct = typeof ext.data.trendPct === 'number' ? ext.data.trendPct : null;
  const trendValue = typeof ext.data.trendValue === 'number' ? ext.data.trendValue : null;
  const ctx =
    ext.data.context && typeof ext.data.context === 'object'
      ? (ext.data.context as { language?: unknown; condition?: unknown; printing?: unknown })
      : null;
  const capturedCondition =
    typeof ctx?.condition === 'string'
      ? ctx.condition
      : typeof ext.data.condition === 'string'
        ? ext.data.condition
        : null;
  const comparisonRaw =
    ext.data.comparisonMarketPrices && typeof ext.data.comparisonMarketPrices === 'object'
      ? (ext.data.comparisonMarketPrices as TcgComparisonMarketPrices)
      : null;
  const nmFromComparison = resolveNmFromComparison(comparisonRaw);
  const isNmContext = /near\s*mint/i.test(capturedCondition || '');

  let nextMarketPrice = summary.marketPrice;
  let usedExtensionMarket = false;
  if (isNmContext && market != null && Number.isFinite(market) && market >= 0) {
    nextMarketPrice = market;
    usedExtensionMarket = true;
  } else if (nmFromComparison != null) {
    nextMarketPrice = nmFromComparison;
    usedExtensionMarket = true;
  }

  const capturedLanguage =
    typeof ctx?.language === 'string'
      ? ctx.language
      : typeof ext.data.language === 'string'
        ? ext.data.language
        : null;

  return {
    ...summary,
    marketPrice: nextMarketPrice,
    lowestPrice: listing != null && Number.isFinite(listing) && listing >= 0 ? listing : summary.lowestPrice,
    lowestPriceWithShipping:
      summary.lowestPriceWithShipping != null
        ? summary.lowestPriceWithShipping
        : listing != null && Number.isFinite(listing) && listing >= 0
          ? listing
          : summary.lowestPriceWithShipping,
    source: usedExtensionMarket ? 'extension_capture' : summary.source,
    capturedFromUrl: ext.url,
    capturedContext: {
      language: capturedLanguage,
      condition: capturedCondition,
      printing: typeof ctx?.printing === 'string' ? ctx.printing : null,
    },
    usedAuth: true,
    apiMarketPrice: typeof summary.apiMarketPrice === 'number' ? summary.apiMarketPrice : summary.marketPrice,
    priceDriftVsApi:
      typeof summary.apiMarketPrice === 'number'
        ? nextMarketPrice - summary.apiMarketPrice
        : summary.priceDriftVsApi ?? null,
    captureHint: (() => {
      const bits: string[] = [];
      if (trendValue != null && trendPct != null) {
        bits.push(`Trend ${fmtMoney(trendValue)} (${trendPct >= 0 ? '+' : ''}${trendPct.toFixed(2)}%).`);
      }
      if (listing != null) bits.push(`Listing ${fmtMoney(listing)}.`);
      if (
        market != null &&
        Number.isFinite(market) &&
        Math.abs(market - nextMarketPrice) >= 0.005 &&
        capturedCondition &&
        !/near\s*mint/i.test(capturedCondition)
      ) {
        bits.push(`Captured on page (${capturedCondition}): ${fmtMoney(market)}; display uses Near Mint.`);
      }
      const base = ext.capturedAt
        ? `Extension capture applied (${formatRelative(ext.capturedAt)}).`
        : 'Extension capture applied.';
      return bits.length ? `${base} ${bits.join(' ')}` : base;
    })(),
    fetchedAt: Date.now(),
  };
};

const isExtTcgNorm = (n: ExtTcgNormalized | ExtEbayNormalized | null | undefined): n is ExtTcgNormalized =>
  Boolean(n && 'latestSalesRows' in n);

export const buildTcgSalesSnapshotFromExtension = (
  url: string,
  ext: ExtCaptureResponse
): TcgplayerSalesSnapshot | null => {
  if (!ext.capture || ext.capture.source !== 'tcgplayer' || !isExtTcgNorm(ext.normalized)) return null;
  const n = ext.normalized;
  const fallbackLang = inferLanguageTag(n.context?.language);
  const capturedMarketPrice =
    n.pricePoints.capturedMarketPrice ?? n.pricePoints.marketPrice ?? null;
  return {
    capturedAt: ext.capture.capturedAt ?? Date.now(),
    sourceUrl: ext.capture.url || url,
    context: n.context,
    captureMode: n.captureMode,
    hasMore: n.hasMore,
    rowCount: n.rowCount,
    comparisonMarketPrices: n.comparisonMarketPrices,
    pricePoints: {
      ...n.pricePoints,
      capturedMarketPrice,
      displayMarketPrice: resolveNmFromComparison(n.comparisonMarketPrices) ?? null,
    },
    latestSalesRows: n.latestSalesRows.map((row) => ({
      ...row,
      languageTag: row.languageTag ?? fallbackLang,
      hasPhoto: typeof row.hasPhoto === 'boolean' ? row.hasPhoto : null,
      suspiciousLanguagePump: row.suspiciousLanguagePump === true,
      suspiciousReason: row.suspiciousReason ?? null,
    })),
  };
};

export const buildEbayExtensionSnapshotFromResponse = (
  url: string,
  ext: ExtCaptureResponse,
  card?: Pick<Card, 'name' | 'set' | 'cardNumber' | 'raw' | 'grade9' | 'psa10'>
): EbayExtensionSnapshot | null => {
  if (!ext.capture || ext.capture.source !== 'ebay' || !ext.normalized) return null;
  const n = ext.normalized;
  if (!('listings' in n)) return null;
  const toNorm = (s: string): string =>
    String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const cardNumberStr = String(card?.cardNumber ?? '').trim();
  const cardRaw = Number(card?.raw ?? NaN);
  const cardGrade9 = Number(card?.grade9 ?? NaN);
  const cardPsa10 = Number(card?.psa10 ?? NaN);
  const STOPWORDS = new Set([
    'pokemon',
    'card',
    'trading',
    'tcg',
    'game',
    'ex',
    'promo',
    'promos',
    'holo',
    'rare',
    'limited',
    'edition',
    // common set tokens tend to be non-unique across lots of listings
    'spark',
    'sparks',
  ]);

  const tokenize = (s: string): string[] => {
    const base = toNorm(s)
      .split(' ')
      .filter((t) => t && t.length >= 3 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
    return Array.from(new Set(base));
  };

  const identityTokens = tokenize(`${String(card?.name ?? '')} ${String(card?.set ?? '')}`);

  const scoreTitleMatch = (title: string): { score: number; cardNumberMatch: boolean } => {
    const norm = toNorm(title);
    let score = 0;
    for (const t of identityTokens) {
      if (t && norm.includes(t)) score += 1;
    }
    const cardNumberMatch = Boolean(cardNumberStr && norm.includes(cardNumberStr));
    if (cardNumberMatch) score += 2;
    return { score, cardNumberMatch };
  };

  const getTargetPrice = (r: EbayExtensionListing): number | null => {
    const isGraded = r.isGraded === true;
    if (!isGraded) return Number.isFinite(cardRaw) && cardRaw > 0 ? cardRaw : null;
    const gradeTagRaw = r.gradeTag;
    const gradeNum = gradeTagRaw == null ? null : Number.parseFloat(String(gradeTagRaw));
    if (gradeNum != null && Number.isFinite(gradeNum)) {
      if (gradeNum >= 10) return Number.isFinite(cardPsa10) && cardPsa10 > 0 ? cardPsa10 : null;
      if (Math.round(gradeNum) === 9) return Number.isFinite(cardGrade9) && cardGrade9 > 0 ? cardGrade9 : null;
    }
    return Number.isFinite(cardRaw) && cardRaw > 0 ? cardRaw : null;
  };

  const priceLooksLikeCard = (r: EbayExtensionListing, target: number | null): boolean => {
    if (target == null || !(target > 0)) return true; // no anchor -> don't reject
    const unit =
      typeof r.unitPrice === 'number' && Number.isFinite(r.unitPrice)
        ? r.unitPrice
        : typeof r.price === 'number' && Number.isFinite(r.price)
          ? r.price
          : null;
    if (unit == null || !(unit > 0)) return true;
    const ratio = unit / target;
    return ratio >= 0.2 && ratio <= 6;
  };

  const getItemId = (r: { itemId: string | null; itemUrl: string | null }): string | null => {
    const rawId = (r.itemId || '').trim();
    if (/^\d{6,}$/.test(rawId)) return rawId;
    const m = String(r.itemUrl || '').match(/\/itm\/(\d{6,})/i);
    return m ? m[1] : null;
  };
  const mapNormListing = (r: ExtEbayListingNorm) => {
    const itemId = getItemId(r);
    let itemUrl: string | null = itemId ? `https://www.ebay.com/itm/${itemId}` : (r.itemUrl || null);
    if (itemUrl && /\/p\/\d+/i.test(itemUrl) && !itemId) itemUrl = null;
    const soldAt = toEpochMsLoose(r.soldAt);
    const price = Number(r.price);
    if (soldAt == null || !Number.isFinite(price)) return null;
    const base: EbayExtensionListing = {
      title: r.title,
      price,
      unitPrice:
        typeof (r as { unitPrice?: unknown }).unitPrice === 'number' &&
        Number.isFinite((r as { unitPrice?: number }).unitPrice)
          ? (r as { unitPrice?: number }).unitPrice
          : undefined,
      lotQuantity:
        typeof (r as { lotQuantity?: unknown }).lotQuantity === 'number' &&
        Number.isFinite((r as { lotQuantity?: number }).lotQuantity) &&
        (r as { lotQuantity?: number }).lotQuantity! > 1
          ? Math.round((r as { lotQuantity?: number }).lotQuantity!)
          : undefined,
      isLot: (r as { isLot?: unknown }).isLot === true,
      soldAt,
      itemId,
      itemUrl,
      pokemonCenterStamp: effectivePokemonCenterStamp({
        title: r.title,
        pokemonCenterStamp: (r as { pokemonCenterStamp?: boolean }).pokemonCenterStamp,
      }),
      sealedInTitle: effectiveSealedInTitle({
        title: r.title,
        sealedInTitle: (r as { sealedInTitle?: boolean }).sealedInTitle,
      }),
      gradeTag: r.gradeTag ?? null,
      grader: r.grader ?? null,
      isGraded: r.isGraded === true,
      conditionTag: r.conditionTag ?? null,
      languageTag: r.languageTag ?? inferLanguageTag(r.title),
      hasPhoto: typeof r.hasPhoto === 'boolean' ? r.hasPhoto : null,
      suspiciousLanguagePump: r.suspiciousLanguagePump === true,
      suspiciousReason: r.suspiciousReason ?? null,
      ...(r.listingKind ? { listingKind: r.listingKind } : {}),
      ...(r.currentBid != null && Number.isFinite(r.currentBid) ? { currentBid: r.currentBid } : {}),
      ...(r.buyItNow != null && Number.isFinite(r.buyItNow) ? { buyItNow: r.buyItNow } : {}),
      ...(r.bidCount != null && Number.isFinite(r.bidCount) ? { bidCount: r.bidCount } : {}),
      ...(r.endsAtMs != null && Number.isFinite(r.endsAtMs) ? { endsAtMs: r.endsAtMs } : {}),
      ...(r.freeShipping === true
        ? { freeShipping: true, shippingCost: null }
        : typeof r.shippingCost === 'number' && Number.isFinite(r.shippingCost) && r.shippingCost >= 0
          ? { shippingCost: r.shippingCost }
          : {}),
      ...(r.bestOfferAccepted === true ? { bestOfferAccepted: true as const } : {}),
    };
    return enrichEbayListingFromTitle(base);
  };
  const normalized = n.listings
    .map((r) => mapNormListing(r))
    .filter((r): r is NonNullable<typeof r> => Boolean(r));
  const rejectedListings: EbayFilteredListing[] = [];

  const excludedNorm = (n.excludedListings ?? [])
    .map((r) => mapNormListing(r))
    .filter((r): r is NonNullable<typeof r> => Boolean(r));
  for (const r of excludedNorm) {
    rejectedListings.push({ ...r, filterReason: 'listing_mismatch' });
  }

  const accepted: typeof normalized = [];

  for (const r of normalized) {
    const { score, cardNumberMatch } = scoreTitleMatch(r.title);
    const minScore = cardNumberMatch ? 1 : 2;
    if (score < minScore) {
      rejectedListings.push({ ...r, filterReason: 'clarity' });
      continue;
    }

    const target = getTargetPrice(r);
    if (!priceLooksLikeCard(r, target)) {
      rejectedListings.push({ ...r, filterReason: 'clarity' });
      continue;
    }

    accepted.push(r);
  }
  const dedup = new Map<string, (typeof normalized)[number]>();
  for (const r of accepted) {
    const k = r.itemId || r.itemUrl || `${startOfUtcDay(toEpochMsLoose(r.soldAt) ?? 0)}|${r.price.toFixed(2)}|${toNorm(r.title)}`;
    if (!dedup.has(k)) dedup.set(k, r);
  }
  const listings = Array.from(dedup.values()).sort((a, b) => b.soldAt - a.soldAt);
  return {
    capturedAt: ext.capture.capturedAt ?? Date.now(),
    sourceUrl: ext.capture.url || url,
    query: n.query,
    captureMode: n.captureMode,
    hasMore: n.hasMore,
    rowCount: listings.length,
    listings,
    rejectedListings,
  };
};

export const fetchLatestTcgExtensionCapture = async (url: string): Promise<ExtCaptureResponse | null> => {
  const r = await fetch(
    apiUrl(`/api/ext/capture/latest?source=tcgplayer&url=${encodeURIComponent(url)}`),
    { cache: 'no-store' }
  );
  if (!r.ok) return null;
  const j = (await r.json()) as ExtCaptureResponse | { error: string };
  if ('error' in j) return null;
  return j;
};

export const fetchLatestEbayExtensionCapture = async (
  url?: string,
  opts?: { relaxedEbayMatch?: boolean }
): Promise<ExtCaptureResponse | null> => {
  const relaxed =
    opts?.relaxedEbayMatch === true ? '&relaxedEbay=1' : '';
  const path = url
    ? `/api/ext/capture/latest?source=ebay&url=${encodeURIComponent(url)}${relaxed}`
    : '/api/ext/capture/latest?source=ebay';
  const r = await fetch(apiUrl(path), { cache: 'no-store' });
  if (!r.ok) return null;
  const j = (await r.json()) as ExtCaptureResponse | { error: string };
  if ('error' in j) return null;
  return j;
};

/** Persist merged Quick Fetch eBay snapshot so `/api/ext/capture/ebay/listing-tags` can find rows in extension_captures. */
export const postMergedEbayCaptureToServer = async (
  snapshot: EbayExtensionSnapshot
): Promise<{
  ok: boolean;
  error?: string;
  portfolioMerge?: { touched: number; diagnostics?: unknown };
}> => {
  const url = String(snapshot.sourceUrl || '').trim();
  if (!url) return { ok: false, error: 'missing sourceUrl' };
  try {
    const r = await fetch(apiUrl('/api/ext/capture'), {
      method: 'POST',
      headers: buildApiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        source: 'ebay',
        url,
        capturedAt: snapshot.capturedAt ?? Date.now(),
        data: {
          query: snapshot.query ?? '',
          captureMode: snapshot.captureMode ?? 'deep',
          hasMore: snapshot.hasMore ?? false,
          rowCount: snapshot.rowCount ?? snapshot.listings?.length ?? 0,
          listings: snapshot.listings ?? [],
          excludedListings: snapshot.rejectedListings ?? [],
          ...(snapshot.ebayDualCaptureStats ? { captureStats: snapshot.ebayDualCaptureStats } : {}),
        },
      }),
    });
    if (!r.ok) {
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: j.error ?? `HTTP ${r.status}` };
    }
    const body = (await r.json().catch(() => ({}))) as {
      portfolioMerge?: { touched: number; diagnostics?: unknown };
    };
    return { ok: true, portfolioMerge: body.portfolioMerge };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
};
