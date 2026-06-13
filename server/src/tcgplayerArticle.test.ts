import { describe, it, expect } from 'vitest';
import {
  parseTcgplayerArticleHtml,
  assertTcgplayerArticleUrl,
  extractTcgplayerArticleUuid,
} from './tcgplayerArticle.js';

describe('tcgplayerArticle', () => {
  it('parses tables from article HTML', () => {
    const html = `<!DOCTYPE html><html><body><article>
      <h1>Buyer Guide</h1>
      <p>Intro paragraph for excerpt.</p>
      <table><tr><th>Rarity</th><th>Rate</th></tr>
      <tr><td>Ultra Rare</td><td>1:12</td></tr>
      </table>
    </article></body></html>`;
    const out = parseTcgplayerArticleHtml(html);
    expect(out.title).toContain('Buyer Guide');
    expect(out.excerpt.length).toBeGreaterThan(0);
    expect(out.tables.length).toBe(1);
    expect(out.tables[0].headers).toEqual(['Rarity', 'Rate']);
    expect(out.tables[0].rows).toEqual([['Ultra Rare', '1:12']]);
  });

  it('validates tcgplayer article URLs', () => {
    expect(() =>
      assertTcgplayerArticleUrl('https://www.tcgplayer.com/content/article/foo/bar/')
    ).not.toThrow();
    expect(() => assertTcgplayerArticleUrl('https://evil.com/content/article/x')).toThrow();
  });

  it('extracts article UUID from path (slug + querystrings)', () => {
    const u = assertTcgplayerArticleUrl(
      'https://www.tcgplayer.com/content/article/Pok%C3%A9mon-TCG-Perfect-Order-Pull-Rates/73148119-ebcb-40b7-84b6-52b3a6d0c631/?utm_source=x'
    );
    expect(extractTcgplayerArticleUuid(u)).toBe('73148119-ebcb-40b7-84b6-52b3a6d0c631');
  });
});
