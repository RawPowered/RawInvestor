/**
 * Bot / captcha wall heuristics for extension capture (eBay sold SERP, TCGPlayer product).
 * Injected into tabs via background.js before extractCurrentPageInTab; also unit-tested in Node.
 */

const BOT_CHECK_MESSAGE =
  'BOT_CHECK: This page looks like a security or bot challenge. Complete it in the tab, then run Raw Investor capture again. If the page already shows normal results, open the extension again and use “No challenge here — capture anyway.”';

const HIGH_CONFIDENCE_PHRASES = [
  'verify you are human',
  "verify you're a human",
  'unusual traffic',
  'robot check',
  'press and hold',
  'hcaptcha',
  'recaptcha',
  "prove you're not a robot",
  'prove you are not a robot',
  'pardon our interruption',
];

const hasCaptchaIframe = (doc) =>
  Boolean(
    doc.querySelector?.(
      'iframe[src*="hcaptcha"], iframe[src*="recaptcha"], iframe[src*="captcha"]'
    )
  );

/**
 * @param {Document} doc
 */
export const hasEbaySoldSerpEvidence = (doc = document) => {
  const resultsRoot =
    doc.querySelector?.('ul.srp-results, #srp-river-results, .srp-results') || doc.body;
  if (!resultsRoot) return false;
  const items = resultsRoot.querySelectorAll?.('li.s-item') ?? [];
  if (items.length >= 2) return true;
  if (items.length === 1) {
    const row = items[0];
    const link = row.querySelector?.("a.s-item__link[href*='/itm/'], a[href*='/itm/']");
    const price = row.querySelector?.(
      ".s-item__price, .s-card__price, [class*='s-card__price'], .su-card-container__attributes__primary"
    );
    if (link && price && /\$|USD/i.test(String(price.textContent || ''))) return true;
  }
  const listItems = resultsRoot.querySelectorAll?.("[role='listitem']") ?? [];
  if (listItems.length >= 3) {
    const withItm = Array.from(listItems).filter((el) =>
      el.querySelector?.("a[href*='/itm/']")
    );
    if (withItm.length >= 2) return true;
  }
  return false;
};

/**
 * @param {Document} doc
 */
export const hasTcgProductEvidence = (doc = document) => {
  try {
    const path = String(doc.location?.pathname || '');
    if (!/\/product\/\d+/i.test(path)) return false;
  } catch {
    return false;
  }
  const body = (doc.body?.innerText || '').replace(/\s+/g, ' ');
  if (/market\s*price[\s\S]{0,40}?\$[\d,]+/i.test(body)) return true;
  if (/\badd\s+to\s+cart\b[\s\S]{0,120}?\$[\d,]+/i.test(body)) return true;
  if (doc.querySelector?.('[data-testid*="sales"], .sales-history, .latest-sales')) return true;
  return false;
};

/**
 * @param {Document} doc
 * @param {'ebay' | 'tcgplayer' | string | null} source
 */
export const detectLikelyBotWall = (doc = document, source = null) => {
  if (source === 'ebay' && hasEbaySoldSerpEvidence(doc)) return false;
  if (source === 'tcgplayer' && hasTcgProductEvidence(doc)) return false;

  const title = (doc.title || '').toLowerCase();
  const body = (doc.body?.innerText || '').slice(0, 12000).toLowerCase();
  const t = `${title}\n${body}`;

  if (hasCaptchaIframe(doc)) return true;

  let highHits = 0;
  for (const p of HIGH_CONFIDENCE_PHRASES) {
    if (t.includes(p)) highHits += 1;
  }
  if (/\bcaptcha\b/i.test(t)) highHits += 1;
  if (/\bcloudflare\b/i.test(t) && /(challenge|checking|verify|ray id)/i.test(t)) highHits += 1;

  if (highHits >= 2) return true;
  if (highHits >= 1 && hasCaptchaIframe(doc)) return true;

  const soleStrong =
    /verify you are human|unusual traffic|press and hold|pardon our interruption/i.test(t) &&
    !hasEbaySoldSerpEvidence(doc) &&
    !hasTcgProductEvidence(doc);
  return soleStrong;
};

export const botCheckErrorMessage = () => BOT_CHECK_MESSAGE;

const api = {
  hasEbaySoldSerpEvidence,
  hasTcgProductEvidence,
  detectLikelyBotWall,
  botCheckErrorMessage,
};

if (typeof globalThis !== 'undefined') {
  globalThis.__pcgrBotWallDetect = api;
}
