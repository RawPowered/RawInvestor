import crypto from 'node:crypto';
import { readPortfolioMeta } from './portfolioCardsRepository.js';

const EBAY_OAUTH_SCOPE = 'https://api.ebay.com/oauth/api_scope';
const TOKEN_SAFETY_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

const quantile = (sortedAsc: number[], q: number): number | null => {
  if (!sortedAsc.length) return null;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const clamped = Math.max(0, Math.min(1, q));
  const pos = clamped * (sortedAsc.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedAsc[lo];
  const frac = pos - lo;
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * frac;
};

const mean = (values: number[]): number | null => {
  if (!values.length) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
};

const toNumber = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

export type EbayApiEnv = 'production' | 'sandbox';

export type EbayResolvedCreds = {
  clientId: string;
  clientSecret: string;
  env: EbayApiEnv;
  source: 'meta' | 'env';
};

const apiBaseForEnv = (env: EbayApiEnv): string =>
  env === 'sandbox' ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com';

/**
 * Resolve application OAuth credentials: portfolio meta (when `dataDir` set) wins over `process.env`.
 */
export const resolveEbayAppCredentials = (dataDir?: string): EbayResolvedCreds | null => {
  if (dataDir) {
    try {
      const meta = readPortfolioMeta(dataDir);
      const id = String(meta?.ebayClientId ?? '').trim();
      const sec = String(meta?.ebayClientSecret ?? '').trim();
      if (id && sec) {
        const env: EbayApiEnv = meta?.ebayEnv === 'sandbox' ? 'sandbox' : 'production';
        return { clientId: id, clientSecret: sec, env, source: 'meta' };
      }
    } catch {
      /* ignore missing DB */
    }
  }
  const clientId = String(process.env.EBAY_CLIENT_ID || process.env.EBAY_APP_ID || '').trim();
  const clientSecret = String(process.env.EBAY_CLIENT_SECRET || process.env.EBAY_CERT_ID || '').trim();
  if (!clientId || !clientSecret) return null;
  const envRaw = String(process.env.EBAY_ENV || 'production').trim().toLowerCase();
  const env: EbayApiEnv = envRaw === 'sandbox' ? 'sandbox' : 'production';
  return { clientId, clientSecret, env, source: 'env' };
};

const credFingerprint = (c: EbayResolvedCreds): string =>
  `${c.source}:${c.env}:${c.clientId}:${crypto.createHash('sha256').update(c.clientSecret).digest('hex').slice(0, 24)}`;

const basicAuthHeader = (c: EbayResolvedCreds): string =>
  Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64');

export type EbaySoldListing = {
  itemId: string;
  title: string;
  soldAt: number;
  price: number;
  currency: string;
  condition?: string;
  itemUrl?: string;
};

export type EbaySalesSummary = {
  query: string;
  windowDays: number;
  fetchedAt: number;
  count: number;
  low: number | null;
  median: number | null;
  high: number | null;
  mean: number | null;
  p25: number | null;
  p75: number | null;
  pacePerMonth: number;
  pacePerWeek: number;
  source: 'ebay_marketplace_insights';
  currency: string | null;
  listings: EbaySoldListing[];
};

type TokenCache = {
  fingerprint: string;
  token: string;
  expiresAt: number;
};

let tokenCache: TokenCache | null = null;

type SoldSummaryCacheEntry = {
  expiresAt: number;
  summary: EbaySalesSummary;
};

const soldSummaryCache = new Map<string, SoldSummaryCacheEntry>();
const SOLD_CACHE_TTL_MS = 10 * 60 * 1000;

export const resetEbayTokenCacheForTests = (): void => {
  tokenCache = null;
  soldSummaryCache.clear();
};

export const resetEbaySoldSummaryCacheForTests = (): void => {
  soldSummaryCache.clear();
};

const soldCacheKey = (opts: {
  env: EbayApiEnv;
  q: string;
  startIso: string;
  endIso: string;
  limit: number;
  categoryIds?: string[];
}): string =>
  [
    opts.env,
    opts.q,
    opts.startIso,
    opts.endIso,
    String(opts.limit),
    (opts.categoryIds ?? []).join(','),
  ].join('|');

/** Clear cached OAuth token (call after admin updates eBay credentials). */
export const invalidateEbayTokenCache = (): void => {
  tokenCache = null;
};

/**
 * Application-only OAuth (`client_credentials`). Pass `dataDir` to use keys from portfolio_meta first.
 */
export const getEbayAccessToken = async (dataDir?: string): Promise<string> => {
  const creds = resolveEbayAppCredentials(dataDir);
  if (!creds) {
    throw new Error(
      'Missing eBay credentials. Set them in Admin → Configuration (eBay API) or set EBAY_CLIENT_ID and EBAY_CLIENT_SECRET in the environment.'
    );
  }
  const fp = credFingerprint(creds);
  const now = Date.now();
  if (tokenCache && tokenCache.fingerprint === fp && tokenCache.expiresAt - TOKEN_SAFETY_MS > now) {
    return tokenCache.token;
  }
  const base = apiBaseForEnv(creds.env);
  const auth = basicAuthHeader(creds);
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: EBAY_OAUTH_SCOPE,
  });
  const res = await fetch(`${base}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });
  const raw = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !raw.access_token) {
    const detail = raw.error_description || raw.error || `${res.status} ${res.statusText}`;
    throw new Error(`eBay OAuth failed: ${detail}`);
  }
  const expiresInSec = typeof raw.expires_in === 'number' && raw.expires_in > 0 ? raw.expires_in : 7200;
  tokenCache = {
    fingerprint: fp,
    token: raw.access_token,
    expiresAt: now + expiresInSec * 1000,
  };
  return raw.access_token;
};

export type FetchEbaySoldSummaryOpts = {
  windowDays?: number;
  limit?: number;
  categoryIds?: string[];
  startDate?: string;
  endDate?: string;
  /** Portfolio DB directory — enables Admin-stored eBay keys. */
  dataDir?: string;
};

type ItemSalesApiRecord = {
  itemId?: string;
  title?: string;
  condition?: string;
  itemWebUrl?: string;
  soldDate?: string;
  transactionDate?: string;
  dateSold?: string;
  soldPrice?: { value?: string | number; currency?: string };
  transactionPrice?: { value?: string | number; currency?: string };
  price?: { value?: string | number; currency?: string };
};

const mapRecord = (row: ItemSalesApiRecord): EbaySoldListing | null => {
  const itemId = String(row.itemId || '').trim();
  const title = String(row.title || '').trim();
  const soldTsRaw = row.soldDate || row.transactionDate || row.dateSold;
  const soldAt = soldTsRaw ? Date.parse(soldTsRaw) : NaN;
  const priceObj = row.soldPrice || row.transactionPrice || row.price;
  const price = toNumber(priceObj?.value);
  if (!itemId || !title || !Number.isFinite(soldAt) || price == null || price <= 0) return null;
  return {
    itemId,
    title,
    soldAt,
    price,
    currency: String(priceObj?.currency || '').trim() || 'USD',
    condition: row.condition ? String(row.condition).trim() : undefined,
    itemUrl: row.itemWebUrl ? String(row.itemWebUrl).trim() : undefined,
  };
};

export const summarizeSoldListings = (
  query: string,
  listings: EbaySoldListing[],
  windowDays: number,
  fetchedAt: number = Date.now()
): EbaySalesSummary => {
  const sortedByDate = [...listings].sort((a, b) => a.soldAt - b.soldAt);
  const prices = sortedByDate.map((r) => r.price).sort((a, b) => a - b);
  const count = prices.length;
  const pacePerMonth = count > 0 ? (count / windowDays) * 30 : 0;
  const currency = sortedByDate[0]?.currency ?? null;
  return {
    query,
    windowDays,
    fetchedAt,
    count,
    low: count ? prices[0] : null,
    median: quantile(prices, 0.5),
    high: count ? prices[prices.length - 1] : null,
    mean: mean(prices),
    p25: quantile(prices, 0.25),
    p75: quantile(prices, 0.75),
    pacePerMonth,
    pacePerWeek: pacePerMonth / (30 / 7),
    source: 'ebay_marketplace_insights',
    currency,
    listings: sortedByDate,
  };
};

export const fetchEbaySoldSummary = async (
  query: string,
  opts?: FetchEbaySoldSummaryOpts
): Promise<EbaySalesSummary> => {
  const cleaned = query.trim();
  if (!cleaned) throw new Error('q is required');
  const hasExplicitStart = Boolean(String(opts?.startDate || '').trim());
  const windowMin = hasExplicitStart ? 1 : 7;
  const windowDays = Math.max(windowMin, Math.min(365, Math.floor(opts?.windowDays ?? 30)));
  const limit = Math.max(10, Math.min(200, Math.floor(opts?.limit ?? 60)));
  const endMsRaw = opts?.endDate ? Date.parse(opts.endDate) : Date.now();
  const safeEndMs = Number.isFinite(endMsRaw) ? endMsRaw : Date.now();
  const startMsRaw = opts?.startDate ? Date.parse(opts.startDate) : safeEndMs - windowDays * DAY_MS;
  const fallbackStart = safeEndMs - windowDays * DAY_MS;
  const safeStartMs = Number.isFinite(startMsRaw) ? startMsRaw : fallbackStart;
  const rangeStart = Math.min(safeStartMs, safeEndMs);
  const rangeEnd = Math.max(safeStartMs, safeEndMs);
  const cutoffIso = new Date(rangeStart).toISOString();
  const endIso = new Date(rangeEnd).toISOString();
  const effectiveWindowDays = Math.max(1, Math.ceil((rangeEnd - rangeStart) / DAY_MS));
  const dataDir = opts?.dataDir;
  const credsForCache = resolveEbayAppCredentials(dataDir);
  const cacheEnv: EbayApiEnv = credsForCache?.env ?? 'production';
  const cacheKey = soldCacheKey({
    env: cacheEnv,
    q: cleaned,
    startIso: cutoffIso,
    endIso,
    limit,
    categoryIds: opts?.categoryIds,
  });
  const cached = soldSummaryCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.summary;
  }
  const token = await getEbayAccessToken(dataDir);
  const creds = resolveEbayAppCredentials(dataDir);
  const base = creds ? apiBaseForEnv(creds.env) : apiBaseForEnv('production');
  const qs = new URLSearchParams({
    q: cleaned,
    limit: String(limit),
    filter: `soldDate:[${cutoffIso}..${endIso}]`,
  });
  if (opts?.categoryIds?.length) {
    qs.set('category_ids', opts.categoryIds.map((s) => s.trim()).filter(Boolean).join(','));
  }
  const url = `${base}/buy/marketplace_insights/v1_beta/item_sales/search?${qs.toString()}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
    },
  });
  const raw = (await res.json()) as {
    itemSales?: ItemSalesApiRecord[];
    item_sales?: ItemSalesApiRecord[];
    itemSalesRecords?: ItemSalesApiRecord[];
    errors?: Array<{ message?: string; longMessage?: string }>;
  };
  if (!res.ok) {
    const apiErr = raw.errors?.[0]?.longMessage || raw.errors?.[0]?.message;
    const detail = apiErr || `${res.status} ${res.statusText}`;
    if (/insufficient permissions/i.test(detail) || res.status === 403) {
      throw new Error(
        'eBay sold search denied: this app keyset is not enabled for Marketplace Insights sold-data scope yet. Request access in the eBay developer portal or switch to a user-token seller flow.'
      );
    }
    throw new Error(`eBay sold search failed: ${detail}`);
  }
  const rows = raw.itemSales || raw.item_sales || raw.itemSalesRecords || [];
  const mapped = rows.map(mapRecord).filter((r): r is EbaySoldListing => !!r);
  const summary = summarizeSoldListings(cleaned, mapped, effectiveWindowDays);
  soldSummaryCache.set(cacheKey, {
    expiresAt: Date.now() + SOLD_CACHE_TTL_MS,
    summary,
  });
  return summary;
};
