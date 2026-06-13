const {
  BrowserWindow,
  BrowserView,
  ipcMain,
  dialog,
  clipboard,
  nativeImage,
  shell,
} = require("electron");
const path = require("path");
const fs = require("fs").promises;
const { pathToFileURL } = require("url");
const { appendCaptureLog } = require("./capture-logger.cjs");

let extractModulePromise;

async function getExtractModule() {
  if (!extractModulePromise) {
    const extRoot = String(process.env.PCGR_EXTENSION_ROOT || "").trim()
      ? process.env.PCGR_EXTENSION_ROOT
      : path.join(__dirname, "..", "extension");
    const extractPath = path.join(extRoot, "extractPageInTab.mjs");
    extractModulePromise = import(pathToFileURL(extractPath).href);
  }
  return extractModulePromise;
}

async function getExtractFunction() {
  const m = await getExtractModule();
  return m.extractCurrentPageInTab;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Serialize DOM capture (`executeJavaScript` + eBay prep) across all tabs.
 * Concurrent captures (e.g. Quick Fetch eBay + TCG in parallel) can stall with no
 * "extractor finished" log — queue guarantees one extraction pipeline at a time.
 */
/** Per-tab tails: parallel extracts on different tabs; serial within one tab. */
const captureExtractTailsByKey = new Map();

function enqueueCaptureExtract(work, webContents) {
  const key =
    webContents && typeof webContents.id === "number"
      ? `wc:${webContents.id}`
      : "__global__";
  let tail = captureExtractTailsByKey.get(key) ?? Promise.resolve();
  const next = tail.then(() => work());
  captureExtractTailsByKey.set(
    key,
    next.catch(() => {})
  );
  return next;
}

/**
 * Attach **before** an inject that may navigate.
 *
 * Only `did-finish-load` ends the first wait — **not** `dom-ready` / `did-navigate-in-page`.
 * Those fire early (or on URL tweaks) while eBay still runs a second load wave; starting the
 * big capture then hits the “subtle reset” and the script context dies.
 *
 * If the listing updates with **no** full document reload, `idle-fallback` eventually proceeds.
 */
function attachWaitForNextDocumentLifecycle(webContents, options = {}) {
  const idleFallbackMs = Number(options.idleFallbackMs) || 28000;
  const hardTimeoutMs = Number(options.hardTimeoutMs) || 90000;
  const settleMs = Number(options.settleMs) || 400;

  return new Promise((resolve) => {
    let finished = false;
    const listeners = [];

    const cleanup = () => {
      while (listeners.length) {
        const { event, handler } = listeners.pop();
        try {
          webContents.removeListener(event, handler);
        } catch {
          /* ignore */
        }
      }
    };

    const done = (reason) => {
      if (finished) return;
      finished = true;
      clearTimeout(idleTimer);
      clearTimeout(hardTimer);
      cleanup();
      resolve(reason);
    };

    const addOnce = (event, handler) => {
      webContents.once(event, handler);
      listeners.push({ event, handler });
    };

    addOnce("did-finish-load", () => done("did-finish-load"));

    const idleTimer = setTimeout(() => done("idle-fallback"), idleFallbackMs);
    const hardTimer = setTimeout(() => done("hard-timeout"), hardTimeoutMs);
  }).then(async (reason) => {
    await delay(settleMs);
    return reason;
  });
}

/**
 * After the first load signal, wait until the tab is **actually** not loading, then drain any
 * extra “echo” loads (eBay often chains a second fetch/navigation right after filters).
 *
 * Wave 0 uses `maxQuietWaitMs` so we do not block ~75s when `isLoading()` never clears (background XHR).
 */
async function waitUntilQuietForCapture(webContents, options = {}) {
  const stableMs = Number(options.stableMs) || 1400;
  const maxQuietWaitMs = Number(options.maxQuietWaitMs) || 18000;
  const maxTotalMs = Number(options.maxTotalMs) || 75000;
  const maxWaves = Number(options.maxWaves) || 5;
  const waveListenMs = Number(options.waveListenMs) || 10000;
  const heartbeatEveryMs = Number(options.heartbeatLogEveryMs) || 6000;

  const started = Date.now();
  const hardDeadline = started + maxTotalMs;
  let lastHeartbeat = started;

  for (let wave = 0; wave < maxWaves && Date.now() < hardDeadline; wave += 1) {
    const idleDeadline =
      wave === 0 ? Math.min(started + maxQuietWaitMs, hardDeadline) : hardDeadline;

    let stableStart = null;
    let achievedStable = false;
    while (Date.now() < idleDeadline && Date.now() < hardDeadline) {
      if (webContents.isDestroyed()) return;
      const now = Date.now();
      if (now - lastHeartbeat >= heartbeatEveryMs) {
        lastHeartbeat = now;
        let loading = false;
        try {
          loading = Boolean(webContents.isLoading());
        } catch {
          loading = false;
        }
        appendCaptureLog({
          scope: "capture-wait",
          level: "info",
          message: "waiting for quiet tab (heartbeat)",
          detail: {
            wave,
            elapsedMs: now - started,
            loading,
            stableStartMs: stableStart ? now - stableStart : null,
          },
        });
      }
      try {
        if (webContents.isLoading()) {
          stableStart = null;
          await delay(100);
          continue;
        }
        if (stableStart == null) stableStart = Date.now();
        else if (Date.now() - stableStart >= stableMs) {
          achievedStable = true;
          break;
        }
      } catch {
        return;
      }
      await delay(90);
    }

    if (!achievedStable) break;

    const remaining = Math.max(0, hardDeadline - Date.now());
    if (remaining < 500) break;

    const anotherLoad = await Promise.race([
      new Promise((resolve) => {
        webContents.once("did-start-loading", () => resolve(true));
      }),
      delay(Math.min(waveListenMs, remaining)).then(() => false),
    ]);

    if (!anotherLoad) break;

    await Promise.race([
      new Promise((resolve) => {
        webContents.once("did-finish-load", resolve);
      }),
      delay(Math.min(40000, hardDeadline - Date.now())),
    ]);
  }

  await Promise.race([
    new Promise((resolve) => {
      webContents.once("did-stop-loading", resolve);
    }),
    delay(900),
  ]);
}

async function injectSmallPrepScript(webContents, prepFn, payloadObj, errorLabel) {
  const payload = JSON.stringify(payloadObj);
  const code =
    "(async function () {\n" +
    "  try {\n" +
    "    const prep = " +
    prepFn.toString() +
    ";\n" +
    "    return await prep(" +
    payload +
    ");\n" +
    "  } catch (e) {\n" +
    "    return {\n" +
    "      error:\n" +
    "        e && typeof e.message === 'string'\n" +
    "          ? e.message\n" +
    "          : String(e),\n" +
    "      captureThrown: true,\n" +
    "    };\n" +
    "  }\n" +
    "})()";
  try {
    return await webContents.executeJavaScript(code, true);
  } catch (err) {
    const url = (() => {
      try {
        return webContents.getURL();
      } catch {
        return "";
      }
    })();
    throw new Error(`${errorLabel} did not run${url ? ` (${url})` : ""}: ${String(err?.message || err)}`);
  }
}

function prepResultAppliedOk(result) {
  return (
    result &&
    result.captureThrown !== true &&
    typeof result.error !== "string" &&
    result.applied === true
  );
}

/**
 * eBay UI steps run in short injections; we wait for `did-finish-load` (not dom-ready — too early),
 * then wait until loading is quiet + drain follow-up loads before the long capture script runs.
 */
async function runExtractInWebContentsImpl(webContents, options) {
  const incoming = options && typeof options === "object" ? { ...options } : {};
  let opts = { ...incoming };
  const m = await getExtractModule();
  const pipelineT0 = Date.now();
  const ebayQuickPrepShort = incoming.ebayQuickRefresh === true;
  const quietAfterNavOk = ebayQuickPrepShort
    ? { stableMs: 550, maxQuietWaitMs: 7000, maxTotalMs: 16000 }
    : { stableMs: 1400, maxQuietWaitMs: 18000, maxTotalMs: 75000 };
  const quietAfterNavMiss = ebayQuickPrepShort
    ? { stableMs: 500, maxQuietWaitMs: 4000, maxTotalMs: 10000 }
    : { stableMs: 900, maxQuietWaitMs: 6000, maxTotalMs: 14000 };
  const loadWaitAfterPrep = ebayQuickPrepShort
    ? { idleFallbackMs: 12000, hardTimeoutMs: 45000, settleMs: 500 }
    : { idleFallbackMs: 24000, hardTimeoutMs: 90000, settleMs: 750 };

  const facetNeedsPrep =
    opts.ebaySkipGradedFacetClick !== true &&
    (opts.ebayGradedFacet === "no" || opts.ebayGradedFacet === "yes") &&
    typeof m.ebayApplyGradedFacetOnly === "function";

  if (facetNeedsPrep) {
    appendCaptureLog({
      scope: "ebay-prep",
      level: "info",
      message: "graded facet inject starting",
      detail: { ebayGradedFacet: opts.ebayGradedFacet },
    });
    const facetResult = await injectSmallPrepScript(
      webContents,
      m.ebayApplyGradedFacetOnly,
      { ebayGradedFacet: opts.ebayGradedFacet },
      "eBay graded-facet script"
    );
    const facetOk = prepResultAppliedOk(facetResult);
    opts = {
      ...opts,
      ebaySkipGradedFacetClick: facetOk,
      ebayGradedFacetAlreadyApplied: facetOk,
    };
    if (facetOk) {
      const loadWait = attachWaitForNextDocumentLifecycle(webContents, loadWaitAfterPrep);
      await loadWait;
      await waitUntilQuietForCapture(webContents, quietAfterNavOk);
    } else {
      appendCaptureLog({
        scope: "ebay-prep",
        level: "info",
        message: "graded facet prep did not apply — full extract will retry facet click",
        detail: {},
      });
      await delay(400);
      await waitUntilQuietForCapture(webContents, quietAfterNavMiss);
    }
    appendCaptureLog({
      scope: "ebay-prep",
      level: "info",
      message: "graded facet prep finished",
      detail: { applied: facetOk, elapsedMs: Date.now() - pipelineT0 },
    });
  }

  const perPageNum = Number(opts.ebayPerPageTarget);
  const soldWatermarkNum = Number(opts.ebaySoldWatermarkMs);
  const hasSoldWatermark = Number.isFinite(soldWatermarkNum) && soldWatermarkNum > 0;
  const adaptivePerPage = opts.ebayAdaptivePerPage === true;
  const adaptiveMinRows = Number.isFinite(Number(opts.ebayAdaptiveMinRows))
    ? Math.max(1, Number(opts.ebayAdaptiveMinRows))
    : 18;
  const adaptiveMinParseableRows = Number.isFinite(Number(opts.ebayAdaptiveMinParseableRows))
    ? Math.max(1, Number(opts.ebayAdaptiveMinParseableRows))
    : 4;
  let skipPerPageViaAdaptive = false;
  let adaptiveInspection = null;
  if (
    adaptivePerPage &&
    hasSoldWatermark &&
    typeof m.ebayInspectSoldPageOnly === "function"
  ) {
    appendCaptureLog({
      scope: "ebay-prep",
      level: "info",
      message: "adaptive per-page inspection starting",
      detail: { ebaySoldWatermarkMs: soldWatermarkNum },
    });
    adaptiveInspection = await injectSmallPrepScript(
      webContents,
      m.ebayInspectSoldPageOnly,
      {},
      "eBay adaptive sold-page inspection script"
    );
    const maxSoldAt = Number(adaptiveInspection?.maxSoldAt);
    const rowCount = Number(adaptiveInspection?.rowCount);
    const parseableDateRows = Number(adaptiveInspection?.parseableDateRows);
    const hasFreshSale = Number.isFinite(maxSoldAt) && maxSoldAt > soldWatermarkNum;
    const hasHealthyRows =
      Number.isFinite(rowCount) &&
      rowCount >= adaptiveMinRows &&
      Number.isFinite(parseableDateRows) &&
      parseableDateRows >= adaptiveMinParseableRows;
    skipPerPageViaAdaptive = hasFreshSale || hasHealthyRows;
    appendCaptureLog({
      scope: "ebay-prep",
      level: "info",
      message: "adaptive per-page inspection finished",
      detail: {
        hasFreshSale,
        hasHealthyRows,
        skipPerPageViaAdaptive,
        rowCount: Number.isFinite(rowCount) ? rowCount : null,
        parseableDateRows: Number.isFinite(parseableDateRows) ? parseableDateRows : null,
        maxSoldAt: Number.isFinite(maxSoldAt) ? maxSoldAt : null,
        ebaySoldWatermarkMs: soldWatermarkNum,
      },
    });
    if (skipPerPageViaAdaptive) {
      opts = {
        ...opts,
        ebaySkipPerPageChange: true,
        ebayPerPageAlreadyApplied: true,
        ebayPerPageTarget: null,
      };
    }
  }
  const perPageNeedsPrep =
    opts.ebaySkipPerPageChange !== true &&
    Number.isFinite(perPageNum) &&
    perPageNum >= 25 &&
    typeof m.ebayApplyPerPageOnly === "function";

  if (perPageNeedsPrep) {
    appendCaptureLog({
      scope: "ebay-prep",
      level: "info",
      message: "results-per-page inject starting",
      detail: { ebayPerPageTarget: perPageNum },
    });
    const perResult = await injectSmallPrepScript(
      webContents,
      m.ebayApplyPerPageOnly,
      { ebayPerPageTarget: perPageNum },
      "eBay results-per-page script"
    );
    const perOk = prepResultAppliedOk(perResult);
    opts = {
      ...opts,
      ebaySkipPerPageChange: perOk,
      ebayPerPageAlreadyApplied: perOk,
    };
    if (perOk) {
      const loadWait = attachWaitForNextDocumentLifecycle(webContents, loadWaitAfterPrep);
      await loadWait;
      await waitUntilQuietForCapture(webContents, quietAfterNavOk);
    } else {
      appendCaptureLog({
        scope: "ebay-prep",
        level: "info",
        message:
          "results-per-page prep missed UI — skipping navigation wait; full extract will retry per-page",
        detail: { ebayPerPageTarget: perPageNum },
      });
      await delay(400);
      await waitUntilQuietForCapture(webContents, quietAfterNavMiss);
    }
    appendCaptureLog({
      scope: "ebay-prep",
      level: "info",
      message: "per-page prep finished",
      detail: { applied: perOk, elapsedMs: Date.now() - pipelineT0 },
    });
  }
  if (skipPerPageViaAdaptive) {
    appendCaptureLog({
      scope: "ebay-prep",
      level: "info",
      message: "adaptive per-page skipped target inflation",
      detail: {
        inspected: Boolean(adaptiveInspection),
        ebayPerPageTarget: perPageNum,
      },
    });
  }

  appendCaptureLog({
    scope: "extract",
    level: "info",
    message: "full extractor inject starting",
    detail: {
      mode: opts.mode,
      ebaySkipGradedFacetClick: opts.ebaySkipGradedFacetClick === true,
      ebaySkipPerPageChange: opts.ebaySkipPerPageChange === true,
      prepElapsedMs: Date.now() - pipelineT0,
    },
  });
  const injectT0 = Date.now();
  const result = await runExtractInWebContentsSingle(webContents, opts);
  const cs = result?.data?.captureStats;
  appendCaptureLog({
    scope: "extract-timing",
    level: "info",
    message: "capture pipeline timings ms",
    detail: {
      prepMs: injectT0 - pipelineT0,
      extractInjectWallMs: Date.now() - injectT0,
      totalMs: Date.now() - pipelineT0,
      mode: opts.mode,
      ebayDeepFetchPhaseMs: cs?.ebayDeepFetchPhaseMs ?? null,
      pagesScanned: cs?.pagesScanned ?? null,
      ebayDeepFetchConcurrency: cs?.ebayDeepFetchConcurrency ?? null,
    },
  });
  return result;
}

async function runExtractInWebContents(webContents, options) {
  return enqueueCaptureExtract(
    () => runExtractInWebContentsImpl(webContents, options),
    webContents
  );
}

async function runExtractInWebContentsSingle(webContents, options) {
  const fn = await getExtractFunction();
  const incoming = options && typeof options === "object" ? { ...options } : {};
  const opts = {
    ...incoming,
    mode: incoming.mode === "deep" ? "deep" : "default",
  };
  const payload = JSON.stringify(opts);
  // IMPORTANT: do not wrap fn.toString() in a template literal — the extractor body
  // contains `${...}` template expressions that Node would wrongly interpolate here.
  // Wrap so async rejections become `{ error }`: otherwise Electron reports only
  // "Script failed to execute" (common on eBay when fetch/deep paths reject).
  const code =
    "(async function () {\n" +
    "  try {\n" +
    "    const extract = " +
    fn.toString() +
    ";\n" +
    "    return await extract(" +
    payload +
    ");\n" +
    "  } catch (e) {\n" +
    "    return {\n" +
    "      error:\n" +
    "        e && typeof e.message === 'string'\n" +
    "          ? e.message\n" +
    "          : String(e),\n" +
    "      captureThrown: true,\n" +
    "    };\n" +
    "  }\n" +
    "})()";
  try {
    const out = await webContents.executeJavaScript(code, true);
    if (out && out.error) {
      appendCaptureLog({
        scope: "extract",
        level: "error",
        message: "extractor returned error payload",
        detail: { error: out.error, captureThrown: out.captureThrown },
      });
    } else {
      const src = out?.source;
      const rows =
        src === "ebay"
          ? Array.isArray(out?.data?.listings)
            ? out.data.listings.length
            : null
          : src === "tcgplayer"
            ? Array.isArray(out?.data?.latestSalesRows)
              ? out.data.latestSalesRows.length
              : null
            : null;
      appendCaptureLog({
        scope: "extract",
        level: "info",
        message: "extractor finished",
        detail: { source: src ?? null, rowCount: rows },
      });
    }
    return out;
  } catch (err) {
    appendCaptureLog({
      scope: "extract",
      level: "error",
      message: "executeJavaScript failed",
      detail: String(err?.message || err),
    });
    const url = (() => {
      try {
        return webContents.getURL();
      } catch {
        return "";
      }
    })();
    throw new Error(
      `Capture script did not run${url ? ` (${url})` : ""}: ${String(err?.message || err)}`
    );
  }
}

async function postCaptureToServer(apiBaseUrl, result, extToken, appToken) {
  const endpoint = `${String(apiBaseUrl || "").replace(/\/$/, "")}/api/ext/capture`;
  const headers = { "Content-Type": "application/json" };
  const tok = String(extToken || "").trim();
  if (tok) headers["x-ext-token"] = tok;
  const app = String(appToken || "").trim();
  if (app) headers["x-pcgr-app-token"] = app;
  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(result),
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    /* ignore */
  }
  if (!res.ok) {
    const msg =
      (data && typeof data.error === "string" && data.error.trim()) ||
      (text && text.trim().length > 0 && text.trim().length < 800 ? text.trim() : "") ||
      `Capture failed (${res.status}).`;
    throw new Error(msg);
  }
  const tcgRows = Array.isArray(result?.data?.latestSalesRows)
    ? result.data.latestSalesRows.length
    : null;
  const ebayRows = Array.isArray(result?.data?.listings)
    ? result.data.listings.length
    : null;
  const excludedRowCount =
    typeof result?.data?.excludedRowCount === "number"
      ? result.data.excludedRowCount
      : Array.isArray(result?.data?.excludedListings)
        ? result.data.excludedListings.length
        : null;
  return {
    ...data,
    source: result?.source ?? null,
    rowCount: tcgRows != null ? tcgRows : ebayRows != null ? ebayRows : null,
    captureStats: result?.data?.captureStats ?? null,
    tcgFeedSanity: result?.data?.tcgFeedSanity ?? null,
    excludedRowCount,
  };
}

/** Shape matches post-capture echo for eBay/TCG row counts (no /api/ext/capture round-trip). */
function formatLocalCaptureEcho(result) {
  const tcgRows = Array.isArray(result?.data?.latestSalesRows)
    ? result.data.latestSalesRows.length
    : null;
  const ebayRows = Array.isArray(result?.data?.listings) ? result.data.listings.length : null;
  const excludedRowCount =
    typeof result?.data?.excludedRowCount === "number"
      ? result.data.excludedRowCount
      : Array.isArray(result?.data?.excludedListings)
        ? result.data.excludedListings.length
        : null;
  return {
    ok: true,
    localOnly: true,
    source: result?.source ?? null,
    rowCount: tcgRows != null ? tcgRows : ebayRows != null ? ebayRows : null,
    captureStats: result?.data?.captureStats ?? null,
    tcgFeedSanity: result?.data?.tcgFeedSanity ?? null,
    excludedRowCount,
    raw: result,
  };
}

/**
 * Product/detail pages under /game/ or /trading-cards/ — same URLs Add Card → Fetch accepts.
 * Uses server scrape + SQLite upsert instead of fragile in-tab DOM capture → /api/ext/capture.
 */
function shouldPricechartingTabServerSync(rawUrl) {
  try {
    const u = new URL(String(rawUrl || ""));
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();
    if (host !== "pricecharting.com") return false;
    const p = u.pathname.toLowerCase();
    if (p === "/" || p === "") return false;
    return /\/(game|trading-cards|console)\//i.test(p);
  } catch {
    return false;
  }
}

async function postPricechartingSyncToServer(apiBaseUrl, pageUrl, extToken, appToken) {
  const endpoint = `${String(apiBaseUrl || "").replace(/\/$/, "")}/api/ext/pricecharting/sync`;
  const headers = { "Content-Type": "application/json" };
  const tok = String(extToken || "").trim();
  if (tok) headers["x-ext-token"] = tok;
  const app = String(appToken || "").trim();
  if (app) headers["x-pcgr-app-token"] = app;
  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ url: String(pageUrl || "").trim() }),
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    /* ignore */
  }
  if (!res.ok) {
    const msg =
      (data && typeof data.error === "string" && data.error.trim()) ||
      (text && text.trim().length > 0 && text.trim().length < 800 ? text.trim() : "") ||
      `PriceCharting sync failed (${res.status}).`;
    throw new Error(msg);
  }
  return {
    ok: true,
    source: "pricecharting",
    cardId: data?.cardId ?? null,
    created: data?.created === true,
    portfolioMerge: data?.portfolioMerge ?? { touched: 1 },
    rowCount: null,
    file: null,
  };
}

function normalizeHttpUrl(rawUrl) {
  const raw = String(rawUrl || "").trim();
  if (!raw) return null;
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function isGoogleAuthUrl(rawUrl) {
  const normalized = normalizeHttpUrl(rawUrl);
  if (!normalized) return false;
  try {
    const u = new URL(normalized);
    const host = u.hostname.toLowerCase();
    const path = u.pathname.toLowerCase();
    if (host === "accounts.google.com" || host.endsWith(".accounts.google.com")) return true;
    if (host === "oauth2.googleapis.com") return true;
    if (host === "myaccount.google.com" && /^\/(?:signin|security|accountchooser)\b/i.test(path)) {
      return true;
    }
    if ((host === "google.com" || host.endsWith(".google.com")) && /^\/(?:o\/oauth2|signin|accountchooser)\b/i.test(path)) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function buildEbaySessionProbeJs() {
  return `(function () {
  try {
    const text = String(document.body && document.body.innerText ? document.body.innerText : "").toLowerCase();
    const hrefs = Array.from(document.querySelectorAll("a[href]"))
      .map((a) => String(a.href || "").toLowerCase())
      .slice(0, 500);
    const html = String(document.documentElement && document.documentElement.innerHTML ? document.documentElement.innerHTML : "").toLowerCase();
    const signedOut =
      /signin\\.ebay\\.com|\\/signin|sign in|log in|login/.test(location.href.toLowerCase()) ||
      hrefs.some((h) => /signin\\.ebay\\.com|\\/signin/.test(h)) ||
      /hello[,!]?\\s*sign in/.test(text) ||
      /sign in to your account|continue to sign in|create an account/.test(text);
    const signedIn =
      hrefs.some((h) => /\\/mye\\/|\\/mys\\/|\\/usr\\//.test(h)) ||
      /my ebay|watchlist|purchase history|summary|account settings|sign out/.test(text) ||
      /gh-ug|gh-eb-username|gh-identity/.test(html);
    return {
      ok: true,
      status: signedIn && !signedOut ? "signed-in" : signedOut && !signedIn ? "signed-out" : "unknown",
      url: location.href,
      title: document.title || "",
    };
  } catch (e) {
    return { ok: false, status: "unknown", error: e && e.message ? e.message : String(e) };
  }
})()`;
}

function normalizeUrlForMatch(rawUrl) {
  const normalized = normalizeHttpUrl(rawUrl);
  if (!normalized) return "";
  try {
    const u = new URL(normalized);
    // Keep matching predictable across query param ordering noise.
    const pairs = Array.from(u.searchParams.entries()).sort(([a], [b]) =>
      a.localeCompare(b)
    );
    const q = new URLSearchParams();
    for (const [k, v] of pairs) q.append(k, v);
    const qs = q.toString();
    const path = u.pathname.replace(/\/+$/, "") || "/";
    return `${u.origin.toLowerCase()}${path}${qs ? `?${qs}` : ""}`;
  } catch {
    return normalized;
  }
}

function tcgProductIdFromUrlString(url) {
  try {
    const u = new URL(String(url || ""));
    const m = u.pathname.match(/\/product\/(\d+)/i);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function ebayNkwFromUrlString(url) {
  try {
    const u = new URL(String(url || ""));
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "ebay.com" && host !== "m.ebay.com") return null;
    const nkw = u.searchParams.get("_nkw");
    if (nkw == null || nkw === "") return null;
    return nkw;
  } catch {
    return null;
  }
}

/**
 * @param {string} actualUrl
 * @param {{ kind: string, targetUrl: string }} expected
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
function verifyExpectedCaptureUrl(actualUrl, expected) {
  const targetUrl = String(expected?.targetUrl || "").trim();
  const kind = String(expected?.kind || "");
  const trunc = (s, n = 120) => {
    const t = String(s || "");
    return t.length <= n ? t : `${t.slice(0, n)}…`;
  };
  if (!actualUrl || actualUrl === "about:blank") {
    return { ok: false, reason: "Tab has no loaded URL" };
  }
  if (kind === "tcgplayer") {
    const want = tcgProductIdFromUrlString(targetUrl);
    const got = tcgProductIdFromUrlString(actualUrl);
    if (!want) return { ok: false, reason: "Invalid target TCG URL" };
    if (!got) {
      return {
        ok: false,
        reason: `Expected TCGPlayer product page, got: ${trunc(actualUrl)}`,
      };
    }
    if (want !== got) {
      return {
        ok: false,
        reason: `TCG product id mismatch (expected ${want}, tab shows ${got})`,
      };
    }
    return { ok: true };
  }
  if (kind === "ebay") {
    const wantNkw = ebayNkwFromUrlString(targetUrl);
    const gotNkw = ebayNkwFromUrlString(actualUrl);
    if (!wantNkw) return { ok: false, reason: "Invalid target eBay URL" };
    if (!gotNkw) {
      return {
        ok: false,
        reason: `Expected eBay search URL, got: ${trunc(actualUrl)}`,
      };
    }
    const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
    if (norm(wantNkw) !== norm(gotNkw)) {
      return {
        ok: false,
        reason: `eBay _nkw mismatch (expected "${wantNkw.slice(0, 96)}", tab has "${gotNkw.slice(0, 96)}")`,
      };
    }
    return { ok: true };
  }
  return { ok: false, reason: `Unknown capture kind: ${kind}` };
}

function safeRemoveBrowserView(win, view) {
  if (!win || win.isDestroyed() || !view) return;
  try {
    win.removeBrowserView(view);
  } catch {
    // not attached
  }
}

/**
 * Injected into eBay listing pages. Best-effort DOM: scroll bid/BIN into view,
 * re-read prices, then click the strongest bid CTA match.
 */
function buildEbaySniperExecuteJs(maxBidUsd, maxBinUsd) {
  const maxBid = Number(maxBidUsd);
  const maxBin = Number(maxBinUsd);
  const safeBid = Number.isFinite(maxBid) && maxBid > 0 ? maxBid : 0;
  const safeBin = Number.isFinite(maxBin) && maxBin > 0 ? maxBin : safeBid;
  return `(async function () {
  try {
    const maxBid = ${safeBid};
    const maxBin = ${safeBin};
    if (!(maxBid > 0)) return { ok: false, reason: "invalid-max-bid" };

    const pickUsd = (raw) => {
      const s = String(raw || "");
      const m =
        s.replace(/,/g, "").match(/\\$\\s*([0-9]+(?:\\.[0-9]+)?)/i) ||
        s.match(/([0-9]+(?:\\.[0-9]+)?)\\s*USD/i);
      if (!m) return null;
      const n = Number(m[1]);
      return Number.isFinite(n) ? n : null;
    };

    const anchors = [
      document.querySelector("#singlebid"),
      document.querySelector("#bidBox"),
      document.querySelector('[data-testid="x-bid-action"]'),
      document.querySelector('[class*="vi-bid"]'),
      document.querySelector('[class*="binbox"]'),
    ].filter(Boolean);
    for (const el of anchors) {
      try {
        el.scrollIntoView({ block: "center", behavior: "instant" });
      } catch {
        /* ignore */
      }
    }

    const text = document.body && document.body.innerText ? document.body.innerText : "";

    const curBid =
      pickUsd(text.match(/current bid[^\\n$]*\\$\\s*[0-9]/i)?.[0] || "") ||
      pickUsd(text.match(/current bid[^\\n]*([0-9]+(?:\\.[0-9]+)?)/i)?.[0] || "");
    const binPrice =
      pickUsd(text.match(/buy it now[^\\n$]*\\$\\s*[0-9]/i)?.[0] || "") ||
      pickUsd(text.match(/buy it now[^\\n]*([0-9]+(?:\\.[0-9]+)?)/i)?.[0] || "");

    const hasAuctionCue = /current bid|\\bbids?\\b|place bid|enter bid/i.test(text);
    const hasBinCue = /buy it now/i.test(text);

    if (hasAuctionCue && curBid != null && curBid > maxBid) {
      return { ok: false, reason: "over-ceiling-bid", effectivePrice: curBid };
    }
    if (hasBinCue && binPrice != null && binPrice > maxBin && !hasAuctionCue) {
      return { ok: false, reason: "over-ceiling-bin", effectivePrice: binPrice };
    }
    if (!hasAuctionCue && !hasBinCue && curBid == null && binPrice == null) {
      return { ok: false, reason: "price-not-found" };
    }

    const candidates = Array.from(
      document.querySelectorAll("button, a[role=button], [role=button], input[type=submit], input[type=button]")
    );

    const labelOf = (el) =>
      (
        el.getAttribute("aria-label") ||
        el.textContent ||
        el.value ||
        ""
      )
        .toString()
        .toLowerCase();

    const score = (el) => {
      const t = labelOf(el);
      if (/confirm\\s*bid|review\\s*bid|place\\s*bid|submit\\s*bid|bid\\s*now/.test(t)) return 100;
      if (/enter\\s*max|max\\s*bid/.test(t)) return 60;
      if (/buy\\s*it\\s*now|bin/.test(t)) return 40;
      return 0;
    };

    const scored = candidates
      .map((el) => ({ el, s: score(el) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s);

    const pick = scored[0]?.el || null;
    if (!pick) return { ok: false, reason: "bid-button-not-found" };

    try {
      pick.scrollIntoView({ block: "center", behavior: "instant" });
    } catch {
      /* ignore */
    }
    try {
      pick.click();
    } catch {
      const ev = new MouseEvent("click", { bubbles: true, cancelable: true, view: window });
      pick.dispatchEvent(ev);
    }
    return { ok: true, curBid, binPrice };
  } catch (e) {
    return {
      ok: false,
      reason: "js-error",
      error: e && e.message ? e.message : String(e),
    };
  }
})()`;
}

/** Read-only scrape for Arsenal live watch (eBay view-item). */
function buildEbayListingProbeJs() {
  return `(function () {
  try {
    const pickUsd = (raw) => {
      const s = String(raw || "");
      const m =
        s.replace(/,/g, "").match(/\\$\\s*([0-9]+(?:\\.[0-9]+)?)/i) ||
        s.match(/([0-9]+(?:\\.[0-9]+)?)\\s*USD/i);
      if (!m) return null;
      const n = Number(m[1]);
      return Number.isFinite(n) ? n : null;
    };
    const text = document.body && document.body.innerText ? document.body.innerText : "";
    const curBid =
      pickUsd(text.match(/current bid[^\\n$]*\\$\\s*[0-9]/i)?.[0] || "") ||
      pickUsd(text.match(/current bid[^\\n]*([0-9]+(?:\\.[0-9]+)?)/i)?.[0] || "");
    const binPrice =
      pickUsd(text.match(/buy it now[^\\n$]*\\$\\s*[0-9]/i)?.[0] || "") ||
      pickUsd(text.match(/buy it now[^\\n]*([0-9]+(?:\\.[0-9]+)?)/i)?.[0] || "") ||
      pickUsd(text.match(/or best offer[^\\n$]*\\$\\s*[0-9]/i)?.[0] || "");
    const hasAuctionCue = /current bid|\\bbids?\\b|place bid|enter bid/i.test(text);
    const hasBinCue = /buy it now/i.test(text);
    let listingKind = "unknown";
    if (hasAuctionCue) listingKind = "auction";
    else if (hasBinCue) listingKind = "bin";

    const parseEndsAtMs = () => {
      const raw = String(text || "");
      const lowerFull = raw.toLowerCase();
      const head = lowerFull.search(/\\bends?\\s+in\\b|\\btime\\s+left\\b/);
      if (head < 0) return null;
      const slice = lowerFull.slice(head, head + 220);
      const day = Number.parseInt((slice.match(/(\\d+)\\s*(d|day|days)\\b/) || [])[1] || "", 10);
      const hour = Number.parseInt((slice.match(/(\\d+)\\s*(h|hr|hour|hours)\\b/) || [])[1] || "", 10);
      const min = Number.parseInt((slice.match(/(\\d+)\\s*(m|min|mins|minute|minutes)\\b/) || [])[1] || "", 10);
      const sec = Number.parseInt((slice.match(/(\\d+)\\s*(s|sec|secs|second|seconds)\\b/) || [])[1] || "", 10);
      if (!Number.isFinite(day) && !Number.isFinite(hour) && !Number.isFinite(min) && !Number.isFinite(sec))
        return null;
      const ms =
        (Number.isFinite(day) ? day : 0) * 86400000 +
        (Number.isFinite(hour) ? hour : 0) * 3600000 +
        (Number.isFinite(min) ? min : 0) * 60000 +
        (Number.isFinite(sec) ? sec : 0) * 1000;
      if (!Number.isFinite(ms) || ms <= 0) return null;
      const maxMs = 35 * 86400000;
      if (ms > maxMs) return null;
      return Date.now() + ms;
    };
    const endsAtMs = parseEndsAtMs();

    const h1 =
      document.querySelector("h1#x-item-title-label, h1.x-item-title__main, h1.it-ttl, [data-testid='x-item-title'], h1") ||
      null;
    const title = (h1?.textContent || document.title || "").replace(/\\s+/g, " ").trim().slice(0, 240);
    const img =
      document.querySelector("#icImg") ||
      document.querySelector(".ux-image-magnify img") ||
      document.querySelector(".ux-image-carousel-item img");
    const imageUrl = String(img?.src || img?.getAttribute("data-src") || "").trim().slice(0, 2000) || null;

    const parseOk = endsAtMs != null || curBid != null || binPrice != null;
    return {
      ok: true,
      currentBid: curBid,
      buyItNow: binPrice,
      endsAtMs,
      title: title || null,
      imageUrl,
      listingKind,
      parseOk,
    };
  } catch (e) {
    return {
      ok: false,
      reason: "js-error",
      error: e && e.message ? e.message : String(e),
    };
  }
})()`;
}

/** Strip: tabs row + URL row (see tab-strip.html). */
const TAB_BAR_BASE_HEIGHT = 74;
/** Extra height when the capture / quick-fetch chrome row is visible. */
const CAPTURE_CHROME_EXTRA_HEIGHT = 36;

class RawEngineTabbedBrowser {
  constructor({ session, getApiBaseUrl, getExtToken, getAppToken }) {
    this.session = session;
    this.getApiBaseUrl = getApiBaseUrl;
    this.getExtToken = getExtToken;
    this.getAppToken = getAppToken;
    this.tabBarHeight = TAB_BAR_BASE_HEIGHT;
    this.hostWindow = null;
    this.stripView = null;
    this.tabs = [];
    this.activeTabId = null;
    this.nextId = 1;
    this.captureMode = "default";
    this.captureDiagnosticsEnabled = false;
    /** Mirrors main-process allowDevTools (false in packaged builds unless opted in). */
    this._devtoolsEnabled = false;
    this._ipcRegistered = false;
    this._mounted = false;
    /** @type {Promise<void> | null} */
    this._initialMountPromise = null;
    /** @type {BrowserWindow | null} */
    this._screenshotEditor = null;
  }

  setCaptureDiagnosticsEnabled(enabled) {
    this.captureDiagnosticsEnabled = Boolean(enabled);
  }

  openGoogleAuthExternal(url, reason) {
    const normalized = normalizeHttpUrl(url);
    if (!normalized || !isGoogleAuthUrl(normalized)) return false;
    appendCaptureLog({
      scope: "browser-auth",
      level: "info",
      message: "opening Google auth in system browser",
      detail: { reason: reason || "google-auth", url: normalized },
    });
    shell.openExternal(normalized).catch((err) => {
      appendCaptureLog({
        scope: "browser-auth",
        level: "error",
        message: "failed to open Google auth externally",
        detail: {
          reason: reason || "google-auth",
          url: normalized,
          error: String(err?.message || err),
        },
      });
    });
    return true;
  }

  async checkEbaySessionStatus() {
    const existing = this.tabs.find((t) => {
      if (!t || t.kind === "app" || t.locked) return false;
      try {
        const u = new URL(t.view.webContents.getURL() || t.url || "");
        return /(^|\.)ebay\.com$/i.test(u.hostname);
      } catch {
        return false;
      }
    });

    if (existing?.view?.webContents && !existing.view.webContents.isDestroyed()) {
      try {
        const result = await existing.view.webContents.executeJavaScript(buildEbaySessionProbeJs(), true);
        if (result && typeof result === "object") {
          return { ...result, source: "tab", tabId: existing.id };
        }
      } catch {
        /* fall back to hidden probe */
      }
    }

    const probeWindow = new BrowserWindow({
      show: false,
      width: 900,
      height: 700,
      webPreferences: {
        session: this.session,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        devTools: this._devtoolsEnabled,
      },
    });

    try {
      await new Promise((resolve) => {
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        const timer = setTimeout(done, 12000);
        probeWindow.webContents.once("did-finish-load", () => {
          clearTimeout(timer);
          setTimeout(done, 800);
        });
        probeWindow.webContents.once("did-fail-load", () => {
          clearTimeout(timer);
          done();
        });
        probeWindow.loadURL("https://www.ebay.com/").catch(() => {
          clearTimeout(timer);
          done();
        });
      });
      const result = await probeWindow.webContents.executeJavaScript(buildEbaySessionProbeJs(), true);
      if (result && typeof result === "object") return { ...result, source: "hidden" };
      return { ok: false, status: "unknown", source: "hidden", error: "unexpected-result" };
    } catch (err) {
      return {
        ok: false,
        status: "unknown",
        source: "hidden",
        error: String(err?.message || err),
      };
    } finally {
      try {
        if (!probeWindow.isDestroyed()) probeWindow.close();
      } catch {
        /* ignore */
      }
    }
  }

  async clearEbaySession() {
    const cookieUrls = [
      "https://www.ebay.com/",
      "https://signin.ebay.com/",
      "https://m.ebay.com/",
      "https://pages.ebay.com/",
    ];
    const cookies = await this.session.cookies.get({}).catch(() => []);
    let removedCookies = 0;
    for (const cookie of cookies) {
      const domain = String(cookie.domain || "").replace(/^\./, "").toLowerCase();
      if (!domain.endsWith("ebay.com")) continue;
      const pathPart = String(cookie.path || "/");
      for (const baseUrl of cookieUrls) {
        try {
          const u = new URL(baseUrl);
          u.pathname = pathPart.startsWith("/") ? pathPart : `/${pathPart}`;
          await this.session.cookies.remove(u.toString(), cookie.name);
          removedCookies += 1;
          break;
        } catch {
          /* try next URL */
        }
      }
    }

    const dataTypes = ["cache", "indexedDB", "localStorage", "serviceWorkers", "webSQL"];
    const origins = ["https://www.ebay.com", "https://signin.ebay.com", "https://m.ebay.com"];
    try {
      await this.session.clearData({ origins, dataTypes });
    } catch (err) {
      appendCaptureLog({
        scope: "browser-auth",
        level: "warn",
        message: "targeted eBay storage clear failed",
        detail: { error: String(err?.message || err) },
      });
    }
    return { ok: true, removedCookies };
  }

  async ebayOrganicNavigateByTabId(tabId, targetUrl, rawOpts = {}) {
    const deadline =
      Date.now() + (Number(rawOpts.timeoutMs) > 0 ? Number(rawOpts.timeoutMs) : 85000);
    const allowDirectFallback = rawOpts.allowDirectFallback !== false;
    const n = Number(tabId);
    const tab = this.tabs.find((t) => t.id === n);
    if (!tab || tab.kind === "app" || tab.locked) {
      return { ok: false, error: "invalid_tab" };
    }
    const wc = tab.view.webContents;
    try {
      if (wc.isDestroyed()) return { ok: false, error: "webcontents_destroyed" };
    } catch {
      return { ok: false, error: "webcontents_destroyed" };
    }
    const m = await getExtractModule();
    const wantNkw = ebayNkwFromUrlString(String(targetUrl || ""));
    if (!wantNkw) {
      appendCaptureLog({
        scope: "ebay-organic",
        level: "error",
        message: "bad target nkw",
        detail: { tabId: n },
      });
      return { ok: false, error: "invalid_target_nkw" };
    }
    let query;
    try {
      query = decodeURIComponent(wantNkw).replace(/\+/g, " ").trim();
    } catch {
      query = String(wantNkw).replace(/\+/g, " ").trim();
    }

    const normNkw = (s) => {
      try {
        return decodeURIComponent(String(s || "").replace(/\+/g, "%20"))
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();
      } catch {
        return String(s || "")
          .replace(/\+/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();
      }
    };
    const wantNorm = normNkw(wantNkw);

    const runFallback = async (reason) => {
      appendCaptureLog({
        scope: "ebay-organic",
        level: "warn",
        message: "direct URL fallback",
        detail: { tabId: n, reason },
      });
      try {
        wc.loadURL(String(targetUrl));
        await attachWaitForNextDocumentLifecycle(wc, {
          idleFallbackMs: 22000,
          hardTimeoutMs: 55000,
          settleMs: 700,
        });
        await waitUntilQuietForCapture(wc, {
          stableMs: 1200,
          maxQuietWaitMs: 16000,
          maxTotalMs: 60000,
        });
        return { ok: true, fellBack: true };
      } catch (e) {
        return { ok: false, error: String(e?.message || e), fellBack: true };
      }
    };

    appendCaptureLog({
      scope: "ebay-organic",
      level: "info",
      message: "organic navigation start",
      detail: { tabId: n, queryLen: query.length },
    });

    try {
      wc.loadURL("https://www.ebay.com/");
      await attachWaitForNextDocumentLifecycle(wc, {
        idleFallbackMs: 20000,
        hardTimeoutMs: 50000,
        settleMs: 600,
      });
      await waitUntilQuietForCapture(wc, {
        stableMs: 900,
        maxQuietWaitMs: 14000,
        maxTotalMs: 35000,
      });
    } catch (e) {
      appendCaptureLog({
        scope: "ebay-organic",
        level: "error",
        message: "ebay.com load failed",
        detail: { error: String(e?.message || e) },
      });
      if (allowDirectFallback) return await runFallback("home_load_failed");
      return { ok: false, error: String(e?.message || e) };
    }

    if (typeof m.ebayOrganicTypeSearchQuery !== "function") {
      if (allowDirectFallback) return await runFallback("missing_ebayOrganicTypeSearchQuery");
      return { ok: false, error: "missing_extract_export" };
    }

    let typeRes;
    try {
      typeRes = await injectSmallPrepScript(
        wc,
        m.ebayOrganicTypeSearchQuery,
        { query },
        "eBay organic type-search"
      );
    } catch (e) {
      appendCaptureLog({
        scope: "ebay-organic",
        level: "warn",
        message: "type-search inject threw",
        detail: { error: String(e?.message || e) },
      });
      if (allowDirectFallback) return await runFallback("type_inject_threw");
      return { ok: false, error: String(e?.message || e) };
    }
    if (!typeRes || typeRes.ok !== true) {
      appendCaptureLog({
        scope: "ebay-organic",
        level: "warn",
        message: "type-search did not complete",
        detail: { typeRes },
      });
      if (allowDirectFallback) return await runFallback("type_search_failed");
      return { ok: false, error: "type_search_failed", detail: typeRes };
    }

    let matchedSrp = false;
    while (Date.now() < deadline) {
      let url = "";
      try {
        url = wc.getURL();
      } catch {
        url = "";
      }
      const got = ebayNkwFromUrlString(url);
      if (got && normNkw(got) === wantNorm && /\/sch\//i.test(url)) {
        matchedSrp = true;
        break;
      }
      await delay(280);
    }
    if (!matchedSrp) {
      appendCaptureLog({
        scope: "ebay-organic",
        level: "warn",
        message: "timeout waiting for SERP _nkw",
        detail: { wantNorm },
      });
      if (allowDirectFallback) return await runFallback("serp_nkw_timeout");
      return { ok: false, error: "serp_nkw_timeout" };
    }

    if (typeof m.ebayOrganicMergeSoldTargetUrl !== "function") {
      if (allowDirectFallback) return await runFallback("missing_merge_fn");
      return { ok: false, error: "missing_merge_export" };
    }

    let mergeRes;
    try {
      mergeRes = await injectSmallPrepScript(
        wc,
        m.ebayOrganicMergeSoldTargetUrl,
        { targetUrl: String(targetUrl) },
        "eBay organic merge sold URL"
      );
    } catch (e) {
      if (allowDirectFallback) return await runFallback("merge_threw");
      return { ok: false, error: String(e?.message || e) };
    }
    if (!mergeRes || mergeRes.ok !== true) {
      appendCaptureLog({
        scope: "ebay-organic",
        level: "warn",
        message: "merge sold URL failed",
        detail: { mergeRes },
      });
      if (allowDirectFallback) return await runFallback("merge_failed");
      return { ok: false, error: "merge_failed", detail: mergeRes };
    }

    if (mergeRes.navigated === true) {
      await attachWaitForNextDocumentLifecycle(wc, {
        idleFallbackMs: 22000,
        hardTimeoutMs: 55000,
        settleMs: 700,
      });
      await waitUntilQuietForCapture(wc, {
        stableMs: 1200,
        maxQuietWaitMs: 18000,
        maxTotalMs: 60000,
      });
    } else {
      await delay(400);
      await waitUntilQuietForCapture(wc, {
        stableMs: 800,
        maxQuietWaitMs: 8000,
        maxTotalMs: 14000,
      });
    }

    appendCaptureLog({
      scope: "ebay-organic",
      level: "info",
      message: "organic navigation done",
      detail: { tabId: n },
    });
    return { ok: true, fellBack: false };
  }

  registerIpc() {
    if (this._ipcRegistered) return;
    this._ipcRegistered = true;

    ipcMain.handle("rawengine-browser:back-active", async () => {
      this.backActive();
      return true;
    });
    ipcMain.handle("rawengine-browser:forward-active", async () => {
      this.forwardActive();
      return true;
    });
    ipcMain.handle("rawengine-browser:reload-active", async () => {
      this.reloadActive();
      return true;
    });
    ipcMain.handle("rawengine-browser:force-reload-active", async () => {
      this.forceReloadActive();
      return true;
    });

    ipcMain.handle("rawengine-browser:new-tab", async (_e, url) => {
      const u = String(url || "").trim();
      if (u && this.openGoogleAuthExternal(u, "new-tab")) {
        return { ok: true, id: null, external: true };
      }
      const id = this.addTab(u || "https://www.pricecharting.com/");
      return id != null ? { ok: true, id } : { ok: false, id: null };
    });
    ipcMain.handle("rawengine-browser:activate", async (_e, id) => {
      const n = Number(id);
      const tab = this.tabs.find((t) => t.id === n);
      if (!tab) return false;
      this.activeTabId = n;
      this.layout();
      this.broadcastTabs();
      try {
        tab.view.webContents.focus();
      } catch {
        // ignore
      }
      return true;
    });
    ipcMain.handle("rawengine-browser:close-tab", async (_e, id) => {
      this.closeTabById(Number(id));
      return true;
    });
    ipcMain.handle("rawengine-browser:list", async () => this.serializeTabs());
    ipcMain.handle("rawengine-browser:reload-tab", async (_e, id) =>
      this.reloadTabById(Number(id))
    );
    ipcMain.handle("rawengine-browser:open-url", async (_e, url) => {
      const u = String(url || "").trim();
      if (!u) return false;
      if (this.openGoogleAuthExternal(u, "address-bar")) return true;
      this.openUrlInActive(u);
      return true;
    });
    ipcMain.handle("rawengine-browser:open-or-focus-url", async (_e, url) => {
      const u = String(url || "").trim();
      if (!u) return { ok: false, id: null, reused: false };
      if (this.openGoogleAuthExternal(u, "open-or-focus")) {
        return { ok: true, id: null, reused: false, external: true };
      }
      const out = this.openOrFocusUrl(u);
      return {
        ok: out.id != null,
        id: out.id ?? null,
        reused: out.reused === true,
      };
    });
    ipcMain.handle("rawengine-browser:ebay-session-status", async () =>
      this.checkEbaySessionStatus()
    );
    ipcMain.handle("rawengine-browser:clear-ebay-session", async () =>
      this.clearEbaySession()
    );
    ipcMain.handle("rawengine-browser:ebay-organic-navigate", async (_e, payload) => {
      const tabId = Number(payload?.tabId || 0);
      const targetUrl = String(payload?.targetUrl || "").trim();
      const allowDirectFallback = payload?.allowDirectFallback !== false;
      const timeoutMs = Number(payload?.timeoutMs);
      return this.ebayOrganicNavigateByTabId(tabId, targetUrl, {
        allowDirectFallback,
        timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : undefined,
      });
    });

    ipcMain.handle("rawengine-capture-chrome:publish", async (event, raw) => {
      let senderOk = false;
      try {
        senderOk = this.tabs.some(
          (t) => t.kind === "app" && t.view?.webContents?.id === event.sender.id
        );
      } catch {
        senderOk = false;
      }
      if (!senderOk) return { ok: false, reason: "forbidden" };
      const stageRaw = typeof raw?.stage === "string" ? raw.stage : "";
      const stage =
        stageRaw === "refreshing" || stageRaw === "capturing" || stageRaw === "idle"
          ? stageRaw
          : raw?.active === true
            ? "capturing"
            : "idle";
      const payload =
        raw && typeof raw === "object"
          ? {
              active: raw.active === true,
              pct:
                typeof raw.pct === "number" && Number.isFinite(raw.pct)
                  ? Math.min(100, Math.max(0, raw.pct))
                  : null,
              phase: typeof raw.phase === "string" ? raw.phase : "",
              target: typeof raw.target === "string" ? raw.target : "",
              stage,
            }
          : { active: false, pct: null, phase: "", target: "", stage: "idle" };
      this.publishCaptureChrome(payload);
      return { ok: true };
    });

    ipcMain.handle("rawengine:focus-portfolio-window", async () => {
      return { ok: this.focusPortfolioWindow() };
    });

    ipcMain.handle("rawengine-capture-chrome:cancel-from-strip", async (event) => {
      try {
        if (!this.stripView || event.sender.id !== this.stripView.webContents.id) {
          return { ok: false, reason: "forbidden" };
        }
      } catch {
        return { ok: false, reason: "forbidden" };
      }
      const appTab = this.tabs.find((t) => t.kind === "app");
      if (appTab) {
        try {
          appTab.view.webContents.send("rawengine-app:cancel-quick-fetch");
        } catch {
          /* ignore */
        }
      }
      return { ok: true };
    });

    ipcMain.handle("rawengine-browser:capture-tab", async (_e, payload) => {
      const tabId = Number(payload?.tabId || 0);
      const mode = payload?.mode === "deep" ? "deep" : "default";
      const options = payload?.options && typeof payload.options === "object" ? payload.options : {};
      return this.captureTabById(tabId, { mode, options });
    });

    ipcMain.handle("rawengine-browser:screenshot-start", async (_e, payload) => {
      const m = String(payload?.mode || "viewport").toLowerCase();
      const mode =
        m === "choose"
          ? "choose"
          : m === "fullpage" || m === "full"
            ? "fullpage"
            : m === "region"
              ? "region"
              : "viewport";
      try {
        if (mode === "choose") {
          const parent =
            this.hostWindow && !this.hostWindow.isDestroyed() ? this.hostWindow : undefined;
          const { response } = await dialog.showMessageBox(parent, {
            type: "question",
            buttons: ["Full page", "Select area (scroll + drag)", "Cancel"],
            defaultId: 0,
            cancelId: 2,
            title: "Screenshot",
            message: "Choose screenshot type:",
            noLink: true,
          });
          if (response === 2) return { ok: false, cancelled: true };
          const chosen = response === 0 ? "fullpage" : "region";
          return await this.startScreenshot(chosen);
        }
        return await this.startScreenshot(mode);
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    });

    ipcMain.handle("screenshot-editor:save-png", async (event, dataUrl) => {
      const parent = BrowserWindow.fromWebContents(event.sender) || this.hostWindow;
      const raw = String(dataUrl || "");
      if (raw.length > 60_000_000) {
        return { ok: false, error: "Image too large." };
      }
      const m = /^data:image\/png;base64,(.+)$/i.exec(raw.replace(/\s/g, ""));
      if (!m) {
        return { ok: false, error: "Expected a PNG data URL." };
      }
      const { canceled, filePath } = await dialog.showSaveDialog(parent && !parent.isDestroyed() ? parent : undefined, {
        title: "Save screenshot",
        defaultPath: "RawInvestor-screenshot.png",
        filters: [{ name: "PNG", extensions: ["png"] }],
      });
      if (canceled || !filePath) return { ok: false, cancelled: true };
      try {
        await fs.writeFile(filePath, Buffer.from(m[1], "base64"));
        return { ok: true, filePath };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    });

    ipcMain.handle("screenshot-editor:copy-png", async (_event, dataUrl) => {
      const raw = String(dataUrl || "");
      if (raw.length > 60_000_000) {
        return { ok: false, error: "Image too large." };
      }
      const m = /^data:image\/png;base64,(.+)$/i.exec(raw.replace(/\s/g, ""));
      if (!m) {
        return { ok: false, error: "Expected a PNG data URL." };
      }
      try {
        const img = nativeImage.createFromBuffer(Buffer.from(m[1], "base64"));
        if (img.isEmpty()) {
          return { ok: false, error: "Could not decode image." };
        }
        clipboard.writeImage(img);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    });

    ipcMain.handle("rawengine-browser:sniper-click", async (_e, payload) => {
      const tabId = Number(payload?.tabId || 0);
      const maxBidUsd = Number(payload?.maxBidUsd || 0);
      const maxBinUsd = Number(
        payload?.maxBinUsd != null && payload.maxBinUsd !== "" ? payload.maxBinUsd : maxBidUsd
      );
      const tab = this.tabs.find((t) => t.id === tabId);
      if (!tab) return { ok: false, reason: "tab-not-found" };
      if (tab.kind === "app" || tab.locked) return { ok: false, reason: "tab-not-clickable" };

      try {
        const code = buildEbaySniperExecuteJs(maxBidUsd, maxBinUsd);
        const result = await tab.view.webContents.executeJavaScript(code, true);
        if (result && typeof result === "object") return result;
        return { ok: false, reason: "unexpected-result" };
      } catch (err) {
        return { ok: false, reason: "sniper-exec-failed", error: String(err?.message || err) };
      }
    });

    ipcMain.handle("rawengine-browser:ebay-listing-probe", async (_e, payload) => {
      return this.runEbayListingProbe(Number(payload?.tabId || 0));
    });
  }

  serializeTabs() {
    const detectSiteKey = (rawUrl, kind) => {
      if (kind === "app") return "raw-investor";
      try {
        const u = new URL(String(rawUrl || ""));
        const host = u.hostname.toLowerCase().replace(/^www\./, "");
        if (host === "pricecharting.com") return "pricecharting";
        if (host === "tcgplayer.com") return "tcgplayer";
        if (host === "ebay.com" || host === "m.ebay.com") return "ebay";
        return "other";
      } catch {
        return "other";
      }
    };
    return this.tabs.map((t) => {
      let loading = false;
      try {
        loading = Boolean(t.view?.webContents?.isLoading?.());
      } catch {
        loading = false;
      }
      return {
        id: t.id,
        title: t.title,
        url: t.url,
        active: t.id === this.activeTabId,
        locked: Boolean(t.locked),
        loading,
        siteKey: detectSiteKey(t.url, t.kind),
        kind: t.kind,
      };
    });
  }

  broadcastTabs() {
    if (!this.stripView || this.stripView.webContents.isDestroyed()) return;
    try {
      this.stripView.webContents.send(
        "rawengine-browser:tabs-updated",
        this.serializeTabs()
      );
    } catch {
      // ignore
    }
  }

  /**
   * @param {{ active: boolean, pct: number | null, phase: string, target: string }} payload
   */
  publishCaptureChrome(payload) {
    const active = Boolean(payload?.active);
    const nextTop = active
      ? TAB_BAR_BASE_HEIGHT + CAPTURE_CHROME_EXTRA_HEIGHT
      : TAB_BAR_BASE_HEIGHT;
    if (this.tabBarHeight !== nextTop) {
      this.tabBarHeight = nextTop;
      this.layout();
    }
    if (!this.stripView || this.stripView.webContents.isDestroyed()) return;
    try {
      this.stripView.webContents.send("rawengine-tab-strip:capture-chrome", {
        active,
        pct: payload?.pct ?? null,
        phase: String(payload?.phase || ""),
        target: String(payload?.target || ""),
        stage: String(payload?.stage || (active ? "capturing" : "idle")),
      });
    } catch {
      /* ignore */
    }
  }

  teardownHostWindow() {
    if (this.hostWindow && !this.hostWindow.isDestroyed()) {
      for (const t of this.tabs) {
        safeRemoveBrowserView(this.hostWindow, t.view);
        try {
          t.view.webContents.close();
        } catch {
          // ignore
        }
      }
      safeRemoveBrowserView(this.hostWindow, this.stripView);
      try {
        this.stripView?.webContents?.close();
      } catch {
        // ignore
      }
    }
    this.tabs = [];
    this.activeTabId = null;
    this.hostWindow = null;
    this.stripView = null;
    this._initialMountPromise = null;
    this._mounted = false;
    this._devtoolsEnabled = false;
    this.nextId = 1;
    this.captureMode = "default";
    this.tabBarHeight = TAB_BAR_BASE_HEIGHT;
  }

  /**
   * Mount tab strip + Raw Investor as first tab on the main BrowserWindow (no second window).
   * Resolves when the tab strip and dashboard webContents have finished loading (or rejects on failure / timeout).
   * @returns {Promise<void>}
   */
  mountMainWindow(win, opts) {
    if (this._mounted) {
      console.warn("[rawengine] mountMainWindow: already mounted");
      return this._initialMountPromise || Promise.resolve();
    }
    this._mounted = true;
    this.hostWindow = win;
    this._devtoolsEnabled = Boolean(opts.allowDevTools);

    const refitLayout = () => {
      try {
        this.layout();
      } catch {
        /* ignore */
      }
    };
    if (win.isVisible()) {
      setImmediate(refitLayout);
    } else {
      win.once("show", refitLayout);
    }

    win.on("resize", () => this.layout());
    win.once("closed", () => {
      this.teardownHostWindow();
    });

    this.stripView = new BrowserView({
      webPreferences: {
        preload: path.join(__dirname, "tab-strip-preload.cjs"),
        session: this.session,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        devTools: this._devtoolsEnabled,
      },
    });

    const appView = new BrowserView({
      webPreferences: {
        preload: opts.preloadPath,
        session: this.session,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        devTools: this._devtoolsEnabled,
      },
    });

    const id = this.nextId++;
    const appTab = {
      id,
      view: appView,
      title: "Raw Investor",
      url: opts.isDev ? opts.rendererUrl : opts.prodIndexPath,
      locked: true,
      kind: "app",
    };

    const wc = appView.webContents;
    wc.setWindowOpenHandler(({ url: nextUrl }) => {
      if (nextUrl && !this.openGoogleAuthExternal(nextUrl, "app-popup")) {
        this.addTab(nextUrl);
      }
      return { action: "deny" };
    });
    wc.on("will-navigate", (event, url) => {
      if (!url) return;
      const devBase = String(opts.rendererUrl || "").replace(/\/$/, "");
      const isLocal =
        url.startsWith("file://") ||
        (devBase && url.startsWith(devBase)) ||
        /^https?:\/\/(localhost|127\.0\.0\.1):5173\b/i.test(url);
      if (isLocal) return;
      event.preventDefault();
      if (this.openGoogleAuthExternal(url, "app-navigation")) return;
      this.addTab(url);
    });

    this.tabs.push(appTab);
    this.activeTabId = id;
    this.layout();
    this.broadcastTabs();

    const stripWc = this.stripView.webContents;
    const STRIP_READY_MS = 30000;
    const APP_READY_MS = opts.isDev ? 120000 : 180000;

    const stripReady = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        stripWc.removeAllListeners("did-finish-load");
        stripWc.removeAllListeners("did-fail-load");
        reject(new Error(`tab-strip: load exceeded ${STRIP_READY_MS}ms`));
      }, STRIP_READY_MS);
      const cleanup = () => {
        clearTimeout(timer);
        stripWc.removeListener("did-finish-load", onDone);
        stripWc.removeListener("did-fail-load", onFail);
      };
      const onDone = () => {
        cleanup();
        try {
          this.layout();
          this.broadcastTabs();
        } catch {
          /* ignore */
        }
        resolve();
      };
      const onFail = (_e, code, desc, url, mainFrame) => {
        if (!mainFrame) return;
        cleanup();
        reject(new Error(`tab-strip: ${desc || "load failed"} (${code}) ${url || ""}`));
      };
      stripWc.once("did-finish-load", onDone);
      stripWc.once("did-fail-load", onFail);
      stripWc.loadFile(path.join(__dirname, "tab-strip.html"));
    });

    const appReady = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        wc.removeAllListeners("did-finish-load");
        wc.removeAllListeners("did-fail-load");
        reject(new Error(`dashboard: load exceeded ${APP_READY_MS}ms`));
      }, APP_READY_MS);
      const cleanup = () => {
        clearTimeout(timer);
        wc.removeListener("did-finish-load", onOk);
        wc.removeListener("did-fail-load", onFail);
      };
      const onOk = () => {
        cleanup();
        try {
          if (win && !win.isDestroyed()) {
            win.show();
            win.focus();
          }
        } catch {
          /* ignore */
        }
        try {
          refitLayout();
        } catch {
          /* ignore */
        }
        resolve();
      };
      const onFail = (_e, code, desc, url, mainFrame) => {
        if (!mainFrame) return;
        cleanup();
        const detail = `${desc || "Unknown error"} (code ${code})\n\n${String(url || opts.prodIndexPath || opts.rendererUrl || "")}`;
        console.error("[rawengine] main UI failed to load", { code, desc, url });
        try {
          if (win && !win.isDestroyed()) {
            dialog.showMessageBox(win, {
              type: "error",
              title: "Raw Investor",
              message: "The main window could not load.",
              detail,
            });
          }
        } catch {
          /* ignore */
        }
        reject(new Error(`dashboard: ${detail}`));
      };
      wc.once("did-finish-load", onOk);
      wc.once("did-fail-load", onFail);
      if (opts.isDev) {
        wc.loadURL(opts.rendererUrl);
      } else {
        wc.loadFile(opts.prodIndexPath);
      }
    });

    this._initialMountPromise = Promise.all([stripReady, appReady])
      .then(() => {
        this.layout();
        this.broadcastTabs();
        try {
          wc.focus();
        } catch {
          // ignore
        }
      })
      .catch((err) => {
        try {
          this.teardownHostWindow();
        } catch {
          /* ignore */
        }
        throw err;
      });

    return this._initialMountPromise;
  }

  addTab(url, opts = {}) {
    if (!this.hostWindow || this.hostWindow.isDestroyed()) {
      console.warn("[rawengine] addTab: no host window");
      return null;
    }
    const safeUrl = normalizeHttpUrl(url);
    if (!safeUrl) return null;
    if (!opts.allowGoogleAuthEmbedded && this.openGoogleAuthExternal(safeUrl, "add-tab")) {
      return null;
    }

    const view = new BrowserView({
      webPreferences: {
        session: this.session,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        devTools: this._devtoolsEnabled,
      },
    });

    const id = this.nextId++;
    const tab = { id, view, title: "Loading…", url: safeUrl, locked: false, kind: "web" };
    const wc = view.webContents;

    wc.on("page-title-updated", (_e, title) => {
      tab.title = title;
      this.broadcastTabs();
    });
    wc.on("did-navigate", (_e, u) => {
      tab.url = u;
      this.broadcastTabs();
    });
    wc.on("did-navigate-in-page", (_e, u) => {
      tab.url = u;
      this.broadcastTabs();
    });
    wc.setWindowOpenHandler(({ url: nextUrl }) => {
      if (nextUrl) {
        this.addTab(nextUrl, { allowGoogleAuthEmbedded: true });
      }
      return { action: "deny" };
    });
    wc.on("focus", () => {
      this.activeTabId = id;
      this.broadcastTabs();
    });

    this.tabs.push(tab);
    this.activeTabId = id;

    try {
      this.hostWindow.show();
      this.hostWindow.focus();
    } catch {
      // ignore
    }

    wc.loadURL(safeUrl);
    this.layout();
    this.broadcastTabs();
    try {
      wc.focus();
    } catch {
      // ignore
    }
    return id;
  }

  /** Open a web tab without focusing the host window (Arsenal background watch). */
  addTabQuiet(url, opts = {}) {
    if (!this.hostWindow || this.hostWindow.isDestroyed()) {
      console.warn("[rawengine] addTabQuiet: no host window");
      return null;
    }
    const safeUrl = normalizeHttpUrl(url);
    if (!safeUrl) return null;
    if (!opts.allowGoogleAuthEmbedded && this.openGoogleAuthExternal(safeUrl, "add-tab-quiet")) {
      return null;
    }

    const view = new BrowserView({
      webPreferences: {
        session: this.session,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        devTools: this._devtoolsEnabled,
      },
    });

    const id = this.nextId++;
    const tab = { id, view, title: "Loading…", url: safeUrl, locked: false, kind: "web" };
    const wc = view.webContents;

    wc.on("page-title-updated", (_e, title) => {
      tab.title = title;
      this.broadcastTabs();
    });
    wc.on("did-navigate", (_e, u) => {
      tab.url = u;
      this.broadcastTabs();
    });
    wc.on("did-navigate-in-page", (_e, u) => {
      tab.url = u;
      this.broadcastTabs();
    });
    wc.setWindowOpenHandler(({ url: nextUrl }) => {
      if (nextUrl) {
        this.addTab(nextUrl, { allowGoogleAuthEmbedded: true });
      }
      return { action: "deny" };
    });
    wc.on("focus", () => {
      this.activeTabId = id;
      this.broadcastTabs();
    });

    this.tabs.push(tab);
    this.activeTabId = id;
    wc.loadURL(safeUrl);
    this.layout();
    this.broadcastTabs();
    return id;
  }

  findWebTabByUrl(url) {
    const wanted = normalizeUrlForMatch(url);
    if (!wanted) return null;
    return (
      this.tabs.find((t) => {
        if (!t || t.kind === "app" || t.locked) return false;
        return normalizeUrlForMatch(t.url) === wanted;
      }) || null
    );
  }

  activateTabById(id) {
    const n = Number(id);
    const tab = this.tabs.find((t) => t.id === n);
    if (!tab) return false;
    this.activeTabId = n;
    this.layout();
    this.broadcastTabs();
    try {
      tab.view.webContents.focus();
    } catch {
      // ignore
    }
    return true;
  }

  /** Focus Raw Investor app tab and bring the host window forward. */
  focusPortfolioWindow() {
    const appTab = this.tabs.find((t) => t.kind === "app");
    if (!appTab) return false;
    this.activateTabById(appTab.id);
    try {
      if (this.hostWindow && !this.hostWindow.isDestroyed()) {
        this.hostWindow.show();
        this.hostWindow.focus();
      }
    } catch {
      // ignore
    }
    return true;
  }

  /** Focus Raw Investor app tab and tell renderer to open the in-app User Guide. */
  notifyOpenUserGuide() {
    const appTab = this.tabs.find((t) => t.kind === "app");
    if (!appTab) return false;
    this.activateTabById(appTab.id);
    try {
      appTab.view.webContents.send("rawengine-app:open-user-guide");
    } catch {
      return false;
    }
    try {
      if (this.hostWindow && !this.hostWindow.isDestroyed()) {
        this.hostWindow.show();
        this.hostWindow.focus();
      }
    } catch {
      // ignore
    }
    return true;
  }

  openOrFocusUrl(url) {
    const normalized = normalizeHttpUrl(url);
    if (!normalized) return { id: null, reused: false };
    if (this.openGoogleAuthExternal(normalized, "open-or-focus-method")) {
      return { id: null, reused: false, external: true };
    }
    const existing = this.findWebTabByUrl(normalized);
    if (existing) {
      this.activateTabById(existing.id);
      try {
        this.hostWindow.show();
        this.hostWindow.focus();
      } catch {
        // ignore
      }
      return { id: existing.id, reused: true };
    }
    const id = this.addTab(normalized);
    return { id, reused: false };
  }

  /** Close every embedded web tab (not the main Raw Investor app tab). */
  closeAllWebTabs() {
    const ids = this.tabs.filter((t) => t.kind !== "app").map((t) => t.id);
    for (const id of ids) this.closeTabById(id);
  }

  closeTabById(id) {
    const idx = this.tabs.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const tab = this.tabs[idx];
    if (tab.locked) return;

    safeRemoveBrowserView(this.hostWindow, tab.view);
    try {
      tab.view.webContents.close();
    } catch {
      // ignore
    }
    this.tabs.splice(idx, 1);
    if (this.activeTabId === id) {
      const next = this.tabs[Math.max(0, idx - 1)] || this.tabs[0];
      this.activeTabId = next ? next.id : null;
    }
    this.layout();
    this.broadcastTabs();
  }

  isTabLoading(tabId) {
    const tab = this.tabs.find((t) => t.id === Number(tabId));
    if (!tab?.view?.webContents) return false;
    try {
      return Boolean(tab.view.webContents.isLoading());
    } catch {
      return false;
    }
  }

  async runEbayListingProbe(tabId) {
    const tab = this.tabs.find((t) => t.id === Number(tabId));
    if (!tab) return { ok: false, reason: "tab-not-found" };
    if (tab.kind === "app" || tab.locked) return { ok: false, reason: "tab-not-clickable" };
    try {
      const code = buildEbayListingProbeJs();
      const result = await tab.view.webContents.executeJavaScript(code, true);
      if (result && typeof result === "object") return result;
      return { ok: false, reason: "unexpected-result" };
    } catch (err) {
      return { ok: false, reason: "probe-exec-failed", error: String(err?.message || err) };
    }
  }

  layout() {
    if (!this.hostWindow || this.hostWindow.isDestroyed()) return;
    const [w, h] = this.hostWindow.getContentSize();
    const top = this.tabBarHeight;

    for (const t of this.tabs) {
      safeRemoveBrowserView(this.hostWindow, t.view);
    }
    safeRemoveBrowserView(this.hostWindow, this.stripView);

    const active = this.tabs.find((t) => t.id === this.activeTabId);
    if (active) {
      this.hostWindow.addBrowserView(active.view);
      active.view.setBounds({
        x: 0,
        y: top,
        width: w,
        height: Math.max(0, h - top),
      });
    }

    if (this.stripView && !this.stripView.webContents.isDestroyed()) {
      this.hostWindow.addBrowserView(this.stripView);
      this.stripView.setBounds({ x: 0, y: 0, width: w, height: top });
    }
  }

  openUrl(url) {
    if (!url) return;
    if (this.openGoogleAuthExternal(url, "open-url-method")) return;
    if (!this._mounted) {
      console.warn("[rawengine] openUrl before mount");
      return;
    }
    try {
      this.hostWindow.show();
      this.hostWindow.focus();
    } catch {
      // ignore
    }
    this.addTab(url);
  }

  openUrlInActive(url) {
    const normalized = normalizeHttpUrl(url);
    if (!normalized) return;
    if (this.openGoogleAuthExternal(normalized, "active-tab-url")) return;
    const tab = this.tabs.find((t) => t.id === this.activeTabId);
    if (!tab || tab.kind === "app" || tab.locked) {
      this.addTab(normalized);
      return;
    }
    try {
      tab.view.webContents.loadURL(normalized);
    } catch {
      this.addTab(normalized);
    }
  }

  backActive() {
    const tab = this.tabs.find((t) => t.id === this.activeTabId);
    if (!tab) return;
    if (tab.kind === "app" || tab.locked) return;
    try {
      if (tab.view.webContents.canGoBack()) tab.view.webContents.goBack();
    } catch {
      // ignore
    }
  }

  forwardActive() {
    const tab = this.tabs.find((t) => t.id === this.activeTabId);
    if (!tab) return;
    if (tab.kind === "app" || tab.locked) return;
    try {
      if (tab.view.webContents.canGoForward()) tab.view.webContents.goForward();
    } catch {
      // ignore
    }
  }

  reloadActive() {
    const tab = this.tabs.find((t) => t.id === this.activeTabId);
    if (tab) tab.view.webContents.reload();
  }

  /** Reload a capture/web tab by id (control deck / stalled capture recovery). */
  reloadTabById(id) {
    const n = Number(id);
    const tab = this.tabs.find((t) => t.id === n);
    if (!tab || tab.kind === "app" || tab.locked) return { ok: false };
    try {
      tab.view.webContents.reload();
      return { ok: true, id: n };
    } catch {
      return { ok: false };
    }
  }

  forceReloadActive() {
    const tab = this.tabs.find((t) => t.id === this.activeTabId);
    if (tab) tab.view.webContents.reloadIgnoringCache();
  }

  toggleDevToolsActive() {
    if (!this._devtoolsEnabled) return;
    const tab = this.tabs.find((t) => t.id === this.activeTabId);
    if (!tab) return;
    if (tab.view.webContents.isDevToolsOpened()) tab.view.webContents.closeDevTools();
    else tab.view.webContents.openDevTools({ mode: "detach" });
  }

  zoomResetActive() {
    const tab = this.tabs.find((t) => t.id === this.activeTabId);
    if (tab) tab.view.webContents.setZoomFactor(1);
  }

  zoomInActive() {
    const tab = this.tabs.find((t) => t.id === this.activeTabId);
    if (!tab) return;
    const z = tab.view.webContents.getZoomFactor();
    tab.view.webContents.setZoomFactor(Math.min(Number((z + 0.1).toFixed(2)), 3));
  }

  zoomOutActive() {
    const tab = this.tabs.find((t) => t.id === this.activeTabId);
    if (!tab) return;
    const z = tab.view.webContents.getZoomFactor();
    tab.view.webContents.setZoomFactor(Math.max(Number((z - 0.1).toFixed(2)), 0.25));
  }

  setCaptureMode(mode) {
    this.captureMode = mode === "deep" ? "deep" : "default";
  }

  /**
   * @param {"viewport"|"fullpage"|"region"} mode
   * @returns {Promise<{ ok: boolean, cancelled?: boolean, error?: string }>}
   */
  async startScreenshot(mode) {
    if (!this.hostWindow || this.hostWindow.isDestroyed()) {
      throw new Error("Browser is not ready.");
    }
    const tab = this.tabs.find((t) => t.id === this.activeTabId);
    if (!tab) throw new Error("No active tab.");
    const wc = tab.view.webContents;
    if (wc.isDestroyed()) throw new Error("Tab is closed.");

    /** @type {{ mode: string, dataUrl?: string, slices?: string[], tiles?: { dataUrl: string, dx: number, dy: number }[], width?: number, height?: number }} */
    let payload;
    if (mode === "region") {
      const rect = await this._pickRegionInPage(wc);
      if (!rect) return { ok: false, cancelled: true };
      payload = await this._captureDocumentRect(wc, rect);
    } else if (mode === "fullpage") {
      const bounds = await this._getFullPageDocumentBounds(wc);
      const cdpUrl = await this._captureFullPageCdp(wc, bounds);
      if (cdpUrl) {
        payload = { mode: "single", dataUrl: cdpUrl };
      } else {
        try {
          payload = await this._captureDocumentRect(
            wc,
            { x: 0, y: 0, width: bounds.sw, height: bounds.sh },
            { maxTiles: 900 }
          );
        } catch {
          const slices = await this._captureFullPageSlices(wc);
          if (!slices.length) throw new Error("Could not capture page.");
          payload = { mode: "slices", slices };
        }
      }
    } else {
      const img = await wc.capturePage();
      payload = { mode: "single", dataUrl: img.toDataURL() };
    }

    await this._openScreenshotEditor(this.hostWindow, payload);
    return { ok: true };
  }

  /**
   * Max layout size in CSS px (document + wide scrollers). CDP cssContentSize often matches viewport width.
   * @param {Electron.WebContents} wc
   * @returns {Promise<{ sw: number, sh: number, dpr: number }>}
   */
  async _getFullPageDocumentBounds(wc) {
    const js = `(() => {
      var de = document.documentElement;
      var body = document.body;
      var se = document.scrollingElement || de;
      var sw = Math.max(
        se.scrollWidth || 0,
        de.scrollWidth || 0,
        body ? body.scrollWidth : 0,
        se.offsetWidth || 0,
        de.offsetWidth || 0,
        window.innerWidth || 0
      );
      var sh = Math.max(
        se.scrollHeight || 0,
        de.scrollHeight || 0,
        body ? body.scrollHeight : 0,
        se.offsetHeight || 0,
        de.offsetHeight || 0,
        window.innerHeight || 0
      );
      var nodes = document.querySelectorAll("*");
      var cap = Math.min(nodes.length, 15000);
      var i, el;
      for (i = 0; i < cap; i++) {
        el = nodes[i];
        try {
          if (el.scrollWidth > (el.clientWidth || 0) + 2) sw = Math.max(sw, el.scrollWidth);
          if (el.scrollHeight > (el.clientHeight || 0) + 2) sh = Math.max(sh, el.scrollHeight);
        } catch (e) {}
      }
      var dpr = window.devicePixelRatio && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
      return {
        sw: Math.ceil(Math.max(sw, 1)),
        sh: Math.ceil(Math.max(sh, 1)),
        dpr: dpr,
      };
    })()`;
    try {
      const raw = await wc.executeJavaScript(js, true);
      const sw = raw && Number(raw.sw) ? Math.ceil(raw.sw) : 1280;
      const sh = raw && Number(raw.sh) ? Math.ceil(raw.sh) : 720;
      const dpr = raw && Number(raw.dpr) && raw.dpr > 0 ? Math.min(3, raw.dpr) : 1;
      return { sw: Math.max(1, sw), sh: Math.max(1, sh), dpr };
    } catch {
      return { sw: 1280, sh: 720, dpr: 1 };
    }
  }

  /**
   * Full-page capture via CDP (clip uses max(CDP layout, DOM scroll bounds)).
   * @param {Electron.WebContents} wc
   * @param {{ sw: number, sh: number, dpr: number }} bounds
   * @returns {Promise<string | null>} PNG data URL or null on failure
   */
  async _captureFullPageCdp(wc, bounds) {
    const wasAttached = wc.debugger.isAttached();
    if (!wasAttached) {
      try {
        wc.debugger.attach("1.3");
      } catch {
        return null;
      }
    }
    try {
      await wc.debugger.sendCommand("Page.enable");
      const metrics = await wc.debugger.sendCommand("Page.getLayoutMetrics");
      const css = metrics && metrics.cssContentSize;
      const legacy = metrics && metrics.contentSize;
      let width = css && Number(css.width) ? Math.ceil(css.width) : 0;
      let height = css && Number(css.height) ? Math.ceil(css.height) : 0;
      if (!width || !height) {
        width = legacy && Number(legacy.width) ? Math.ceil(legacy.width) : 0;
        height = legacy && Number(legacy.height) ? Math.ceil(legacy.height) : 0;
      }
      const bsw = bounds && Number(bounds.sw) ? bounds.sw : 0;
      const bsh = bounds && Number(bounds.sh) ? bounds.sh : 0;
      width = Math.ceil(Math.max(width || 0, bsw || 0, 1));
      height = Math.ceil(Math.max(height || 0, bsh || 0, 1));
      const maxDim = 32000;
      width = Math.min(Math.max(1, width), maxDim);
      height = Math.min(Math.max(1, height), maxDim);
      const dpr = bounds && Number(bounds.dpr) ? bounds.dpr : 1;
      const clipScale = Math.min(2, Math.max(1, Number(dpr.toFixed(3)) || 1));
      const clip = { x: 0, y: 0, width, height, scale: clipScale };
      /** @type {{ data?: string } | null} */
      let shot = null;
      try {
        shot = await wc.debugger.sendCommand("Page.captureScreenshot", {
          format: "png",
          captureBeyondViewport: true,
          fromSurface: true,
          clip,
        });
      } catch {
        try {
          shot = await wc.debugger.sendCommand("Page.captureScreenshot", {
            format: "png",
            captureBeyondViewport: true,
            fromSurface: false,
            clip: { x: 0, y: 0, width, height, scale: 1 },
          });
        } catch {
          shot = null;
        }
      }
      if (!shot || typeof shot.data !== "string" || !shot.data.length) return null;
      return `data:image/png;base64,${shot.data}`;
    } catch {
      return null;
    } finally {
      if (!wasAttached && wc.debugger.isAttached()) {
        try {
          wc.debugger.detach();
        } catch {
          /* ignore */
        }
      }
    }
  }

  /**
   * Document-space marquee with edge auto-scroll (Edge-like), returns CSS-pixel rect.
   * @param {Electron.WebContents} wc
   * @returns {Promise<{ x: number, y: number, width: number, height: number } | null>}
   */
  async _pickRegionInPage(wc) {
    const js = `(function () {
      return new Promise(function (resolve) {
        var EDGE = 22;
        var SPEED = 36;
        var ov = document.createElement("div");
        ov.style.cssText =
          "position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(15,23,42,.25)";
        var hint = document.createElement("div");
        hint.textContent = "Drag to select · move to window edge to scroll · Esc = cancel";
        hint.style.cssText =
          "position:fixed;top:10px;left:50%;transform:translateX(-50%);background:#0f172a;color:#f8fafc;padding:8px 14px;border-radius:8px;font:600 13px system-ui,sans-serif;z-index:2147483648;box-shadow:0 4px 20px rgba(0,0,0,.35);max-width:92vw;text-align:center";
        var box = document.createElement("div");
        box.style.cssText =
          "position:fixed;border:2px solid #38bdf8;background:rgba(56,189,248,.12);display:none;z-index:2147483647;pointer-events:none;box-sizing:border-box";
        var dragging = false;
        var anchorX = 0;
        var anchorY = 0;
        var curX = 0;
        var curY = 0;
        function docBounds() {
          var sw = Math.max(
            document.documentElement ? document.documentElement.scrollWidth : 0,
            document.body ? document.body.scrollWidth : 0,
            window.innerWidth || 0
          );
          var sh = Math.max(
            document.documentElement ? document.documentElement.scrollHeight : 0,
            document.body ? document.body.scrollHeight : 0,
            window.innerHeight || 0
          );
          return { sw: sw, sh: sh };
        }
        function syncBox() {
          var dl = Math.min(anchorX, curX);
          var dt = Math.min(anchorY, curY);
          var dw = Math.abs(curX - anchorX);
          var dh = Math.abs(curY - anchorY);
          var b = docBounds();
          dl = Math.max(0, Math.min(dl, b.sw));
          dt = Math.max(0, Math.min(dt, b.sh));
          dw = Math.max(0, Math.min(dw, b.sw - dl));
          dh = Math.max(0, Math.min(dh, b.sh - dt));
          box.style.left = dl - window.scrollX + "px";
          box.style.top = dt - window.scrollY + "px";
          box.style.width = dw + "px";
          box.style.height = dh + "px";
        }
        function cleanup() {
          document.removeEventListener("keydown", onKey, true);
          document.removeEventListener("mousemove", onMove, true);
          document.removeEventListener("mouseup", onUp, true);
          window.removeEventListener("scroll", onScroll, true);
          try {
            ov.remove();
          } catch (e1) {}
          try {
            hint.remove();
          } catch (e2) {}
          try {
            box.remove();
          } catch (e3) {}
        }
        function onKey(e) {
          if (e.key === "Escape") {
            cleanup();
            resolve(null);
          }
        }
        function onScroll() {
          if (dragging) syncBox();
        }
        function onMove(e) {
          if (!dragging) return;
          curX = e.pageX;
          curY = e.pageY;
          var ih = window.innerHeight;
          var iw = window.innerWidth;
          if (e.clientY >= ih - EDGE) window.scrollBy(0, SPEED);
          else if (e.clientY <= EDGE) window.scrollBy(0, -SPEED);
          if (e.clientX >= iw - EDGE) window.scrollBy(SPEED, 0);
          else if (e.clientX <= EDGE) window.scrollBy(-SPEED, 0);
          syncBox();
        }
        function onUp() {
          dragging = false;
          document.removeEventListener("mousemove", onMove, true);
          document.removeEventListener("mouseup", onUp, true);
          var dl = Math.min(anchorX, curX);
          var dt = Math.min(anchorY, curY);
          var dw = Math.abs(curX - anchorX);
          var dh = Math.abs(curY - anchorY);
          var b = docBounds();
          dl = Math.max(0, Math.min(dl, b.sw));
          dt = Math.max(0, Math.min(dt, b.sh));
          dw = Math.max(0, Math.min(dw, b.sw - dl));
          dh = Math.max(0, Math.min(dh, b.sh - dt));
          cleanup();
          if (dw < 4 || dh < 4) resolve(null);
          else
            resolve({
              x: Math.round(dl),
              y: Math.round(dt),
              width: Math.round(dw),
              height: Math.round(dh),
            });
        }
        ov.addEventListener("mousedown", function (e) {
          e.preventDefault();
          dragging = true;
          anchorX = e.pageX;
          anchorY = e.pageY;
          curX = anchorX;
          curY = anchorY;
          box.style.display = "block";
          syncBox();
          document.addEventListener("mousemove", onMove, true);
          document.addEventListener("mouseup", onUp, true);
        });
        document.addEventListener("keydown", onKey, true);
        window.addEventListener("scroll", onScroll, true);
        (document.documentElement || document.body).appendChild(ov);
        (document.documentElement || document.body).appendChild(hint);
        (document.documentElement || document.body).appendChild(box);
      });
    })()`;
    try {
      return await wc.executeJavaScript(js, true);
    } catch {
      return null;
    }
  }

  /**
   * Fallback full-page: scroll-stitch using scrollingElement metrics.
   * @param {Electron.WebContents} wc
   * @returns {Promise<string[]>}
   */
  async _captureFullPageSlices(wc) {
    const info = await wc
      .executeJavaScript(
        `(() => {
        var el = document.scrollingElement || document.documentElement || document.body;
        var vh = Math.max(100, Math.floor(el.clientHeight || window.innerHeight || 600));
        var scrollHeight = Math.max(
          el.scrollHeight || 0,
          document.body ? document.body.scrollHeight : 0,
          document.documentElement ? document.documentElement.scrollHeight : 0,
          vh
        );
        return {
          vh: vh,
          scrollHeight: scrollHeight,
          sx: window.scrollX,
          sy: window.scrollY,
        };
      })()`,
        true
      )
      .catch(() => null);
    if (!info || !Number.isFinite(info.vh) || !Number.isFinite(info.scrollHeight)) {
      const img = await wc.capturePage();
      return [img.toDataURL()];
    }
    const saved = { sx: info.sx || 0, sy: info.sy || 0 };
    const vh = Math.floor(info.vh);
    const scrollHeight = Math.max(Math.floor(info.scrollHeight), vh);
    const slices = [];
    const maxSlices = 80;
    try {
      let y = 0;
      while (y < scrollHeight && slices.length < maxSlices) {
        await wc.executeJavaScript(`window.scrollTo(${saved.sx}, ${y})`, true).catch(() => {});
        await delay(240);
        try {
          await wc.executeJavaScript(
            `new Promise(function(r){requestAnimationFrame(function(){requestAnimationFrame(r);});})`,
            true
          );
        } catch {
          /* ignore */
        }
        await delay(80);
        const shot = await wc.capturePage();
        const size = shot.getSize();
        if (!size.width || !size.height) break;
        slices.push(shot.toDataURL());
        const step = Math.max(1, Math.min(vh, size.height) - 1);
        if (y + step >= scrollHeight) break;
        y += step;
      }
    } finally {
      await wc.executeJavaScript(`window.scrollTo(${saved.sx}, ${saved.sy})`, true).catch(() => {});
    }
    return slices;
  }

  /**
   * Capture a document-space rectangle (tiles when larger than viewport).
   * @param {Electron.WebContents} wc
   * @param {{ x: number, y: number, width: number, height: number }} rect
   * @param {{ maxTiles?: number }} [options]
   * @returns {Promise<{ mode: string, dataUrl?: string, tiles?: { dataUrl: string, dx: number, dy: number }[], width?: number, height?: number }>}
   */
  async _captureDocumentRect(wc, rect, options = {}) {
    const maxTiles = Math.min(2000, Math.max(50, Number(options.maxTiles) || 200));
    const rx = Math.round(rect.x);
    const ry = Math.round(rect.y);
    const rw = Math.round(rect.width);
    const rh = Math.round(rect.height);
    if (rw < 4 || rh < 4) {
      throw new Error("Region too small.");
    }

    const saved = await wc
      .executeJavaScript(
        `({
          sx: window.scrollX,
          sy: window.scrollY,
          vww: document.documentElement.clientWidth || window.innerWidth || 800,
          vhh: document.documentElement.clientHeight || window.innerHeight || 600,
          scrollWidth: Math.max(
            document.scrollingElement ? document.scrollingElement.scrollWidth : 0,
            document.documentElement ? document.documentElement.scrollWidth : 0,
            document.body ? document.body.scrollWidth : 0,
            1
          ),
          scrollHeight: Math.max(
            document.scrollingElement ? document.scrollingElement.scrollHeight : 0,
            document.documentElement ? document.documentElement.scrollHeight : 0,
            document.body ? document.body.scrollHeight : 0,
            1
          )
        })`,
        true
      )
      .catch(() => null);
    if (!saved) {
      throw new Error("Could not read page geometry.");
    }

    const vw = Math.floor(Number(saved.vww) || 800);
    const vh = Math.floor(Number(saved.vhh) || 600);
    const maxScrollX = Math.max(0, Math.floor(Number(saved.scrollWidth) || 1) - vw);
    const maxScrollY = Math.max(0, Math.floor(Number(saved.scrollHeight) || 1) - vh);
    const tiles = [];
    let docY = ry;

    try {
      while (docY < ry + rh && tiles.length < maxTiles) {
        const sy = Math.min(Math.max(0, docY), maxScrollY);
        let docX = rx;
        let progressedX = false;
        while (docX < rx + rw && tiles.length < maxTiles) {
          const sx = Math.min(Math.max(0, docX), maxScrollX);
          await wc.executeJavaScript(`window.scrollTo(${sx},${sy})`, true).catch(() => {});
          await delay(200);
          try {
            await wc.executeJavaScript(
              `new Promise(function(r){requestAnimationFrame(function(){requestAnimationFrame(r);});})`,
              true
            );
          } catch {
            /* ignore */
          }
          await delay(60);
          const snap = await wc
            .executeJavaScript(
              `({
                sx: window.scrollX,
                sy: window.scrollY,
                vw: document.documentElement.clientWidth || window.innerWidth,
                vh: document.documentElement.clientHeight || window.innerHeight
              })`,
              true
            )
            .catch(() => null);
          if (!snap) break;
          const sxx = snap.sx || 0;
          const syy = snap.sy || 0;
          const vwi = Math.floor(snap.vw || vw);
          const vhi = Math.floor(snap.vh || vh);
          const left = Math.max(rx, sxx);
          const top = Math.max(ry, syy);
          const right = Math.min(rx + rw, sxx + vwi);
          const bottom = Math.min(ry + rh, syy + vhi);
          const capW = Math.round(right - left);
          const capH = Math.round(bottom - top);
          if (capW >= 2 && capH >= 2) {
            const capX = Math.round(left - sxx);
            const capY = Math.round(top - syy);
            const img = await wc.capturePage({ x: capX, y: capY, width: capW, height: capH });
            tiles.push({
              dataUrl: img.toDataURL(),
              dx: Math.round(left - rx),
              dy: Math.round(top - ry),
            });
            progressedX = true;
            docX = Math.max(docX + 1, Math.round(right));
          } else {
            docX += Math.max(40, Math.floor(vwi * 0.35));
          }
        }
        const rowBottom = Math.min(ry + rh, sy + vh);
        if (!progressedX && rowBottom <= docY) {
          docY += Math.max(24, Math.floor(vh * 0.35));
        } else {
          docY = rowBottom;
        }
      }
    } finally {
      await wc.executeJavaScript(`window.scrollTo(${saved.sx},${saved.sy})`, true).catch(() => {});
    }

    if (!tiles.length) {
      throw new Error("Could not capture region.");
    }
    if (tiles.length === 1) {
      return { mode: "single", dataUrl: tiles[0].dataUrl };
    }
    return { mode: "tiles", width: rw, height: rh, tiles };
  }

  /**
   * @param {BrowserWindow | null} parent
   * @param {{ mode: string, dataUrl?: string, slices?: string[], tiles?: { dataUrl: string, dx: number, dy: number }[], width?: number, height?: number }} payload
   */
  async _openScreenshotEditor(parent, payload) {
    if (this._screenshotEditor && !this._screenshotEditor.isDestroyed()) {
      try {
        this._screenshotEditor.close();
      } catch {
        // ignore
      }
      this._screenshotEditor = null;
    }
    const win = new BrowserWindow({
      parent: parent && !parent.isDestroyed() ? parent : undefined,
      width: 1100,
      height: 780,
      minWidth: 640,
      minHeight: 480,
      title: "Screenshot — annotate, copy or save",
      backgroundColor: "#0f172a",
      webPreferences: {
        preload: path.join(__dirname, "screenshot-editor-preload.cjs"),
        contextIsolation: true,
        sandbox: true,
      },
    });
    this._screenshotEditor = win;
    const htmlPath = path.join(__dirname, "screenshot-editor.html");
    win.once("closed", () => {
      this._screenshotEditor = null;
    });
    await win.loadFile(htmlPath);
    try {
      win.webContents.send("screenshot-editor:load", payload);
    } catch {
      // ignore
    }
    try {
      win.show();
    } catch {
      // ignore
    }
  }

  async captureTabById(tabId, opts = {}) {
    const n = Number(tabId);
    const tab = this.tabs.find((t) => t.id === n);
    if (!tab) throw new Error("Tab not found.");
    if (tab.kind === "app" || tab.locked) {
      throw new Error("Capture tab must be a web tab.");
    }
    const u = tab.view.webContents.getURL();
    if (!u || u === "about:blank") {
      throw new Error("Load a supported page in this tab first.");
    }
    const mode =
      opts.mode === "deep" || opts.mode === "default" ? opts.mode : this.captureMode;
    const options =
      opts.options && typeof opts.options === "object" ? opts.options : {};
    const expectedCapture =
      options.expectedCapture &&
      typeof options.expectedCapture === "object" &&
      typeof options.expectedCapture.targetUrl === "string" &&
      typeof options.expectedCapture.kind === "string"
        ? options.expectedCapture
        : null;
    if (expectedCapture) {
      const v = verifyExpectedCaptureUrl(u, expectedCapture);
      if (!v.ok) {
        appendCaptureLog({
          scope: "captureTab-verify",
          level: "error",
          message: "URL mismatch before capture",
          detail: { tabId: n, actualUrl: u, targetUrl: expectedCapture.targetUrl, reason: v.reason },
        });
        throw new Error(`Capture tab URL check failed: ${v.reason}`);
      }
      appendCaptureLog({
        scope: "captureTab-verify",
        level: "info",
        message: "URL ok",
        detail: { tabId: n, kind: expectedCapture.kind },
      });
    }
    const apiBase = this.getApiBaseUrl();
    const extTok = this.getExtToken ? this.getExtToken() : "";
    const appTok = this.getAppToken ? this.getAppToken() : "";
    if (shouldPricechartingTabServerSync(u)) {
      return postPricechartingSyncToServer(apiBase, u, extTok, appTok);
    }
    const skipUpload = options.skipUpload === true;
    const extractIn = { ...options };
    delete extractIn.skipUpload;
    delete extractIn.expectedCapture;
    appendCaptureLog({
      scope: "captureTab",
      level: "info",
      message: "capture start",
      detail: {
        tabId: n,
        url: u,
        mode,
        skipUpload,
        optionKeys: Object.keys(extractIn),
      },
    });
    let result;
    try {
      result = await runExtractInWebContents(tab.view.webContents, {
        mode,
        ...extractIn,
      });
    } catch (err) {
      appendCaptureLog({
        scope: "captureTab",
        level: "error",
        message: "capture failed",
        detail: { tabId: n, error: String(err?.message || err) },
      });
      throw err;
    }
    if (!result || result.error) {
      appendCaptureLog({
        scope: "captureTab",
        level: "error",
        message: "capture returned error object",
        detail: { tabId: n, error: result?.error ?? "empty" },
      });
      throw new Error(result?.error || "Capture returned no data.");
    }
    const srcOk = result?.source;
    const rowSummary =
      srcOk === "ebay"
        ? Array.isArray(result?.data?.listings)
          ? result.data.listings.length
          : null
        : srcOk === "tcgplayer"
          ? Array.isArray(result?.data?.latestSalesRows)
            ? result.data.latestSalesRows.length
            : null
          : null;
    appendCaptureLog({
      scope: "captureTab",
      level: "info",
      message: skipUpload ? "capture ok (local echo)" : "capture ok (uploading)",
      detail: { tabId: n, source: srcOk, rowCount: rowSummary, skipUpload },
    });
    if (skipUpload) {
      return formatLocalCaptureEcho(result);
    }
    return postCaptureToServer(apiBase, result, extTok, appTok);
  }

  async captureActiveTab(parentForDialog, opts = {}) {
    const tab = this.tabs.find((t) => t.id === this.activeTabId);
    if (!tab) {
      throw new Error("No active tab.");
    }
    if (tab.kind === "app" || tab.locked) {
      throw new Error(
        "Switch to a capture tab: open TCGPlayer, eBay sold search, or PriceCharting from the Capture menu (or a new tab), then capture."
      );
    }
    const u = tab.view.webContents.getURL();
    if (!u || u === "about:blank") {
      throw new Error("Load a supported page in this tab first.");
    }

    const posted = await this.captureTabById(tab.id, opts);

    const win =
      parentForDialog && !parentForDialog.isDestroyed()
        ? parentForDialog
        : this.hostWindow;
    if (win && !win.isDestroyed()) {
      const rows = posted.rowCount != null ? String(posted.rowCount) : "?";
      const src = posted.source ? String(posted.source).toUpperCase() : "CAPTURE";
      const pcNote =
        posted.created === true
          ? "New card added (server scrape + TCG snapshot when available)."
          : posted.created === false && posted.cardId
            ? "Existing card updated from PriceCharting."
            : "";

      let detail = posted.file ? String(posted.file) : "";
      if (pcNote) {
        detail = detail ? `${detail}\n\n${pcNote}` : pcNote;
      }
      const pcSync =
        posted.source === "pricecharting" &&
        posted.cardId &&
        (posted.created === true || posted.created === false);
      if (this.captureDiagnosticsEnabled) {
        const diags = posted?.portfolioMerge?.diagnostics;
        if (Array.isArray(diags) && diags.length > 0) {
          const lines = diags.map((d) => {
            const cardName = d.cardName ? String(d.cardName) : String(d.cardId || "");
            const header = `- ${cardName || "Card"}: passed ${d.passed}, failed ${d.failed}, skipped ${d.skipped}`;
            const ex = Array.isArray(d.failedExamples) ? d.failedExamples.slice(0, 3) : [];
            const exLines = ex
              .map((r) => `   · ${String(r.title || "").slice(0, 90)} — $${r.price ?? 0}`)
              .join("\n");
            return exLines ? `${header}\n${exLines}` : header;
          }).join("\n");
          detail += `\n\nCapture sanity gate (eBay):\n${lines}`;
        }
      }

      const pm = posted?.portfolioMerge;
      if (pm && typeof pm.touched === "number" && !pcSync) {
        const mergeLine = `Portfolio merge: ${pm.touched} card row(s) updated.`;
        detail = detail ? `${detail}\n\n${mergeLine}` : mergeLine;
        if (pm.touched === 0) {
          detail +=
            "\n\nNo portfolio cards matched this capture URL. Add the card first, or confirm this page matches a card's saved PriceCharting / TCGPlayer / eBay link.";
        }
      }

      const headline = pcSync
        ? `${src}: ${posted.created ? "new card added" : "card updated"} (server scrape).`
        : `${src}: saved capture (${rows} rows).`;

      await dialog.showMessageBox(win, {
        type: "info",
        title: "Capture saved",
        message: headline,
        detail,
      });
    }

    return posted;
  }
}

let singleton;

function getRawEngineTabbedBrowser(opts) {
  if (!singleton) {
    singleton = new RawEngineTabbedBrowser(opts);
  }
  return singleton;
}

module.exports = { RawEngineTabbedBrowser, getRawEngineTabbedBrowser };
