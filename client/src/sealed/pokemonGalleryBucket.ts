/**
 * Coarse buckets for TCGPlayer Pokémon products + buyer-guide slot labels (EV fill-heuristics).
 */
import type { SealedSetGalleryToggles } from '../types';

export type PokemonGalleryBucket =
  | 'common'
  | 'sir'
  | 'ir'
  | 'fullArt'
  | 'ex'
  | 'otherHigh';

const norm = (s: string) => s.toLowerCase();

/** Classify catalog row for gallery visibility toggles. */
export const classifyPokemonProductBucket = (
  rarityName: string | null | undefined,
  productName: string | undefined
): PokemonGalleryBucket => {
  const r = norm(String(rarityName ?? ''));
  const n = norm(String(productName ?? ''));

  if (/special\s+illustration/i.test(r) || /special\s+illustration/i.test(n)) return 'sir';
  if (/illustration\s+rare/i.test(r) && !/special/i.test(r)) return 'ir';
  if (/\bfull\s*art\b/i.test(r) || /\bfull\s*art\b/i.test(n)) return 'fullArt';
  if (/\bdouble\s*rare\b/i.test(r)) return 'ex';
  if (/\bpokémon\s+ex\b|\bpokemon\s+ex\b|\bmega\s+\w+\s+ex\b/i.test(n)) return 'ex';
  if (/\bultra\s*rare\b/i.test(r) && !/illustration/i.test(r)) return 'otherHigh';
  if (/hyper\s*rare|amazing\s+rare|secret\s+rare|illustration\s+rare/i.test(r)) {
    if (/special/i.test(r)) return 'sir';
    if (/illustration/i.test(r)) return 'ir';
  }
  if (/rainbow|gold\s+rare|shiny/i.test(r + n)) return 'otherHigh';
  if (/^common$|^uncommon$/i.test(r.trim()) || /\bcommon\b|\buncommon\b/i.test(r)) return 'common';
  if (/rare|holo/i.test(r) && !/ultra|double|illustration|hyper/i.test(r)) return 'otherHigh';
  return 'common';
};

export const defaultSealedGalleryToggles = (): SealedSetGalleryToggles => ({
  showCommons: false,
  includeSir: true,
  includeIr: true,
  includeFullArt: true,
  includeEx: true,
  includeOtherPremium: false,
});

export const galleryItemVisible = (
  bucket: PokemonGalleryBucket,
  toggles: SealedSetGalleryToggles
): boolean => {
  if (bucket === 'common') return toggles.showCommons;
  if (bucket === 'sir') return toggles.includeSir;
  if (bucket === 'ir') return toggles.includeIr;
  if (bucket === 'fullArt') return toggles.includeFullArt;
  if (bucket === 'ex') return toggles.includeEx;
  return toggles.includeOtherPremium;
};

/** Map buyer-guide slot label to bucket for median resale fill. */
export const slotLabelToBucket = (label: string): PokemonGalleryBucket | null => {
  const s = norm(label);
  if (/special\s+illustration|sir\b/i.test(s)) return 'sir';
  if (/illustration\s+rare/i.test(s) && !/special/i.test(s)) return 'ir';
  if (/full\s*art|trainer\s*full/i.test(s)) return 'fullArt';
  if (/mega\s+hyper|hyper\s+rare|special\s+illustration/i.test(s)) return 'sir';
  if (/double\s*rare|pokémon\s+ex|pokemon\s+ex|\bex\s+card/i.test(s)) return 'ex';
  if (/ultra\s*rare|double\s*rare|super\s+rare/i.test(s)) return 'otherHigh';
  if (/common|uncommon|energy|bulk|non[\s-]?holo/i.test(s)) return 'common';
  return null;
};
