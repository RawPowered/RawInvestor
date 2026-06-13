import { describe, it, expect } from 'vitest';
import { brandLogoSrc, BRAND_LOGOS } from './brandLogos';

describe('brandLogoSrc', () => {
  it('returns public paths under /branding/', () => {
    expect(brandLogoSrc('psa')).toBe('/branding/psa.png');
    expect(BRAND_LOGOS.tcgplayer).toBe('/branding/tcgplayer.png');
    expect(BRAND_LOGOS.gemrate).toBe('/branding/gemrate.png');
  });
});
