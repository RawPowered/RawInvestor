import type { Dispatch, SetStateAction } from 'react';
import type { Card } from './types';

/** Register new cards for SQLite-primary (paged) incremental sync: cache + dirty set. */
export function registerNewCardsInPagedCache(
  newCards: Card[],
  cardCache: Map<string, Card>,
  dirtyIds: Set<string>
): void {
  for (const c of newCards) {
    cardCache.set(c.id, c);
    dirtyIds.add(c.id);
  }
}

/** Prepend imported/added cards to the quick picker slice; cap 200; dedupe by id. */
export function mergeIntoQuickIndex(prev: Card[] | null, added: Card[]): Card[] {
  const addedIds = new Set(added.map((c) => c.id));
  const tail = (prev ?? []).filter((c) => !addedIds.has(c.id));
  return [...added, ...tail].slice(0, 200);
}

export type StageCardUpdateCtx = {
  setCards: Dispatch<SetStateAction<Card[]>>;
  setQuickIndexCards?: Dispatch<SetStateAction<Card[] | null>>;
  cardCache: Map<string, Card>;
  dirtyIds?: Set<string>;
  serverPaged: boolean;
};

/** Keep cache, quick index, and current master page in sync after fetch/edit/refresh. */
export function stageCardUpdate(card: Card, ctx: StageCardUpdateCtx): void {
  ctx.cardCache.set(card.id, card);
  if (ctx.serverPaged && ctx.dirtyIds) {
    ctx.dirtyIds.add(card.id);
  }
  if (ctx.serverPaged && ctx.setQuickIndexCards) {
    ctx.setQuickIndexCards((prev) => mergeIntoQuickIndex(prev, [card]));
  }
  ctx.setCards((prev) => {
    const idx = prev.findIndex((c) => c.id === card.id);
    if (idx < 0) return prev;
    const next = [...prev];
    next[idx] = card;
    return next;
  });
}

/** Prefer locally dirty cached cards when applying a server page refresh. */
export function mergeServerPageWithLocalCache(
  items: Card[],
  cardCache: Map<string, Card>,
  dirtyIds: Set<string>
): Card[] {
  return items.map((c) => {
    if (!dirtyIds.has(c.id)) return c;
    const cached = cardCache.get(c.id);
    return cached ?? c;
  });
}
