import { describe, expect, it } from 'vitest';
import type { Card } from '../types';
import { hasCompletedFullFetch } from './quickCardFetchState';
import {
  shouldFetchGemRateOnQuickRefresh,
  DEFAULT_QUICK_CARD_ADMIN_SETTINGS,
} from './quickCardAdminSettings';

const baseCard = (over: Partial<Card> = {}): Card =>
  ({
    id: '1',
    name: 'Pikachu',
    set: 'Base',
    raw: 10,
    grade9: 20,
    psa10: 30,
    p10: 0.1,
    p9: 0.2,
    ...over,
  }) as Card;

describe('hasCompletedFullFetch', () => {
  it('returns true when lastFullFetchAt is set', () => {
    expect(hasCompletedFullFetch(baseCard({ lastFullFetchAt: Date.now() }))).toBe(true);
  });

  it('returns true for legacy deep eBay snapshot', () => {
    expect(
      hasCompletedFullFetch(
        baseCard({
          ebayExtensionSnapshot: {
            capturedAt: 1,
            captureMode: 'deep',
            listings: [],
            rowCount: 0,
            hasMore: false,
            query: 'q',
            sourceUrl: 'https://ebay.com',
          },
        })
      )
    ).toBe(true);
  });

  it('returns false for new cards', () => {
    expect(hasCompletedFullFetch(baseCard())).toBe(false);
  });
});

describe('shouldFetchGemRateOnQuickRefresh', () => {
  it('returns false when admin toggle off', () => {
    expect(
      shouldFetchGemRateOnQuickRefresh(DEFAULT_QUICK_CARD_ADMIN_SETTINGS, {})
    ).toBe(false);
  });

  it('returns true every_time when enabled', () => {
    expect(
      shouldFetchGemRateOnQuickRefresh(
        { ...DEFAULT_QUICK_CARD_ADMIN_SETTINGS, gemRateOnQuickRefresh: true, gemRateQuickMode: 'every_time' },
        { lastQuickRefreshAt: Date.now() }
      )
    ).toBe(true);
  });

  it('returns false within interval for every_n_days', () => {
    const now = Date.now();
    expect(
      shouldFetchGemRateOnQuickRefresh(
        {
          ...DEFAULT_QUICK_CARD_ADMIN_SETTINGS,
          gemRateOnQuickRefresh: true,
          gemRateQuickMode: 'every_n_days',
          gemRateQuickIntervalDays: 7,
        },
        { lastQuickRefreshAt: now - 86_400_000 },
        now
      )
    ).toBe(false);
  });

  it('returns true when interval elapsed', () => {
    const now = Date.now();
    expect(
      shouldFetchGemRateOnQuickRefresh(
        {
          ...DEFAULT_QUICK_CARD_ADMIN_SETTINGS,
          gemRateOnQuickRefresh: true,
          gemRateQuickMode: 'every_n_days',
          gemRateQuickIntervalDays: 1,
        },
        { lastQuickRefreshAt: now - 2 * 86_400_000 },
        now
      )
    ).toBe(true);
  });
});
