import type { Card } from '../../../types';
import type { PortfolioBatchCardJob } from '../types';

export type PortfolioEbayBatchWorker = (card: Card) => Promise<{ ok: boolean; message?: string }>;

/**
 * Run eBay capture jobs for multiple cards with a bounded pool (never two workers on same cardId).
 */
export async function runPortfolioEbayBatch(
  cards: Card[],
  worker: PortfolioEbayBatchWorker,
  opts: {
    maxConcurrent: number;
    signal?: AbortSignal;
    onJobsUpdate?: (jobs: PortfolioBatchCardJob[]) => void;
  }
): Promise<PortfolioBatchCardJob[]> {
  const max = Math.max(1, Math.min(4, Math.floor(opts.maxConcurrent)));
  const jobs: PortfolioBatchCardJob[] = cards.map((c) => ({
    cardId: c.id,
    cardName: c.name || c.id,
    status: 'pending',
  }));
  const notify = () => opts.onJobsUpdate?.([...jobs]);

  const runOne = async (index: number) => {
    const card = cards[index];
    const job = jobs[index]!;
    if (opts.signal?.aborted) {
      job.status = 'error';
      job.message = 'cancelled';
      notify();
      return;
    }
    job.status = 'running';
    notify();
    try {
      const res = await worker(card);
      job.status = res.ok ? 'done' : 'error';
      job.message = res.message;
    } catch (err) {
      job.status = 'error';
      job.message = err instanceof Error ? err.message : String(err);
    }
    notify();
  };

  let nextIndex = 0;
  const pool: Promise<void>[] = [];

  const pump = async (): Promise<void> => {
    while (nextIndex < cards.length) {
      if (opts.signal?.aborted) return;
      const i = nextIndex++;
      await runOne(i);
    }
  };

  for (let w = 0; w < Math.min(max, cards.length); w += 1) {
    pool.push(pump());
  }
  await Promise.all(pool);
  return jobs;
}
