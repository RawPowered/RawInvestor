import type { Card, EbaySalesSummary } from '../types';
import { patchCardOnServer } from '../serverSync';
import { fetchEbayApiConfigStatus, fetchEbaySoldForCard } from '../services/ebayApiSold';
import { buildEbaySearchQuery, ebaySoldSearchUrlFromCardFields } from './ebaySearchQuery';

export type EbayApiIncrementalLaneResult = {
  satisfied: boolean;
  summary: EbaySalesSummary | null;
  error: string | null;
  apiFirstEnabled: boolean;
};

export type EbayApiIncrementalLaneOpts = {
  watermarkMs: number | null;
  limit: number;
  windowDaysFallback?: number;
};

export const runEbayApiIncrementalLane = async (
  card: Card,
  opts: EbayApiIncrementalLaneOpts
): Promise<EbayApiIncrementalLaneResult> => {
  const status = await fetchEbayApiConfigStatus();
  if (!status.configured || status.ebayApiFirstIncremental === false) {
    return { satisfied: false, summary: null, error: null, apiFirstEnabled: false };
  }

  const fetchOpts: {
    limit: number;
    windowDays?: number;
    startDate?: string;
    endDate?: string;
  } = { limit: opts.limit };

  if (opts.watermarkMs != null && Number.isFinite(opts.watermarkMs)) {
    const start = new Date(opts.watermarkMs - 24 * 60 * 60 * 1000);
    fetchOpts.startDate = start.toISOString();
    fetchOpts.windowDays = 7;
  } else {
    fetchOpts.windowDays = opts.windowDaysFallback ?? 30;
  }

  try {
    const summary = await fetchEbaySoldForCard(card, fetchOpts);
    const now = Date.now();
    await patchCardOnServer(card.id, {
      ebaySales: summary,
      ebayLastApiFetchedAt: now,
    });
    const satisfied = (summary.count ?? 0) > 0;
    return {
      satisfied,
      summary,
      error: null,
      apiFirstEnabled: true,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { satisfied: false, summary: null, error: msg, apiFirstEnabled: true };
  }
};

export const ebaySoldQueryIdentity = (card: Pick<Card, 'name' | 'set' | 'cardNumber'>): string =>
  buildEbaySearchQuery(card).toLowerCase();

export const ebaySoldUrlForCard = (card: Pick<Card, 'name' | 'set' | 'cardNumber'>): string =>
  ebaySoldSearchUrlFromCardFields(card);

export const shouldClearEbaySalesOnQueryChange = (
  card: Pick<Card, 'name' | 'set' | 'cardNumber' | 'ebaySales' | 'ebayExtensionSnapshot'>
): boolean => {
  const prevQ = String(card.ebaySales?.query ?? card.ebayExtensionSnapshot?.query ?? '')
    .trim()
    .toLowerCase();
  const nextQ = ebaySoldQueryIdentity(card);
  return Boolean(prevQ && nextQ && prevQ !== nextQ);
};
