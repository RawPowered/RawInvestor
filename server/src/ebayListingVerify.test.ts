import { describe, expect, it } from 'vitest';
import { scoreListingTitleMatch } from './ebayListingVerify.js';

describe('scoreListingTitleMatch', () => {
  it('accepts matching Pikachu listing', () => {
    const r = scoreListingTitleMatch({
      name: 'Pikachu VMAX',
      set: 'Vivid Voltage',
      cardNumber: '044',
      listingTitle: '2020 Pokemon Vivid Voltage Pikachu VMAX #044 Ultra Rare Holo Near Mint',
    });
    expect(r.ok).toBe(true);
  });

  it('rejects unrelated title', () => {
    const r = scoreListingTitleMatch({
      name: 'Charizard ex',
      set: 'Obsidian Flames',
      cardNumber: '223',
      listingTitle: 'Pokemon TCG Random Bulk Lot — 50 Cards — Energy',
    });
    expect(r.ok).toBe(false);
  });
});
