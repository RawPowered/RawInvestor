import { describe, it, expect } from 'vitest';
import {
  extractPcProductIds,
  extractReleaseDateMs,
  extractTcgplayerUrl,
  parseCardHtml,
  parsePrice,
  parseSaleDate,
  slugFromUrl,
} from './scraper.js';
import * as cheerio from 'cheerio';

const cardPageHtml = ({
  name = 'Pikachu ex',
  number = '238',
  set = 'Pokemon Surging Sparks',
  prices = {
    ungraded: '$50.00',
    grade9: '$305.00',
    grade95: '$600.00',
    psa10: '$1,100.00',
  },
  imageUrl = 'https://images.pricecharting.com/abc/123.jpg',
  releaseRow,
  genreRow,
  catalogProductId = '11005500',
}: {
  name?: string;
  number?: string;
  set?: string;
  prices?: { ungraded: string; grade9: string; grade95: string; psa10: string };
  imageUrl?: string;
  /** When set, adds a Card Details-style row with this date string */
  releaseRow?: string;
  /** When set, adds Genre row (e.g. Sealed Product). */
  genreRow?: string;
  /** Appears as data-product-id under #product_details (mirrors live PC markup). */
  catalogProductId?: string;
} = {}): string => `<!doctype html>
<html><head>
<meta property="og:image" content="${imageUrl}" />
</head><body>
<h1 id="product_name">${name} <a href="/category/pokemon">${set}</a> #${number}</h1>
${genreRow != null ? `<table id="genre"><tr><th>Genre</th><td>${genreRow}</td></tr></table>` : ''}
${releaseRow != null ? `<table id="details"><tr><td>Release Date</td><td>${releaseRow}</td></tr></table>` : ''}
<div id="product_details"><a href="#" class="js-add-one-click" data-product-id="${catalogProductId}">cart</a></div>
<table id="price_data">
  <tr>
    <th>Ungraded</th>
    <th>Grade 9</th>
    <th>Grade 9.5</th>
    <th>PSA 10</th>
  </tr>
  <tr>
    <td id="used_price"><span class="price js-price">${prices.ungraded}</span></td>
    <td id="complete_price"><span class="price js-price">${prices.grade9}</span></td>
    <td id="new_price"><span class="price js-price">${prices.grade95}</span></td>
    <td id="manual_only_price"><span class="price js-price">${prices.psa10}</span></td>
  </tr>
</table>
<img id="product_image" src="${imageUrl}" />
</body></html>`;

describe('parseSaleDate', () => {
  it('uses local noon for calendar dates without a time (not midnight)', () => {
    const ms = parseSaleDate('May 8, 2025');
    expect(ms).not.toBeNull();
    const d = new Date(ms!);
    expect(d.getHours()).toBe(12);
    expect(d.getMinutes()).toBe(0);
  });

  it('parses ISO date-only as local noon on that calendar day', () => {
    const ms = parseSaleDate('2025-03-14');
    expect(ms).not.toBeNull();
    const d = new Date(ms!);
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(2);
    expect(d.getDate()).toBe(14);
    expect(d.getHours()).toBe(12);
  });

  it('preserves timestamps when the cell includes a clock time', () => {
    const ms = parseSaleDate('May 8, 2025 3:30 PM');
    expect(ms).not.toBeNull();
    const d = new Date(ms!);
    expect(d.getHours()).toBe(15);
    expect(d.getMinutes()).toBe(30);
  });
});

describe('parsePrice', () => {
  it('parses plain dollar amounts', () => {
    expect(parsePrice('$19.27')).toBe(19.27);
  });
  it('parses amounts with thousands separators', () => {
    expect(parsePrice('$1,250.00')).toBe(1250);
  });
  it('returns NaN for garbage', () => {
    expect(parsePrice('n/a')).toBeNaN();
    expect(parsePrice('')).toBeNaN();
  });
  it('tolerates whitespace and missing $', () => {
    expect(parsePrice('  324.50 ')).toBe(324.5);
  });
});

describe('slugFromUrl', () => {
  it('turns a pricecharting URL into a safe slug', () => {
    const s = slugFromUrl(
      'https://www.pricecharting.com/game/pokemon-surging-sparks/pikachu-ex-238'
    );
    expect(s).toBe('game_pokemon-surging-sparks_pikachu-ex-238');
  });
  it('falls back to "card" for invalid URLs', () => {
    expect(slugFromUrl('not a url')).toBe('card');
  });
});

describe('parseCardHtml', () => {
  const url = 'https://www.pricecharting.com/game/pokemon-surging-sparks/pikachu-ex-238';

  it('maps columns to the correct price fields (PSA 10 is NOT #new_price)', () => {
    const data = parseCardHtml(cardPageHtml(), url);
    expect(data.raw).toBe(50);
    expect(data.grade9).toBe(305);
    expect(data.psa10).toBe(1100);
    expect(data.pcProductIds).toEqual(['11005500']);
  });

  it('extractPcProductIds prefers #product_details scope', () => {
    const html = `<body><div id="product_details"><i data-product-id="1"></i></div><footer data-product-id="2"></footer></body>`;
    expect(extractPcProductIds(cheerio.load(html))).toEqual(['1']);
  });

  it('parses Release Date into releaseDateMs', () => {
    const data = parseCardHtml(cardPageHtml({ releaseRow: 'March 14, 2025' }), url);
    expect(data.releaseDateMs).not.toBeNull();
    expect(typeof data.releaseDateMs).toBe('number');
    expect(new Date(data.releaseDateMs!).getUTCFullYear()).toBeGreaterThanOrEqual(
      2025
    );
  });

  it('sets suggestedPortfolioKind sealed when Genre is Sealed Product', () => {
    const data = parseCardHtml(cardPageHtml({ genreRow: 'Sealed Product' }), url);
    expect(data.suggestedPortfolioKind).toBe('sealed');
  });

  it('extracts TCGPlayer URL from a details row', () => {
    const html = `<!doctype html><body><table>
      <tr><td>TCGPlayer ID:</td><td>575687</td></tr>
    </table></body>`;
    const tcg = extractTcgplayerUrl(cheerio.load(html));
    expect(tcg).toBe('https://www.tcgplayer.com/product/575687');
  });

  it('includes tcgplayerUrl in parseCardHtml output', () => {
    const html = `${cardPageHtml()}<table><tr><td>TCGPlayer ID:</td><td>575687</td></tr></table>`;
    const data = parseCardHtml(html, url);
    expect(data.tcgplayerUrl).toBe('https://www.tcgplayer.com/product/575687');
  });

  it('extracts tcgplayerUrl from partner links with encoded URL param', () => {
    const html = `<!doctype html><body>
      <a href="https://partner.tcgplayer.com/c/3029031/1780961/21018?u=https%3A%2F%2Fwww.tcgplayer.com%2Fproduct%2F662128%2F-">See It</a>
    </body>`;
    const tcg = extractTcgplayerUrl(cheerio.load(html));
    expect(tcg).toBe('https://www.tcgplayer.com/product/662128');
  });

  it('extracts tcgplayerUrl from direct tcgplayer product links', () => {
    const html = `<!doctype html><body>
      <a href="https://www.tcgplayer.com/product/662128/pokemon-phantasmal-flames-ambipom-107">TCGPlayer</a>
    </body>`;
    const tcg = extractTcgplayerUrl(cheerio.load(html));
    expect(tcg).toBe('https://www.tcgplayer.com/product/662128');
  });

  it('extractReleaseDateMs reads dt/dd pairs', () => {
    const html = `<!doctype html><body><dl>
      <dt>Release Date</dt><dd>April 18, 2026</dd>
    </dl></body></html>`;
    const ms = extractReleaseDateMs(cheerio.load(html));
    expect(ms).not.toBeNull();
  });

  it('parses Release Date when the label is th and value is td', () => {
    const html = `<!doctype html><body><table>
      <tr><th>Release Date</th><td>March 14, 2025</td></tr>
    </table></body></html>`;
    const ms = extractReleaseDateMs(cheerio.load(html));
    expect(ms).not.toBeNull();
    expect(new Date(ms!).getFullYear()).toBe(2025);
  });

  it('extracts card name and set', () => {
    const data = parseCardHtml(cardPageHtml(), url);
    expect(data.name).toMatch(/Pikachu ex/i);
    expect(data.set).toMatch(/Surging Sparks/i);
  });

  it('extracts card number from the "#N" suffix in the title', () => {
    const data = parseCardHtml(cardPageHtml({ number: '238' }), url);
    expect(data.cardNumber).toBe('238');
  });

  it('falls back to the URL slug when the title has no #N', () => {
    const html = `<html><body><h1 id="product_name">Meowth</h1></body></html>`;
    const data = parseCardHtml(html, 'https://www.pricecharting.com/game/pokemon-phantasmal-flames/meowth-106');
    expect(data.cardNumber).toBe('106');
  });

  it('captures og:image as imageUrl', () => {
    const data = parseCardHtml(cardPageHtml(), url);
    expect(data.imageUrl).toBe('https://images.pricecharting.com/abc/123.jpg');
  });

  it('returns 0 for prices that are absent rather than throwing', () => {
    const html = `<html><body><h1 id="product_name">Test</h1></body></html>`;
    const data = parseCardHtml(html, url);
    expect(data.raw).toBe(0);
    expect(data.grade9).toBe(0);
    expect(data.psa10).toBe(0);
    expect(data.imageUrl).toBeNull();
  });

  it('handles protocol-relative image URLs', () => {
    const html = cardPageHtml({ imageUrl: '//images.pricecharting.com/x.jpg' });
    const data = parseCardHtml(html, url);
    expect(data.imageUrl).toBe('https://images.pricecharting.com/x.jpg');
  });

  it('captures the full price matrix from #full-prices in source order', () => {
    const html = `
      <html><body>
      <h1 id="product_name">Meowth <a>Pokemon Phantasmal Flames</a> #106</h1>
      <div id="full-prices">
        <table>
          <tr><td>Ungraded</td><td class="price js-price">$19.27</td></tr>
          <tr><td>Grade 1</td><td class="price js-price">-</td></tr>
          <tr><td>Grade 8</td><td class="price js-price">$22.50</td></tr>
          <tr><td>Grade 9</td><td class="price js-price">$34.54</td></tr>
          <tr><td>Grade 9.5</td><td class="price js-price">$55.00</td></tr>
          <tr><td>PSA 10</td><td class="price js-price">$192.56</td></tr>
          <tr><td>BGS 10 Black</td><td class="price js-price">$1,538.00</td></tr>
        </table>
      </div>
      </body></html>`;
    const data = parseCardHtml(html, 'https://www.pricecharting.com/x');

    const keys = data.allPrices.map((p) => p.key);
    expect(keys).toEqual([
      'ungraded',
      'grade_8',
      'grade_9',
      'grade_9_5',
      'psa_10',
      'bgs_10_black',
    ]);
    const bgs = data.allPrices.find((p) => p.key === 'bgs_10_black');
    expect(bgs?.price).toBe(1538);
    expect(bgs?.label).toBe('BGS 10 Black');
    // Dashed-out (unsold) grades are dropped entirely.
    expect(keys).not.toContain('grade_1');
  });

  it('returns an empty recentSales array when no sales table is present', () => {
    const data = parseCardHtml(cardPageHtml(), url);
    expect(data.recentSales).toEqual([]);
  });

  it('scrapes a recent-sales table into normalized snapshots', () => {
    const html = `
      <html><body>
      <h1 id="product_name">Meowth <a>Pokemon Phantasmal Flames</a> #106</h1>
      <table>
        <thead><tr><th>Date</th><th>Grade</th><th>Price</th></tr></thead>
        <tbody>
          <tr><td>2026-01-10</td><td>PSA 10</td><td>$180.00</td></tr>
          <tr><td>2026-02-15</td><td>PSA 10</td><td>$195.50</td></tr>
          <tr><td>2026-03-01</td><td>Ungraded</td><td>$22.00</td></tr>
          <tr><td>2026-03-20</td><td>Grade 9</td><td>$38.00</td></tr>
        </tbody>
      </table>
      </body></html>`;
    const data = parseCardHtml(html, url);
    expect(data.recentSales.length).toBe(4);
    // Oldest first
    expect(data.recentSales[0].at).toBeLessThan(data.recentSales[3].at);
    const psa10Sales = data.recentSales.filter((s) => s.grade === 'psa10');
    expect(psa10Sales.map((s) => s.price)).toEqual([180, 195.5]);
    const rawSales = data.recentSales.filter((s) => s.grade === 'raw');
    expect(rawSales[0].price).toBe(22);
  });

  it('returns an empty salesVolume object when no volume stats are on the page', () => {
    const data = parseCardHtml(cardPageHtml(), url);
    expect(data.salesVolume).toEqual({});
  });

  it('scrapes salesVolume from free-text labels', () => {
    const html = `
      <html><body>
      <h1 id="product_name">Test</h1>
      <div class="sidebar">
        Sales This Week: 12
        Monthly Sales: 47
        Yearly Sales: 612
        Total Sales: 2,481
      </div>
      </body></html>`;
    const data = parseCardHtml(html, url);
    expect(data.salesVolume.week).toBe(12);
    expect(data.salesVolume.month).toBe(47);
    expect(data.salesVolume.year).toBe(612);
    expect(data.salesVolume.total).toBe(2481);
  });

  it('scrapes salesVolume from structured dt/dd pairs', () => {
    const html = `
      <html><body>
      <h1 id="product_name">Test</h1>
      <dl>
        <dt>Weekly Sales</dt><dd>8</dd>
        <dt>This Month</dt><dd>33</dd>
        <dt>All-Time Sales</dt><dd>1,204</dd>
      </dl>
      </body></html>`;
    const data = parseCardHtml(html, url);
    expect(data.salesVolume.week).toBe(8);
    expect(data.salesVolume.month).toBe(33);
    expect(data.salesVolume.total).toBe(1204);
  });

  it('skips sales rows that cannot be parsed (missing date or price)', () => {
    const html = `
      <html><body>
      <table>
        <thead><tr><th>Date</th><th>Grade</th><th>Price</th></tr></thead>
        <tbody>
          <tr><td>2026-01-10</td><td>PSA 10</td><td>$180.00</td></tr>
          <tr><td>garbage</td><td>PSA 10</td><td>$99.00</td></tr>
          <tr><td>2026-02-10</td><td>PSA 10</td><td>n/a</td></tr>
        </tbody>
      </table>
      </body></html>`;
    const data = parseCardHtml(html, url);
    expect(data.recentSales.length).toBe(1);
    expect(data.recentSales[0].price).toBe(180);
  });

  it('picks the Price column, NOT the Shipping column, when both are present', () => {
    // Regression: previously we picked the first $ cell in the row, which
    // grabbed Shipping ($6) instead of the actual sale price.
    const html = `
      <html><body>
      <table>
        <thead><tr><th>Date</th><th>Grade</th><th>Shipping</th><th>Price</th></tr></thead>
        <tbody>
          <tr><td>2026-03-01</td><td>PSA 10</td><td>$6.00</td><td>$450.00</td></tr>
          <tr><td>2026-03-10</td><td>PSA 10</td><td>$5.50</td><td>$475.00</td></tr>
        </tbody>
      </table>
      </body></html>`;
    const data = parseCardHtml(html, url);
    expect(data.recentSales.length).toBe(2);
    expect(data.recentSales.map((s) => s.price)).toEqual([450, 475]);
  });

  it('skips rows with no identifiable grade instead of defaulting to raw', () => {
    // Regression: previously rows with no grade word defaulted to "raw",
    // polluting the Raw distribution with unrelated sales.
    const html = `
      <html><body>
      <table>
        <thead><tr><th>Date</th><th>Title</th><th>Price</th></tr></thead>
        <tbody>
          <tr><td>2026-03-01</td><td>Some random eBay listing title</td><td>$75.00</td></tr>
          <tr><td>2026-03-05</td><td>PSA 10 Mint copy</td><td>$450.00</td></tr>
        </tbody>
      </table>
      </body></html>`;
    const data = parseCardHtml(html, url);
    expect(data.recentSales.length).toBe(1);
    expect(data.recentSales[0].grade).toBe('psa10');
    expect(data.recentSales[0].price).toBe(450);
  });

  it('scrapes per-grade tables without a global row cap starving later tables', () => {
    const rawRows = Array.from({ length: 120 }, (_, i) => {
      return `<tr><td>${i + 50} days ago</td><td>$${10 + i}.00</td></tr>`;
    }).join('');
    const psaRows = Array.from({ length: 80 }, (_, i) => {
      return `<tr><td>${i + 10} days ago</td><td>$${400 + i}.00</td></tr>`;
    }).join('');
    const html = `
      <html><body>
      <h1 id="product_name">Test</h1>
      <table id="ungraded_sales">
        <thead><tr><th>Date</th><th>Price</th></tr></thead>
        <tbody>${rawRows}</tbody>
      </table>
      <table id="psa10_sales">
        <thead><tr><th>Date</th><th>Price</th></tr></thead>
        <tbody>${psaRows}</tbody>
      </table>
      </body></html>`;
    const data = parseCardHtml(html, url);
    const rawN = data.recentSales.filter((s) => s.grade === 'raw').length;
    const psaN = data.recentSales.filter((s) => s.grade === 'psa10').length;
    expect(rawN).toBe(120);
    expect(psaN).toBe(80);
    expect(data.recentSales.length).toBe(200);
  });

  it('uses the table context (id/class/preceding heading) to infer the grade', () => {
    // When PriceCharting groups sales into per-grade tables, the grade lives
    // in the table id or a preceding heading, not in every row.
    const html = `
      <html><body>
      <h3>PSA 10 Sales</h3>
      <table id="psa10_sales">
        <thead><tr><th>Date</th><th>Price</th></tr></thead>
        <tbody>
          <tr><td>2026-03-01</td><td>$450.00</td></tr>
          <tr><td>2026-03-05</td><td>$475.00</td></tr>
        </tbody>
      </table>
      </body></html>`;
    const data = parseCardHtml(html, url);
    expect(data.recentSales.length).toBe(2);
    expect(data.recentSales.every((s) => s.grade === 'psa10')).toBe(true);
  });

  it('drops sales whose price is <= $1 (shipping-cost leakage, fees)', () => {
    const html = `
      <html><body>
      <table>
        <thead><tr><th>Date</th><th>Grade</th><th>Price</th></tr></thead>
        <tbody>
          <tr><td>2026-03-01</td><td>PSA 10</td><td>$0.99</td></tr>
          <tr><td>2026-03-05</td><td>PSA 10</td><td>$450.00</td></tr>
        </tbody>
      </table>
      </body></html>`;
    const data = parseCardHtml(html, url);
    expect(data.recentSales.length).toBe(1);
    expect(data.recentSales[0].price).toBe(450);
  });

  it('prefers "Sold For" over "Price" when both are present in the header', () => {
    const html = `
      <html><body>
      <table>
        <thead><tr><th>Date</th><th>Grade</th><th>Price</th><th>Sold For</th></tr></thead>
        <tbody>
          <tr><td>2026-03-01</td><td>PSA 10</td><td>$500.00</td><td>$450.00</td></tr>
        </tbody>
      </table>
      </body></html>`;
    const data = parseCardHtml(html, url);
    expect(data.recentSales.length).toBe(1);
    expect(data.recentSales[0].price).toBe(450);
  });

  it('extracts the cover image from the real PriceCharting markup structure', () => {
    const realMarkup = `
      <html><body>
      <h1 id="product_name">Meowth <a href="#">Pokemon Phantasmal Flames</a> #106</h1>
      <div id="product_details">
        <div class="cover">
          <a href="#">
            <img src='https://storage.googleapis.com/images.pricecharting.com/5jww5phgmfvpdy2p/240.jpg'
                 alt="Meowth #106 Pokemon Phantasmal Flames Prices" />
          </a>
        </div>
      </div>
      </body></html>`;
    const data = parseCardHtml(realMarkup, url);
    expect(data.imageUrl).toBe(
      'https://storage.googleapis.com/images.pricecharting.com/5jww5phgmfvpdy2p/240.jpg'
    );
  });
});
