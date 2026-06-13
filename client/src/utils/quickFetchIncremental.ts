import type {
  Card,
  EbayExtensionSnapshot,
  EbayFilteredListing,
  TcgplayerLatestSaleRow,
  TcgplayerSalesSnapshot,
} from '../types';
import { dedupeEbayListings } from './ebayQuickFetch';

function tcgSaleDedupeKey(r: TcgplayerLatestSaleRow): string {
  return `${r.at}|${r.price}|${String(r.condition ?? '')}|${r.qty}`;
}

/** Latest `soldAt` across stored eBay sold rows (null → treat as no watermark / full capture). */
export function getEbaySoldWatermarkMs(card: Card): number | null {
  const listings = card.ebayExtensionSnapshot?.listings;
  if (!Array.isArray(listings) || listings.length === 0) return null;
  let max = -Infinity;
  for (const r of listings) {
    const t = typeof r.soldAt === 'number' && Number.isFinite(r.soldAt) ? r.soldAt : NaN;
    if (Number.isFinite(t)) max = Math.max(max, t);
  }
  return Number.isFinite(max) && max > 0 ? max : null;
}

/** Latest sale timestamp across stored TCG latest-sales rows. */
export function getTcgSalesWatermarkMs(card: Card): number | null {
  const rows = card.tcgplayerSalesSnapshot?.latestSalesRows;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  let max = -Infinity;
  for (const r of rows) {
    const t = typeof r.at === 'number' && Number.isFinite(r.at) ? r.at : NaN;
    if (Number.isFinite(t)) max = Math.max(max, t);
  }
  return Number.isFinite(max) && max > 0 ? max : null;
}

export function mergeIncrementalEbaySnapshots(
  existing: EbayExtensionSnapshot | null | undefined,
  incoming: EbayExtensionSnapshot
): EbayExtensionSnapshot {
  const mergedListings = dedupeEbayListings([
    ...(existing?.listings ?? []),
    ...(incoming.listings ?? []),
  ]);
  mergedListings.sort((a, b) => (b.soldAt ?? 0) - (a.soldAt ?? 0));

  const mergedRejectedMap = new Map<string, EbayFilteredListing>();
  for (const r of [...(existing?.rejectedListings ?? []), ...(incoming.rejectedListings ?? [])]) {
    const row = r;
    const id =
      row.itemId && String(row.itemId).trim()
        ? `id:${String(row.itemId).trim()}`
        : `k:${row.soldAt}|${row.price}|${String(row.title || '').slice(0, 120)}`;
    if (!mergedRejectedMap.has(id)) mergedRejectedMap.set(id, row);
  }
  const mergedRejected = Array.from(mergedRejectedMap.values());

  return {
    ...incoming,
    capturedAt: Math.max(existing?.capturedAt ?? 0, incoming.capturedAt),
    listings: mergedListings,
    rowCount: mergedListings.length,
    rejectedListings: mergedRejected.length ? mergedRejected : undefined,
    ebayDualCaptureStats: incoming.ebayDualCaptureStats ?? existing?.ebayDualCaptureStats,
  };
}

export function mergeIncrementalTcgSnapshots(
  existing: TcgplayerSalesSnapshot | null | undefined,
  incoming: TcgplayerSalesSnapshot
): TcgplayerSalesSnapshot {
  const merged = new Map<string, TcgplayerLatestSaleRow>();
  for (const r of existing?.latestSalesRows ?? []) merged.set(tcgSaleDedupeKey(r), r);
  for (const r of incoming.latestSalesRows) merged.set(tcgSaleDedupeKey(r), r);
  const combined = Array.from(merged.values()).sort((x, y) => y.at - x.at);
  return {
    ...incoming,
    latestSalesRows: combined,
    rowCount: combined.length,
    capturedAt: Math.max(existing?.capturedAt ?? 0, incoming.capturedAt),
  };
}

/** Prefer extension capture when it is newer or has more rows; avoid discarding a fresh manual capture behind an older bulk snapshot. */
export function resolveEbaySnapshotForRefresh(
  fromExtension: EbayExtensionSnapshot | null | undefined,
  existing: EbayExtensionSnapshot | undefined | null
): EbayExtensionSnapshot | null {
  if (!fromExtension) return existing ?? null;
  if (!existing) return fromExtension;
  const iRows = fromExtension.listings?.length ?? 0;
  const eRows = existing.listings?.length ?? 0;
  const iAt = fromExtension.capturedAt ?? 0;
  const eAt = existing.capturedAt ?? 0;
  if (iRows > eRows) return fromExtension;
  if (iAt > eAt && iRows > 0) return fromExtension;
  if (iRows < eRows) return existing;
  return iAt >= eAt ? fromExtension : existing;
}

export function resolveTcgSnapshotForRefresh(
  fromExtension: TcgplayerSalesSnapshot | null | undefined,
  existing: TcgplayerSalesSnapshot | undefined | null
): TcgplayerSalesSnapshot | null {
  if (!fromExtension) return existing ?? null;
  if (!existing) return fromExtension;
  const iRows = fromExtension.latestSalesRows?.length ?? 0;
  const eRows = existing.latestSalesRows?.length ?? 0;
  if (iRows > eRows) return fromExtension;
  if (iRows < eRows) return existing;
  const iAt = fromExtension.capturedAt ?? 0;
  const eAt = existing.capturedAt ?? 0;
  return iAt >= eAt ? fromExtension : existing;
}
