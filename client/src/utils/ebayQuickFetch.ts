import { apiUrl, buildApiHeaders } from '../apiBase';
import type {
  Card,
  EbayDualCaptureStats,
  EbayExtensionListing,
  EbayExtensionSnapshot,
  EbayFilteredListing,
  EbayVerificationArchiveEntry,
  TcgplayerLatestSaleRow,
  TcgplayerSalesSnapshot,
} from '../types';
import { ebayListingSaleKey } from '../ebayStamp';
import { enrichEbayListingFromTitle } from './ebayTitleMeta';
import { startOfUtcDay } from '../releaseFilter';

export type EbayExtractPayload = {
  source?: string;
  url?: string;
  data?: {
    listings?: EbayExtensionListing[];
    excludedListings?: Array<
      EbayExtensionListing & { excludeReason?: string; titleFromLink?: string; titleFromBody?: string }
    >;
    query?: string;
    captureMode?: string;
    hasMore?: boolean;
    captureStats?: Record<string, unknown>;
    excludedRowCount?: number;
  };
};

const medianSorted = (nums: number[]): number | null => {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Dedupe sold rows by eBay item id (fallback composite key). */
export const dedupeEbayListings = (rows: EbayExtensionListing[]): EbayExtensionListing[] => {
  const by = new Map<string, EbayExtensionListing>();
  for (const r of rows) {
    const k =
      r.itemId && String(r.itemId).trim()
        ? `id:${String(r.itemId).trim()}`
        : `k:${r.soldAt}|${r.price}|${String(r.title || '').slice(0, 120)}`;
    if (!by.has(k)) by.set(k, r);
  }
  return Array.from(by.values());
};

/**
 * Merge two extractor payloads (Graded No pass + Graded Yes pass) into one snapshot for PATCH.
 */
export const mergeDualGradedEbayCaptures = (
  capNo: EbayExtractPayload | null | undefined,
  capYes: EbayExtractPayload | null | undefined,
  baseSoldUrl: string
): EbayExtensionSnapshot => {
  const listingsNo = capNo?.data?.listings ?? [];
  const listingsYes = capYes?.data?.listings ?? [];
  const mergedListings = dedupeEbayListings([...listingsNo, ...listingsYes]).map(enrichEbayListingFromTitle);

  const exNo = capNo?.data?.excludedListings ?? [];
  const exYes = capYes?.data?.excludedListings ?? [];
  const mergedRejectedMap = new Map<string, EbayFilteredListing>();
  for (const r of [...exNo, ...exYes]) {
    const row = r as EbayExtensionListing;
    const id =
      row.itemId && String(row.itemId).trim()
        ? `id:${String(row.itemId).trim()}`
        : `k:${row.soldAt}|${row.price}|${String(row.title || '').slice(0, 120)}`;
    if (!mergedRejectedMap.has(id)) {
      mergedRejectedMap.set(id, {
        ...enrichEbayListingFromTitle(row),
        filterReason: 'listing_mismatch',
      });
    }
  }
  const mergedRejected = Array.from(mergedRejectedMap.values());

  const q =
    String(capNo?.data?.query || capYes?.data?.query || '').trim() ||
    new URL(baseSoldUrl).searchParams.get('_nkw') ||
    '';

  const statsNo = capNo?.data?.captureStats ?? {};
  const statsYes = capYes?.data?.captureStats ?? {};
  const capModeNo = capNo?.data?.captureMode;
  const capModeYes = capYes?.data?.captureMode;
  const captureMode =
    capModeNo === 'deep' || capModeYes === 'deep' ? ('deep' as const) : ('default' as const);

  const dual: EbayDualCaptureStats = {
    gradedNoRows: listingsNo.length,
    gradedYesRows: listingsYes.length,
    gradedNoPages: typeof statsNo.pagesScanned === 'number' ? statsNo.pagesScanned : 1,
    gradedYesPages: typeof statsYes.pagesScanned === 'number' ? statsYes.pagesScanned : 1,
    gradedFacetAppliedNo: statsNo.gradedFacetApplied === true,
    gradedFacetAppliedYes: statsYes.gradedFacetApplied === true,
  };

  return {
    capturedAt: Date.now(),
    sourceUrl: baseSoldUrl,
    query: q,
    captureMode,
    hasMore: Boolean(capNo?.data?.hasMore || capYes?.data?.hasMore),
    rowCount: mergedListings.length,
    listings: mergedListings,
    rejectedListings: mergedRejected.length ? mergedRejected : undefined,
    ebayDualCaptureStats: dual,
  };
};

/** TCG archive key aligned with overview manual archive (`overviewMarketSalesSection`). */
export const tcgSaleArchiveKey = (r: TcgplayerLatestSaleRow): string =>
  `${startOfUtcDay(r.at)}|${(r.condition || '').trim().toLowerCase()}|${r.qty}|${r.price.toFixed(4)}`;

/**
 * Single deep eBay capture without graded facet passes (sealed products).
 * Uses {@link ebaySkipGradedFacetClick} in the extractor.
 */
export const buildEbayDeepSnapshotFromSingleCapture = (
  cap: EbayExtractPayload | null | undefined,
  baseSoldUrl: string
): EbayExtensionSnapshot => {
  const listings = dedupeEbayListings(cap?.data?.listings ?? []).map(enrichEbayListingFromTitle);
  const ex = cap?.data?.excludedListings ?? [];
  const mergedRejectedMap = new Map<string, EbayFilteredListing>();
  for (const r of ex) {
    const row = r as EbayExtensionListing;
    const id =
      row.itemId && String(row.itemId).trim()
        ? `id:${String(row.itemId).trim()}`
        : `k:${row.soldAt}|${row.price}|${String(row.title || '').slice(0, 120)}`;
    if (!mergedRejectedMap.has(id)) {
      mergedRejectedMap.set(id, {
        ...enrichEbayListingFromTitle(row),
        filterReason: 'listing_mismatch',
      });
    }
  }
  const mergedRejected = Array.from(mergedRejectedMap.values());

  const q =
    String(cap?.data?.query || '').trim() ||
    new URL(baseSoldUrl).searchParams.get('_nkw') ||
    '';

  const stats = cap?.data?.captureStats ?? {};
  const captureMode = cap?.data?.captureMode === 'deep' ? ('deep' as const) : ('default' as const);
  const dual: EbayDualCaptureStats = {
    gradedNoRows: listings.length,
    gradedYesRows: 0,
    gradedNoPages: typeof stats.pagesScanned === 'number' ? stats.pagesScanned : 1,
    gradedYesPages: 0,
    gradedFacetAppliedNo: stats.gradedFacetApplied === true,
    gradedFacetAppliedYes: false,
    sealedSinglePass: true,
  };

  return {
    capturedAt: Date.now(),
    sourceUrl: baseSoldUrl,
    query: q,
    captureMode,
    hasMore: Boolean(cap?.data?.hasMore),
    rowCount: listings.length,
    listings,
    rejectedListings: mergedRejected.length ? mergedRejected : undefined,
    ebayDualCaptureStats: dual,
  };
};

export type VerifyArchiveOptions = {
  medianMult?: number;
  rawMult?: number;
  maxChecks?: number;
  /** Sealed: skip graded/RAW outlier filtering — keep primary sales history as captured. */
  skipGradedOutlierArchive?: boolean;
};

/** Default gates: price must exceed BOTH trimmed median RAW comps and PC raw × multiplier. */
export const verifyAndArchiveEbayOutliers = async (
  card: Card,
  snapshot: EbayExtensionSnapshot,
  existingArchive: EbayVerificationArchiveEntry[] | undefined,
  existingArchivedKeys: string[] | undefined,
  opts?: VerifyArchiveOptions
): Promise<{
  snapshot: EbayExtensionSnapshot;
  ebayVerificationArchive: EbayVerificationArchiveEntry[];
  ebayArchivedSaleKeys: string[];
}> => {
  if (opts?.skipGradedOutlierArchive === true || card.portfolioKind === 'sealed') {
    return {
      snapshot,
      ebayVerificationArchive: Array.isArray(existingArchive) ? [...existingArchive] : [],
      ebayArchivedSaleKeys: [...(existingArchivedKeys ?? [])],
    };
  }

  const medianMult = opts?.medianMult ?? 1.35;
  const rawMult = opts?.rawMult ?? 1.25;
  const maxChecks = opts?.maxChecks ?? 40;

  const rawPrices = (snapshot.listings ?? [])
    .filter((r) => !r.isGraded && typeof r.price === 'number' && Number.isFinite(r.price))
    .map((r) => r.price);
  const med = medianSorted(rawPrices);

  const pcRaw = typeof card.raw === 'number' && Number.isFinite(card.raw) ? card.raw : null;

  const archivePrev = Array.isArray(existingArchive) ? [...existingArchive] : [];
  const keysPrev = new Set(existingArchivedKeys ?? []);

  const keep: EbayExtensionListing[] = [];
  const newEntries: EbayVerificationArchiveEntry[] = [];
  const newKeys: string[] = [];

  let checks = 0;
  for (const row of snapshot.listings ?? []) {
    const price = typeof row.price === 'number' ? row.price : NaN;
    const isRaw = !row.isGraded;
    let suspicious = false;
    if (isRaw && Number.isFinite(price) && med != null && pcRaw != null && pcRaw > 0) {
      if (price > med * medianMult && price > pcRaw * rawMult) suspicious = true;
    }

    if (!suspicious || checks >= maxChecks) {
      keep.push(row);
      continue;
    }
    checks += 1;
    const itemUrl =
      row.itemUrl ||
      (row.itemId ? `https://www.ebay.com/itm/${String(row.itemId).trim()}` : '');
    if (!itemUrl) {
      keep.push(row);
      continue;
    }

    try {
      const r = await fetch(apiUrl('/api/ebay/verify-listing'), {
        method: 'POST',
        headers: buildApiHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          itemUrl,
          name: card.name,
          set: card.set,
          cardNumber: card.cardNumber,
        }),
      });
      const j = (await r.json()) as { ok?: boolean; reason?: string; pageTitle?: string | null };
      if (r.ok && j.ok === true) {
        keep.push(row);
        continue;
      }
      const reason = `verify:${j.reason || 'failed'}${j.pageTitle ? ` (${j.pageTitle.slice(0, 80)})` : ''}`;
      newEntries.push({ archivedAt: Date.now(), reason, listing: row });
      newKeys.push(ebayListingSaleKey(row));
    } catch {
      keep.push(row);
    }
  }

  const mergedArchive = [...archivePrev, ...newEntries];
  const mergedKeys = Array.from(new Set([...Array.from(keysPrev), ...newKeys]));

  return {
    snapshot: { ...snapshot, listings: keep, rowCount: keep.length },
    ebayVerificationArchive: mergedArchive,
    ebayArchivedSaleKeys: mergedKeys,
  };
};

/**
 * Sealed TCG latest-sales: drop median×RAW price outliers (same gates as eBay RAW verify; no HTTP checks).
 */
export function archiveTcgSalesPriceOutliers(
  card: Pick<Card, 'raw'>,
  snapshot: TcgplayerSalesSnapshot,
  existingArchivedKeys: string[] | undefined,
  opts?: VerifyArchiveOptions
): { snapshot: TcgplayerSalesSnapshot; tcgplayerArchivedSaleKeys: string[] } {
  const medianMult = opts?.medianMult ?? 1.35;
  const rawMult = opts?.rawMult ?? 1.25;
  const maxChecks = opts?.maxChecks ?? 40;

  const rows = snapshot.latestSalesRows ?? [];
  const prices = rows
    .filter((r) => typeof r.price === 'number' && Number.isFinite(r.price))
    .map((r) => r.price);
  const med = medianSorted(prices);
  const pcRaw = typeof card.raw === 'number' && Number.isFinite(card.raw) ? card.raw : null;

  const keysPrev = new Set(existingArchivedKeys ?? []);
  const newKeys: string[] = [];
  const keep: TcgplayerLatestSaleRow[] = [];
  let checks = 0;

  for (const row of rows) {
    const price = typeof row.price === 'number' ? row.price : NaN;
    let suspicious = false;
    if (Number.isFinite(price) && med != null && pcRaw != null && pcRaw > 0) {
      if (price > med * medianMult && price > pcRaw * rawMult) suspicious = true;
    }

    if (!suspicious || checks >= maxChecks) {
      keep.push(row);
      continue;
    }
    checks += 1;
    newKeys.push(tcgSaleArchiveKey(row));
  }

  const mergedKeys = Array.from(new Set([...Array.from(keysPrev), ...newKeys]));
  const nextRecent = keep[0]?.price ?? snapshot.pricePoints.mostRecentSale;

  return {
    snapshot: {
      ...snapshot,
      rowCount: keep.length,
      latestSalesRows: keep,
      pricePoints: {
        ...snapshot.pricePoints,
        mostRecentSale: nextRecent,
      },
    },
    tcgplayerArchivedSaleKeys: mergedKeys,
  };
}
