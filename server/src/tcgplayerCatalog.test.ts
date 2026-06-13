import { describe, it, expect } from 'vitest';
import {
  assertTcgplayerCatalogBrowseUrl,
  extractTcgplayerProductIdsFromHtml,
} from './tcgplayerCatalog.js';

describe('tcgplayerCatalog', () => {
  it('extracts unique product ids from html', () => {
    const html = `
      <a href="https://www.tcgplayer.com/product/100/foo">A</a>
      <a href="http://tcgplayer.com/product/200/bar">B</a>
      <a href="https://www.tcgplayer.com/product/100/dup">dup</a>
    `;
    expect(extractTcgplayerProductIdsFromHtml(html)).toEqual([100, 200]);
  });

  it('extracts product ids from relative /product/{id} hrefs', () => {
    const html = `
      <a href="/product/555/card-name">Rel</a>
      <a href='https://www.tcgplayer.com/product/556/other'>Abs</a>
    `;
    expect(extractTcgplayerProductIdsFromHtml(html)).toEqual([555, 556]);
  });

  it('rejects content article urls for catalog browse', () => {
    expect(() =>
      assertTcgplayerCatalogBrowseUrl('https://www.tcgplayer.com/content/article/x/y/')
    ).toThrow(/article/);
  });

  it('accepts catalog-style tcgplayer url', () => {
    const u = assertTcgplayerCatalogBrowseUrl('https://www.tcgplayer.com/categories/pokemon/scarlet-violet');
    expect(u.hostname).toContain('tcgplayer');
  });
});
