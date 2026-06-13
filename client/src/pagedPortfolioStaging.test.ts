import { describe, it, expect, vi } from 'vitest';
import type { SetStateAction } from 'react';
import type { Card } from './types';
import {
  mergeIntoQuickIndex,
  mergeServerPageWithLocalCache,
  registerNewCardsInPagedCache,
  stageCardUpdate,
} from './pagedPortfolioStaging';

const stubCard = (id: string, name: string): Card =>
  ({
    id,
    name,
    set: '',
    url: `https://www.pricecharting.com/game/${id}`,
    raw: 1,
    grade9: 1,
    psa10: 1,
    p10: 0.5,
    p9: 0.5,
    allPrices: [],
    priceHistory: [],
    recentSales: [],
    salesVolume: {},
  }) as Card;

describe('registerNewCardsInPagedCache', () => {
  it('adds cards to cache and dirty set', () => {
    const cache = new Map<string, Card>();
    const dirty = new Set<string>();
    const a = stubCard('a', 'A');
    const b = stubCard('b', 'B');
    registerNewCardsInPagedCache([a, b], cache, dirty);
    expect(cache.size).toBe(2);
    expect(dirty.has('a')).toBe(true);
    expect(dirty.has('b')).toBe(true);
  });
});

describe('mergeIntoQuickIndex', () => {
  it('prepends new cards and caps at 200', () => {
    const prev = Array.from({ length: 50 }, (_, i) => stubCard(`old-${i}`, `Old ${i}`));
    const added = [stubCard('new1', 'N1'), stubCard('new2', 'N2')];
    const out = mergeIntoQuickIndex(prev, added);
    expect(out[0].id).toBe('new1');
    expect(out[1].id).toBe('new2');
    expect(out.length).toBeLessThanOrEqual(200);
  });

  it('dedupes when prev contains same id as added', () => {
    const prev = [stubCard('x', 'Old')];
    const added = [stubCard('x', 'New')];
    const out = mergeIntoQuickIndex(prev, added);
    expect(out.filter((c) => c.id === 'x').length).toBe(1);
    expect(out[0].name).toBe('New');
  });
});

describe('stageCardUpdate', () => {
  it('updates cache, quick index, and page row when server paged', () => {
    const cache = new Map<string, Card>();
    const dirty = new Set<string>();
    const onPage = stubCard('a', 'On page');
    const updated = { ...onPage, name: 'Updated' };
    const setCards = vi.fn((fn: SetStateAction<Card[]>) => {
      const next = typeof fn === 'function' ? fn([onPage]) : fn;
      expect(next[0].name).toBe('Updated');
    });
    const setQuickIndex = vi.fn();
    stageCardUpdate(updated, {
      setCards,
      setQuickIndexCards: setQuickIndex,
      cardCache: cache,
      dirtyIds: dirty,
      serverPaged: true,
    });
    expect(cache.get('a')?.name).toBe('Updated');
    expect(dirty.has('a')).toBe(true);
    expect(setQuickIndex).toHaveBeenCalled();
    expect(setCards).toHaveBeenCalled();
  });

  it('updates cache only when card is off master page', () => {
    const cache = new Map<string, Card>();
    const offPage = stubCard('off', 'Off');
    const setCards = vi.fn((fn: SetStateAction<Card[]>) => {
      const next = typeof fn === 'function' ? fn([stubCard('other', 'Other')]) : fn;
      expect(next).toHaveLength(1);
      expect(next[0].id).toBe('other');
    });
    stageCardUpdate(offPage, {
      setCards,
      cardCache: cache,
      serverPaged: false,
    });
    expect(cache.get('off')?.name).toBe('Off');
    expect(setCards).toHaveBeenCalled();
  });
});

describe('mergeServerPageWithLocalCache', () => {
  it('prefers dirty cached card over server row', () => {
    const cache = new Map<string, Card>();
    const dirty = new Set(['a']);
    const server = stubCard('a', 'Server');
    const local = stubCard('a', 'Local');
    cache.set('a', local);
    const out = mergeServerPageWithLocalCache([server], cache, dirty);
    expect(out[0].name).toBe('Local');
  });
});
