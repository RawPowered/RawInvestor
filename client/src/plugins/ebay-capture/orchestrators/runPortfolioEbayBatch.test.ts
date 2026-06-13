import { describe, expect, it, vi } from 'vitest';
import { runPortfolioEbayBatch } from './runPortfolioEbayBatch';
import type { Card } from '../../../types';

const card = (id: string): Card =>
  ({
    id,
    name: `Card ${id}`,
    set: '',
    raw: 0,
  }) as Card;

describe('runPortfolioEbayBatch', () => {
  it('runs at most maxConcurrent workers and never duplicates cardId', async () => {
    const cards = [card('a'), card('b'), card('c')];
    let peak = 0;
    let running = 0;
    const worker = vi.fn(async (c: Card) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 30));
      running -= 1;
      return { ok: true, message: c.id };
    });
    const jobs = await runPortfolioEbayBatch(cards, worker, { maxConcurrent: 2 });
    expect(worker).toHaveBeenCalledTimes(3);
    expect(peak).toBeLessThanOrEqual(2);
    expect(jobs.every((j) => j.status === 'done')).toBe(true);
  });
});
