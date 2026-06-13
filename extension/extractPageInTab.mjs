/**
 * eBay "Graded → Yes/No" facet click only — used by RawEngine phase A.
 * Must stay aligned with `applyEbayGradedFacetClick` inside `extractCurrentPageInTab` (MV3 cannot import helpers).
 */
import {
  assessSuspiciousNonEnglish,
  inferLanguageFromImageSignals,
  inferLanguageTagFromText,
  mergeLanguageTags,
} from "./cardLanguageDetect.mjs";

export async function ebayApplyGradedFacetOnly(options = {}) {
  const raw = options?.ebayGradedFacet;
  const ebayGradedFacet = raw === "no" || raw === "yes" ? raw : null;
  if (!ebayGradedFacet) return { applied: false, skipped: true };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const wantYes = ebayGradedFacet === "yes";
  await sleep(400);
  const tryClick = (el) => {
    try {
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      return true;
    } catch {
      return false;
    }
  };
  const blocks = Array.from(
    document.querySelectorAll(".x-refine__multi-uilib-form-field, .x-refine__main__value, [class*='x-refine__multi']")
  );
  for (const block of blocks) {
    const bt = (block.textContent || "").replace(/\s+/g, " ").trim();
    if (!/graded/i.test(bt)) continue;
    const innerLinks = Array.from(block.querySelectorAll("a[href], button")).filter((el) => {
      const t = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (!t || t.length > 48) return false;
      if (wantYes) return /^\s*yes\s*$/i.test(t) || (/yes/i.test(t) && t.length < 12);
      return /^\s*no\s*$/i.test(t) || (/^no\b/i.test(t) && t.length < 12);
    });
    if (innerLinks.length) {
      tryClick(innerLinks[0]);
      // Do not await after click — eBay often navigates immediately; awaiting here leaves the
      // injected promise running in a dying document and Electron's executeJavaScript may never resolve.
      return { applied: true };
    }
  }
  const allLinks = Array.from(document.querySelectorAll('a[href*="LH_All"], a[href*="LH_TS"], a.x-refine__multi-select-link'));
  for (const a of allLinks) {
    const t = (a.textContent || "").replace(/\s+/g, " ").trim();
    const href = (a.getAttribute("href") || "").toLowerCase();
    if (!/graded/i.test(href) && !/^yes$/i.test(t) && !/^no$/i.test(t)) continue;
    if (wantYes && (/yes/i.test(t) || /graded.*yes/i.test(href))) {
      tryClick(a);
      return { applied: true };
    }
    if (!wantYes && (/^no$/i.test(t) || /graded.*no/i.test(href))) {
      tryClick(a);
      return { applied: true };
    }
  }
  return { applied: false };
}

/**
 * eBay "results per page" select only — RawEngine phase before full capture (DOM change may navigate).
 * Must stay aligned with `applyEbayPerPage` inside `extractCurrentPageInTab`.
 */
export async function ebayApplyPerPageOnly(options = {}) {
  const ebayPerPageTarget = Number.isFinite(Number(options?.ebayPerPageTarget))
    ? Math.max(25, Number(options.ebayPerPageTarget))
    : null;
  if (ebayPerPageTarget == null) return { applied: false, skipped: true };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const target = String(ebayPerPageTarget);
  const pickPerPageOption = (optsArr) => {
    const t = String(target).trim();
    const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    let o = optsArr.find((x) => String(x.value || "").trim() === t);
    if (o) return o;
    o = optsArr.find((x) => {
      const tx = String(x.textContent || "")
        .replace(/\s+/g, " ")
        .trim();
      return tx === t || new RegExp(`\\b${esc}\\b`).test(tx);
    });
    if (o) return o;
    o = optsArr.find((x) => String(x.textContent || "").replace(/\D/g, "") === t);
    return o || null;
  };
  const rankPerPageSelect = (sel) => {
    try {
      const id = (sel.id || "").toLowerCase();
      const ar = (sel.getAttribute("aria-label") || "").toLowerCase();
      if (id.includes("srp-ipp") || id.includes("items")) return 0;
      if (/result|per page|items per page|pagination|ipp/i.test(ar)) return 1;
      return 2;
    } catch {
      return 2;
    }
  };
  const allSelects = Array.from(document.querySelectorAll("select"));
  const ippEl =
    document.querySelector("#srp-ipp-select") ||
    document.querySelector('select[id*="srp-ipp"]') ||
    document.querySelector('select[id*="SRP-IPP"]') ||
    document.querySelector('select[name="_ipg"]') ||
    document.querySelector('select[aria-label*="per page"]') ||
    document.querySelector('select[aria-label*="Per page"]');
  const orderedSelects = [];
  if (ippEl && allSelects.includes(ippEl)) orderedSelects.push(ippEl);
  for (const s of allSelects
    .filter((x) => x !== ippEl)
    .sort((a, b) => rankPerPageSelect(a) - rankPerPageSelect(b))) {
    orderedSelects.push(s);
  }
  const selects = orderedSelects.length ? orderedSelects : allSelects;
  for (const sel of selects) {
    const selOpts = Array.from(sel.options || []);
    const hit = pickPerPageOption(selOpts);
    if (!hit) continue;
    sel.value = hit.value;
    sel.dispatchEvent(new Event("input", { bubbles: true }));
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    // Same as graded facet: per-page change can navigate; return immediately so executeJavaScript resolves.
    return { applied: true };
  }
  try {
    const pu = new URL(window.location.href);
    const cur = pu.searchParams.get("_ipg") || pu.searchParams.get("ipg") || "";
    if (String(cur).trim() !== target) {
      pu.searchParams.set("_ipg", target);
      const next = pu.toString();
      if (next !== window.location.href) {
        window.location.assign(next);
        return { applied: true, viaUrlFallback: true };
      }
    }
  } catch {
    /* ignore */
  }
  return { applied: false };
}

/** Light shadow pierce for prep scripts (eBay SRP rows often under open shadow roots). */
function querySelectorAllDeepEbay(root, selector) {
  const out = [];
  if (!root || typeof root.querySelectorAll !== "function") return out;
  const visit = (node) => {
    if (!node) return;
    try {
      for (const el of node.querySelectorAll(selector)) out.push(el);
    } catch {
      return;
    }
    let stars;
    try {
      stars = node.querySelectorAll("*");
    } catch {
      return;
    }
    for (let i = 0; i < stars.length; i += 1) {
      const el = stars[i];
      const sr = el && el.shadowRoot;
      if (sr) visit(sr);
    }
  };
  visit(root);
  return out;
}

/** eBay sold-page inspection used by RawEngine to decide per-page prep. */
export async function ebayInspectSoldPageOnly() {
  const parseSoldAt = (text) => {
    const raw = String(text || "").replace(/\s+/g, " ");
    let m = raw.match(
      /Sold\s+((?:[A-Za-z]{3,9}|\d{1,2}\/\d{1,2}\/\d{2,4})[\s,]+\d{4}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{2,4})/i
    );
    if (!m) m = raw.match(/Sold\s+(\d{4}-\d{2}-\d{2})/i);
    if (!m) return null;
    const datePart = m[1].trim();
    const hasExplicitTime =
      /(?:^|[\s,;T])\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?/i.test(datePart) ||
      /t\d{2}:\d{2}/i.test(datePart);
    const isoDay = datePart.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoDay) {
      const y = Number(isoDay[1]);
      const mo = Number(isoDay[2]) - 1;
      const da = Number(isoDay[3]);
      return new Date(y, mo, da, 12, 0, 0, 0).getTime();
    }
    const parsed = Date.parse(datePart);
    if (!Number.isFinite(parsed)) return null;
    if (hasExplicitTime) return parsed;
    const d = new Date(parsed);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0).getTime();
  };
  const rows = Array.from(
    new Set(
      querySelectorAllDeepEbay(
        document,
        "li.s-item, #srp-river-results [role='listitem'], ul.srp-results [role='listitem']"
      )
    )
  );
  let parseableDateRows = 0;
  let soldLikeRows = 0;
  let maxSoldAt = null;
  let minSoldAt = null;
  for (const row of rows) {
    const t = (row.textContent || "").replace(/\s+/g, " ").trim();
    if (!t) continue;
    if (!/(?:\bsold\b|\bended\b)/i.test(t)) continue;
    soldLikeRows += 1;
    const ts = parseSoldAt(t);
    if (ts == null) continue;
    parseableDateRows += 1;
    maxSoldAt = maxSoldAt == null ? ts : Math.max(maxSoldAt, ts);
    minSoldAt = minSoldAt == null ? ts : Math.min(minSoldAt, ts);
  }
  return {
    applied: true,
    rowCount: rows.length,
    soldLikeRows,
    parseableDateRows,
    maxSoldAt,
    minSoldAt,
  };
}

/**
 * RawEngine Quick Fetch: type query into eBay header search with erratic timing, light scrolling,
 * per-character key/input events, then submit via Enter (keypress + keydown + keyup) like a human.
 * Run only on eBay pages that expose the global search field (typically www.ebay.com home).
 */
export async function ebayOrganicTypeSearchQuery(options = {}) {
  const query = String(options?.query || "").trim();
  if (!query) return { ok: false, reason: "empty_query" };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const rand = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

  const nudgeScroll = () => {
    try {
      const root = document.scrollingElement || document.documentElement;
      if (!root) return;
      root.scrollBy({ top: rand(-45, 70), left: rand(-12, 12), behavior: "auto" });
    } catch {
      /* ignore */
    }
  };

  const maybeWheel = () => {
    if (Math.random() > 0.35) return;
    try {
      window.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: rand(15, 110),
          deltaX: rand(-25, 25),
          bubbles: true,
          cancelable: true,
        })
      );
    } catch {
      /* ignore */
    }
  };

  const codeForChar = (ch) => {
    if (ch === " ") return "Space";
    if (ch >= "0" && ch <= "9") return `Digit${ch}`;
    if (ch >= "a" && ch <= "z") return `Key${ch.toUpperCase()}`;
    if (ch >= "A" && ch <= "Z") return `Key${ch}`;
    if (ch === "-") return "Minus";
    if (ch === "=") return "Equal";
    if (ch === "[") return "BracketLeft";
    if (ch === "]") return "BracketRight";
    if (ch === "\\") return "Backslash";
    if (ch === ";") return "Semicolon";
    if (ch === "'") return "Quote";
    if (ch === ",") return "Comma";
    if (ch === ".") return "Period";
    if (ch === "/") return "Slash";
    if (ch === "`") return "Backquote";
    return "";
  };

  const dispatchInputData = (ch) => {
    try {
      input.dispatchEvent(
        new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          inputType: "insertText",
          data: ch,
        })
      );
    } catch {
      try {
        input.dispatchEvent(new Event("beforeinput", { bubbles: true, cancelable: true }));
      } catch {
        /* ignore */
      }
    }
    try {
      input.dispatchEvent(
        new InputEvent("input", { bubbles: true, inputType: "insertText", data: ch })
      );
    } catch {
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  };

  const typePrintableChar = (ch) => {
    const code = codeForChar(ch);
    const isPrintable = ch.length === 1;
    const keyCode = isPrintable ? ch.charCodeAt(0) : 0;
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: ch,
        code: code || undefined,
        keyCode,
        which: keyCode,
        bubbles: true,
        cancelable: true,
      })
    );
    const start = input.value.length;
    input.value += ch;
    try {
      input.setSelectionRange(start + 1, start + 1);
    } catch {
      /* ignore */
    }
    dispatchInputData(ch);
    if (isPrintable) {
      input.dispatchEvent(
        new KeyboardEvent("keypress", {
          key: ch,
          code: code || undefined,
          charCode: keyCode,
          keyCode,
          which: keyCode,
          bubbles: true,
          cancelable: true,
        })
      );
    }
    input.dispatchEvent(
      new KeyboardEvent("keyup", {
        key: ch,
        code: code || undefined,
        keyCode,
        which: keyCode,
        bubbles: true,
        cancelable: false,
      })
    );
  };

  const nextInterKeyDelayMs = (ch, i, len, burstLeftRef) => {
    if (burstLeftRef.n > 0) {
      burstLeftRef.n -= 1;
      return rand(5, 28);
    }
    if (Math.random() < 0.07) burstLeftRef.n = rand(1, 4);
    let ms = rand(22, 110);
    if (i === 0) ms += rand(20, 140);
    if (ch === " ") ms += rand(0, 95);
    if (/[0-9]/.test(ch)) ms += rand(-8, 35);
    if (Math.random() < 0.14) ms += rand(160, 620);
    if (Math.random() < 0.06) ms += rand(500, 1400);
    if (Math.random() < 0.05) ms = rand(4, 18);
    return Math.max(4, ms);
  };

  const trySelectors = [
    "#gh-ac",
    'input[name="_nkw"]',
    'header input[type="search"]',
    'input[placeholder*="Search" i]',
    'input[aria-label*="Search" i]',
  ];
  let input = null;
  for (const sel of trySelectors) {
    try {
      input = document.querySelector(sel);
    } catch {
      input = null;
    }
    if (input && typeof input.focus === "function") break;
  }
  if (!input) return { ok: false, reason: "no_search_input" };

  try {
    try {
      input.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
    } catch {
      /* ignore */
    }
    nudgeScroll();
    await sleep(rand(90, 260));

    input.focus();
    await sleep(rand(40, 140));

    try {
      input.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, detail: rand(1, 3), view: window })
      );
    } catch {
      /* ignore */
    }
    await sleep(rand(30, 110));
    try {
      const len = input.value.length;
      input.setSelectionRange(0, len);
    } catch {
      /* ignore */
    }
    await sleep(rand(25, 90));

    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Backspace",
        code: "Backspace",
        keyCode: 8,
        which: 8,
        bubbles: true,
        cancelable: true,
      })
    );
    input.value = "";
    try {
      input.dispatchEvent(
        new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" })
      );
    } catch {
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    input.dispatchEvent(
      new KeyboardEvent("keyup", {
        key: "Backspace",
        code: "Backspace",
        keyCode: 8,
        which: 8,
        bubbles: true,
        cancelable: false,
      })
    );

    await sleep(rand(140, 380));
    maybeWheel();
    nudgeScroll();
    await sleep(rand(60, 200));

    const burstLeftRef = { n: 0 };
    for (let i = 0; i < query.length; i += 1) {
      const ch = query[i];
      typePrintableChar(ch);
      if (Math.random() < 0.09) {
        nudgeScroll();
        maybeWheel();
      }
      await sleep(nextInterKeyDelayMs(ch, i, query.length, burstLeftRef));
    }

    await sleep(rand(220, 720));
    input.focus();
    try {
      input.setSelectionRange(input.value.length, input.value.length);
    } catch {
      /* ignore */
    }
    await sleep(rand(80, 240));
    nudgeScroll();
    await sleep(rand(40, 160));

    const enterDown = new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
    });
    const enterPress = new KeyboardEvent("keypress", {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      charCode: 13,
      bubbles: true,
      cancelable: true,
    });
    const enterUp = new KeyboardEvent("keyup", {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: false,
    });
    input.dispatchEvent(enterDown);
    await sleep(rand(8, 35));
    input.dispatchEvent(enterPress);
    await sleep(rand(10, 45));
    input.dispatchEvent(enterUp);

    return { ok: true, applied: true, submit: "enter" };
  } catch (e) {
    return {
      ok: false,
      reason: "type_submit_error",
      error: e && e.message ? String(e.message) : String(e),
    };
  }
}

/**
 * Align current eBay SERP URL with target sold URL (LH_Sold, LH_Complete, Graded) while keeping _nkw.
 */
export async function ebayOrganicMergeSoldTargetUrl(options = {}) {
  const targetUrl = String(options?.targetUrl || "").trim();
  if (!targetUrl) return { ok: false, reason: "empty_target" };
  let target;
  try {
    target = new URL(targetUrl);
  } catch {
    return { ok: false, reason: "bad_target_url" };
  }
  const wantNkw = target.searchParams.get("_nkw");
  if (wantNkw == null || wantNkw === "") return { ok: false, reason: "bad_target_nkw" };
  const norm = (s) => {
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
  let cur;
  try {
    cur = new URL(window.location.href);
  } catch {
    return { ok: false, reason: "bad_location" };
  }
  const host = cur.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "ebay.com" && host !== "m.ebay.com") return { ok: false, reason: "not_ebay" };
  const gotNkw = cur.searchParams.get("_nkw");
  if (gotNkw == null) return { ok: false, reason: "no_serp_nkw", step: "merge" };
  if (norm(gotNkw) !== norm(wantNkw))
    return { ok: false, reason: "nkw_mismatch", got: gotNkw, want: wantNkw };
  cur.searchParams.set("LH_Sold", "1");
  cur.searchParams.set("LH_Complete", "1");
  const graded = target.searchParams.get("Graded");
  if (graded === "Yes" || graded === "No") cur.searchParams.set("Graded", graded);
  else cur.searchParams.delete("Graded");
  const next = cur.toString();
  if (next !== window.location.href) {
    window.location.assign(next);
    return { ok: true, applied: true, navigated: true };
  }
  return { ok: true, applied: true, navigated: false };
}

export async function extractCurrentPageInTab(options = {}) {
  let mode = options && options.mode === "deep" ? "deep" : "default";
  if (options?.ebayQuickRefresh === true) mode = "deep";
  const simulateImpatience = options?.simulateImpatience === true;
  const impatienceMs = Number.isFinite(Number(options?.impatienceMs))
    ? Math.max(200, Number(options.impatienceMs))
    : 900;
  const openTcgViewMoreData = options?.openTcgViewMoreData !== false;
  const tcgViewMoreWaitMs = Number.isFinite(Number(options?.tcgViewMoreWaitMs))
    ? Math.max(300, Number(options.tcgViewMoreWaitMs))
    : 900;
  const tcgPrePageSettleMs = Number.isFinite(Number(options?.tcgPrePageSettleMs))
    ? Math.max(0, Number(options.tcgPrePageSettleMs))
    : 1400;
  const tcgMinSalesRows = Number.isFinite(Number(options?.tcgMinSalesRows))
    ? Math.max(1, Number(options.tcgMinSalesRows))
    : 2;
  const tcgSalesFeedTimeoutMs = Number.isFinite(Number(options?.tcgSalesFeedTimeoutMs))
    ? Math.max(4000, Number(options.tcgSalesFeedTimeoutMs))
    : 24000;
  const tcgSalesFeedPollMs = Number.isFinite(Number(options?.tcgSalesFeedPollMs))
    ? Math.max(120, Number(options.tcgSalesFeedPollMs))
    : 450;
  const tcgViewMoreMaxAttempts = Number.isFinite(Number(options?.tcgViewMoreMaxAttempts))
    ? Math.max(1, Math.min(6, Number(options.tcgViewMoreMaxAttempts)))
    : 3;
  const tcgSalesWatermarkMsRaw = options?.tcgSalesWatermarkMs;
  const tcgSalesWatermarkMs =
    typeof tcgSalesWatermarkMsRaw === "number" && Number.isFinite(tcgSalesWatermarkMsRaw)
      ? tcgSalesWatermarkMsRaw
      : null;
  const tcgSalesWatermarkSlackMs = 86_400_000;
  const tcgDeepExtraSettleMs = Number.isFinite(Number(options?.tcgDeepExtraSettleMs))
    ? Math.max(0, Math.min(8000, Number(options.tcgDeepExtraSettleMs)))
    : 550;
  const ebayPerPageTarget = Number.isFinite(Number(options?.ebayPerPageTarget))
    ? Math.max(25, Number(options.ebayPerPageTarget))
    : null;
  const ebayGradedFacetRaw = options?.ebayGradedFacet;
  const ebayGradedFacet =
    ebayGradedFacetRaw === "no" || ebayGradedFacetRaw === "yes" ? ebayGradedFacetRaw : null;
  const ebaySkipGradedFacetClick = options?.ebaySkipGradedFacetClick === true;
  const ebaySkipPerPageChange = options?.ebaySkipPerPageChange === true;
  const rawEnginePrepLikely = ebaySkipPerPageChange || ebaySkipGradedFacetClick;
  const ebayStopDeepPagingWhenPageMaxSoldAtLteMsRaw = options?.ebayStopDeepPagingWhenPageMaxSoldAtLteMs;
  const ebayStopDeepPagingWhenPageMaxSoldAtLteMs =
    typeof ebayStopDeepPagingWhenPageMaxSoldAtLteMsRaw === 'number' &&
    Number.isFinite(ebayStopDeepPagingWhenPageMaxSoldAtLteMsRaw)
      ? ebayStopDeepPagingWhenPageMaxSoldAtLteMsRaw
      : null;
  const ebaySoldWatermarkMsRaw = options?.ebaySoldWatermarkMs;
  const ebaySoldWatermarkMs =
    typeof ebaySoldWatermarkMsRaw === 'number' && Number.isFinite(ebaySoldWatermarkMsRaw)
      ? ebaySoldWatermarkMsRaw
      : null;
  const ebayListingPollMaxMs = Number.isFinite(Number(options?.ebayListingPollMaxMs))
    ? Math.max(2000, Math.min(20000, Number(options.ebayListingPollMaxMs)))
    : rawEnginePrepLikely
      ? 12000
      : 8000;
  const ebayListingSettleMs = Number.isFinite(Number(options?.ebayListingSettleMs))
    ? Math.max(0, Math.min(20000, Number(options.ebayListingSettleMs)))
    : rawEnginePrepLikely
      ? 2400
      : 400;
  const ebayDeepBudgetMs = Number.isFinite(Number(options?.ebayDeepBudgetMs))
    ? Math.max(30_000, Math.min(240_000, Number(options.ebayDeepBudgetMs)))
    : Math.min(180_000, 55_000 + (ebayPerPageTarget != null ? ebayPerPageTarget * 350 : 9000));
  const ebayDeepFetchConcurrency = Number.isFinite(Number(options?.ebayDeepFetchConcurrency))
    ? Math.max(1, Math.min(8, Math.floor(Number(options.ebayDeepFetchConcurrency))))
    : 4;
  /** User override when heuristics false-positive on real results pages. */
  const skipBotWallCheck = options?.skipBotWallCheck === true;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const runImpatienceSimulation = async () => {
    if (!simulateImpatience) return;
    const root = document.scrollingElement || document.documentElement || document.body;
    if (!root) return;
    const startTop = Number(root.scrollTop || 0);
    const downBy = Math.min(280, Math.max(70, Math.floor(window.innerHeight * 0.18)));
    root.scrollTop = startTop + downBy;
    await sleep(Math.min(350, Math.floor(impatienceMs * 0.4)));
    root.scrollTop = Math.max(0, startTop - Math.floor(downBy * 0.25));
    const overlays = Array.from(document.querySelectorAll("[data-impatience-jiggle='1']"));
    overlays.forEach((el) => el.remove());
    const dot = document.createElement("div");
    dot.setAttribute("data-impatience-jiggle", "1");
    dot.style.position = "fixed";
    dot.style.left = "16px";
    dot.style.top = "16px";
    dot.style.width = "7px";
    dot.style.height = "7px";
    dot.style.borderRadius = "999px";
    dot.style.background = "rgba(37,99,235,0.75)";
    dot.style.boxShadow = "0 0 0 1px rgba(255,255,255,0.8)";
    dot.style.pointerEvents = "none";
    dot.style.zIndex = "2147483647";
    document.body?.appendChild(dot);
    const jiggleSteps = [
      [18, 14],
      [42, 22],
      [30, 40],
      [52, 26],
      [38, 12]
    ];
    for (const [x, y] of jiggleSteps) {
      dot.style.transform = `translate(${x}px, ${y}px)`;
      await sleep(Math.max(55, Math.floor(impatienceMs / 10)));
    }
    dot.remove();
  };
  const parseUsd = (s) => {
    const m = String(s || "").match(/\$?\s*([\d,]+(?:\.\d{1,2})?)/);
    if (!m) return null;
    const n = Number.parseFloat(m[1].replace(/,/g, ""));
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  /**
   * eBay SRP often nests anchors / price nodes under open shadow roots; light-DOM querySelector misses them.
   */
  const querySelectorAllDeep = (root, selector) => {
    const out = [];
    if (!root || typeof root.querySelectorAll !== "function") return out;
    const visit = (node) => {
      if (!node) return;
      try {
        for (const el of node.querySelectorAll(selector)) out.push(el);
      } catch {
        return;
      }
      let stars;
      try {
        stars = node.querySelectorAll("*");
      } catch {
        return;
      }
      for (let i = 0; i < stars.length; i += 1) {
        const el = stars[i];
        const sr = el && el.shadowRoot;
        if (sr) visit(sr);
      }
    };
    visit(root);
    return out;
  };
  const collectTextDeep = (root) => {
    const parts = [];
    const walk = (node) => {
      if (!node) return;
      if (node.nodeType === 3) {
        parts.push(node.textContent || "");
        return;
      }
      if (node.nodeType === 1) {
        const ch = node.childNodes;
        if (ch) for (let i = 0; i < ch.length; i += 1) walk(ch[i]);
        if (node.shadowRoot) walk(node.shadowRoot);
      }
    };
    walk(root);
    return parts.join("").replace(/\s+/g, " ").trim();
  };
  const parseEbayPriceUsd = (s) => {
    let txt = String(s || "").replace(/\s+/g, " ").trim();
    if (!txt) return null;
    const bo = txt.toLowerCase().indexOf("best offer");
    if (bo !== -1) txt = txt.slice(0, bo).replace(/\s+$/g, "").trim();
    if (!txt) return null;
    const tLower = txt.toLowerCase();
    if (/\bshipping\b/.test(tLower) || /\bdelivery\b/.test(tLower)) return null;
    if (/^\s*was\b/i.test(txt) || /^\s*est\.?\b/i.test(txt) || /^\s*list\s*:/i.test(txt)) return null;
    if (/\bwas\s*:/.test(tLower) || /\boriginal\s*:/.test(tLower) || /\bcompare\s*at\b/.test(tLower)) return null;
    if (/\bmsrp\b/.test(tLower) && /\$\s*[\d,]+/.test(txt)) return null;
    const mApproxUsd = txt.match(/Approx(?:imately)?\s*US\s*\$\s*([\d,]+(?:\.\d{1,2})?)/i);
    if (mApproxUsd) return parseUsd(mApproxUsd[1]);
    const mUsd = txt.match(/\bUS\s*\$\s*([\d,]+(?:\.\d{1,2})?)/i);
    if (mUsd) return parseUsd(mUsd[1]);
    if (/\$\s*[\d,]+(?:\.\d{1,2})?\s+to\s+\$?\s*[\d,]+(?:\.\d{1,2})?/i.test(txt)) return null;
    return parseUsd(txt);
  };
  /** When one node contains "$199 $29" or list+sold on one line, prefer the last dollar amount. */
  const parsePriceFromListingCardText = (raw) => {
    const cleaned = String(raw || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!cleaned) return null;
    const dollarMatches = [...cleaned.matchAll(/\$\s*([\d,]+(?:\.\d{1,2})?)/g)];
    if (dollarMatches.length >= 2) {
      for (let i = dollarMatches.length - 1; i >= 0; i -= 1) {
        const frag = dollarMatches[i][0];
        const p = parseEbayPriceUsd(frag);
        if (p != null) return p;
      }
    }
    return parseEbayPriceUsd(cleaned);
  };
  /**
   * eBay often renders two prices: list/was (sometimes strikethrough) then sold / current.
   * Grabbing the first `.s-item__price` in DOM order frequently attaches the wrong amount to the item.
   * We skip stale/was/strike-looking nodes when possible, collect all plausible prices in the card,
   * and take the last one in document order (final line is usually the realized sale price).
   */
  const parseEbayListingPrice = (container) => {
    if (!container || typeof container.querySelectorAll !== "function") return null;
    const priceSelectors = [
      ".su-card-container__attributes__primary .s-item__price",
      ".su-card-container__attributes__primary .s-card__price",
      ".su-card-container__attributes__primary [class*='s-card__price']",
      ".s-item__price",
      ".s-card__price",
      "[class*='s-card__price']",
      "[class*='s-item__price']",
      ".s-item__detail--primary .s-item__price",
      ".s-item__details .s-item__price"
    ];
    const rejectClass =
      /s-item__(shipping|delivery|logistics|installment|purchase-options|discount|additional|fee|tax)/i;
    const isLikelyStaleOrComparePrice = (el) => {
      let n = el;
      for (let d = 0; d < 12 && n; d += 1) {
        const c = String(n.className || "");
        if (
          /(strike|strikethrough|line-through|old-pric|original-pric|compare|list-pric|was-pric|previous|before-discount|from-pric|msrp)/i.test(
            c
          )
        ) {
          return true;
        }
        const st = n.getAttribute && n.getAttribute("style");
        if (st && /line-through|strike/i.test(String(st))) return true;
        n = n.parentElement;
      }
      return false;
    };
    const gatherPriceElements = (skipStale) => {
      const seen = new Set();
      const out = [];
      for (const sel of priceSelectors) {
        for (const el of querySelectorAllDeep(container, sel)) {
          if (!el || seen.has(el) || rejectClass.test(String(el.className || ""))) continue;
          if (skipStale && isLikelyStaleOrComparePrice(el)) continue;
          seen.add(el);
          out.push(el);
        }
      }
      return out;
    };
    const scoreElements = (els) => {
      const scored = [];
      for (const el of els) {
        const raw = (el.textContent || "").replace(/\s+/g, " ").trim();
        const p = parsePriceFromListingCardText(raw);
        if (p != null) scored.push({ el, p });
      }
      return scored;
    };
    let els = gatherPriceElements(true);
    let scored = scoreElements(els);
    if (scored.length === 0) {
      scored = scoreElements(gatherPriceElements(false));
    }
    if (scored.length === 0) return null;
    if (scored.length === 1) return scored[0].p;
    scored.sort((a, b) => {
      const bit = a.el.compareDocumentPosition(b.el);
      if (bit & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (bit & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
    return scored[scored.length - 1].p;
  };
  const ebayItemIdFromHref = (href) => {
    const s = String(href || "").trim();
    if (!s) return null;
    const m =
      s.match(/\/itm\/(?:[^/?#]+\/)?(\d{4,})(?:[/?#]|$)/i) ||
      s.match(/[?&](?:item|item_id)=(\d{4,})/i) ||
      s.match(/ebay\.com\/itm\/(\d{4,})/i);
    return m ? m[1] : null;
  };
  const canonicalizePricechartingPageUrl = (href) => {
    let s = String(href || "")
      .trim()
      .replace(/\/+$/, "");
    try {
      const u = new URL(s);
      if (!/^([a-z0-9-]+\.)*pricecharting\.com$/i.test(u.hostname)) return null;
      if (/^m\.pricecharting\.com$/i.test(u.hostname)) u.hostname = "www.pricecharting.com";
      return u.toString();
    } catch {
      return null;
    }
  };
  const detectSource = (url) => {
    try {
      const u = new URL(url);
      const hn = u.hostname.toLowerCase();
      if (/^([a-z0-9-]+\.)*pricecharting\.com$/i.test(hn)) return "pricecharting";
      const host = hn.replace(/^www\./, "");
      if (host === "tcgplayer.com") return "tcgplayer";
      if (host === "ebay.com" || host === "m.ebay.com") {
        if (u.pathname.toLowerCase().includes("/sch/") && (u.searchParams.get("_nkw") || u.searchParams.get("nkw"))) {
          return "ebay";
        }
        return null;
      }
      return null;
    } catch {
      return null;
    }
  };
  const source = detectSource(location.href);
  if (!source) {
    return {
      error:
        "Unsupported page. Open a TCGPlayer product, eBay search results (…/sch/i.html?_nkw=…), or PriceCharting."
    };
  }
  const botApi = typeof globalThis !== "undefined" ? globalThis.__pcgrBotWallDetect : null;
  const isLikelyBotWall = () =>
    botApi
      ? botApi.detectLikelyBotWall(document, source)
      : false;
  if (!skipBotWallCheck && (source === "ebay" || source === "tcgplayer") && isLikelyBotWall()) {
    return {
      error: botApi?.botCheckErrorMessage?.() ||
        "BOT_CHECK: This page looks like a security or bot challenge. Complete it in the tab, then run Raw Investor capture again. If the page already shows normal results, open the extension again and use “No challenge here — capture anyway.”"
    };
  }
  if (source === "tcgplayer") {
    const tcgExtractStartedAt = Date.now();
    const parseDateMs = (raw) => {
      const s = String(raw || "").trim();
      const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
      if (!m) return null;
      const mm = Number.parseInt(m[1], 10);
      const dd = Number.parseInt(m[2], 10);
      let yy = Number.parseInt(m[3], 10);
      if (yy < 100) yy += 2000;
      const d = new Date(yy, mm - 1, dd, 12, 0, 0, 0);
      const t = d.getTime();
      return Number.isFinite(t) ? t : null;
    };
    const readSelectText = (candidates) => {
      for (const sel of candidates) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const txt = (el.textContent || "").trim();
        if (txt) return txt;
      }
      return null;
    };
    const body = (document.body?.innerText || "").replace(/\s+/g, " ");
    const query = new URL(location.href).searchParams;
    const productMatch = location.pathname.match(/\/product\/(\d+)/i);
    const productId = productMatch ? Number.parseInt(productMatch[1], 10) : null;
    const urlCondition = query.get("Condition") || query.get("condition") || "";
    const selectedCondition = readSelectText([
      "button[aria-label*='Condition']",
      "[data-testid*='Condition']"
    ]);
    const marketLanguage =
      query.get("Language") || query.get("language") || readSelectText([
        "button[aria-label*='Language']",
        "[data-testid*='Language']"
      ]) || null;
    const parseComparisonMarketPrices = (text) => {
      const compact = String(text).replace(/\s+/g, " ").trim();
      const pick = (labelPattern) => {
        const m = compact.match(
          new RegExp(`${labelPattern}[\\s\\S]{0,220}?\\bmarket\\s*price\\b[\\s\\S]{0,40}?\\$([\\d,]+(?:\\.\\d{1,2})?)`, "i")
        );
        return m ? parseUsd(m[1]) : null;
      };
      return {
        nearMint: pick("\\bnear\\s*mint\\b"),
        lightlyPlayed: pick("\\blightly\\s*played\\b"),
        moderatelyPlayed: pick("\\bmoderately\\s*played\\b"),
        heavilyPlayed: pick("\\bheavily\\s*played\\b"),
        damaged: pick("\\bdamaged\\b"),
      };
    };
    const comparisonMarketPrices = parseComparisonMarketPrices(body);
    const isNearMintContext =
      /near\s*mint/i.test(urlCondition) || /near\s*mint/i.test(selectedCondition || "");
    const nearMintMarketMatch = body.match(
      /\bnear\s*mint\b[\s\S]{0,220}?\bmarket\s*price\b[\s\S]{0,40}?\$([\d,]+(?:\.\d{1,2})?)/i
    );
    let marketPrice = nearMintMarketMatch ? parseUsd(nearMintMarketMatch[1]) : null;
    if (marketPrice == null && isNearMintContext) {
      const marketMatch = body.match(/market\s*price[\s\S]{0,40}?\$([\d,]+(?:\.\d{1,2})?)/i);
      marketPrice = marketMatch ? parseUsd(marketMatch[1]) : null;
    }
    if (marketPrice == null && comparisonMarketPrices.nearMint != null) {
      marketPrice = comparisonMarketPrices.nearMint;
    }
    const listingMatch =
      body.match(/\badd\s+to\s+cart\b[\s\S]{0,120}?\$([\d,]+(?:\.\d{1,2})?)/i) ||
      body.match(/\bas\s+low\s+as\b[\s\S]{0,30}?\$([\d,]+(?:\.\d{1,2})?)/i);
    const listingPrice = listingMatch ? parseUsd(listingMatch[1]) : null;
    const trendMatch =
      body.match(/near\s*mint[^$%]{0,80}\$([\d,]+(?:\.\d{1,2})?)\s*\(([+-]?\d+(?:\.\d+)?)%\)/i) ||
      body.match(/\$([\d,]+(?:\.\d{1,2})?)\s*\(([+-]?\d+(?:\.\d+)?)%\)/i);
    const trendValue = trendMatch ? parseUsd(trendMatch[1]) : null;
    const trendPct =
      trendMatch && Number.isFinite(Number.parseFloat(trendMatch[2]))
        ? Number.parseFloat(trendMatch[2])
        : null;
    const parsePricePoints = () => {
      const text = body;
      const recentSaleMatch = text.match(/most\s*recent\s*sale[\s\S]{0,30}?\$([\d,]+(?:\.\d{1,2})?)/i);
      const listedMedianMatch = text.match(/listed\s*median[\s:]*([\-$\d,\.]+)/i);
      const qtyMatch = text.match(/current\s*quantity[\s:]*([\d,]+)/i);
      const sellersMatch = text.match(/current\s*sellers[\s:]*([\d,]+)/i);
      const toNum = (x) => {
        const n = Number.parseInt(String(x || "").replace(/[^\d]/g, ""), 10);
        return Number.isFinite(n) ? n : null;
      };
      const listedMedianRaw = listedMedianMatch ? String(listedMedianMatch[1] || "").trim() : "";
      return {
        marketPrice,
        capturedMarketPrice: marketPrice,
        mostRecentSale: recentSaleMatch ? parseUsd(recentSaleMatch[1]) : null,
        listedMedian:
          listedMedianRaw === "-" ? null : parseUsd(listedMedianRaw),
        currentQuantity: qtyMatch ? toNum(qtyMatch[1]) : null,
        currentSellers: sellersMatch ? toNum(sellersMatch[1]) : null,
      };
    };
    const parseLatestSalesRows = () => {
      const out = [];
      const seenTr = new Set();
      const trSelectors = [
        "table tbody tr",
        "table[role='grid'] tbody tr",
        "div[role='table'] tbody tr",
        "[class*='latest'] table tbody tr",
        "[class*='LatestSales'] tr",
        "[class*='sales'] tbody tr",
        "[class*='SalesHistory'] tr"
      ];
      for (const sel of trSelectors) {
        const rows = querySelectorAllDeep(document, sel);
        for (let i = 0; i < rows.length; i += 1) {
          const tr = rows[i];
          if (!tr || tr.nodeType !== 1) continue;
          if (String(tr.tagName || "").toLowerCase() !== "tr") continue;
          if (seenTr.has(tr)) continue;
          if (tr.closest("thead")) continue;
          seenTr.add(tr);
          const cells = Array.from(tr.querySelectorAll("td, th"))
            .filter((td) => td.tagName === "TD")
            .map((td) => (td.textContent || "").replace(/\s+/g, " ").trim());
          if (cells.length < 4) continue;
          const at = parseDateMs(cells[0]);
          const qty = Number.parseInt((cells[2] || "").replace(/[^\d]/g, ""), 10);
          const price = parseUsd(cells[3]);
          if (at == null || !Number.isFinite(qty) || !Number.isFinite(price)) continue;
          const conditionText = cells[1] || "";
          const imgs = Array.from(tr.querySelectorAll("img"));
          let hasPhoto = false;
          let imageAlt = "";
          let imageSrc = "";
          for (const img of imgs) {
            const src = String(
              img.currentSrc || img.src || img.getAttribute?.("data-src") || ""
            ).trim();
            if (!src || /1x1|pixel|spinner|loading|placeholder|^data:/i.test(src)) continue;
            hasPhoto = true;
            imageAlt = String(img.alt || img.getAttribute?.("aria-label") || "").trim();
            imageSrc = src;
            break;
          }
          const languageTag = mergeLanguageTags(
            inferLanguageTagFromText(conditionText),
            inferLanguageFromImageSignals({ alt: imageAlt, src: imageSrc })
          );
          const suspicious = assessSuspiciousNonEnglish({ languageTag, marketLanguage });
          out.push({
            at,
            dateText: cells[0],
            condition: conditionText || null,
            qty,
            price,
            languageTag,
            hasPhoto,
            suspiciousLanguagePump: suspicious.suspiciousLanguagePump,
            suspiciousReason: suspicious.suspiciousReason,
            imageAlt: imageAlt || null,
            imageUrl: imageSrc || null,
            rowIndex: i
          });
        }
      }
      const dedup = new Map();
      for (const r of out) {
        const k = `${r.at}|${r.condition}|${r.qty}|${r.price}|${r.rowIndex}`;
        if (!dedup.has(k)) dedup.set(k, r);
      }
      return Array.from(dedup.values())
        .map(({ rowIndex, ...rest }) => rest)
        .sort((a, b) => b.at - a.at);
    };
    const clickByText = (texts) => {
      const all = querySelectorAllDeep(document, "button, a, [role='button'], [role='link']");
      for (const el of all) {
        const txt = (el.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
        if (!txt) continue;
        if (texts.some((t) => txt.includes(t))) {
          try {
            el.click();
          } catch {
            try {
              el.dispatchEvent(
                new MouseEvent("click", { bubbles: true, cancelable: true, view: window })
              );
            } catch {
              /* ignore */
            }
          }
          return true;
        }
      }
      return false;
    };
    const viewMoreLabelHit = (el) => {
      const bits = [
        (el.textContent || "").replace(/\s+/g, " ").trim().toLowerCase(),
        String(el.getAttribute?.("aria-label") || "")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase(),
        String(el.getAttribute?.("title") || "")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase(),
        String(el.getAttribute?.("data-testid") || "")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase()
      ].filter(Boolean);
      for (const raw of bits) {
        // Never treat auth CTAs as "view more" (mis-clicks break sales capture).
        if (
          raw.includes("sign in") ||
          raw.includes("sign-in") ||
          raw.includes("log in") ||
          raw.includes("log-in") ||
          raw.includes("register") ||
          raw.includes("create account") ||
          raw.includes("join free")
        ) {
          continue;
        }
        if (raw.includes("view more data")) return true;
        if (raw.includes("view more") && (raw.includes("data") || raw.includes("sales"))) return true;
        if (raw.includes("view more") && raw.length <= 28) return true;
        if (raw === "more data" || /\bmore data\b/.test(raw)) return true;
      }
      return false;
    };
    const resolveClickableHost = (start) => {
      let n = start;
      for (let d = 0; d < 10 && n; d += 1) {
        const tag = String(n.tagName || "").toLowerCase();
        const role = String(n.getAttribute?.("role") || "").toLowerCase();
        if (tag === "a" || tag === "button") return n;
        if (role === "button" || role === "link") return n;
        if (n.getAttribute?.("tabindex") === "0" && (tag === "div" || tag === "span")) return n;
        n = n.parentElement;
      }
      return start;
    };
    const firePointerClick = (el) => {
      try {
        el.scrollIntoView({ block: "center", behavior: "auto" });
      } catch {
        try {
          el.scrollIntoView();
        } catch {
          /* ignore */
        }
      }
      try {
        el.click();
        return true;
      } catch {
        /* ignore */
      }
      try {
        el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
        return true;
      } catch {
        return false;
      }
    };
    const clickViewMoreDataLink = () => {
      const selList = [
        "a",
        "button",
        "[role='button']",
        "[role='link']",
        "div[role='button']",
        "a[data-testid]",
        "button[data-testid]",
        "[role='button'][data-testid]",
        "[role='link'][data-testid]"
      ];
      const candidates = new Set();
      for (const s of selList) {
        for (const el of querySelectorAllDeep(document, s)) candidates.add(el);
      }
      for (const el of candidates) {
        if (!viewMoreLabelHit(el)) continue;
        const target = resolveClickableHost(el);
        if (firePointerClick(target)) return true;
      }
      return false;
    };
    const clickClearSalesFilters = () => {
      const needles = ["clear filters", "reset filters", "clear all filters"];
      const all = querySelectorAllDeep(
        document,
        "button, a, [role='button'], [role='link'], span[role='button']"
      );
      for (const el of all) {
        const raw = (el.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
        if (!raw) continue;
        if (needles.some((n) => raw === n || raw.includes(n))) {
          const target = resolveClickableHost(el);
          if (firePointerClick(target)) return true;
        }
      }
      return false;
    };
    const pollUntilMinSalesRows = async () => {
      const deadline = Date.now() + tcgSalesFeedTimeoutMs;
      let last = parseLatestSalesRows();
      let pollMs = tcgSalesFeedPollMs;
      const pollCeil = Math.max(tcgSalesFeedPollMs, 900);
      while (Date.now() < deadline) {
        if (last.length >= tcgMinSalesRows) return last;
        await sleep(pollMs);
        const next = parseLatestSalesRows();
        if (next.length > last.length) pollMs = Math.max(80, Math.floor(pollMs * 0.72));
        else pollMs = Math.min(pollCeil, Math.floor(pollMs * 1.12));
        last = next;
      }
      return parseLatestSalesRows();
    };
    const detectSalesModal = () => {
      const dialogs = querySelectorAllDeep(document, '[role="dialog"], [aria-modal="true"]');
      for (const d of dialogs) {
        const t = ((d.textContent || "") + "").toLowerCase();
        if (t.includes("sales history") || t.includes("latest sales")) return true;
      }
      return false;
    };

    const tcgFeedSanity = {
      prePageSettleMs: tcgPrePageSettleMs,
      viewMoreClickCount: 0,
      viewMoreAttempts: 0,
      rowsBeforeModal: parseLatestSalesRows().length,
      rowsAfterWait: 0,
      modalDetected: false,
      timedOutWaitingForFeed: false,
      clearFiltersClicked: false,
      extractWallMs: 0,
      minRowsWanted: tcgMinSalesRows,
      pollTimeoutMs: tcgSalesFeedTimeoutMs
    };

    await sleep(tcgPrePageSettleMs);
    if (mode === "deep") await sleep(tcgDeepExtraSettleMs);
    await runImpatienceSimulation();

    let latestSalesRows = [];
    if (openTcgViewMoreData) {
      for (let attempt = 0; attempt < tcgViewMoreMaxAttempts; attempt += 1) {
        tcgFeedSanity.viewMoreAttempts = attempt + 1;
        const clicked = clickViewMoreDataLink();
        if (clicked) tcgFeedSanity.viewMoreClickCount += 1;
        await sleep(Math.max(700, Math.min(tcgViewMoreWaitMs, 2800)));
        latestSalesRows = await pollUntilMinSalesRows();
        tcgFeedSanity.rowsAfterWait = latestSalesRows.length;
        tcgFeedSanity.modalDetected = detectSalesModal();
        if (latestSalesRows.length >= tcgMinSalesRows) break;
        await sleep(850);
      }
      if (latestSalesRows.length < tcgMinSalesRows) {
        tcgFeedSanity.timedOutWaitingForFeed = true;
        latestSalesRows = parseLatestSalesRows();
      }
    } else {
      latestSalesRows = parseLatestSalesRows();
    }

    if (
      latestSalesRows.length < tcgMinSalesRows &&
      detectSalesModal() &&
      clickClearSalesFilters()
    ) {
      tcgFeedSanity.clearFiltersClicked = true;
      await sleep(650);
      latestSalesRows = await pollUntilMinSalesRows();
      tcgFeedSanity.rowsAfterWait = latestSalesRows.length;
    }

    const targetRows = mode === "deep" ? Number.POSITIVE_INFINITY : 100;
    let loops = 0;
    let noGrowthRounds = 0;
    while (latestSalesRows.length < targetRows && loops < 120) {
      const clicked = clickByText(["load more sales"]);
      if (!clicked) break;
      loops += 1;
      const prevLen = latestSalesRows.length;
      const interWait = mode === "deep" ? 640 : 750;
      await sleep(interWait);
      latestSalesRows = parseLatestSalesRows();
      if (tcgSalesWatermarkMs != null && latestSalesRows.length > 0) {
        let minAt = Infinity;
        for (const row of latestSalesRows) {
          if (typeof row.at === "number" && Number.isFinite(row.at)) minAt = Math.min(minAt, row.at);
        }
        if (Number.isFinite(minAt) && minAt <= tcgSalesWatermarkMs - tcgSalesWatermarkSlackMs) {
          break;
        }
      }
      if (latestSalesRows.length <= prevLen) noGrowthRounds += 1;
      else noGrowthRounds = 0;
      if (noGrowthRounds >= 3) break;
    }
    const hasMore = Array.from(document.querySelectorAll("button, a")).some((el) => {
      const txt = (el.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
      const disabled = el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true";
      return txt.includes("load more sales") && !disabled;
    });
    latestSalesRows = parseLatestSalesRows();
    tcgFeedSanity.extractWallMs = Date.now() - tcgExtractStartedAt;
    if (tcgFeedSanity.extractWallMs > 0 && latestSalesRows.length > 0) {
      tcgFeedSanity.tcgRowsPerSec = (latestSalesRows.length * 1000) / tcgFeedSanity.extractWallMs;
    }
    return {
      source: "tcgplayer",
      url: location.href,
      title: document.title,
      capturedAt: Date.now(),
      data: {
        marketPrice,
        listingPrice,
        trendValue,
        trendPct,
        productId,
        captureMode: mode,
        hasMore,
        rowCount: latestSalesRows.length,
        tcgFeedSanity,
        pricePoints: parsePricePoints(),
        comparisonMarketPrices,
        latestSalesRows,
        context: {
          language: query.get("Language") || query.get("language") || null,
          condition: query.get("Condition") || query.get("condition") || null,
          printing: query.get("Printing") || query.get("printing") || null
        },
        condition: selectedCondition,
        language: readSelectText([
          "button[aria-label*='Language']",
          "[data-testid*='Language']"
        ]),
        bodySample: body.slice(0, 1200)
      }
    };
  }
  if (source === "ebay") {
    const u = new URL(location.href);
    const isSoldSearchPage =
      (u.searchParams.get("LH_Sold") === "1" || u.searchParams.get("lh_sold") === "1") &&
      (u.searchParams.get("LH_Complete") === "1" || u.searchParams.get("lh_complete") === "1");
    const pageFromUrl = Number.parseInt(u.searchParams.get("_pgn") || "1", 10);
    const currentPage = Number.isFinite(pageFromUrl) && pageFromUrl > 0 ? pageFromUrl : 1;
    const parseSoldAt = (text) => {
      const raw = String(text || "").replace(/\s+/g, " ");
      let m = raw.match(
        /Sold\s+((?:[A-Za-z]{3,9}|\d{1,2}\/\d{1,2}\/\d{2,4})[\s,]+\d{4}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{2,4})/i
      );
      if (!m) m = raw.match(/Sold\s+(\d{4}-\d{2}-\d{2})/i);
      if (!m) return null;
      const datePart = m[1].trim();
      const hasExplicitTime =
        /(?:^|[\s,;T])\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?/i.test(datePart) ||
        /t\d{2}:\d{2}/i.test(datePart);
      const isoDay = datePart.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (isoDay) {
        const y = Number(isoDay[1]);
        const mo = Number(isoDay[2]) - 1;
        const da = Number(isoDay[3]);
        return new Date(y, mo, da, 12, 0, 0, 0).getTime();
      }
      const parsed = Date.parse(datePart);
      if (!Number.isFinite(parsed)) return null;
      if (hasExplicitTime) return parsed;
      const d = new Date(parsed);
      return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0).getTime();
    };
    const soldFromNodeText = (txt) => {
      const t = String(txt || "").toLowerCase();
      return t.includes("sold ") || t.includes("ended ");
    };
    const parseGradeTag = (title) => {
      const t = String(title || "").toUpperCase();
      const grader =
        /\bPSA\b/.test(t) ? "PSA" :
        /\bCGC\b/.test(t) ? "CGC" :
        /\bBGS\b|\bBECKETT\b/.test(t) ? "BGS" :
        /\bSGC\b/.test(t) ? "SGC" :
        /\bTAG\b/.test(t) ? "TAG" : null;
      const mPristine =
        t.match(/\b(?:PRISTINE|BLACK LABEL)\s*(10)\b/) || t.match(/\b10\s*(?:PRISTINE|BLACK LABEL)\b/);
      const mSimple = t.match(/\b(?:PSA|CGC|BGS|SGC|TAG|BECKETT)\s*(\d{1,2}(?:\.\d)?)\b/);
      let gradeTag = null;
      if (mPristine && grader) gradeTag = `${grader} 10 PRISTINE`;
      else if (mSimple && grader) gradeTag = `${grader} ${mSimple[1]}`;
      else if (grader) {
        const gEsc = grader.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const mGemMint = t.match(
          new RegExp(`\\b${gEsc}\\b[\\s\\S]{0,140}?\\bGEM\\s+MINT\\s+(\\d{1,2}(?:\\.\\d)?)\\b`, "i")
        );
        const mMintGrade = t.match(
          new RegExp(`\\b${gEsc}\\b[\\s\\S]{0,100}?\\bMINT\\s+(\\d{1,2}(?:\\.\\d)?)\\b`, "i")
        );
        if (mGemMint) gradeTag = `${grader} ${mGemMint[1]} GEM MINT`;
        else if (mMintGrade && !mSimple) gradeTag = `${grader} ${mMintGrade[1]} MINT`;
      }
      return { grader, gradeTag, isGraded: Boolean(grader && gradeTag) };
    };
    const parseConditionTag = (title) => {
      const t = ` ${String(title || "").toUpperCase().replace(/[^A-Z0-9 ]+/g, " ")} `;
      if (/\bNEAR MINT\b|\bNM\b/.test(t)) return "NM";
      if (/\bLIGHTLY PLAYED\b|\bLP\b/.test(t)) return "LP";
      if (/\bMODERATELY PLAYED\b|\bMP\b/.test(t)) return "MP";
      if (/\bHEAVILY PLAYED\b|\bHP\b/.test(t)) return "HP";
      if (/\bDAMAGED\b|\bDMG\b/.test(t)) return "DMG";
      return null;
    };
    const parsePokemonCenterStamp = (title) => {
      const t = String(title || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (/\bpokemon center stamped\b/.test(t)) return true;
      if (/\bpokemon center stamp\b/.test(t)) return true;
      if (/\bpokemon center\b/.test(t)) return true;
      return false;
    };
    const parseSealedInTitle = (title) => {
      const t = String(title || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return /\bsealed\b/.test(t);
    };
    const collectPage = (root = document) => {
      const out = [];
      const excludedOut = [];
      const seenItem = new Set();
      let skippedNoContainer = 0;
      let skippedAd = 0;
      let skippedNotSold = 0;
      let skippedBelowPager = 0;
      let skippedNoTitle = 0;
      let skippedNoStructuredPrice = 0;
      let skippedAmbiguousPrice = 0;
      let dedupedWithinPage = 0;
      const resultsRoot =
        root.querySelector("ul.srp-results, #srp-river-results, .srp-results") || root;
      const rootSelectorUsed =
        resultsRoot === root
          ? "document"
          : resultsRoot.matches("ul.srp-results")
            ? "ul.srp-results"
            : resultsRoot.matches("#srp-river-results")
              ? "#srp-river-results"
              : ".srp-results";
      const liSItemCount = resultsRoot.querySelectorAll("li.s-item").length;
      const listitemCount = resultsRoot.querySelectorAll("[role='listitem']").length;
      const dataViewMiCount = resultsRoot.querySelectorAll("[data-view*='mi:']").length;
      const sItemCount = liSItemCount + dataViewMiCount + listitemCount;
      const listingIdFromRowAttrs = (el) => {
        if (!el || !el.getAttribute) return null;
        const cand = [
          el.getAttribute("data-listingid"),
          el.getAttribute("data-listing-id"),
          el.getAttribute("data-item-id"),
          el.getAttribute("data-listingId")
        ];
        for (const v of cand) {
          const t = String(v || "").trim();
          if (/^\d{4,}$/.test(t)) return t;
        }
        if (el.attributes) {
          for (let i = 0; i < el.attributes.length; i += 1) {
            const a = el.attributes[i];
            const n = a.name.toLowerCase();
            if (!/(item|listing|iguid|iid)/.test(n)) continue;
            const t = String(a.value || "").trim();
            if (/^\d{4,}$/.test(t)) return t;
          }
        }
        const marked = querySelectorAllDeep(el, "[data-item-id], [data-listingid], [data-listing-id]")[0];
        if (marked) {
          const t = String(
            marked.getAttribute("data-item-id") ||
              marked.getAttribute("data-listingid") ||
              marked.getAttribute("data-listing-id") ||
              ""
          ).trim();
          if (/^\d{4,}$/.test(t)) return t;
        }
        return null;
      };
      const getPrimaryListingLink = (container) => {
        const anchors = querySelectorAllDeep(
          container,
          "a.s-item__link[href*='/itm/'], a[href*='/itm/'], a[href*='item=']"
        );
        for (let i = 0; i < anchors.length; i += 1) {
          const href = anchors[i].getAttribute("href");
          if (ebayItemIdFromHref(href)) return anchors[i];
        }
        return null;
      };
      const outermostOnly = (arr) => {
        const a = [...new Set(arr)];
        return a.filter((el) => !a.some((o) => o !== el && o.contains(el)));
      };
      const rowLooksLikeListing = (el) => {
        if (!el) return false;
        if (el.matches?.(".s-item__ad")) return false;
        if (listingIdFromRowAttrs(el)) return true;
        const anchors = querySelectorAllDeep(el, "a[href]");
        for (let i = 0; i < anchors.length; i += 1) {
          if (ebayItemIdFromHref(anchors[i].getAttribute("href"))) return true;
        }
        return (
          querySelectorAllDeep(
            el,
            ".s-item__price, .s-card__price, [class*='s-card__price'], .su-card-container__attributes__primary"
          ).length > 0
        );
      };
      const rawRowCandidates = [];
      resultsRoot.querySelectorAll("li.s-item").forEach((n) => rawRowCandidates.push(n));
      resultsRoot.querySelectorAll("[role='listitem']").forEach((n) => rawRowCandidates.push(n));
      resultsRoot.querySelectorAll("div.su-card-container").forEach((n) => rawRowCandidates.push(n));
      resultsRoot.querySelectorAll("div.s-item, .s-item__wrapper").forEach((n) => rawRowCandidates.push(n));
      let listingRows = outermostOnly(rawRowCandidates).filter(rowLooksLikeListing);
      if (!listingRows.length) {
        listingRows = outermostOnly(Array.from(resultsRoot.querySelectorAll("[role='listitem']")));
      }
      let soldCandidates = 0;
      let duplicateItemLinksSkipped = 0;
      const seenItemAnyState = new Set();
      for (const container of listingRows) {
        if (container.querySelector?.(".s-item__ad, .s-item--watch-at-corner")) {
          skippedAd += 1;
          continue;
        }
        const primaryLink = getPrimaryListingLink(container);
        const hrefItemId = ebayItemIdFromHref(primaryLink?.getAttribute("href"));
        const attrItemId = listingIdFromRowAttrs(container);
        const itemId = hrefItemId || attrItemId;
        if (!itemId) {
          skippedNoContainer += 1;
          continue;
        }
        const anchors = querySelectorAllDeep(container, "a[href]");
        const link =
          primaryLink ||
          anchors.find(
            (a) =>
              String(a.className || "").includes("s-item__link") && ebayItemIdFromHref(a.getAttribute("href"))
          ) || anchors.find((a) => ebayItemIdFromHref(a.getAttribute("href")) === itemId);
        const cardText = collectTextDeep(container);
        soldCandidates += 1;
        // Sold search pages must contain Sold/Ended text; active listings should not be filtered out.
        if (isSoldSearchPage && !soldFromNodeText(cardText)) {
          skippedNotSold += 1;
          continue;
        }
        const textFromNode = (node) => {
          if (!node) return "";
          const ar = (node.getAttribute?.("aria-label") || node.getAttribute?.("title") || "").trim();
          if (ar.length > 2) return ar;
          const deep = collectTextDeep(node).trim();
          if (deep.length > 2) return deep;
          return String(node.textContent || "")
            .replace(/\s+/g, " ")
            .trim();
        };
        const titleFromCardLines = (txt) => {
          if (!txt) return "";
          const oneLine = txt.replace(/\s+/g, " ").trim();
          const parts = oneLine
            .split(/\n+/)
            .map((s) => s.replace(/\s+/g, " ").trim())
            .filter((s) => s.length > 8);
          if (parts.length <= 1 && oneLine.length > 40) {
            const afterSold = oneLine
              .replace(/^[\s\S]*?\bSold\s+[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}\s+/i, "")
              .trim();
            if (afterSold.length > 12) return afterSold.slice(0, 200);
          }
          for (const p of parts) {
            if (/^sold\s+[A-Za-z]{3,9}\s+\d{1,2}/i.test(p)) continue;
            if (/^sold\b/i.test(p) && p.length < 48) continue;
            if (/^\+?\$[\d,.]+\s*(delivery|shipping)?$/i.test(p)) continue;
            if (/^\d+\s+bids?\b/i.test(p)) continue;
            if (/^(best\s+offer|or\s+best\s+offer)/i.test(p)) continue;
            return p.length > 200 ? p.slice(0, 200) : p;
          }
          return parts[0] ? parts[0].slice(0, 200) : "";
        };
        const titleHits = querySelectorAllDeep(
          container,
          [
            "[class*='s-card__title']",
            "[class*='item__title']",
            "[class*='listing__title']",
            ".s-item__title span",
            ".s-item__title",
            "[class*='s-item__title']",
            "[data-testid*='title']",
            "h1",
            "h2",
            "h3"
          ].join(", ")
        );
        const stripOpensPrefix = (s) =>
          String(s || "")
            .replace(/^Opens in a new window\s*/i, "")
            .trim();
        let titleFromBody = "";
        for (let ti = 0; ti < titleHits.length; ti += 1) {
          const cand = stripOpensPrefix(textFromNode(titleHits[ti]));
          if (cand.length > 8) {
            titleFromBody = cand;
            break;
          }
        }
        const titleFromLink = stripOpensPrefix(
          primaryLink?.getAttribute?.("aria-label") || primaryLink?.getAttribute?.("title") || ""
        );
        let title = "";
        if (titleFromLink.length > 8) title = titleFromLink;
        else if (titleFromBody.length > 8) title = titleFromBody;
        else title = textFromNode(link);
        if (!title) title = titleFromCardLines(cardText);
        title = title
          .replace(/new listing|opens in a new window/gi, " ")
          .replace(/opens in (?:new )?tab/gi, " ")
          .replace(/\s+/g, " ")
          .trim();
        const gLink = parseGradeTag(titleFromLink);
        const gBody = parseGradeTag(titleFromBody);
        const idSignalsConflict = Boolean(hrefItemId && attrItemId && hrefItemId !== attrItemId);
        const gradeSignalsConflict =
          titleFromLink.length > 8 &&
          titleFromBody.length > 8 &&
          gLink.isGraded !== gBody.isGraded;
        let slugSignalsConflict = false;
        try {
          const rawH = primaryLink?.getAttribute?.("href") || "";
          if (rawH) {
            const absP = new URL(rawH, location.origin).pathname;
            const slugM = absP.match(/\/itm\/([^/]+)\/(\d{10,})\/?$/i);
            if (slugM) {
              const slugPart = String(slugM[1] || "")
                .replace(/-/g, " ")
                .toLowerCase();
              const slugLooksGraded = /\b(psa|cgc|bgs|sgc|tag|beckett|graded|slab|pristine)\b/.test(slugPart);
              const bodyLooksGraded = parseGradeTag(titleFromBody).isGraded;
              if (slugLooksGraded && !bodyLooksGraded && titleFromLink.length > 8 && gLink.isGraded) {
                slugSignalsConflict = true;
              }
            }
          }
        } catch {
          /* ignore */
        }
        const listingConsistencyMismatch =
          idSignalsConflict || gradeSignalsConflict || slugSignalsConflict;
        const gradeInfo = parseGradeTag(title);
        const conditionTag = parseConditionTag(title);
        if (!title || title.length < 2) {
          skippedNoTitle += 1;
          continue;
        }
        const price = parseEbayListingPrice(container);
        if (price == null) {
          skippedNoStructuredPrice += 1;
          continue;
        }
        if (itemId && seenItemAnyState.has(itemId)) {
          duplicateItemLinksSkipped += 1;
          continue;
        }
        if (itemId) seenItemAnyState.add(itemId);
        const soldAt = isSoldSearchPage ? parseSoldAt(cardText) : Date.now();
        if (isSoldSearchPage && soldAt == null) {
          skippedNotSold += 1;
          continue;
        }

        const bidCountEarly = (() => {
          const m = String(cardText || "").match(/(\d+)\s*bids?\b/i);
          if (!m) return null;
          const n = Number.parseInt(m[1] || "", 10);
          return Number.isFinite(n) && n > 0 ? n : null;
        })();

        const bestOfferAccepted =
          /\bbest\s+offer\s+accepted\b/i.test(cardText) ||
          /\baccepted\s+best\s+offer\b/i.test(cardText);

        /** When freeShipping is true, shippingCost is null (unknown numeric add-on). */
        const parseShippingMeta = (txt) => {
          const t = String(txt || "");
          if (/\bfree\s+(shipping|delivery)\b/i.test(t))
            return { freeShipping: true, shippingCost: null };
          const mShip =
            t.match(/\+\s*\$?\s*([\d,]+(?:\.\d{1,2})?)\s*(?:for\s+)?(?:shipping|delivery|postage)\b/i) ||
            t.match(/\$\s*([\d,]+(?:\.\d{1,2})?)\s+(?:shipping|delivery|postage)\b/i);
          if (mShip) {
            const n = Number.parseFloat(String(mShip[1]).replace(/,/g, ""));
            if (Number.isFinite(n) && n >= 0 && n < 5000)
              return { freeShipping: false, shippingCost: n };
          }
          if (/\b(shipping|delivery)\b/i.test(t)) {
            const pluses = [...t.matchAll(/\+\s*\$?\s*([\d,]+(?:\.\d{1,2})?)/gi)];
            if (pluses.length) {
              const last = pluses[pluses.length - 1];
              const n = Number.parseFloat(String(last[1]).replace(/,/g, ""));
              if (Number.isFinite(n) && n >= 0 && n < 500)
                return { freeShipping: false, shippingCost: n };
            }
          }
          return { freeShipping: false, shippingCost: null };
        };
        const { freeShipping, shippingCost } = parseShippingMeta(cardText);

        let listingKind =
          /\bbuy it now\b/i.test(cardText) ? "bin" : /\bbid\b/i.test(cardText) ? "auction" : "unknown";
        if (isSoldSearchPage && listingKind === "unknown") {
          if (bidCountEarly != null && bidCountEarly >= 1) listingKind = "auction";
          else if (bestOfferAccepted) listingKind = "bin";
        }

        // eBay active SRPs typically show either "Current bid" (auction) or a fixed "Buy It Now" price (BIN).
        // We keep the parser output in `price` and split into currentBid/buyItNow based on listingKind.
        const parseEndsAtMsFromEndsIn = (txt) => {
          const t = String(txt || "");
          if (!/ends\s*in/i.test(t)) return null;
          const lower = t.toLowerCase();
          const day = Number.parseInt((lower.match(/(\d+)\s*(d|day|days)\b/) || [])[1] || "", 10);
          const hour = Number.parseInt((lower.match(/(\d+)\s*(h|hour|hours)\b/) || [])[1] || "", 10);
          const min = Number.parseInt((lower.match(/(\d+)\s*(m|min|mins|minute|minutes)\b/) || [])[1] || "", 10);
          if (!Number.isFinite(day) && !Number.isFinite(hour) && !Number.isFinite(min)) return null;
          const ms =
            (Number.isFinite(day) ? day : 0) * 24 * 60 * 60 * 1000 +
            (Number.isFinite(hour) ? hour : 0) * 60 * 60 * 1000 +
            (Number.isFinite(min) ? min : 0) * 60 * 1000;
          if (!Number.isFinite(ms) || ms <= 0) return null;
          return Date.now() + ms;
        };

        const endsAtMs = parseEndsAtMsFromEndsIn(cardText);
        const bidCount = bidCountEarly;
        const itemUrl = `https://www.ebay.com/itm/${itemId}`;
        if (itemId) seenItem.add(itemId);
        const pickListingImageUrl = (cont) => {
          const imgs = querySelectorAllDeep(cont, "img");
          let best = "";
          for (let ii = 0; ii < imgs.length; ii += 1) {
            const img = imgs[ii];
            const src = String(
              img.currentSrc || img.src || img.getAttribute?.("data-src") || img.getAttribute?.("src") || ""
            ).trim();
            if (!src || /1x1|pixel|spinner|loading|placeholder|^data:/i.test(src)) continue;
            if (/ebayimg\.com|ebaystatic\.com|thumbs\.ebaystatic/i.test(src) && src.length > best.length) {
              best = src;
            }
          }
          return best || null;
        };
        const hasPhoto = (() => {
          const imgs = querySelectorAllDeep(container, "img");
          for (let ii = 0; ii < imgs.length; ii += 1) {
            const img = imgs[ii];
            const src = String(img.getAttribute?.("src") || img.getAttribute?.("data-src") || "").trim();
            if (!src) continue;
            if (/sprite|placeholder|gif;base64|spacer/i.test(src)) continue;
            return true;
          }
          return false;
        })();
        const imageUrl = pickListingImageUrl(container) || "";
        const rowPayload = {
          title: title.length > 180 ? title.slice(0, 180) : title,
          price,
          soldAt,
          itemId: itemId ? String(itemId) : null,
          itemUrl,
          imageUrl,
          hasPhoto,
          gradeTag: gradeInfo.gradeTag,
          grader: gradeInfo.grader,
          isGraded: gradeInfo.isGraded,
          conditionTag,
          pokemonCenterStamp: parsePokemonCenterStamp(title),
          sealedInTitle: parseSealedInTitle(title),
          listingKind,
          currentBid: listingKind === "auction" ? price : null,
          buyItNow: listingKind === "bin" ? price : null,
          bidCount,
          endsAtMs,
          freeShipping,
          shippingCost,
          bestOfferAccepted,
        };
        if (listingConsistencyMismatch) {
          excludedOut.push({
            ...rowPayload,
            excludeReason: "listing_mismatch",
            titleFromLink: titleFromLink.slice(0, 220),
            titleFromBody: titleFromBody.slice(0, 220),
          });
        } else {
          out.push(rowPayload);
        }
      }
      const dedup = new Map();
      for (const r of out) {
        const k = r.itemId || `${r.soldAt}|${r.title}|${r.price}`;
        if (!dedup.has(k)) dedup.set(k, r);
        else dedupedWithinPage += 1;
      }
      const rows = Array.from(dedup.values());
      const excludedDedup = new Map();
      for (const r of excludedOut) {
        const k = r.itemId || `${r.soldAt}|${r.title}|${r.price}`;
        if (!excludedDedup.has(k)) excludedDedup.set(k, r);
      }
      const excludedRows = Array.from(excludedDedup.values());
      return {
        rows,
        excludedRows,
        stats: {
          rootSelectorUsed,
          sItemCount,
          liSItemCount,
          listitemCount,
          dataViewMiCount,
          scannedLinks: listingRows.length,
          uniqueItemIdsSeen: seenItemAnyState.size,
          duplicateItemLinksSkipped,
          soldCandidates,
          keptRows: rows.length,
          dedupedWithinPage,
          skippedNoContainer,
          skippedAd,
          skippedNotSold,
          skippedBelowPager,
          skippedNoTitle,
          skippedNoStructuredPrice,
          skippedAmbiguousPrice,
          skippedNoTitleOrPrice: skippedNoTitle + skippedNoStructuredPrice + skippedAmbiguousPrice,
          excludedKept: excludedRows.length
        }
      };
    };
    const detectMaxPage = () => {
      const nums = [];
      const anchors = Array.from(document.querySelectorAll("a[href*='_pgn='], a.pagination__next"));
      for (const a of anchors) {
        try {
          const raw = a.getAttribute("href") || "";
          const abs = new URL(raw, location.origin);
          const n = Number.parseInt(abs.searchParams.get("_pgn") || "", 10);
          if (Number.isFinite(n) && n > 0) nums.push(n);
        } catch {
          /* ignore */
        }
      }
      if (!nums.length) return currentPage;
      return Math.max(currentPage, ...nums);
    };
    /** Best-effort: apply sold-search facet Graded → Yes / No before scraping (authentic comps split).
     *  Keep aligned with exported `ebayApplyGradedFacetOnly` (RawEngine phase A). */
    const applyEbayGradedFacetClick = async () => {
      if (!ebayGradedFacet) return false;
      const wantYes = ebayGradedFacet === "yes";
      await sleep(500);
      const tryClick = (el) => {
        try {
          el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
          return true;
        } catch {
          return false;
        }
      };
      const blocks = Array.from(
        document.querySelectorAll(".x-refine__multi-uilib-form-field, .x-refine__main__value, [class*='x-refine__multi']")
      );
      for (const block of blocks) {
        const bt = (block.textContent || "").replace(/\s+/g, " ").trim();
        if (!/graded/i.test(bt)) continue;
        const innerLinks = Array.from(block.querySelectorAll("a[href], button")).filter((el) => {
          const t = (el.textContent || "").replace(/\s+/g, " ").trim();
          if (!t || t.length > 48) return false;
          if (wantYes) return /^\s*yes\s*$/i.test(t) || (/yes/i.test(t) && t.length < 12);
          return /^\s*no\s*$/i.test(t) || (/^no\b/i.test(t) && t.length < 12);
        });
        if (innerLinks.length) {
          tryClick(innerLinks[0]);
          return true;
        }
      }
      const allLinks = Array.from(document.querySelectorAll('a[href*="LH_All"], a[href*="LH_TS"], a.x-refine__multi-select-link'));
      for (const a of allLinks) {
        const t = (a.textContent || "").replace(/\s+/g, " ").trim();
        const href = (a.getAttribute("href") || "").toLowerCase();
        if (!/graded/i.test(href) && !/^yes$/i.test(t) && !/^no$/i.test(t)) continue;
        if (wantYes && (/yes/i.test(t) || /graded.*yes/i.test(href))) {
          tryClick(a);
          return true;
        }
        if (!wantYes && (/^no$/i.test(t) || /graded.*no/i.test(href))) {
          tryClick(a);
          return true;
        }
      }
      return false;
    };
    const applyEbayPerPage = async () => {
      if (ebayPerPageTarget == null) return false;
      const target = String(ebayPerPageTarget);
      const pickPerPageOption = (optsArr) => {
        const t = String(target).trim();
        const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        let o = optsArr.find((x) => String(x.value || "").trim() === t);
        if (o) return o;
        o = optsArr.find((x) => {
          const tx = String(x.textContent || "")
            .replace(/\s+/g, " ")
            .trim();
          return tx === t || new RegExp(`\\b${esc}\\b`).test(tx);
        });
        if (o) return o;
        o = optsArr.find((x) => String(x.textContent || "").replace(/\D/g, "") === t);
        return o || null;
      };
      const rankPerPageSelect = (sel) => {
        try {
          const id = (sel.id || "").toLowerCase();
          const ar = (sel.getAttribute("aria-label") || "").toLowerCase();
          if (id.includes("srp-ipp") || id.includes("items")) return 0;
          if (/result|per page|items per page|pagination|ipp/i.test(ar)) return 1;
          return 2;
        } catch {
          return 2;
        }
      };
      const allSelects = Array.from(document.querySelectorAll("select"));
      const ippEl =
        document.querySelector("#srp-ipp-select") ||
        document.querySelector('select[id*="srp-ipp"]') ||
        document.querySelector('select[id*="SRP-IPP"]') ||
        document.querySelector('select[name="_ipg"]') ||
        document.querySelector('select[aria-label*="per page"]') ||
        document.querySelector('select[aria-label*="Per page"]');
      const orderedSelects = [];
      if (ippEl && allSelects.includes(ippEl)) orderedSelects.push(ippEl);
      for (const s of allSelects
        .filter((x) => x !== ippEl)
        .sort((a, b) => rankPerPageSelect(a) - rankPerPageSelect(b))) {
        orderedSelects.push(s);
      }
      const selects = orderedSelects.length ? orderedSelects : allSelects;
      for (const sel of selects) {
        const selOpts = Array.from(sel.options || []);
        const hit = pickPerPageOption(selOpts);
        if (!hit) continue;
        sel.value = hit.value;
        sel.dispatchEvent(new Event("input", { bubbles: true }));
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
      try {
        const pu = new URL(window.location.href);
        const target = String(ebayPerPageTarget);
        const cur = pu.searchParams.get("_ipg") || pu.searchParams.get("ipg") || "";
        if (String(cur).trim() !== target) {
          pu.searchParams.set("_ipg", target);
          const next = pu.toString();
          if (next !== window.location.href) {
            window.location.assign(next);
            return true;
          }
        }
      } catch {
        /* ignore */
      }
      return false;
    };
    const roughListingRowCount = () => {
      const rr =
        document.querySelector("ul.srp-results, #srp-river-results, .srp-results") || document.body;
      const light = rr.querySelectorAll("li.s-item").length;
      const role = rr.querySelectorAll("[role='listitem']").length;
      const deepLi = querySelectorAllDeep(rr, "li.s-item").length;
      return Math.max(light, role, deepLi);
    };
    const ebayQuickRefresh = options?.ebayQuickRefresh === true;
    // Do not paginate via click here. Full navigation destroys this script context in MV3.
    let gradedFacetApplied = false;
    if (ebaySkipGradedFacetClick) {
      gradedFacetApplied = options?.ebayGradedFacetAlreadyApplied === true;
    } else {
      gradedFacetApplied = await applyEbayGradedFacetClick();
    }
    let perPageDropdownApplied = false;
    let ebayQuickRefreshSkippedPerPageAndDeep = false;
    if (ebaySkipPerPageChange) {
      perPageDropdownApplied = options?.ebayPerPageAlreadyApplied === true;
    } else if (
      mode === "deep" &&
      ebayQuickRefresh &&
      ebayStopDeepPagingWhenPageMaxSoldAtLteMs != null &&
      isSoldSearchPage
    ) {
      await sleep(350);
      const pr0 = Date.now();
      while (Date.now() - pr0 < 9000 && roughListingRowCount() < 1) {
        await sleep(220);
      }
      const ins = await ebayInspectSoldPageOnly();
      if (
        ins.parseableDateRows >= 1 &&
        ins.maxSoldAt != null &&
        Number.isFinite(ins.maxSoldAt) &&
        ins.maxSoldAt <= ebayStopDeepPagingWhenPageMaxSoldAtLteMs
      ) {
        ebayQuickRefreshSkippedPerPageAndDeep = true;
        perPageDropdownApplied = false;
      } else {
        perPageDropdownApplied = await applyEbayPerPage();
      }
    } else {
      perPageDropdownApplied = await applyEbayPerPage();
    }
    await runImpatienceSimulation();
    await sleep(300);
    const pollStart = Date.now();
    while (Date.now() - pollStart < ebayListingPollMaxMs && roughListingRowCount() < 1) {
      await sleep(180);
    }
    await sleep(ebayListingSettleMs);
    const listingPollElapsedMs = Date.now() - pollStart;
    const firstPage = collectPage(document);
    const merged = [...firstPage.rows];
    const mergedExcluded = [...(firstPage.excludedRows || [])];
    let ebayQuickSkipDeepAfterFirstPage = false;
    if (
      mode === "deep" &&
      ebayQuickRefresh &&
      ebayStopDeepPagingWhenPageMaxSoldAtLteMs != null &&
      firstPage.rows.length > 0
    ) {
      let maxS = -Infinity;
      let datesOk = true;
      for (const r of firstPage.rows) {
        const t = typeof r.soldAt === "number" && Number.isFinite(r.soldAt) ? r.soldAt : null;
        if (t == null) {
          datesOk = false;
          break;
        }
        maxS = Math.max(maxS, t);
      }
      if (
        datesOk &&
        Number.isFinite(maxS) &&
        maxS <= ebayStopDeepPagingWhenPageMaxSoldAtLteMs
      ) {
        ebayQuickSkipDeepAfterFirstPage = true;
      }
    }
    const stats = {
      pagesScanned: 1,
      ebayListingPollMs: listingPollElapsedMs,
      ebayListingSettleMsUsed: ebayListingSettleMs,
      ebayDeepShortHtmlSkips: 0,
      ebayDeepLoopExceptions: 0,
      rootSelectorUsed: firstPage.stats.rootSelectorUsed,
      sItemCount: firstPage.stats.sItemCount,
      liSItemCount: firstPage.stats.liSItemCount,
      listitemCount: firstPage.stats.listitemCount,
      dataViewMiCount: firstPage.stats.dataViewMiCount,
      currentPageRows: firstPage.rows.length,
      scannedLinks: firstPage.stats.scannedLinks,
      uniqueItemIdsSeen: firstPage.stats.uniqueItemIdsSeen,
      duplicateItemLinksSkipped: firstPage.stats.duplicateItemLinksSkipped,
      soldCandidates: firstPage.stats.soldCandidates,
      keptRowsPreGlobalDedup: firstPage.stats.keptRows,
      dedupedWithinPages: firstPage.stats.dedupedWithinPage,
      skippedNoContainer: firstPage.stats.skippedNoContainer,
      skippedAd: firstPage.stats.skippedAd,
      skippedNotSold: firstPage.stats.skippedNotSold,
      skippedBelowPager: firstPage.stats.skippedBelowPager,
      skippedNoTitle: firstPage.stats.skippedNoTitle,
      skippedNoStructuredPrice: firstPage.stats.skippedNoStructuredPrice,
      skippedAmbiguousPrice: firstPage.stats.skippedAmbiguousPrice,
      skippedNoTitleOrPrice: firstPage.stats.skippedNoTitleOrPrice,
      dedupedAcrossPages: 0
    };
    if (mode === "deep") {
      const deepPhaseStartedAt = Date.now();
      const skipDeepForQuick =
        ebayQuickRefreshSkippedPerPageAndDeep || ebayQuickSkipDeepAfterFirstPage;
      if (skipDeepForQuick) {
        stats.ebayQuickRefreshEarlyCatchup = true;
        stats.ebayQuickRefreshSkipDeepReason = ebayQuickRefreshSkippedPerPageAndDeep
          ? "prePerPageInspect"
          : "firstPageMaxSold";
        stats.ebayDeepFetchPhaseMs = Date.now() - deepPhaseStartedAt;
      } else {
      let maxPageInPager = detectMaxPage();
      const probeCeiling = currentPage + 42;
      const effectiveLastPage = Math.max(maxPageInPager, probeCeiling);
      const parser = new DOMParser();
      const startedAt = Date.now();
      let noGrowthRounds = 0;
      let lastMergedLen = merged.length;
      let consecutiveEmptyPages = 0;
      let consecutiveFetchFailures = 0;
      let shortHtmlStreak = 0;
      let deepLoopExceptions = 0;
      let deepStopped = false;
      const EBAY_FETCH_TIMEOUT_MS = 90000;
      const EBAY_FETCH_ATTEMPTS = 4;
      const buildDeepFetchPageUrl = (pageNum) => {
        const pu = new URL(location.href);
        pu.searchParams.set("_pgn", String(pageNum));
        if (ebayPerPageTarget != null) {
          pu.searchParams.set("_ipg", String(ebayPerPageTarget));
        }
        if (ebayGradedFacet === "yes") {
          pu.searchParams.set("Graded", "Yes");
        } else if (ebayGradedFacet === "no") {
          pu.searchParams.set("Graded", "No");
        }
        return pu.toString();
      };
      stats.ebayDeepFetchConcurrencyInitial = ebayDeepFetchConcurrency;
      let effDeepConc = ebayDeepFetchConcurrency;
      stats.ebayDeepFetchConcurrency = effDeepConc;
      stats.ebayDeepUrlParamsIpg = ebayPerPageTarget != null ? ebayPerPageTarget : null;
      stats.ebayDeepUrlParamsGraded = ebayGradedFacet || null;
      const fetchSoldSearchPage = async (pageUrl) => {
        for (let attempt = 0; attempt < EBAY_FETCH_ATTEMPTS; attempt += 1) {
          try {
            const ctrl = new AbortController();
            const tid = setTimeout(() => ctrl.abort(), EBAY_FETCH_TIMEOUT_MS);
            const res = await fetch(pageUrl, { credentials: "include", signal: ctrl.signal });
            clearTimeout(tid);
            if (res.ok) return res;
          } catch {
            /* retry */
          }
          await sleep(450 * (attempt + 1));
        }
        return null;
      };
      const processRemoteHtml = (page, html) => {
        if (!html || html.length < 1000) {
          shortHtmlStreak += 1;
          stats.ebayDeepShortHtmlSkips += 1;
          if (shortHtmlStreak >= 6) deepStopped = true;
          return;
        }
        shortHtmlStreak = 0;
        let doc;
        try {
          doc = parser.parseFromString(html, "text/html");
        } catch {
          deepLoopExceptions += 1;
          stats.ebayDeepLoopExceptions = deepLoopExceptions;
          if (deepLoopExceptions >= 5) deepStopped = true;
          return;
        }
        const pageResult = collectPage(doc);
        if (!pageResult.rows.length) {
          consecutiveEmptyPages += 1;
          if (page > maxPageInPager && consecutiveEmptyPages >= 2) deepStopped = true;
          return;
        }
        consecutiveEmptyPages = 0;
        stats.pagesScanned += 1;
        stats.scannedLinks += pageResult.stats.scannedLinks;
        stats.uniqueItemIdsSeen += pageResult.stats.uniqueItemIdsSeen;
        stats.duplicateItemLinksSkipped += pageResult.stats.duplicateItemLinksSkipped;
        stats.soldCandidates += pageResult.stats.soldCandidates;
        stats.sItemCount += pageResult.stats.sItemCount;
        stats.keptRowsPreGlobalDedup += pageResult.stats.keptRows;
        stats.dedupedWithinPages += pageResult.stats.dedupedWithinPage;
        stats.skippedNoContainer += pageResult.stats.skippedNoContainer;
        stats.skippedAd += pageResult.stats.skippedAd;
        stats.skippedNotSold += pageResult.stats.skippedNotSold;
        stats.skippedBelowPager += pageResult.stats.skippedBelowPager;
        stats.skippedNoTitle += pageResult.stats.skippedNoTitle;
        stats.skippedNoStructuredPrice += pageResult.stats.skippedNoStructuredPrice;
        stats.skippedAmbiguousPrice += pageResult.stats.skippedAmbiguousPrice;
        if (
          ebayStopDeepPagingWhenPageMaxSoldAtLteMs != null &&
          pageResult.rows.length > 0
        ) {
          let maxSold = -Infinity;
          let allFinite = true;
          for (const r of pageResult.rows) {
            const t =
              typeof r.soldAt === "number" && Number.isFinite(r.soldAt) ? r.soldAt : null;
            if (t == null) {
              allFinite = false;
              break;
            }
            maxSold = Math.max(maxSold, t);
          }
          if (
            allFinite &&
            Number.isFinite(maxSold) &&
            maxSold <= ebayStopDeepPagingWhenPageMaxSoldAtLteMs
          ) {
            stats.ebayDeepStoppedIncremental = true;
            deepStopped = true;
          }
        }
        merged.push(...pageResult.rows);
        if (pageResult.excludedRows?.length) mergedExcluded.push(...pageResult.excludedRows);
        if (merged.length <= lastMergedLen) noGrowthRounds += 1;
        else noGrowthRounds = 0;
        lastMergedLen = merged.length;
        if (noGrowthRounds >= 3) deepStopped = true;
        try {
          const docPagerMax = (() => {
            const nums = [];
            const aa = Array.from(doc.querySelectorAll("a[href*='_pgn=']"));
            for (const x of aa) {
              try {
                const raw = x.getAttribute("href") || "";
                const abs = new URL(raw, location.origin);
                const n = Number.parseInt(abs.searchParams.get("_pgn") || "", 10);
                if (Number.isFinite(n) && n > 0) nums.push(n);
              } catch {
                /* ignore */
              }
            }
            return nums.length ? Math.max(...nums) : maxPageInPager;
          })();
          maxPageInPager = Math.max(maxPageInPager, docPagerMax);
        } catch {
          /* ignore */
        }
      };
      for (
        let batchStart = currentPage + 1;
        batchStart <= effectiveLastPage && !deepStopped;
        batchStart += effDeepConc
      ) {
        if (Date.now() - startedAt > ebayDeepBudgetMs) break;
        const batchEnd = Math.min(batchStart + effDeepConc - 1, effectiveLastPage);
        const batchPages = [];
        for (let p = batchStart; p <= batchEnd; p += 1) batchPages.push(p);
        let rawResults;
        try {
          rawResults = await Promise.all(
            batchPages.map(async (page) => {
              if (Date.now() - startedAt > ebayDeepBudgetMs) {
                return { page, budgetExceeded: true, ok: false, html: null };
              }
              const res = await fetchSoldSearchPage(buildDeepFetchPageUrl(page));
              if (!res) return { page, ok: false, html: null };
              const html = await res.text();
              return { page, ok: true, html };
            })
          );
        } catch {
          deepLoopExceptions += 1;
          stats.ebayDeepLoopExceptions = deepLoopExceptions;
          if (deepLoopExceptions >= 5) break;
          continue;
        }
        rawResults.sort((a, b) => a.page - b.page);
        for (const one of rawResults) {
          if (Date.now() - startedAt > ebayDeepBudgetMs) {
            deepStopped = true;
            break;
          }
          if (one.budgetExceeded) {
            deepStopped = true;
            break;
          }
          if (!one.ok) {
            consecutiveFetchFailures += 1;
            if (consecutiveFetchFailures >= 8) {
              deepStopped = true;
              break;
            }
            continue;
          }
          consecutiveFetchFailures = 0;
          processRemoteHtml(one.page, one.html);
          if (deepStopped) break;
        }
        let batchFails = 0;
        for (const one of rawResults) {
          if (!one.ok) batchFails += 1;
        }
        if (batchPages.length > 0 && batchFails >= Math.ceil(batchPages.length / 2) && effDeepConc > 1) {
          effDeepConc = Math.max(1, Math.floor(effDeepConc / 2));
          stats.ebayDeepFetchConcurrency = effDeepConc;
          stats.ebayDeepAdaptiveConcurrencyReduced = true;
        }
      }
      stats.ebayDeepFetchPhaseMs = Date.now() - deepPhaseStartedAt;
      }
    }
    stats.skippedNoTitleOrPrice =
      (stats.skippedNoTitle || 0) + (stats.skippedNoStructuredPrice || 0) + (stats.skippedAmbiguousPrice || 0);
    const byKey = new Map();
    for (const r of merged) {
      const k = r.itemId || `${r.soldAt}|${r.title}|${r.price}`;
      if (!byKey.has(k)) byKey.set(k, r);
    }
    const uniques = Array.from(byKey.values());
    stats.dedupedAcrossPages = Math.max(0, merged.length - uniques.length);
    const byKeyEx = new Map();
    for (const r of mergedExcluded) {
      const k = r.itemId || `${r.soldAt}|${r.title}|${r.price}`;
      if (!byKeyEx.has(k)) byKeyEx.set(k, r);
    }
    const excludedUniques = Array.from(byKeyEx.values());
    let listed = uniques;
    if (
      options?.ebayQuickRefresh === true &&
      ebaySoldWatermarkMs != null &&
      ebaySoldWatermarkMs > 0
    ) {
      const wm = ebaySoldWatermarkMs;
      const dated = uniques.filter((r) => typeof r.soldAt === 'number' && Number.isFinite(r.soldAt));
      if (dated.length > 0) {
        const maxT = Math.max(...dated.map((r) => r.soldAt));
        if (maxT <= wm) {
          listed = [];
          stats.ebayQuickRefreshCatchupEmpty = true;
        } else {
          listed = uniques.filter(
            (r) => typeof r.soldAt === 'number' && Number.isFinite(r.soldAt) && r.soldAt > wm
          );
          stats.ebayQuickRefreshNewSoldOnly = true;
          stats.ebayQuickRefreshFirstPageRowCount = uniques.length;
          stats.ebayQuickRefreshNewSoldRowCount = listed.length;
        }
      }
    }
    const gradeCounts = { PSA: 0, CGC: 0, BGS: 0, SGC: 0, TAG: 0, RAW: 0 };
    for (const r of listed) {
      if (r.isGraded && r.grader && gradeCounts[r.grader] != null) gradeCounts[r.grader] += 1;
      else gradeCounts.RAW += 1;
    }
    return {
      source: "ebay",
      url: location.href,
      title: document.title,
      capturedAt: Date.now(),
      data: {
        query: (u.searchParams.get("_nkw") || u.searchParams.get("nkw") || "").trim(),
        captureMode: mode,
        hasMore: Boolean(
          document.querySelector("a.pagination__next:not([aria-disabled='true'])")
        ),
        rowCount: listed.length,
        listings: listed,
        excludedListings: excludedUniques,
        excludedRowCount: excludedUniques.length,
        captureStats: {
          ...stats,
          gradeCounts,
          excludedAcrossPages: excludedUniques.length,
          gradedFacet: ebayGradedFacet,
          gradedFacetApplied,
          ebayPerPageApplied: perPageDropdownApplied,
          ebayDeepBudgetMs
        }
      }
    };
  }
  if (source === "pricecharting") {
    const body = (document.body?.innerText || "").replace(/\s+/g, " ");
    const rawMatch = body.match(/\b(ungraded|raw|loose)\b[\s\S]{0,40}?\$([\d,]+(?:\.\d{1,2})?)/i);
    const pcUrl = canonicalizePricechartingPageUrl(location.href) || location.href;
    return {
      source: "pricecharting",
      url: pcUrl,
      title: document.title,
      capturedAt: Date.now(),
      data: {
        rawPrice: rawMatch ? parseUsd(rawMatch[2]) : null,
        tcgplayerUrl:
          document.querySelector("a[href*='tcgplayer.com/product/']")?.getAttribute("href") || null,
        bodySample: body.slice(0, 1200)
      }
    };
  }
  return { error: "This page is not a supported capture target." };
}
