import type { SealedPullSlot } from '../types';
import {
  classifyPokemonProductBucket,
  slotLabelToBucket,
  type PokemonGalleryBucket,
} from './pokemonGalleryBucket';

const medianSorted = (sorted: number[]): number | null => {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

const median = (nums: number[]): number | null => {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  return medianSorted(sorted);
};

/** Group selected catalog rows by PokemonGalleryBucket using classifier. */
export const bucketMedianPrices = (
  items: Array<{
    productId: number;
    marketPrice: number;
    rarityName: string | null;
    productName: string;
  }>,
  selectedIds: Set<number>
): Map<PokemonGalleryBucket, number> => {
  const byBucket = new Map<PokemonGalleryBucket, number[]>();
  for (const it of items) {
    if (!selectedIds.has(it.productId)) continue;
    const b = classifyPokemonProductBucket(it.rarityName, it.productName);
    const arr = byBucket.get(b) ?? [];
    arr.push(it.marketPrice);
    byBucket.set(b, arr);
  }
  const med = new Map<PokemonGalleryBucket, number>();
  for (const [b, xs] of byBucket) {
    const m = median(xs);
    if (m != null) med.set(b, m);
  }
  return med;
};

/** Set gross resale USD from median selected price per bucket matched from slot label. */
export const fillSlotResaleFromGallery = (
  slots: SealedPullSlot[],
  galleryItems: Array<{
    productId: number;
    marketPrice: number;
    rarityName: string | null;
    productName: string;
  }>,
  selectedIds: Set<number>
): SealedPullSlot[] => {
  const medByBucket = bucketMedianPrices(galleryItems, selectedIds);
  return slots.map((slot) => {
    if (slot.excludeFromEv) return slot;
    const b = slotLabelToBucket(slot.label);
    if (b == null) return slot;
    const m = medByBucket.get(b);
    if (m == null) return slot;
    return { ...slot, resaleUsd: Math.round(m * 100) / 100 };
  });
};
