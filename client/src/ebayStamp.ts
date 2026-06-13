import { startOfUtcDay } from './releaseFilter';
import type { EbayExtensionListing, EbayExtensionSnapshot, EbayFilteredListing } from './types';

const normalizeForPokemonCenterTitle = (title: string): string =>
  String(title || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * eBay: Pokémon Center variant (stamped product, same # as non-PC) —
 * "Pokemon Center", "POKEMON CENTER", "Pokémon Center", "Pokemon Center Stamped", etc.
 */
export const parsePokemonCenterStampFromTitle = (title: string): boolean => {
  const t = normalizeForPokemonCenterTitle(title);
  if (/\bpokemon center stamped\b/.test(t)) return true;
  if (/\bpokemon center stamp\b/.test(t)) return true;
  if (/\bpokemon center\b/.test(t)) return true;
  return false;
};

export const effectivePokemonCenterStamp = (r: {
  title: string;
  pokemonCenterStamp?: boolean;
}): boolean => {
  if (r.pokemonCenterStamp === true) return true;
  if (r.pokemonCenterStamp === false) return false;
  return parsePokemonCenterStampFromTitle(r.title);
};

/** Title says sealed plastic sleeve; word boundary avoids matching inside unrelated tokens. */
export const parseSealedInTitle = (title: string): boolean => {
  const t = normalizeForPokemonCenterTitle(title);
  return /\bsealed\b/.test(t);
};

export const effectiveSealedInTitle = (r: {
  title: string;
  sealedInTitle?: boolean;
}): boolean => {
  if (r.sealedInTitle === true) return true;
  if (r.sealedInTitle === false) return false;
  return parseSealedInTitle(r.title);
};

/** Stable id for a captured eBay row (item id, or day|price|title). */
export const ebayListingSaleKey = (r: Pick<EbayExtensionListing, 'itemId' | 'soldAt' | 'price' | 'title'>): string =>
  r.itemId && r.itemId.trim()
    ? `itm:${r.itemId.trim()}`
    : `${startOfUtcDay(r.soldAt)}|${r.price.toFixed(4)}|${r.title.trim().toLowerCase()}`;

/** eBay only — Poké Center stamp vs standard same-number listings. */
export type EbayTitleStampFilter = 'all' | 'stamp' | 'no_stamp';
/** eBay — title says sealed (plastic sleeve). */
export type EbayTitleSealedFilter = 'all' | 'sealed' | 'not_sealed';

/** Minimal row shape for stamp/sealed title heuristics (listings, quick KPI rows, etc.). */
export type EbayTitleFilterRow = {
  title: string;
  pokemonCenterStamp?: boolean;
  sealedInTitle?: boolean;
};

export const matchesEbayTitleStampFilter = (r: EbayTitleFilterRow, f: EbayTitleStampFilter): boolean => {
  if (f === 'all') return true;
  const stamped = effectivePokemonCenterStamp(r);
  if (f === 'stamp') return stamped;
  return !stamped;
};

export const matchesEbayTitleSealedFilter = (r: EbayTitleFilterRow, f: EbayTitleSealedFilter): boolean => {
  if (f === 'all') return true;
  const sealed = effectiveSealedInTitle(r);
  if (f === 'sealed') return sealed;
  return !sealed;
};

export const matchesEbayTitleTagFilters = (
  r: EbayTitleFilterRow,
  stamp: EbayTitleStampFilter,
  sealed: EbayTitleSealedFilter
): boolean => matchesEbayTitleStampFilter(r, stamp) && matchesEbayTitleSealedFilter(r, sealed);

export const mapEbayExtensionSnapshotTagBulk = (
  snap: EbayExtensionSnapshot,
  patch: { pokemonCenterStamp?: boolean; sealedInTitle?: boolean }
): EbayExtensionSnapshot => {
  const mapRow = (r: EbayExtensionListing): EbayExtensionListing => {
    const next: EbayExtensionListing = { ...r };
    if (patch.pokemonCenterStamp !== undefined) next.pokemonCenterStamp = patch.pokemonCenterStamp;
    if (patch.sealedInTitle !== undefined) next.sealedInTitle = patch.sealedInTitle;
    return next;
  };
  return {
    ...snap,
    listings: (snap.listings ?? []).map(mapRow),
    rejectedListings: (snap.rejectedListings ?? []).map((r: EbayFilteredListing) => ({
      ...mapRow(r),
      filterReason: r.filterReason,
    })),
  };
};
