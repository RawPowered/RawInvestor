import type { TcgplayerLatestSaleRow, TcgplayerSalesSnapshot } from '../types';

type TcgExtractRaw = {
  source?: string;
  url?: string;
  capturedAt?: number;
  data?: {
    captureMode?: 'default' | 'deep';
    latestSalesRows?: TcgplayerLatestSaleRow[];
    rowCount?: number;
    hasMore?: boolean;
    pricePoints?: TcgplayerSalesSnapshot['pricePoints'];
    context?: TcgplayerSalesSnapshot['context'];
    tcgFeedSanity?: Record<string, unknown>;
  };
};

export type TcgCaptureEcho = {
  raw?: TcgExtractRaw;
  rowCount?: number | null;
};

function saleKey(r: TcgplayerLatestSaleRow): string {
  return `${r.at}|${r.price}|${String(r.condition ?? '')}|${r.qty}`;
}

function extractSnapshot(echo: TcgCaptureEcho | null | undefined, fallbackUrl: string): TcgplayerSalesSnapshot | null {
  const raw = echo?.raw;
  if (!raw || raw.source !== 'tcgplayer' || !raw.data) return null;
  const d = raw.data;
  const rows = d.latestSalesRows;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const pp = d.pricePoints ?? {
    marketPrice: null,
    mostRecentSale: null,
    listedMedian: null,
    currentQuantity: null,
    currentSellers: null,
  };
  const ctx = d.context ?? { language: null, condition: null, printing: null };
  return {
    capturedAt: typeof raw.capturedAt === 'number' ? raw.capturedAt : Date.now(),
    sourceUrl: fallbackUrl || String(raw.url || ''),
    context: ctx,
    captureMode: d.captureMode === 'deep' ? 'deep' : 'default',
    hasMore: Boolean(d.hasMore),
    rowCount: typeof d.rowCount === 'number' ? d.rowCount : rows.length,
    pricePoints: pp,
    latestSalesRows: rows,
  };
}

/**
 * Merge default-mode + deep-mode TCG captures from **separate RawEngine tabs**.
 * Dedupes rows; prefers metadata from the snapshot with more rows.
 */
export function mergeTcgDualRawEngineCaptures(
  defaultEcho: TcgCaptureEcho | null | undefined,
  deepEcho: TcgCaptureEcho | null | undefined,
  sourceUrl: string
): TcgplayerSalesSnapshot | null {
  const a = extractSnapshot(defaultEcho, sourceUrl);
  const b = extractSnapshot(deepEcho, sourceUrl);
  if (!a && !b) return null;
  if (!a) return b;
  if (!b) return a;

  const preferBase = a.latestSalesRows.length >= b.latestSalesRows.length ? a : b;
  const other = preferBase === a ? b : a;

  const merged = new Map<string, TcgplayerLatestSaleRow>();
  for (const r of other.latestSalesRows) merged.set(saleKey(r), r);
  for (const r of preferBase.latestSalesRows) merged.set(saleKey(r), r);
  const combined = Array.from(merged.values()).sort((x, y) => y.at - x.at);

  return {
    ...preferBase,
    latestSalesRows: combined,
    rowCount: combined.length,
    capturedAt: Math.max(a.capturedAt, b.capturedAt),
    captureMode: preferBase.captureMode === 'deep' ? 'deep' : 'default',
    sourceUrl: sourceUrl || preferBase.sourceUrl,
  };
}
