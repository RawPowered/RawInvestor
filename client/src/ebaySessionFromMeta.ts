/** Portfolio meta key written by MV3 extension POST /api/ext/ebay-session (server). */
export const EBAY_SESSION_EXTENSION_MAX_AGE_MS = 30 * 60 * 1000;

export type EbaySessionExtensionReport = {
  status: 'signed-in' | 'signed-out' | 'unknown';
  url?: string;
  title?: string;
  reportedAt: number;
};

export function parseEbaySessionExtensionReport(
  doc: Record<string, unknown> | null | undefined
): EbaySessionExtensionReport | null {
  if (!doc || typeof doc !== 'object') return null;
  const r = doc.ebaySessionExtensionReport;
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  const o = r as Record<string, unknown>;
  const st = o.status;
  if (st !== 'signed-in' && st !== 'signed-out' && st !== 'unknown') return null;
  const reportedAt =
    typeof o.reportedAt === 'number' && Number.isFinite(o.reportedAt) ? o.reportedAt : NaN;
  if (!Number.isFinite(reportedAt)) return null;
  if (Date.now() - reportedAt > EBAY_SESSION_EXTENSION_MAX_AGE_MS) return null;
  return {
    status: st,
    url: typeof o.url === 'string' ? o.url : undefined,
    title: typeof o.title === 'string' ? o.title : undefined,
    reportedAt,
  };
}

/** UI-friendly session row when extension report is fresh enough. */
export function ebaySessionUiFromExtensionReport(report: EbaySessionExtensionReport): {
  status: EbaySessionExtensionReport['status'];
  source: string;
  url?: string;
  title?: string;
} {
  return {
    status: report.status,
    source: 'Edge extension',
    url: report.url,
    title: report.title,
  };
}
