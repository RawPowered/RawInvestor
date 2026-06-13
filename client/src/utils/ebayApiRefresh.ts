import type { Card, EbaySalesSummary } from '../types';
import { patchCardOnServer } from '../serverSync';
import {
  fetchEbayApiConfigStatus,
  fetchEbaySoldBatch,
  fetchEbaySoldForCard,
} from '../services/ebayApiSold';
import { buildEbaySearchQuery } from './ebaySearchQuery';
import { shouldClearEbaySalesOnQueryChange } from './ebayApiIncrementalLane';

export type EbayApiRefreshResult = {
  apiSummary: EbaySalesSummary | null;
  apiError: string | null;
  apiRowCount: number;
};

export const refreshEbaySalesViaApi = async (
  card: Card,
  opts?: { windowDays?: number; limit?: number }
): Promise<EbayApiRefreshResult> => {
  const status = await fetchEbayApiConfigStatus();
  if (!status.configured) {
    return { apiSummary: null, apiError: null, apiRowCount: 0 };
  }
  try {
    const summary = await fetchEbaySoldForCard(card, {
      windowDays: opts?.windowDays ?? 30,
      limit: opts?.limit ?? 60,
    });
    const clearSales = shouldClearEbaySalesOnQueryChange(card);
    await patchCardOnServer(card.id, {
      ebaySales: summary,
      ebayLastApiFetchedAt: Date.now(),
      ...(clearSales ? {} : {}),
    });
    return { apiSummary: summary, apiError: null, apiRowCount: summary.count ?? 0 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { apiSummary: null, apiError: msg, apiRowCount: 0 };
  }
};

export const refreshEbaySalesBatchViaApi = async (
  cards: Card[],
  opts?: { windowDays?: number; limit?: number; concurrency?: number }
): Promise<Map<string, EbayApiRefreshResult>> => {
  const out = new Map<string, EbayApiRefreshResult>();
  const status = await fetchEbayApiConfigStatus();
  if (!status.configured) return out;

  const queries = cards
    .map((c) => ({
      cardId: c.id,
      q: buildEbaySearchQuery(c),
      windowDays: opts?.windowDays ?? 30,
      limit: opts?.limit ?? 60,
    }))
    .filter((q) => q.q);

  if (!queries.length) return out;

  try {
    const batch = await fetchEbaySoldBatch(queries, opts?.concurrency ?? 3);
    for (const r of batch.results) {
      if (r.ok) {
        const card = cards.find((c) => c.id === r.cardId);
        if (card) {
          await patchCardOnServer(card.id, {
            ebaySales: r.data,
            ebayLastApiFetchedAt: Date.now(),
          });
        }
        out.set(r.cardId, {
          apiSummary: r.data,
          apiError: null,
          apiRowCount: r.data.count ?? 0,
        });
      } else {
        out.set(r.cardId, {
          apiSummary: null,
          apiError: r.error,
          apiRowCount: 0,
        });
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    for (const c of cards) {
      out.set(c.id, { apiSummary: null, apiError: msg, apiRowCount: 0 });
    }
  }
  return out;
};
