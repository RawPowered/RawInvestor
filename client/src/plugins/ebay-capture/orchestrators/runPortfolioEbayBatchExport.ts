import type { Card } from '../../../types';
import { runPortfolioEbayBatch } from './runPortfolioEbayBatch';
import type { PortfolioBatchCardJob } from '../types';
import { loadEbayCapturePluginSettings } from '../hooks/useEbayCapturePluginSettings';

export type PortfolioEbayBatchRunner = (card: Card) => Promise<{ ok: boolean; message?: string }>;

/** Portfolio-wide eBay Quick Fetch batch (one worker per card, bounded pool). */
export async function runPortfolioEbayBatchForCards(
  cards: Card[],
  worker: PortfolioEbayBatchRunner,
  opts?: {
    signal?: AbortSignal;
    onJobsUpdate?: (jobs: PortfolioBatchCardJob[]) => void;
    maxConcurrent?: number;
  }
): Promise<PortfolioBatchCardJob[]> {
  const plugin = loadEbayCapturePluginSettings();
  const maxConcurrent = opts?.maxConcurrent ?? plugin.maxConcurrentCards;
  return runPortfolioEbayBatch(cards, worker, {
    maxConcurrent,
    signal: opts?.signal,
    onJobsUpdate: opts?.onJobsUpdate,
  });
}
