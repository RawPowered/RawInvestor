/**
 * Pure helpers for Chromium → Electron cookie import (unit-testable, no Electron).
 * @module
 */

const MARKER_FILENAME = "pcgr-pending-chromium-cookie-import.json";

/** Host keys (cookie table) we allow importing into Raw Investor's embedded browser. */
const IMPORT_SUFFIXES = [
  "ebay.com",
  "tcgplayer.com",
  "pricecharting.com",
];

/**
 * @param {string} hostKey
 * @returns {boolean}
 */
function cookieHostAllowedForImport(hostKey) {
  const h = String(hostKey || "")
    .trim()
    .toLowerCase()
    .replace(/^\./, "");
  if (!h) return false;
  for (const suf of IMPORT_SUFFIXES) {
    if (h === suf || h.endsWith(`.${suf}`)) return true;
  }
  return false;
}

/**
 * Chromium `expires_utc` (Windows epoch microseconds) → Electron `expirationDate` (seconds since Unix epoch).
 * @param {number} expiresUtc
 * @returns {number | undefined}
 */
function chromeExpirationToUnixSeconds(expiresUtc) {
  const n = Number(expiresUtc);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const WINDOWS_TICK = 10000000;
  const SEC_TO_UNIX_EPOCH = 11644473600;
  const unixSec = Math.floor(n / WINDOWS_TICK - SEC_TO_UNIX_EPOCH);
  if (!Number.isFinite(unixSec) || unixSec < 0) return undefined;
  return unixSec;
}

/**
 * @param {string} hostKey
 * @returns {string}
 */
function hostKeyToCookieUrl(hostKey) {
  const raw = String(hostKey || "").trim().toLowerCase();
  const host = raw.startsWith(".") ? raw.slice(1) : raw;
  if (!host) return "https://invalid.invalid/";
  return `https://${host}/`;
}

module.exports = {
  MARKER_FILENAME,
  IMPORT_SUFFIXES,
  cookieHostAllowedForImport,
  chromeExpirationToUnixSeconds,
  hostKeyToCookieUrl,
};
