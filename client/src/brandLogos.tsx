import { useState } from 'react';

/**
 * Static brand marks under `client/public/branding/`. Swap PNGs there to update art.
 * Personal / local use only — trademarks remain with each rights holder.
 */
export const BRAND_LOGOS = {
  psa: '/branding/psa.png',
  beckett: '/branding/beckett.png',
  cgc: '/branding/cgc.png',
  tag: '/branding/tag.png',
  tcgplayer: '/branding/tcgplayer.png',
  ebay: '/branding/ebay.png',
  whatnot: '/branding/whatnot.png',
  cashapp: '/branding/cashapp.png',
  pricecharting: '/branding/pricecharting.png',
  pokemon: '/branding/pokemon.png',
  pokeball: '/branding/pokeball.png',
  gemrate: '/branding/gemrate.png',
} as const;

export type BrandLogoKey = keyof typeof BRAND_LOGOS;

const withBase = (p: string): string => {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');
  const rel = String(p || '').replace(/^\/+/, '');
  return `${base}/${rel}`.replace(/\/{2,}/g, '/');
};

export const brandLogoSrc = (key: BrandLogoKey): string => withBase(BRAND_LOGOS[key]);

/** Raster logo; on missing file shows nothing (after onError). */
export const BrandLogoImg = ({
  brand,
  className = '',
  title,
}: {
  brand: BrandLogoKey;
  className?: string;
  title?: string;
}) => {
  const [broken, setBroken] = useState(false);
  if (broken) return null;
  return (
    <img
      src={brandLogoSrc(brand)}
      alt=""
      role="presentation"
      title={title}
      className={className}
      loading="lazy"
      decoding="async"
      onError={() => setBroken(true)}
    />
  );
};

/** Official grading company homepages (quick reference from expanded card). */
export const GRADER_LINKS: { brand: BrandLogoKey; href: string; label: string }[] = [
  { brand: 'beckett', href: 'https://www.beckett.com/grading', label: 'Beckett Grading' },
  { brand: 'cgc', href: 'https://www.cgccards.com/', label: 'CGC Cards' },
  { brand: 'tag', href: 'https://www.taggrading.com/', label: 'TAG Grading' },
];
