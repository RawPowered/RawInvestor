import { describe, it, expect } from 'vitest';
import {
  classifyPokemonProductBucket,
  slotLabelToBucket,
  galleryItemVisible,
  defaultSealedGalleryToggles,
} from './pokemonGalleryBucket';

describe('pokemonGalleryBucket', () => {
  it('classifies SIR', () => {
    expect(classifyPokemonProductBucket('Special Illustration Rare', 'X')).toBe('sir');
  });

  it('classifies illustration rare', () => {
    expect(classifyPokemonProductBucket('Illustration Rare', 'Y')).toBe('ir');
  });

  it('slotLabel maps ultra rare label', () => {
    expect(slotLabelToBucket('Ultra Rare · Something')).toBe('otherHigh');
  });

  it('gallery visibility respects toggles', () => {
    const t = defaultSealedGalleryToggles();
    expect(galleryItemVisible('common', { ...t, showCommons: false })).toBe(false);
    expect(galleryItemVisible('sir', t)).toBe(true);
  });
});
