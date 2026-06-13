import type { PortfolioMetaDoc } from './portfolioCardsRepository.js';

export type EbaySessionExtensionReport = {
  status: 'signed-in' | 'signed-out' | 'unknown';
  url: string;
  title: string;
  reportedAt: number;
};

export function parseEbaySessionExtensionPostBody(body: unknown): {
  status: EbaySessionExtensionReport['status'];
  url: string;
  title: string;
} | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const o = body as Record<string, unknown>;
  const st = o.status;
  if (st !== 'signed-in' && st !== 'signed-out' && st !== 'unknown') return null;
  const url = typeof o.url === 'string' ? o.url.trim().slice(0, 2048) : '';
  const title = typeof o.title === 'string' ? o.title.trim().slice(0, 512) : '';
  return { status: st, url, title };
}

export function mergeEbaySessionExtensionReport(
  cur: PortfolioMetaDoc,
  partial: { status: EbaySessionExtensionReport['status']; url: string; title: string },
  reportedAt: number
): PortfolioMetaDoc {
  const report: EbaySessionExtensionReport = {
    status: partial.status,
    url: partial.url,
    title: partial.title,
    reportedAt,
  };
  return { ...cur, ebaySessionExtensionReport: report, updatedAt: reportedAt } as PortfolioMetaDoc;
}
