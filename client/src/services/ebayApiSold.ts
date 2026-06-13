import type { Card, EbaySalesSummary } from '../types';
import { apiUrl, buildApiHeaders } from '../apiBase';
import { buildEbaySearchQuery } from '../utils/ebaySearchQuery';

export type EbayApiConfigStatus = {
  configured: boolean;
  env: 'production' | 'sandbox' | null;
  effectiveCredentialSource: 'meta' | 'env' | null;
  ebayApiFirstIncremental?: boolean;
};

export type FetchEbaySoldForCardOpts = {
  windowDays?: number;
  limit?: number;
  startDate?: string;
  endDate?: string;
  categoryIds?: string[];
};

export type EbaySoldBatchResult =
  | { cardId: string; ok: true; data: EbaySalesSummary }
  | { cardId: string; ok: false; error: string };

let configStatusCache: { at: number; value: EbayApiConfigStatus } | null = null;
const CONFIG_TTL_MS = 30_000;

export const invalidateEbayApiConfigCache = (): void => {
  configStatusCache = null;
};

export const fetchEbayApiConfigStatus = async (force = false): Promise<EbayApiConfigStatus> => {
  const now = Date.now();
  if (!force && configStatusCache && now - configStatusCache.at < CONFIG_TTL_MS) {
    return configStatusCache.value;
  }
  try {
    const r = await fetch(apiUrl('/api/ebay/config/status'), {
      headers: buildApiHeaders({ Accept: 'application/json' }),
    });
    const j = (await r.json().catch(() => ({}))) as EbayApiConfigStatus & { error?: string };
    if (!r.ok) {
      const value: EbayApiConfigStatus = {
        configured: false,
        env: null,
        effectiveCredentialSource: null,
      };
      configStatusCache = { at: now, value };
      return value;
    }
    const value: EbayApiConfigStatus = {
      configured: j.configured === true,
      env: j.env === 'sandbox' ? 'sandbox' : j.env === 'production' ? 'production' : null,
      effectiveCredentialSource:
        j.effectiveCredentialSource === 'meta' || j.effectiveCredentialSource === 'env'
          ? j.effectiveCredentialSource
          : null,
      ebayApiFirstIncremental: j.ebayApiFirstIncremental !== false,
    };
    configStatusCache = { at: now, value };
    return value;
  } catch {
    return { configured: false, env: null, effectiveCredentialSource: null };
  }
};

export const isEbayApiConfigured = async (): Promise<boolean> => {
  const s = await fetchEbayApiConfigStatus();
  return s.configured;
};

export const ebaySearchQueryForCard = (card: Pick<Card, 'name' | 'set' | 'cardNumber'>): string =>
  buildEbaySearchQuery(card);

export const fetchEbaySoldForCard = async (
  card: Pick<Card, 'name' | 'set' | 'cardNumber'>,
  opts?: FetchEbaySoldForCardOpts
): Promise<EbaySalesSummary> => {
  const q = buildEbaySearchQuery(card);
  const params = new URLSearchParams({ q });
  if (opts?.windowDays != null && Number.isFinite(opts.windowDays)) {
    params.set('windowDays', String(Math.floor(opts.windowDays)));
  }
  if (opts?.limit != null && Number.isFinite(opts.limit)) {
    params.set('limit', String(Math.floor(opts.limit)));
  }
  if (opts?.startDate) params.set('startDate', opts.startDate);
  if (opts?.endDate) params.set('endDate', opts.endDate);
  if (opts?.categoryIds?.length) params.set('categoryIds', opts.categoryIds.join(','));
  const r = await fetch(apiUrl(`/api/ebay/sold?${params.toString()}`), {
    headers: buildApiHeaders({ Accept: 'application/json' }),
  });
  const j = (await r.json().catch(() => ({}))) as EbaySalesSummary & { error?: string };
  if (!r.ok) {
    throw new Error(j.error || `eBay sold API failed (${r.status})`);
  }
  return j as EbaySalesSummary;
};

export const fetchEbaySoldBatch = async (
  cards: Array<{ cardId: string; q: string; windowDays?: number; limit?: number; startDate?: string; endDate?: string }>,
  concurrency = 2
): Promise<{ results: EbaySoldBatchResult[]; total: number; succeeded: number }> => {
  const r = await fetch(apiUrl('/api/ebay/sold/batch'), {
    method: 'POST',
    headers: buildApiHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' }),
    body: JSON.stringify({
      queries: cards.map((c) => ({
        cardId: c.cardId,
        q: c.q,
        windowDays: c.windowDays,
        limit: c.limit,
        startDate: c.startDate,
        endDate: c.endDate,
      })),
      concurrency,
    }),
  });
  const j = (await r.json().catch(() => ({}))) as {
    results?: EbaySoldBatchResult[];
    total?: number;
    succeeded?: number;
    error?: string;
  };
  if (!r.ok) {
    throw new Error(j.error || `eBay sold batch failed (${r.status})`);
  }
  return {
    results: j.results ?? [],
    total: j.total ?? cards.length,
    succeeded: j.succeeded ?? 0,
  };
};

export const testEbaySoldSearch = async (
  q: string,
  opts?: { windowDays?: number; limit?: number }
): Promise<EbaySalesSummary> => {
  const params = new URLSearchParams({ q: q.trim() || 'pokemon card' });
  if (opts?.windowDays != null) params.set('windowDays', String(opts.windowDays));
  if (opts?.limit != null) params.set('limit', String(opts.limit));
  const r = await fetch(apiUrl(`/api/ebay/sold?${params.toString()}`), {
    headers: buildApiHeaders({ Accept: 'application/json' }),
  });
  const j = (await r.json().catch(() => ({}))) as EbaySalesSummary & { error?: string };
  if (!r.ok) throw new Error(j.error || `Test sold search failed (${r.status})`);
  return j as EbaySalesSummary;
};
