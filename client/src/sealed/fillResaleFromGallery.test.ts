import { describe, it, expect } from 'vitest';
import { fillSlotResaleFromGallery } from './fillResaleFromGallery';
import type { SealedPullSlot } from '../types';

describe('fillSlotResaleFromGallery', () => {
  it('fills resale from median price in matched bucket', () => {
    const slots: SealedPullSlot[] = [
      {
        slotId: 's',
        tableIndex: 0,
        rowIndex: 0,
        label: 'Special Illustration Rare Card',
        probability: 0.1,
        resaleUsd: null,
      },
    ];
    const items = [
      {
        productId: 1,
        marketPrice: 10,
        rarityName: 'Special Illustration Rare',
        productName: 'Foo',
      },
      {
        productId: 2,
        marketPrice: 20,
        rarityName: 'Special Illustration Rare',
        productName: 'Bar',
      },
    ];
    const next = fillSlotResaleFromGallery(slots, items, new Set([1, 2]));
    expect(next[0]?.resaleUsd).toBe(15);
  });
});
