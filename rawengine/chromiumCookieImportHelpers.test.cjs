const test = require("node:test");
const assert = require("node:assert/strict");
const {
  cookieHostAllowedForImport,
  chromeExpirationToUnixSeconds,
  hostKeyToCookieUrl,
} = require("./chromiumCookieImportHelpers.cjs");

test("cookieHostAllowedForImport allows eBay / TCGplayer / PriceCharting", () => {
  assert.equal(cookieHostAllowedForImport("ebay.com"), true);
  assert.equal(cookieHostAllowedForImport(".ebay.com"), true);
  assert.equal(cookieHostAllowedForImport("www.ebay.com"), true);
  assert.equal(cookieHostAllowedForImport("m.ebay.com"), true);
  assert.equal(cookieHostAllowedForImport("tcgplayer.com"), true);
  assert.equal(cookieHostAllowedForImport("www.tcgplayer.com"), true);
  assert.equal(cookieHostAllowedForImport("pricecharting.com"), true);
  assert.equal(cookieHostAllowedForImport("www.pricecharting.com"), true);
  assert.equal(cookieHostAllowedForImport("evil-ebay.com"), false);
  assert.equal(cookieHostAllowedForImport("google.com"), false);
  assert.equal(cookieHostAllowedForImport(""), false);
});

test("chromeExpirationToUnixSeconds converts Chromium epoch", () => {
  assert.equal(chromeExpirationToUnixSeconds(116444736000000000), 0);
  assert.equal(chromeExpirationToUnixSeconds(116444736100000000), 10);
  assert.equal(chromeExpirationToUnixSeconds(0), undefined);
  assert.equal(chromeExpirationToUnixSeconds(NaN), undefined);
});

test("hostKeyToCookieUrl strips leading dot", () => {
  assert.equal(hostKeyToCookieUrl(".ebay.com"), "https://ebay.com/");
  assert.equal(hostKeyToCookieUrl("www.pricecharting.com"), "https://www.pricecharting.com/");
});
