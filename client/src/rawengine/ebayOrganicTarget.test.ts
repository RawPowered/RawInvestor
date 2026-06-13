import { describe, expect, it } from 'vitest';
import { parseEbaySoldTargetUrl } from './ebayOrganicTarget';

describe('parseEbaySoldTargetUrl', () => {
  it('parses sold URL with nkw and sold flags', () => {
    const u =
      'https://www.ebay.com/sch/i.html?_nkw=pikachu+vmax&LH_Sold=1&LH_Complete=1';
    const p = parseEbaySoldTargetUrl(u);
    expect(p).not.toBeNull();
    expect(p!.nkwDecoded).toBe('pikachu vmax');
    expect(p!.lhSold).toBe(true);
    expect(p!.lhComplete).toBe(true);
    expect(p!.graded).toBeNull();
  });

  it('parses Graded facet', () => {
    const u =
      'https://www.ebay.com/sch/i.html?_nkw=Charizard&Graded=No&LH_Sold=1&LH_Complete=1';
    const p = parseEbaySoldTargetUrl(u);
    expect(p!.graded).toBe('No');
    expect(p!.nkwDecoded).toBe('Charizard');
  });

  it('returns null for non-eBay', () => {
    expect(parseEbaySoldTargetUrl('https://example.com/sch/i.html?_nkw=x')).toBeNull();
  });

  it('returns null without _nkw', () => {
    expect(parseEbaySoldTargetUrl('https://www.ebay.com/')).toBeNull();
  });
});
