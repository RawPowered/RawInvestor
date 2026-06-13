import type {
  Card,
  EbayExtensionListing,
  EbayExtensionSnapshot,
  EbaySalesSummary,
} from '../types';

export const ebayRowScanKeyClient = (row: {
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

export const ebaySalesSummaryToExtensionListings = (
  summary: EbaySalesSummary
): EbayExtensionListing[] =>
  (summary.listings ?? []).map((row) => ({
    title: row.title,
    price: row.price,
    soldAt: row.soldAt,
    itemId: row.itemId || null,
    itemUrl: row.itemUrl ?? (row.itemId ? `https://www.ebay.com/itm/${row.itemId}` : null),
    listingKind: 'unknown' as const,
    isGraded: undefined,
    gradeTag: null,
    grader: null,
  }));

export const mergeEbaySoldSources = (
  extensionSnap: EbayExtensionSnapshot | null | undefined,
  apiSummary: EbaySalesSummary | null | undefined
): EbayExtensionListing[] => {
  const fromExt = extensionSnap?.listings ?? [];
  const fromApi = apiSummary ? ebaySalesSummaryToExtensionListings(apiSummary) : [];
  const seen = new Set<string>();
  const out: EbayExtensionListing[] = [];
  for (const row of [...fromExt, ...fromApi]) {
    const key = ebayRowScanKeyClient(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out.sort((a, b) => a.soldAt - b.soldAt);
};

export type EbaySoldDisplaySource = 'extension' | 'api' | 'merged' | 'none';

export type EbaySoldDisplay = {
  source: EbaySoldDisplaySource;
  listings: EbayExtensionListing[];
  capturedAt: number | null;
  query: string | null;
  apiSummary: EbaySalesSummary | null;
  extensionSnapshot: EbayExtensionSnapshot | null;
};

const EXT_STALE_MS = 7 * 24 * 60 * 60 * 1000;

export const resolveEbaySoldDisplay = (card: Pick<
  Card,
  'ebayExtensionSnapshot' | 'ebaySales' | 'name' | 'set' | 'cardNumber'
>): EbaySoldDisplay => {
  const ext = card.ebayExtensionSnapshot ?? null;
  const api = card.ebaySales ?? null;
  const extFresh =
    ext &&
    (ext.listings?.length ?? 0) > 0 &&
    Date.now() - (ext.capturedAt ?? 0) < EXT_STALE_MS;
  if (extFresh) {
    const merged = api ? mergeEbaySoldSources(ext, api) : (ext.listings ?? []);
    return {
      source: api && (api.listings?.length ?? 0) > 0 ? 'merged' : 'extension',
      listings: merged,
      capturedAt: ext.capturedAt ?? null,
      query: ext.query ?? api?.query ?? null,
      apiSummary: api,
      extensionSnapshot: ext,
    };
  }
  if (api && (api.listings?.length ?? 0) > 0) {
    return {
      source: 'api',
      listings: ebaySalesSummaryToExtensionListings(api),
      capturedAt: api.fetchedAt ?? null,
      query: api.query ?? null,
      apiSummary: api,
      extensionSnapshot: ext,
    };
  }
  if (ext && (ext.listings?.length ?? 0) > 0) {
    return {
      source: 'extension',
      listings: ext.listings ?? [],
      capturedAt: ext.capturedAt ?? null,
      query: ext.query ?? null,
      apiSummary: api,
      extensionSnapshot: ext,
    };
  }
  return {
    source: 'none',
    listings: [],
    capturedAt: null,
    query: null,
    apiSummary: api,
    extensionSnapshot: ext,
  };
};
