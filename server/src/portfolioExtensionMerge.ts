import type { Storage } from './storage.js';
import {
  type ExtensionCapturePayload,
  type NormalizedEbayCapture,
  type NormalizedTcgCapture,
  normalizeEbayCapture,
  normalizeForMatch,
  normalizeTcgCapture,
} from './extensionCapture.js';
import {
  feesFromMetaDoc,
  getCardById,
  openAppPortfolioDb,
  readPortfolioMeta,
  upsertCardFull,
  writePortfolioMeta,
} from './portfolioCardsRepository.js';
import { buildEbaySearchQuery, ebaySoldSearchUrlForCard } from './ebaySearchQuery.js';

const tcgProductId = (raw: string): string | null => {
  try {
    const u = new URL(String(raw || '').trim());
    if (!/^tcgplayer\.com$/i.test(u.hostname.replace(/^www\./, ''))) return null;
    const m = u.pathname.match(/\/product\/(\d+)/i);
    return m ? m[1] : null;
  } catch {
    return null;
  }
};

const resolveTcgUrl = (card: Record<string, unknown>): string => {
  const u = String(card.tcgplayerUrl ?? '').trim();
  if (/^https?:\/\/(www\.)?tcgplayer\.com\/product\/\d+/i.test(u)) {
    return u.split('#')[0].split('?')[0];
  }
  const s = card.tcgplayerSummary as Record<string, unknown> | null | undefined;
  const su = s && typeof s.url === 'string' ? s.url.trim() : '';
  if (/^https?:\/\/(www\.)?tcgplayer\.com\/product\/\d+/i.test(su)) {
    return su.split('#')[0].split('?')[0];
  }
  return '';
};

const ebaySearchUrlForCard = (card: Record<string, unknown>): string => {
  const q = buildEbaySearchQuery({
    name: String(card.name ?? ''),
    set: String(card.set ?? ''),
    cardNumber: String(card.cardNumber ?? ''),
  });
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}`;
};

const ebayGradedLaneFromUrl = (url: string): 'no' | 'yes' | null => {
  try {
    const u = new URL(String(url || ''));
    const graded = String(u.searchParams.get('Graded') || u.searchParams.get('graded') || '')
      .trim()
      .toLowerCase();
    if (graded === 'no') return 'no';
    if (graded === 'yes') return 'yes';
    return null;
  } catch {
    return null;
  }
};

const resolveEbayDualCapturePass = (
  payload: ExtensionCapturePayload
): 'ebay-graded-no' | 'ebay-graded-yes' | null => {
  if (payload.capturePass === 'ebay-graded-no' || payload.capturePass === 'ebay-graded-yes') {
    return payload.capturePass;
  }
  const lane = ebayGradedLaneFromUrl(payload.url);
  if (lane === 'no') return 'ebay-graded-no';
  if (lane === 'yes') return 'ebay-graded-yes';
  return null;
};

const tcgRowScanKey = (row: { at: number; condition: string | null; qty: number; price: number }): string => {
  const day = Math.floor(Number(row.at || 0) / 86_400_000);
  const cond = String(row.condition || '').trim().toLowerCase();
  return `${day}|${cond}|${Number(row.qty || 0)}|${Number(row.price || 0).toFixed(4)}`;
};

const ebayRowScanKey = (row: {
  soldAt: number;
  price: number;
  title: string;
  itemId: string | null;
}): string => {
  const itemId = String(row.itemId || '').trim();
  if (itemId) return `item:${itemId}`;
  const day = Math.floor(Number(row.soldAt || 0) / 86_400_000);
  const title = String(row.title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `${day}|${Number(row.price || 0).toFixed(2)}|${title}`;
};

const ebayCaptureMatchesCard = (captureNormKey: string, card: Record<string, unknown>): boolean =>
  normalizeForMatch(
    ebaySoldSearchUrlForCard({
      name: String(card.name ?? ''),
      set: String(card.set ?? ''),
      cardNumber: String(card.cardNumber ?? ''),
    })
  ) === captureNormKey;

const parseEbayNormKey = (
  k: string
): { nkw: string; sold: boolean; complete: boolean } | null => {
  if (!k.startsWith('ebay|')) return null;
  const parts = k.split('|').slice(1);
  const map = new Map<string, string>();
  for (const part of parts) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    map.set(part.slice(0, i), part.slice(i + 1));
  }
  return {
    nkw: String(map.get('nkw') || '').trim(),
    sold: map.get('s') === '1',
    complete: map.get('c') === '1',
  };
};

const ebayActiveCaptureMatchesCard = (
  captureNormKey: string,
  card: Record<string, unknown>
): boolean => {
  const got = parseEbayNormKey(captureNormKey);
  const expected = parseEbayNormKey(normalizeForMatch(ebaySearchUrlForCard(card)));
  if (!got || !expected) return false;
  if (!got.nkw || !expected.nkw) return false;
  // Active watch should match the same query; "complete" may differ depending on the user's SRP UI.
  return got.nkw === expected.nkw && got.sold === false;
};

const appendTcgplayerSelfSampleServer = (
  existing: unknown,
  marketPrice: number,
  at: number
): Array<{ at: number; marketPrice: number }> => {
  if (!Number.isFinite(marketPrice) || marketPrice < 0 || !Number.isFinite(at)) {
    if (!Array.isArray(existing)) return [];
    return (existing as Array<{ at?: number; marketPrice?: number }>).map((x) => ({
      at: Number(x.at),
      marketPrice: Number(x.marketPrice),
    }));
  }
  const cur = Array.isArray(existing)
    ? (existing as Array<{ at?: number; marketPrice?: number }>).map((x) => ({
        at: Number(x.at),
        marketPrice: Number(x.marketPrice),
      }))
    : [];
  const last = cur[cur.length - 1];
  if (
    last &&
    Math.abs(Number(last.marketPrice) - marketPrice) < 1e-6 &&
    at - Number(last.at) < 2 * 60 * 1000
  ) {
    return cur;
  }
  cur.push({ at, marketPrice });
  return cur.slice(-500);
};

const mergeTcgSummaryFromCapture = (
  prev: Record<string, unknown> | null | undefined,
  payload: ExtensionCapturePayload,
  n: NormalizedTcgCapture,
  card: Record<string, unknown>
): Record<string, unknown> => {
  const data = payload.data as Record<string, unknown>;
  const marketRaw =
    typeof data.marketPrice === 'number' && Number.isFinite(data.marketPrice)
      ? (data.marketPrice as number)
      : n.pricePoints.marketPrice;
  const market =
    typeof marketRaw === 'number' && Number.isFinite(marketRaw) && marketRaw >= 0 ? marketRaw : null;
  const listing =
    typeof data.listingPrice === 'number' && Number.isFinite(data.listingPrice)
      ? (data.listingPrice as number)
      : null;
  const ctx =
    data.context && typeof data.context === 'object'
      ? (data.context as Record<string, unknown>)
      : null;
  const base = prev && typeof prev === 'object' ? { ...prev } : {};
  const productUrl = resolveTcgUrl(card) || String(payload.url || '').trim();
  const now = Date.now();
  const capturedAt = typeof payload.capturedAt === 'number' ? payload.capturedAt : now;
  return {
    ...base,
    url: (typeof base.url === 'string' && base.url.trim()) || productUrl,
    marketPrice: (market ?? base.marketPrice) as number | undefined,
    lowestPrice:
      listing != null && listing >= 0
        ? listing
        : (base.lowestPrice as number | null | undefined) ?? null,
    source: 'extension_capture',
    capturedFromUrl: payload.url,
    capturedContext: {
      language:
        typeof ctx?.language === 'string'
          ? ctx.language
          : typeof data.language === 'string'
            ? data.language
            : null,
      condition:
        typeof ctx?.condition === 'string'
          ? ctx.condition
          : typeof data.condition === 'string'
            ? data.condition
            : null,
      printing: typeof ctx?.printing === 'string' ? ctx.printing : null,
    },
    fetchedAt: now,
    captureHint: `Extension capture applied (server merge, ${new Date(capturedAt).toISOString()}).`,
  };
};

export const buildEbaySnapshotForCard = (
  payload: ExtensionCapturePayload,
  n: NormalizedEbayCapture,
  card: Record<string, unknown>
): Record<string, unknown> | null => {
  const toNorm = (s: string): string =>
    String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const cardNumberStr = String(card.cardNumber ?? '').trim();
  const cardRaw = Number(card.raw ?? NaN);
  const cardGrade9 = Number(card.grade9 ?? NaN);
  const cardPsa10 = Number(card.psa10 ?? NaN);
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
    'spark',
    'sparks',
  ]);

  const tokenize = (s: string): string[] => {
    const base = toNorm(s)
      .split(' ')
      .filter((t) => t && t.length >= 3 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
    // De-dupe while preserving order.
    return Array.from(new Set(base));
  };

  const identityTokens = tokenize(`${String(card.name ?? '')} ${String(card.set ?? '')}`);

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

  const getTargetPrice = (
    r: Record<string, unknown>
  ): number | null => {
    if (cardNumberStr && typeof r.unitPrice === 'number' && Number.isFinite(r.unitPrice)) {
      // Use card PSA/Grade anchors when we have a slab grade; otherwise fall back to raw.
    }
    const isGraded = r.isGraded === true;
    const unit = typeof r.unitPrice === 'number' && Number.isFinite(r.unitPrice)
      ? r.unitPrice
      : typeof r.price === 'number' && Number.isFinite(r.price)
        ? r.price
        : null;
    if (unit == null) return null;
    if (!isGraded) {
      return Number.isFinite(cardRaw) && cardRaw > 0 ? cardRaw : null;
    }
    const gradeTagRaw = r.gradeTag;
    const gradeNum = gradeTagRaw == null ? null : Number.parseFloat(String(gradeTagRaw));
    if (gradeNum != null && Number.isFinite(gradeNum)) {
      if (gradeNum >= 10) return Number.isFinite(cardPsa10) && cardPsa10 > 0 ? cardPsa10 : null;
      if (Math.round(gradeNum) === 9) return Number.isFinite(cardGrade9) && cardGrade9 > 0 ? cardGrade9 : null;
    }
    // Unknown graded grade (or missing gradeTag) -> fall back to raw anchor.
    return Number.isFinite(cardRaw) && cardRaw > 0 ? cardRaw : null;
  };

  const priceLooksLikeCard = (
    r: Record<string, unknown>,
    target: number | null
  ): boolean => {
    if (target == null || !(target > 0)) return true; // no anchor -> don't reject
    const unit = typeof r.unitPrice === 'number' && Number.isFinite(r.unitPrice)
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
  type Listing = Record<string, unknown>;
  const normalized: Listing[] = [];
  for (const r of n.listings) {
    const itemId = getItemId(r);
    let itemUrl: string | null = itemId ? `https://www.ebay.com/itm/${itemId}` : r.itemUrl;
    if (itemUrl && /\/p\/\d+/i.test(itemUrl) && !itemId) itemUrl = null;
    normalized.push({
      title: r.title,
      price: r.price,
      unitPrice: r.unitPrice,
      lotQuantity: r.lotQuantity,
      isLot: r.isLot,
      soldAt: r.soldAt,
      itemId,
      itemUrl,
      pokemonCenterStamp: r.pokemonCenterStamp,
      sealedInTitle: r.sealedInTitle,
      gradeTag: r.gradeTag ?? null,
      grader: r.grader ?? null,
      isGraded: r.isGraded === true,
      conditionTag: r.conditionTag ?? null,
      listingKind: r.listingKind ?? 'unknown',
      currentBid: r.currentBid ?? null,
      buyItNow: r.buyItNow ?? null,
      bidCount: r.bidCount ?? null,
      endsAtMs: r.endsAtMs ?? null,
      freeShipping: r.freeShipping === true,
      shippingCost: r.shippingCost ?? null,
      bestOfferAccepted: r.bestOfferAccepted === true,
    });
  }
  const accepted: Listing[] = [];
  const rejectedListings: Array<Listing & { filterReason: 'clarity' | 'listing_mismatch' }> = [];

  for (const r of n.excludedListings ?? []) {
    const itemIdEx = getItemId(r);
    let itemUrlEx: string | null = itemIdEx ? `https://www.ebay.com/itm/${itemIdEx}` : r.itemUrl ?? null;
    if (itemUrlEx && /\/p\/\d+/i.test(itemUrlEx) && !itemIdEx) itemUrlEx = null;
    rejectedListings.push({
      title: r.title,
      price: r.price,
      unitPrice: r.unitPrice,
      lotQuantity: r.lotQuantity,
      isLot: r.isLot,
      soldAt: r.soldAt,
      itemId: itemIdEx,
      itemUrl: itemUrlEx,
      pokemonCenterStamp: r.pokemonCenterStamp,
      sealedInTitle: r.sealedInTitle,
      gradeTag: r.gradeTag ?? null,
      grader: r.grader ?? null,
      isGraded: r.isGraded === true,
      conditionTag: r.conditionTag ?? null,
      listingKind: r.listingKind ?? 'unknown',
      currentBid: r.currentBid ?? null,
      buyItNow: r.buyItNow ?? null,
      bidCount: r.bidCount ?? null,
      endsAtMs: r.endsAtMs ?? null,
      freeShipping: r.freeShipping === true,
      shippingCost: r.shippingCost ?? null,
      bestOfferAccepted: r.bestOfferAccepted === true,
      filterReason: 'listing_mismatch',
    });
  }

  for (const r of normalized) {
    const title = String(r.title || '');
    const { score, cardNumberMatch } = scoreTitleMatch(title);
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
  const dedup = new Map<string, Listing>();
  for (const r of accepted) {
    const itemId = String(r.itemId || '').trim();
    const k =
      itemId ||
      `${Math.floor(Number(r.soldAt) / 86_400_000)}|${Number(r.price).toFixed(2)}|${toNorm(String(r.title))}`;
    if (!dedup.has(k)) dedup.set(k, r);
  }
  const listings = Array.from(dedup.values()).sort(
    (a, b) => Number(b.soldAt) - Number(a.soldAt)
  ) as Array<{
    soldAt: number;
    price: number;
    title: string;
    itemId: string | null;
  }>;
  return {
    capturedAt: payload.capturedAt ?? Date.now(),
    sourceUrl: payload.url,
    query: n.query,
    captureMode: n.captureMode,
    hasMore: n.hasMore,
    rowCount: listings.length,
    listings,
    rejectedListings,
  };
};

const buildEbayActiveSnapshotForCard = (
  payload: ExtensionCapturePayload,
  n: NormalizedEbayCapture,
  card: Record<string, unknown>
): Record<string, unknown> | null => {
  const toNorm = (s: string): string =>
    String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const cardNumberStr = String(card.cardNumber ?? '').trim();
  const cardRaw = Number(card.raw ?? NaN);
  const cardGrade9 = Number(card.grade9 ?? NaN);
  const cardPsa10 = Number(card.psa10 ?? NaN);

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
    'spark',
    'sparks',
  ]);

  const tokenize = (s: string): string[] => {
    const base = toNorm(s)
      .split(' ')
      .filter((t) => t && t.length >= 3 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
    return Array.from(new Set(base));
  };

  const identityTokens = tokenize(`${String(card.name ?? '')} ${String(card.set ?? '')}`);

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

  const getTargetPrice = (r: Record<string, unknown>): number | null => {
    const isGraded = r.isGraded === true;
    const unit =
      typeof r.unitPrice === 'number' && Number.isFinite(r.unitPrice)
        ? r.unitPrice
        : typeof r.price === 'number' && Number.isFinite(r.price)
          ? r.price
          : null;
    if (unit == null) return null;

    if (!isGraded) {
      return Number.isFinite(cardRaw) && cardRaw > 0 ? cardRaw : null;
    }

    const gradeTagRaw = r.gradeTag;
    const gradeNum = gradeTagRaw == null ? null : Number.parseFloat(String(gradeTagRaw));
    if (gradeNum != null && Number.isFinite(gradeNum)) {
      if (gradeNum >= 10) return Number.isFinite(cardPsa10) && cardPsa10 > 0 ? cardPsa10 : null;
      if (Math.round(gradeNum) === 9) return Number.isFinite(cardGrade9) && cardGrade9 > 0 ? cardGrade9 : null;
    }

    return Number.isFinite(cardRaw) && cardRaw > 0 ? cardRaw : null;
  };

  const priceLooksLikeCard = (r: Record<string, unknown>, target: number | null): boolean => {
    if (target == null || !(target > 0)) return true;
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

  type Listing = Record<string, unknown>;
  const normalized: Listing[] = [];
  for (const r of n.listings) {
    const itemId = getItemId(r);
    let itemUrl: string | null = itemId ? `https://www.ebay.com/itm/${itemId}` : r.itemUrl;
    if (itemUrl && /\/p\/\d+/i.test(itemUrl) && !itemId) itemUrl = null;
    normalized.push({
      title: r.title,
      price: r.price,
      unitPrice: r.unitPrice,
      lotQuantity: r.lotQuantity,
      isLot: r.isLot,
      soldAt: r.soldAt,
      itemId,
      itemUrl,
      pokemonCenterStamp: r.pokemonCenterStamp,
      sealedInTitle: r.sealedInTitle,
      gradeTag: r.gradeTag ?? null,
      grader: r.grader ?? null,
      isGraded: r.isGraded === true,
      conditionTag: r.conditionTag ?? null,
      listingKind: r.listingKind ?? 'unknown',
      currentBid: r.currentBid ?? null,
      buyItNow: r.buyItNow ?? null,
      bidCount: r.bidCount ?? null,
      endsAtMs: r.endsAtMs ?? null,
      freeShipping: r.freeShipping === true,
      shippingCost: r.shippingCost ?? null,
      bestOfferAccepted: r.bestOfferAccepted === true,
      imageUrl: r.imageUrl == null ? null : String(r.imageUrl).trim() || null,
    });
  }

  const accepted: Listing[] = [];
  for (const r of normalized) {
    const title = String(r.title || '');
    const { score, cardNumberMatch } = scoreTitleMatch(title);
    const minScore = cardNumberMatch ? 1 : 2;
    if (score < minScore) continue;

    const target = getTargetPrice(r);
    if (!priceLooksLikeCard(r, target)) continue;
    accepted.push(r);
  }

  const dedup = new Map<string, Listing>();
  for (const r of accepted) {
    const itemId = String(r.itemId || '').trim();
    const k =
      itemId ||
      `${Math.floor(Number(r.endsAtMs || 0) / 60_000)}|${Number(r.price || 0).toFixed(2)}|${toNorm(String(
        r.title || ''
      ))}`;
    if (!dedup.has(k)) dedup.set(k, r);
  }

  const listings = Array.from(dedup.values()).sort(
    (a, b) => Number(b.endsAtMs || 0) - Number(a.endsAtMs || 0)
  ) as Array<Record<string, unknown>>;

  return {
    capturedAt: payload.capturedAt ?? Date.now(),
    sourceUrl: payload.url,
    query: n.query,
    captureMode: n.captureMode,
    hasMore: n.hasMore,
    rowCount: listings.length,
    listings: listings.map((r) => ({
      title: String(r.title || ''),
      price: Number(r.price || 0),
      itemId: (r.itemId ? String(r.itemId) : null) as string | null,
      itemUrl: (r.itemUrl ? String(r.itemUrl) : null) as string | null,
      listingKind: (r.listingKind as 'auction' | 'bin' | 'unknown') ?? 'unknown',
      currentBid: r.currentBid == null ? null : Number(r.currentBid),
      buyItNow: r.buyItNow == null ? null : Number(r.buyItNow),
      bidCount: r.bidCount == null ? null : Number(r.bidCount),
      endsAtMs: r.endsAtMs == null ? null : Number(r.endsAtMs),
      freeShipping: r.freeShipping === true,
      shippingCost: r.shippingCost == null ? null : Number(r.shippingCost),
      bestOfferAccepted: r.bestOfferAccepted === true,
      pokemonCenterStamp: r.pokemonCenterStamp === true ? true : null,
      sealedInTitle: r.sealedInTitle === true ? true : null,
      gradeTag: r.gradeTag ?? null,
      grader: r.grader ?? null,
      isGraded: r.isGraded === true,
      conditionTag: r.conditionTag ?? null,
      imageUrl: r.imageUrl == null ? null : String(r.imageUrl).trim() || null,
    })),
  };
};

/**
 * After an extension capture is saved, merge relevant fields into matching
 * portfolio cards (SQL-targeted rows) and persist to app-portfolio v2.
 */
export const mergeExtensionCaptureIntoPortfolio = async (
  dataDir: string,
  _storage: Storage,
  payload: ExtensionCapturePayload
): Promise<{
  touched: number;
  warning?: string;
  error?: string;
  matchedCardIds?: string[];
  diagnostics: Array<{
    cardId: string;
    cardName: string;
    passed: number;
    failed: number;
    skipped: number;
    failedExamples: Array<{
      title: string;
      price: number;
      unitPrice?: number;
      soldAt: number;
      grader: string | null;
      gradeTag: string | null;
      conditionTag: string | null;
    }>;
  }>;
}> => {
  const meta = readPortfolioMeta(dataDir);
  if (!meta) return { touched: 0, diagnostics: [], warning: 'Portfolio meta not found.' };

  const fees = feesFromMetaDoc(meta);
  const db = openAppPortfolioDb(dataDir);
  const capKey = normalizeForMatch(payload.url);

  let ids: string[] = [];
  if (payload.source === 'tcgplayer') {
    const pagePid = tcgProductId(payload.url);
    if (pagePid) {
      ids = (
        db.prepare(`SELECT id FROM cards WHERE norm_tcg_url = ? OR tcg_product_id = ?`).all(capKey, pagePid) as {
          id: string;
        }[]
      ).map((r) => r.id);
    } else {
      ids = (db.prepare(`SELECT id FROM cards WHERE norm_tcg_url = ?`).all(capKey) as { id: string }[]).map(
        (r) => r.id
      );
    }
  } else if (payload.source === 'ebay') {
    const isSoldCapture = (() => {
      try {
        const u = new URL(payload.url);
        const sold = u.searchParams.get('LH_Sold') === '1' || u.searchParams.get('lh_sold') === '1';
        const complete =
          u.searchParams.get('LH_Complete') === '1' || u.searchParams.get('lh_complete') === '1';
        return sold && complete;
      } catch {
        return false;
      }
    })();
    const col = isSoldCapture ? 'ebay_sold_norm' : 'ebay_active_norm';
    ids = (db.prepare(`SELECT id FROM cards WHERE ${col} = ?`).all(capKey) as { id: string }[]).map((r) => r.id);
  } else if (payload.source === 'pricecharting') {
    ids = (db.prepare(`SELECT id FROM cards WHERE norm_pc_url = ?`).all(capKey) as { id: string }[]).map((r) => r.id);
  }

  let touched = 0;
  const diagnostics: Array<{
    cardId: string;
    cardName: string;
    passed: number;
    failed: number;
    skipped: number;
    failedExamples: Array<{
      title: string;
      price: number;
      unitPrice?: number;
      soldAt: number;
      grader: string | null;
      gradeTag: string | null;
      conditionTag: string | null;
    }>;
  }> = [];

  for (const id of ids) {
    let card = getCardById(dataDir, id);
    if (!card) continue;

    if (payload.source === 'tcgplayer') {
      const n = normalizeTcgCapture(payload);
      if (!n) continue;
      const snap = {
        capturedAt: payload.capturedAt ?? Date.now(),
        sourceUrl: payload.url,
        context: n.context,
        captureMode: n.captureMode,
        hasMore: n.hasMore,
        rowCount: n.rowCount,
        pricePoints: n.pricePoints,
        latestSalesRows: n.latestSalesRows,
      };
      const prevSummary = card.tcgplayerSummary as Record<string, unknown> | null | undefined;
      const mergedSummary = mergeTcgSummaryFromCapture(prevSummary, payload, n, card);
      const data = payload.data as Record<string, unknown>;
      const marketRaw =
        typeof data.marketPrice === 'number' && Number.isFinite(data.marketPrice)
          ? (data.marketPrice as number)
          : n.pricePoints.marketPrice;
      const marketForHist =
        typeof marketRaw === 'number' && Number.isFinite(marketRaw) && marketRaw >= 0 ? marketRaw : null;
      const keys = new Set<string>();
      const prevKeys = card.tcgplayerLastScannedSaleKeys;
      if (Array.isArray(prevKeys)) for (const k of prevKeys) keys.add(String(k));
      for (const row of n.latestSalesRows) keys.add(tcgRowScanKey(row));
      const nextSelfHist =
        marketForHist != null
          ? appendTcgplayerSelfSampleServer(card.tcgplayerSelfHistory, marketForHist, Date.now())
          : Array.isArray(card.tcgplayerSelfHistory)
            ? (card.tcgplayerSelfHistory as Array<{ at: number; marketPrice: number }>)
            : [];
      const summaryPatch = marketForHist != null ? { tcgplayerSummary: mergedSummary } : {};
      const merged = {
        ...card,
        ...summaryPatch,
        tcgplayerSalesSnapshot: snap,
        tcgplayerLastScannedSaleKeys: Array.from(keys).slice(-1500),
        tcgplayerSelfHistory: nextSelfHist,
      };
      upsertCardFull(dataDir, merged, fees);
      touched += 1;
      continue;
    }

    if (payload.source === 'ebay') {
      const isSoldCapture = (() => {
        try {
          const u = new URL(payload.url);
          const sold = u.searchParams.get('LH_Sold') === '1' || u.searchParams.get('lh_sold') === '1';
          const complete =
            u.searchParams.get('LH_Complete') === '1' || u.searchParams.get('lh_complete') === '1';
          return sold && complete;
        } catch {
          return false;
        }
      })();

      const n = normalizeEbayCapture(payload);
      if (!n) continue;

      const snap = isSoldCapture
        ? buildEbaySnapshotForCard(payload, n, card)
        : buildEbayActiveSnapshotForCard(payload, n, card);
      if (!snap) continue;

      const passed = Array.isArray((snap as Record<string, unknown>).listings)
        ? ((snap as Record<string, unknown>).listings as unknown[]).length
        : 0;
      const failed = Array.isArray((snap as Record<string, unknown>).rejectedListings)
        ? ((snap as Record<string, unknown>).rejectedListings as unknown[]).length
        : 0;
      const candidates = Array.isArray(n.listings) ? n.listings.length : passed + failed;
      const skipped = Math.max(0, candidates - passed - failed);

      const rejected = (snap as Record<string, unknown>).rejectedListings as unknown[] | undefined;
      const failedExamples = Array.isArray(rejected)
        ? rejected
            .slice(0, 6)
            .map((r) => r as Record<string, unknown>)
            .filter((r) => typeof r.title === 'string')
            .map((r) => ({
              title: String(r.title || ''),
              price: typeof r.price === 'number' && Number.isFinite(r.price) ? r.price : 0,
              unitPrice:
                typeof r.unitPrice === 'number' && Number.isFinite(r.unitPrice) ? r.unitPrice : undefined,
              soldAt:
                typeof r.soldAt === 'number' && Number.isFinite(r.soldAt) ? r.soldAt : Date.now(),
              grader: typeof r.grader === 'string' ? r.grader : null,
              gradeTag: typeof r.gradeTag === 'string' ? r.gradeTag : null,
              conditionTag: typeof r.conditionTag === 'string' ? r.conditionTag : null,
            }))
        : [];

      diagnostics.push({
        cardId: typeof card.id === 'string' ? card.id : String(card.id ?? ''),
        cardName: typeof card.name === 'string' ? card.name : String(card.name ?? ''),
        passed,
        failed,
        skipped,
        failedExamples,
      });

      if (isSoldCapture) {
        const listings = snap.listings as Array<{
          soldAt: number;
          price: number;
          title: string;
          itemId: string | null;
        }>;
        const keys = new Set<string>();
        const prevKeys = card.ebayLastScannedSaleKeys;
        if (Array.isArray(prevKeys)) for (const k of prevKeys) keys.add(String(k));
        for (const row of listings) keys.add(ebayRowScanKey(row));
        const dualPass = resolveEbayDualCapturePass(payload);
        const snapWithPass =
          dualPass != null
            ? { ...snap, capturePass: dualPass }
            : snap;
        if (dualPass != null) {
          card = getCardById(dataDir, id) ?? card;
        }
        const merged: Record<string, unknown> = {
          ...card,
          ebayExtensionSnapshot: snapWithPass,
          ebayLastScannedSaleKeys: Array.from(keys).slice(-2000),
        };
        if (dualPass === 'ebay-graded-no') {
          merged.ebayExtensionSnapshotNo = snapWithPass;
          if (card.ebayExtensionSnapshotYes != null) {
            merged.ebayExtensionSnapshotYes = card.ebayExtensionSnapshotYes;
          }
        } else if (dualPass === 'ebay-graded-yes') {
          merged.ebayExtensionSnapshotYes = snapWithPass;
          if (card.ebayExtensionSnapshotNo != null) {
            merged.ebayExtensionSnapshotNo = card.ebayExtensionSnapshotNo;
          }
        }
        upsertCardFull(dataDir, merged, fees);
      } else {
        const merged = {
          ...card,
          ebayActiveExtensionSnapshot: snap,
        };
        upsertCardFull(dataDir, merged, fees);
      }
      touched += 1;
      continue;
    }

    if (payload.source === 'pricecharting') {
      const data = payload.data as Record<string, unknown>;
      const rawPrice =
        typeof data.rawPrice === 'number' && Number.isFinite(data.rawPrice) ? data.rawPrice : null;
      const tcgHref =
        typeof data.tcgplayerUrl === 'string' && data.tcgplayerUrl.trim()
          ? data.tcgplayerUrl.trim()
          : null;
      const patch: Record<string, unknown> = { ...card };
      if (rawPrice != null && rawPrice >= 0) {
        patch.raw = rawPrice;
      }
      if (tcgHref && /^https?:\/\/(www\.)?tcgplayer\.com\/product\/\d+/i.test(tcgHref)) {
        patch.tcgplayerUrl = tcgHref.split('#')[0].split('?')[0];
      }
      patch.lastRefreshedAt = Date.now();
      upsertCardFull(dataDir, patch, fees);
      touched += 1;
    }
  }

  const m = readPortfolioMeta(dataDir);
  if (m) {
    writePortfolioMeta(dataDir, { ...m, updatedAt: Date.now() });
  }

  let warning: string | undefined;
  if (touched === 0) {
    if (payload.source === 'ebay') {
      warning =
        'No portfolio card matched this eBay URL (ebay_sold_norm). Open the sold-search tab from the card in Raw Investor, or update the card eBay link, then capture again.';
    } else if (payload.source === 'tcgplayer') {
      warning =
        'No portfolio card matched this TCGPlayer URL. Capture from the product page linked on the card.';
    } else if (payload.source === 'pricecharting') {
      warning = 'No portfolio card matched this PriceCharting URL.';
    } else {
      warning = 'Capture saved but no portfolio card was updated.';
    }
  }

  return {
    touched,
    diagnostics,
    warning: touched === 0 ? warning : undefined,
    matchedCardIds: ids.length > 0 ? ids : undefined,
  };
};
