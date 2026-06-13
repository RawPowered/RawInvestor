import { extractCurrentPageInTab } from "./extractPageInTab.mjs";
import {
  readCaptureFlight,
  writeCaptureFlight,
  clearCaptureFlight,
  startBadgeTimer,
  ebayGradedLaneFromUrl,
  derivePassFromUrlAndSession,
  passLabel
} from "./captureFlight.mjs";

const DEFAULT_SERVER = "http://localhost:3001";
const DEFAULT_PROBS = { p10: 0.3, p9: 0.5 };
const PCGR_CONNECTION_URL = "pcgr-connection.json";

/** @param {Record<string, string>} patch */
const applyCaptureConfigPatch = async (patch) => {
  if (!patch || !Object.keys(patch).length) return { updated: [] };
  await chrome.storage.local.set(patch);
  return { updated: Object.keys(patch) };
};

/**
 * Desktop app writes pcgr-connection.json into the stable extension folder on launch.
 * @returns {Promise<{ ok: boolean; applied?: boolean; reason?: string }>}
 */
const applyPcgrConnectionFromFile = async () => {
  try {
    const url = chrome.runtime.getURL(PCGR_CONNECTION_URL);
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return { ok: true, applied: false, reason: "missing-file" };
    const data = await res.json().catch(() => null);
    if (!data || typeof data !== "object") return { ok: true, applied: false, reason: "invalid-json" };

    const stored = await chrome.storage.local.get(["pcgrConnectionVersion"]);
    const incomingVer = String(data.version || data.writtenAt || "").trim();
    if (
      incomingVer &&
      stored.pcgrConnectionVersion === incomingVer &&
      String(data.serverBase || "").trim()
    ) {
      return { ok: true, applied: false, reason: "unchanged" };
    }

    const patch = {};
    const serverBase = String(data.serverBase || "").trim();
    const extToken = String(data.extToken || "").trim();
    const appToken = String(data.appToken || "").trim();
    if (serverBase) patch.serverBase = serverBase.replace(/\/$/, "");
    if (extToken) patch.extToken = extToken;
    if (appToken) patch.appToken = appToken;
    if (incomingVer) patch.pcgrConnectionVersion = incomingVer;

    if (!Object.keys(patch).length) return { ok: true, applied: false, reason: "empty-patch" };

    await applyCaptureConfigPatch(patch);

    const base = String(patch.serverBase || serverBase || DEFAULT_SERVER).replace(/\/$/, "");
    const headers = { Accept: "application/json" };
    if (patch.extToken) headers["x-ext-token"] = patch.extToken;
    if (patch.appToken) headers["x-pcgr-app-token"] = patch.appToken;
    let setupWizardComplete = false;
    try {
      const healthRes = await fetch(`${base}/api/health`, { headers, cache: "no-store" });
      const healthData = await healthRes.json().catch(() => ({}));
      const mode = String(healthData?.mode || "").toLowerCase();
      const tokenRequired = mode === "hardened";
      const extOk = Boolean(patch.extToken);
      if (healthRes.ok && (!tokenRequired || extOk)) {
        setupWizardComplete = true;
      }
    } catch {
      /* health may fail until desktop app starts */
    }
    if (setupWizardComplete) {
      await chrome.storage.local.set({ setupWizardComplete: true });
    }
    return { ok: true, applied: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
};

void applyPcgrConnectionFromFile();
chrome.runtime.onInstalled.addListener(() => {
  void applyPcgrConnectionFromFile();
});

/** Align with server GET /api/scrape and `canonicalizePricechartingUrl`. */
const normalizePricechartingTabUrl = (raw) => {
  let url = String(raw || "")
    .trim()
    .replace(/\/+$/, "");
  try {
    const u = new URL(url);
    if (!/^([a-z0-9-]+\.)*pricecharting\.com$/i.test(u.hostname)) return null;
    if (/^m\.pricecharting\.com$/i.test(u.hostname)) u.hostname = "www.pricecharting.com";
    return u.toString();
  } catch {
    return null;
  }
};

const apiCall = async (path, init = {}) => {
  const { serverBase = DEFAULT_SERVER, extToken = "", appToken = "" } =
    await chrome.storage.local.get(["serverBase", "extToken", "appToken"]);
  const endpoint = `${String(serverBase || DEFAULT_SERVER).replace(/\/$/, "")}${path}`;
  const headers = {
    Accept: "application/json",
    ...(init.headers || {})
  };
  if (extToken) headers["x-ext-token"] = String(extToken);
  if (appToken) headers["x-pcgr-app-token"] = String(appToken);
  const res = await fetch(endpoint, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || `Request failed (${res.status})`);
  }
  return data;
};

const loadStoreDoc = async () => apiCall("/api/store");
const saveStoreDoc = async (doc) =>
  apiCall("/api/store", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(doc)
  });

/** SQLite-backed portfolio: membership is resolved server-side (GET /api/store cards[] is empty). */
const lookupDashboardCardId = async (source, pageUrl) => {
  const src = source === "pricecharting" ? "pricecharting" : "tcgplayer";
  const data = await apiCall(
    `/api/ext/dashboard-card?source=${encodeURIComponent(src)}&url=${encodeURIComponent(pageUrl)}`
  );
  const id = data?.id ? String(data.id).trim() : "";
  return id || null;
};

const deleteCardByIdOnServer = async (id) =>
  apiCall(`/api/cards/${encodeURIComponent(id)}`, { method: "DELETE" });

const buildCardFromPricecharting = async (pricechartingUrl, tcgplayerUrl = null) => {
  const data = await apiCall(`/api/scrape?url=${encodeURIComponent(pricechartingUrl)}`);
  const now = Date.now();
  const recentSales = Array.isArray(data?.recentSales) ? data.recentSales : [];
  const seedHistory = recentSales
    .map((s) => {
      if (!s || typeof s !== "object") return null;
      const at = Number(s.at);
      const price = Number(s.price);
      if (!Number.isFinite(at) || !Number.isFinite(price)) return null;
      const grade = String(s.grade || "").toLowerCase();
      if (grade === "raw") return { at, raw: price, source: "pc_sale" };
      if (grade === "grade9") return { at, grade9: price, source: "pc_sale" };
      if (grade === "psa10") return { at, psa10: price, source: "pc_sale" };
      return null;
    })
    .filter(Boolean)
    .sort((a, b) => a.at - b.at);
  seedHistory.push({
    at: now,
    raw: Number.isFinite(data?.raw) ? Number(data.raw) : 0,
    grade9: Number.isFinite(data?.grade9) ? Number(data.grade9) : 0,
    psa10: Number.isFinite(data?.psa10) ? Number(data.psa10) : 0,
    source: "initial"
  });
  return {
    id: crypto.randomUUID(),
    name: data?.name || "Unknown Card",
    set: data?.set || "Unknown Set",
    rarity: "",
    cardNumber: data?.cardNumber || "",
    url: data?.url || pricechartingUrl,
    localImage: data?.localImage ?? null,
    raw: Number.isFinite(data?.raw) ? Number(data.raw) : 0,
    grade9: Number.isFinite(data?.grade9) ? Number(data.grade9) : 0,
    psa10: Number.isFinite(data?.psa10) ? Number(data.psa10) : 0,
    allPrices: Array.isArray(data?.allPrices) ? data.allPrices : [],
    tcgplayerUrl: tcgplayerUrl || data?.tcgplayerUrl || "",
    releaseDateMs: Number.isFinite(data?.releaseDateMs) ? Number(data.releaseDateMs) : null,
    recentSales,
    salesVolume: data?.salesVolume && typeof data.salesVolume === "object" ? data.salesVolume : {},
    priceHistory: seedHistory,
    lastRefreshedAt: now,
    p10: DEFAULT_PROBS.p10,
    p9: DEFAULT_PROBS.p9,
    portfolioKind: data?.suggestedPortfolioKind === "sealed" ? "sealed" : "single"
  };
};

const buildCardFromTcgplayer = async (tcgplayerUrl) => {
  let pcCandidate = null;
  let tcgData = null;
  try {
    tcgData = await apiCall(`/api/tcgplayer/product?url=${encodeURIComponent(tcgplayerUrl)}`);
  } catch {
    tcgData = null;
  }
  const q = [tcgData?.productName, tcgData?.setName].filter(Boolean).join(" ").trim();
  if (q) {
    try {
      const hint = await apiCall(`/api/pricecharting/search?q=${encodeURIComponent(q)}`);
      pcCandidate = hint?.url || null;
    } catch {
      pcCandidate = null;
    }
  }
  if (pcCandidate) {
    return buildCardFromPricecharting(pcCandidate, tcgplayerUrl);
  }
  return {
    id: crypto.randomUUID(),
    name: tcgData?.productName || "TCGPlayer Card",
    set: tcgData?.setName || "Unknown Set",
    rarity: tcgData?.rarityName || "",
    url: "",
    tcgplayerUrl,
    raw: Number.isFinite(tcgData?.marketPrice) ? Number(tcgData.marketPrice) : 0,
    grade9: 0,
    psa10: 0,
    p10: DEFAULT_PROBS.p10,
    p9: DEFAULT_PROBS.p9
  };
};

const getDashboardCardState = async ({ source, url }) => {
  const workUrl =
    source === "pricecharting"
      ? normalizePricechartingTabUrl(url)
      : String(url || "").trim();
  if (source === "pricecharting" && !workUrl) {
    return { added: false };
  }
  if (source === "tcgplayer" && !workUrl) {
    return { added: false };
  }
  const existingId = await lookupDashboardCardId(source, workUrl);
  return { added: Boolean(existingId) };
};

const inferCardAndCeilingFromTitle = (cards, listingTitle) => {
  const tl = String(listingTitle || "").toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const c of cards) {
    if (!c || typeof c !== "object") continue;
    const name = String(c.name || "").toLowerCase();
    const tokens = name.split(/[^a-z0-9]+/).filter((x) => x.length >= 4);
    let score = 0;
    for (const t of tokens) {
      if (tl.includes(t)) score += Math.min(t.length, 14);
    }
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  if (!best || bestScore < 10) {
    return { cardId: undefined, maxBidUsd: 1, maxBinUsd: undefined };
  }
  const raw = Number(best.raw);
  const maxBidUsd =
    Number.isFinite(raw) && raw > 0 ? Math.round(raw * 100) / 100 : 1;
  const maxBinUsd =
    Number.isFinite(raw) && raw > 0 ? Math.round(raw * 1.15 * 100) / 100 : undefined;
  return { cardId: best.id, maxBidUsd, maxBinUsd };
};

const addQuickTargetFromListing = async ({
  listingUrl,
  itemId,
  title,
  listingImageUrl,
  listingPriceUsd
}) => {
  const store = await loadStoreDoc();
  const targets = Array.isArray(store?.targets) ? [...store.targets] : [];
  const idStr = String(itemId || "").trim();
  const urlStr = String(listingUrl || "").trim();
  if (
    targets.some(
      (t) =>
        (idStr && String(t.itemId || "") === idStr) ||
        (urlStr && String(t.listingUrl || "") === urlStr)
    )
  ) {
    return { duplicate: true };
  }
  const cards = Array.isArray(store?.cards) ? store.cards : [];
  const inferred = inferCardAndCeilingFromTitle(cards, title);
  const now = Date.now();
  const img = String(listingImageUrl || "").trim();
  const lp =
    listingPriceUsd != null && Number.isFinite(Number(listingPriceUsd))
      ? Number(listingPriceUsd)
      : undefined;
  const next = {
    id: crypto.randomUUID(),
    listingUrl: urlStr || (idStr ? `https://www.ebay.com/itm/${idStr}` : ""),
    itemId: idStr || undefined,
    cardId: inferred.cardId,
    label: String(title || "").slice(0, 160),
    listingTitle: String(title || "").slice(0, 220) || undefined,
    listingImageUrl: img || undefined,
    listingPriceUsd: lp,
    listingCapturedAt: now,
    maxBidUsd: inferred.maxBidUsd,
    maxBinUsd: inferred.maxBinUsd,
    sniperEnabled: false,
    sniperLeadMs: 1500,
    armed: false,
    createdAt: now,
    updatedAt: now
  };
  if (!next.listingUrl) {
    throw new Error("Missing listing URL / item id.");
  }
  targets.unshift(next);
  await saveStoreDoc({ ...store, targets });
  return { added: true };
};

const applyTargetListingSnapshots = async (rows) => {
  if (!Array.isArray(rows) || rows.length === 0) return { touched: 0 };
  const now = Date.now();
  const store = await loadStoreDoc();
  const targets = Array.isArray(store?.targets) ? [...store.targets] : [];
  const byId = new Map(
    rows
      .filter((r) => r && String(r.itemId || "").trim())
      .map((r) => [String(r.itemId).trim(), r])
  );
  let changed = false;
  for (let i = 0; i < targets.length; i += 1) {
    const t = targets[i];
    const id = String(t.itemId || "").trim();
    if (!id || !byId.has(id)) continue;
    const row = byId.get(id);
    const title = String(row.title || "").slice(0, 240);
    const imageUrl = String(row.imageUrl || "").trim();
    const rawPrice = row.priceUsd;
    const priceUsd =
      rawPrice != null && Number.isFinite(Number(rawPrice)) ? Number(rawPrice) : null;
    const nextTitle = title || t.listingTitle;
    const nextImg = imageUrl || t.listingImageUrl;
    const nextPrice =
      priceUsd != null && Number.isFinite(priceUsd) ? priceUsd : t.listingPriceUsd ?? null;
    if (
      t.listingTitle === nextTitle &&
      t.listingImageUrl === nextImg &&
      (t.listingPriceUsd ?? null) === (nextPrice ?? null)
    ) {
      continue;
    }
    targets[i] = {
      ...t,
      listingTitle: nextTitle,
      listingImageUrl: nextImg,
      listingPriceUsd: nextPrice,
      listingCapturedAt: now,
      updatedAt: now
    };
    changed = true;
  }
  if (!changed) return { touched: 0 };
  await saveStoreDoc({ ...store, targets });
  return { touched: 1 };
};

const toggleDashboardCard = async ({ source, url, tabId }) => {
  if (source === "ebay") {
    throw new Error("Direct add from eBay is disabled. Use PriceCharting or TCGPlayer.");
  }
  const workUrl =
    source === "pricecharting"
      ? normalizePricechartingTabUrl(url)
      : String(url || "").trim();
  if (source === "pricecharting" && !workUrl) {
    throw new Error("Invalid PriceCharting URL.");
  }
  const existingId = await lookupDashboardCardId(source, workUrl);
  if (existingId) {
    await deleteCardByIdOnServer(existingId);
    return { added: false, removed: true };
  }
  const nextCard =
    source === "pricecharting"
      ? await buildCardFromPricecharting(workUrl)
      : await buildCardFromTcgplayer(url);
  if (Number.isFinite(tabId) && tabId > 0) {
    // Run extension capture from the same tab so add-flow mirrors scrape + capture + save.
    await captureTabById(tabId, workUrl);
  }
  const store = await loadStoreDoc();
  const cards = Array.isArray(store?.cards) ? [...store.cards] : [];
  cards.unshift(nextCard);
  await saveStoreDoc({ ...store, cards });
  return { added: true, removed: false };
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

const isOpenableCaptureUrl = (raw) => {
  try {
    const u = new URL(String(raw || "").trim());
    const hn = u.hostname.toLowerCase();
    if (/^([a-z0-9-]+\.)*pricecharting\.com$/i.test(hn)) return true;
    const host = hn.replace(/^www\./, "");
    if (host === "tcgplayer.com") return /\/product\/\d+/i.test(u.pathname);
    if (host === "ebay.com" || host === "m.ebay.com") {
      const p = u.pathname.toLowerCase();
      return p.includes("/sch/") && (u.searchParams.get("_nkw") || u.searchParams.get("nkw"));
    }
    return false;
  } catch {
    return false;
  }
};

const PERF_OVERRIDE_KEYS = [
  "ebayDeepFetchConcurrency",
  "ebayPerPageTarget",
  "tcgSalesFeedPollMs",
  "tcgSalesFeedTimeoutMs",
  "tcgMinSalesRows",
  "tcgViewMoreWaitMs",
  "tcgPrePageSettleMs",
  "tcgDeepExtraSettleMs",
  "ebayDeepBudgetMs"
];

const buildCaptureExtractOptions = async () => {
  const { captureMode = "default", capturePerfPreset = "default", captureExtractOverrides } =
    await chrome.storage.local.get(["captureMode", "capturePerfPreset", "captureExtractOverrides"]);
  const mode = captureMode === "deep" ? "deep" : "default";
  const o = { mode };
  if (capturePerfPreset === "fast") {
    Object.assign(o, {
      ebayDeepFetchConcurrency: 6,
      ebayPerPageTarget: 60,
      tcgSalesFeedPollMs: 200,
      tcgSalesFeedTimeoutMs: 20000,
      tcgViewMoreWaitMs: 550,
      tcgPrePageSettleMs: 950,
      tcgDeepExtraSettleMs: 380
    });
  }
  const over =
    captureExtractOverrides && typeof captureExtractOverrides === "object" && !Array.isArray(captureExtractOverrides)
      ? captureExtractOverrides
      : null;
  if (over) {
    for (const k of PERF_OVERRIDE_KEYS) {
      if (over[k] == null) continue;
      const n = Number(over[k]);
      if (Number.isFinite(n)) o[k] = n;
    }
  }
  return o;
};

/** Throttle POSTs from content script navigations / visibility. */
let lastEbaySessionPostAt = 0;
let ebaySessionPostInFlight = false;
const EBAY_SESSION_POST_MIN_MS = 50_000;

const postEbaySessionResult = async (body) => {
  const { serverBase = DEFAULT_SERVER, extToken = "", appToken = "" } =
    await chrome.storage.local.get(["serverBase", "extToken", "appToken"]);
  const endpoint = `${String(serverBase || DEFAULT_SERVER).replace(/\/$/, "")}/api/ext/ebay-session`;
  const headers = { "Content-Type": "application/json" };
  if (extToken) headers["x-ext-token"] = String(extToken);
  if (appToken) headers["x-pcgr-app-token"] = String(appToken);
  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
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
      `eBay session report failed (${res.status}).`;
    throw new Error(msg);
  }
  return data;
};

const postCaptureResult = async (result) => {
  const { serverBase = DEFAULT_SERVER, extToken = "", appToken = "" } =
    await chrome.storage.local.get(["serverBase", "extToken", "appToken"]);
  const endpoint = `${String(serverBase || DEFAULT_SERVER).replace(/\/$/, "")}/api/ext/capture`;
  const headers = { "Content-Type": "application/json" };
  if (extToken) headers["x-ext-token"] = String(extToken);
  if (appToken) headers["x-pcgr-app-token"] = String(appToken);
  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(result)
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
    let out = msg;
    if (
      res.status === 401 &&
      /invalid capture upload token|invalid extension token/i.test(String(msg))
    ) {
      out = `${msg}\n\nOpen Raw Investor (desktop) → Admin → RawEngine capture diagnostics → Copy extension token — or the first-launch wizard — and paste it here. It must match PCGR_EXT_TOKEN on the API.`;
    }
    throw new Error(out);
  }
  const tcgRows = Array.isArray(result?.data?.latestSalesRows) ? result.data.latestSalesRows.length : null;
  const ebayRows = Array.isArray(result?.data?.listings) ? result.data.listings.length : null;
  const captureStats =
    result?.data?.captureStats ||
    (result?.source === "tcgplayer" && result?.data?.tcgFeedSanity
      ? { ...result.data.tcgFeedSanity }
      : null);
  const merge = data?.portfolioMerge;
  const touched = typeof merge?.touched === "number" ? merge.touched : null;
  const mergeWarning =
    typeof merge?.warning === "string" && merge.warning.trim() ? merge.warning.trim() : "";
  const mergeError = typeof merge?.error === "string" && merge.error.trim() ? merge.error.trim() : "";
  if (mergeError) {
    throw new Error(mergeError);
  }
  if (touched === 0 && mergeWarning) {
    throw new Error(mergeWarning);
  }

  const out = {
    ...data,
    source: result?.source || null,
    rowCount: tcgRows != null ? tcgRows : ebayRows != null ? ebayRows : null,
    captureStats,
    portfolioMerge: merge ?? null
  };
  return out;
};

const isBotCheckExtractError = (msg) => /BOT_CHECK/i.test(String(msg || ""));

const injectBotWallApiOnTab = async (tabId) => {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: async () => {
      if (globalThis.__pcgrBotWallDetect) return;
      const url = chrome.runtime.getURL("botWallDetect.mjs");
      const mod = await import(url);
      globalThis.__pcgrBotWallDetect = {
        hasEbaySoldSerpEvidence: mod.hasEbaySoldSerpEvidence,
        hasTcgProductEvidence: mod.hasTcgProductEvidence,
        detectLikelyBotWall: mod.detectLikelyBotWall,
        botCheckErrorMessage: mod.botCheckErrorMessage
      };
    }
  });
};

const tabHasMarketCaptureEvidence = async (tabId, source) => {
  if (source !== "ebay" && source !== "tcgplayer") return false;
  try {
    await injectBotWallApiOnTab(tabId);
    const [{ hasEvidence }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (src) => {
        const b = globalThis.__pcgrBotWallDetect;
        if (!b) return false;
        if (src === "ebay") return b.hasEbaySoldSerpEvidence(document);
        if (src === "tcgplayer") return b.hasTcgProductEvidence(document);
        return false;
      },
      args: [source]
    });
    return hasEvidence === true;
  } catch {
    return false;
  }
};

const fetchQuickFetchSession = async () => {
  try {
    const { serverBase = DEFAULT_SERVER, extToken = "", appToken = "" } =
      await chrome.storage.local.get(["serverBase", "extToken", "appToken"]);
    const base = String(serverBase || DEFAULT_SERVER).replace(/\/$/, "");
    const headers = { Accept: "application/json" };
    if (extToken) headers["x-ext-token"] = String(extToken);
    if (appToken) headers["x-pcgr-app-token"] = String(appToken);
    const metaRes = await fetch(`${base}/api/portfolio/meta`, { headers, cache: "no-store" });
    const meta = await metaRes.json().catch(() => ({}));
    if (metaRes.ok && meta?.quickFetchSession && typeof meta.quickFetchSession === "object") {
      return meta.quickFetchSession;
    }
  } catch {
    /* ignore */
  }
  return null;
};

const showTabCaptureBanner = async (tabId, flight) => {
  const mode = flight?.mode === "deep" ? "deep" : "default";
  const label =
    flight?.queue?.currentLabel ||
    (flight?.pass ? passLabel(flight.pass) : "Capturing…");
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "pcgr-capture-banner-show",
      label,
      mode
    });
  } catch {
    /* content script may not be ready */
  }
};

const hideTabCaptureBanner = async (tabId) => {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "pcgr-capture-banner-hide" });
  } catch {
    /* ignore */
  }
};

const assertCaptureNotInFlight = async () => {
  const flight = await readCaptureFlight();
  if (flight?.active) {
    throw new Error(
      "A capture is already running. Wait for the toolbar badge to clear, or reopen the tab being captured."
    );
  }
};

const findGradedEbayTabs = async (qfSession = null) => {
  const tabs = await chrome.tabs.query({
    url: ["*://www.ebay.com/*", "*://m.ebay.com/*"]
  });
  /** @type {chrome.tabs.Tab[]} */
  const noTabs = [];
  /** @type {chrome.tabs.Tab[]} */
  const yesTabs = [];
  const sessionNo = String(qfSession?.gradedNoUrl || "").trim();
  const sessionYes = String(qfSession?.gradedYesUrl || "").trim();

  const matchesSessionUrl = (tabUrl, sessionUrl) => {
    if (!sessionUrl) return false;
    try {
      const a = new URL(tabUrl);
      const b = new URL(sessionUrl);
      if (a.origin !== b.origin) return false;
      const nkwA = a.searchParams.get("_nkw") || a.searchParams.get("nkw") || "";
      const nkwB = b.searchParams.get("_nkw") || b.searchParams.get("nkw") || "";
      return nkwA === nkwB && ebayGradedLaneFromUrl(tabUrl) === ebayGradedLaneFromUrl(sessionUrl);
    } catch {
      return false;
    }
  };

  for (const tab of tabs) {
    if (!tab?.id || !tab.url || detectSource(tab.url) !== "ebay") continue;
    const lane = ebayGradedLaneFromUrl(tab.url);
    if (lane === "no") {
      if (sessionNo && !matchesSessionUrl(tab.url, sessionNo)) continue;
      noTabs.push(tab);
    } else if (lane === "yes") {
      if (sessionYes && !matchesSessionUrl(tab.url, sessionYes)) continue;
      yesTabs.push(tab);
    }
  }
  return { noTabs, yesTabs };
};

const captureQfGradedEbayTabs = async (extractOverrides = {}) => {
  await assertCaptureNotInFlight();
  const qf = await fetchQuickFetchSession();
  if (!qf?.active) {
    throw new Error("Quick Fetch is not active. Start Quick Fetch in Raw Investor first.");
  }
  if (qf.profile !== "singles-dual") {
    throw new Error("Dual graded capture is for singles-dual Quick Fetch only.");
  }
  const { noTabs, yesTabs } = await findGradedEbayTabs(qf);
  if (noTabs.length === 0 || yesTabs.length === 0) {
    throw new Error(
      `Open eBay sold-search tabs with Graded=No and Graded=Yes. Found Graded No: ${noTabs.length}, Graded Yes: ${yesTabs.length}.`
    );
  }
  if (noTabs.length > 1 || yesTabs.length > 1) {
    const titles = [...noTabs, ...yesTabs]
      .map((t) => `• ${t.title || t.url}`)
      .join("\n");
    throw new Error(
      `Multiple graded eBay tabs match. Close extras so only one Graded=No and one Graded=Yes remain:\n${titles}`
    );
  }
  const { captureMode = "default", ebayDualCaptureParallel = false } = await chrome.storage.local.get([
    "captureMode",
    "ebayDualCaptureParallel"
  ]);
  const mode = captureMode === "deep" ? "deep" : "default";
  const startedAt = Date.now();
  const jobs = [
    { tab: noTabs[0], pass: "ebay-graded-no", label: "Graded No" },
    { tab: yesTabs[0], pass: "ebay-graded-yes", label: "Graded Yes" }
  ];

  const runJob = async (job, queueDone) => {
    const flight = {
      active: true,
      tabId: job.tab.id,
      tabTitle: job.tab.title || "",
      source: "ebay",
      mode,
      startedAt,
      pass: job.pass,
      queue: { total: 2, done: queueDone, currentLabel: job.label }
    };
    await writeCaptureFlight(flight);
    await showTabCaptureBanner(job.tab.id, flight);
    try {
      return await captureTabByIdCore(job.tab.id, job.tab.url, extractOverrides, {
        capturePass: job.pass
      });
    } finally {
      await hideTabCaptureBanner(job.tab.id);
    }
  };

  startBadgeTimer(readCaptureFlight);
  try {
    const allowParallel = ebayDualCaptureParallel === true && mode !== "deep";
    if (allowParallel) {
      await writeCaptureFlight({
        active: true,
        source: "ebay",
        mode,
        startedAt,
        pass: null,
        queue: { total: 2, done: 0, currentLabel: "Graded No + Yes (parallel)" }
      });
      const runParallel = async (job) => {
        await showTabCaptureBanner(job.tab.id, {
          mode,
          pass: job.pass,
          queue: { total: 2, done: 0, currentLabel: job.label }
        });
        try {
          return await captureTabByIdCore(job.tab.id, job.tab.url, extractOverrides, {
        capturePass: job.pass
      });
        } finally {
          await hideTabCaptureBanner(job.tab.id);
        }
      };
      const [rNo, rYes] = await Promise.all(jobs.map(runParallel));
      const payloads = { no: rNo?.rawExtract ?? null, yes: rYes?.rawExtract ?? null };
      await chrome.storage.local.set({
        lastQfDualEbayCapture: {
          cardId: String(qf.cardId || "").trim() || null,
          capturedAt: Date.now(),
          payloads
        }
      });
      return { results: [rNo, rYes], parallel: true, payloads };
    }
    const rNo = await runJob(jobs[0], 0);
    const rYes = await runJob(jobs[1], 1);
    const payloads = { no: rNo?.rawExtract ?? null, yes: rYes?.rawExtract ?? null };
    await chrome.storage.local.set({
      lastQfDualEbayCapture: {
        cardId: String(qf.cardId || "").trim() || null,
        capturedAt: Date.now(),
        payloads
      }
    });
    return { results: [rNo, rYes], parallel: false, payloads };
  } finally {
    await clearCaptureFlight();
  }
};

const runExtractOnTab = async (tabId, extractArgs) => {
  try {
    await injectBotWallApiOnTab(tabId);
  } catch {
    /* extract falls back to fail-open bot check */
  }
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: extractCurrentPageInTab,
    args: [extractArgs]
  });
  return result;
};

const captureTabByIdCore = async (tabId, tabUrl, extractOverrides = {}, coreOpts = {}) => {
  const source = detectSource(tabUrl);
  if (!source) {
    throw new Error("Tab must be a TCGPlayer product, eBay sold search (…/sch/i.html?_nkw=…), or PriceCharting.");
  }
  const baseOpts = await buildCaptureExtractOptions();
  const extractArgs = { ...baseOpts, ...extractOverrides };
  const t0 = Date.now();
  let result = await runExtractOnTab(tabId, extractArgs);
  if (
    result?.error &&
    isBotCheckExtractError(result.error) &&
    extractOverrides.skipBotWallCheck !== true &&
    (source === "ebay" || source === "tcgplayer") &&
    (await tabHasMarketCaptureEvidence(tabId, source))
  ) {
    const retryArgs = { ...extractArgs, skipBotWallCheck: true, botCheckAutoRetry: true };
    const retryResult = await runExtractOnTab(tabId, retryArgs);
    if (retryResult && !retryResult.error) {
      result = retryResult;
      if (result.data && typeof result.data === "object") {
        result.data.captureStats = {
          ...(result.data.captureStats || {}),
          botCheckAutoRetry: true
        };
      }
    }
  }
  if (!result || result.error) {
    throw new Error(result?.error || "Capture script returned no result.");
  }
  const qf = await fetchQuickFetchSession();
  const forcedPass = coreOpts.capturePass;
  const derivedPass =
    forcedPass === "ebay-graded-no" || forcedPass === "ebay-graded-yes"
      ? forcedPass
      : derivePassFromUrlAndSession(tabUrl, qf);
  if (derivedPass === "ebay-graded-no" || derivedPass === "ebay-graded-yes") {
    result.capturePass = derivedPass;
  }
  const uploaded = await postCaptureResult(result);
  const captureWallMs = Date.now() - t0;
  return { ...uploaded, captureWallMs, rawExtract: result };
};

const captureTabById = async (tabId, tabUrl, extractOverrides = {}, flightOpts = {}) => {
  if (flightOpts.skipFlightWrap) {
    return captureTabByIdCore(tabId, tabUrl, extractOverrides);
  }
  await assertCaptureNotInFlight();
  const tabMeta = await chrome.tabs.get(tabId).catch(() => ({ id: tabId, title: "" }));
  const source = detectSource(tabUrl);
  if (!source) {
    throw new Error("Tab must be a TCGPlayer product, eBay sold search (…/sch/i.html?_nkw=…), or PriceCharting.");
  }
  const { captureMode = "default" } = await chrome.storage.local.get(["captureMode"]);
  const mode = captureMode === "deep" ? "deep" : "default";
  const qf = await fetchQuickFetchSession();
  const pass = derivePassFromUrlAndSession(tabUrl, qf);
  const flight = {
    active: true,
    tabId,
    tabTitle: tabMeta?.title || "",
    source,
    mode,
    startedAt: Date.now(),
    pass: pass || null,
    ...(flightOpts.queue ? { queue: flightOpts.queue } : {})
  };
  await writeCaptureFlight(flight);
  startBadgeTimer(readCaptureFlight);
  try {
    await showTabCaptureBanner(tabId, flight);
    return await captureTabByIdCore(tabId, tabUrl, extractOverrides);
  } finally {
    await hideTabCaptureBanner(tabId);
    if (!flightOpts.keepFlight) await clearCaptureFlight();
  }
};

const captureActiveTab = async (extractOverrides = {}) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) {
    throw new Error("No active tab found.");
  }
  return captureTabById(tab.id, tab.url, extractOverrides);
};

const waitForTabComplete = async (tabId, timeoutMs = 30000) => {
  const first = await chrome.tabs.get(tabId).catch(() => null);
  if (first?.status === "complete") return true;
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error("Timed out waiting for TCG tab to finish loading."));
    }, timeoutMs);
    const onUpdated = (updatedTabId, changeInfo) => {
      if (done) return;
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        done = true;
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve(true);
      }
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
};

const openAndCaptureFromAppTab = async (extractOverrides = {}) => {
  const { openedUrl } = await openTcgUrlFromAppTab();
  const createdTab = await chrome.tabs.create({ url: openedUrl, active: true });
  if (!createdTab?.id || !createdTab.url) {
    throw new Error("Failed to open TCG tab.");
  }
  await waitForTabComplete(createdTab.id, 45000);
  const fresh = await chrome.tabs.get(createdTab.id).catch(() => createdTab);
  const result = await captureTabById(createdTab.id, fresh?.url || createdTab.url, extractOverrides);
  return { openedUrl, capture: result };
};

const openAndCaptureFromUrl = async (openedUrl, extractOverrides = {}) => {
  if (!isOpenableCaptureUrl(openedUrl)) {
    throw new Error("Provide a TCG product URL, eBay sold-search URL, or PriceCharting URL.");
  }
  const createdTab = await chrome.tabs.create({ url: openedUrl, active: true });
  if (!createdTab?.id || !createdTab.url) {
    throw new Error("Failed to open target tab.");
  }
  await waitForTabComplete(createdTab.id, 45000);
  const fresh = await chrome.tabs.get(createdTab.id).catch(() => createdTab);
  const result = await captureTabById(createdTab.id, fresh?.url || createdTab.url, extractOverrides);
  return { openedUrl, capture: result };
};

const openTcgUrlFromAppTab = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) {
    throw new Error("No active tab found.");
  }
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const isTcgUrl = (v) => /^https?:\/\/(www\.)?tcgplayer\.com\/product\/\d+/i.test(String(v || "").trim());
      const inputs = Array.from(document.querySelectorAll("input"));
      for (const el of inputs) {
        const v = String(el.value || "").trim();
        if (isTcgUrl(v)) return v;
      }
      const active = document.activeElement;
      if (active && active.tagName === "INPUT") {
        const v = String(active.value || "").trim();
        if (isTcgUrl(v)) return v;
      }
      const links = Array.from(document.querySelectorAll("a[href]"));
      for (const a of links) {
        const v = String(a.getAttribute("href") || "").trim();
        if (isTcgUrl(v)) return v;
      }
      const attrs = ["data-tcgplayer-url", "data-url", "value", "title"];
      for (const sel of ["[data-tcgplayer-url]", "[data-url]"]) {
        for (const el of Array.from(document.querySelectorAll(sel))) {
          for (const k of attrs) {
            const v = String(el.getAttribute?.(k) || "").trim();
            if (isTcgUrl(v)) return v;
          }
        }
      }
      const body = (document.body?.innerText || "").replace(/\s+/g, " ");
      const m = body.match(/https?:\/\/(?:www\.)?tcgplayer\.com\/product\/\d+[^\s]*/i);
      if (m) return m[0];
      return null;
    }
  });
  if (!result) {
    throw new Error("No TCGPlayer product URL found on this page.");
  }
  return { openedUrl: String(result) };
};

if (chrome?.commands?.onCommand) {
  chrome.commands.onCommand.addListener(async (cmd) => {
    if (cmd !== "capture-active-tab") return;
    try {
      await captureActiveTab();
    } catch (err) {
      console.warn("capture-active-tab failed:", err);
    }
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "ext-get-capture-flight") {
    void (async () => {
      const flight = await readCaptureFlight();
      const quickFetchSession = await fetchQuickFetchSession();
      let gradedTabCounts = null;
      if (quickFetchSession?.active && quickFetchSession.profile === "singles-dual") {
        const { noTabs, yesTabs } = await findGradedEbayTabs(quickFetchSession);
        gradedTabCounts = { no: noTabs.length, yes: yesTabs.length };
      }
      sendResponse({ ok: true, flight, quickFetchSession, gradedTabCounts });
    })();
    return true;
  }
  if (msg?.type === "capture-qf-graded-ebay-tabs") {
    const skipBot = Boolean(msg?.skipBotWallCheck);
    captureQfGradedEbayTabs(skipBot ? { skipBotWallCheck: true } : {})
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err) =>
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) })
      );
    return true;
  }
  if (msg?.type === "capture-qf-graded-ebay-tabs-and-return") {
    const skipBot = Boolean(msg?.skipBotWallCheck);
    captureQfGradedEbayTabs(skipBot ? { skipBotWallCheck: true } : {})
      .then((result) =>
        sendResponse({
          ok: true,
          result,
          payloads: result?.payloads ?? null
        })
      )
      .catch((err) =>
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) })
      );
    return true;
  }
  if (msg?.type === "ext-sync-capture-config") {
    void (async () => {
      const serverBase = String(msg?.serverBase || "").trim();
      const extToken = String(msg?.extToken || "").trim();
      const appToken = String(msg?.appToken || "").trim();
      const patch = {};
      if (serverBase) patch.serverBase = serverBase.replace(/\/$/, "");
      if (extToken) patch.extToken = extToken;
      if (appToken) patch.appToken = appToken;
      const r = await applyCaptureConfigPatch(patch);
      sendResponse({ ok: true, updated: r.updated });
    })();
    return true;
  }
  if (msg?.type === "ext-apply-pcgr-connection-file") {
    void (async () => {
      const r = await applyPcgrConnectionFromFile();
      sendResponse(r);
    })();
    return true;
  }
  if (msg?.type === "ext-ping-api-health") {
    void (async () => {
      const { serverBase = DEFAULT_SERVER, extToken = "", appToken = "" } =
        await chrome.storage.local.get(["serverBase", "extToken", "appToken"]);
      const base = String(serverBase || DEFAULT_SERVER).replace(/\/$/, "");
      const headers = { Accept: "application/json" };
      if (extToken) headers["x-ext-token"] = String(extToken);
      if (appToken) headers["x-pcgr-app-token"] = String(appToken);
      try {
        const res = await fetch(`${base}/api/health`, { headers, cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        let quickFetchSession = null;
        try {
          const metaRes = await fetch(`${base}/api/portfolio/meta`, { headers, cache: "no-store" });
          const meta = await metaRes.json().catch(() => ({}));
          if (metaRes.ok && meta?.quickFetchSession && typeof meta.quickFetchSession === "object") {
            quickFetchSession = meta.quickFetchSession;
          }
        } catch {
          /* ignore */
        }
        sendResponse({
          ok: true,
          reachable: res.ok,
          status: res.status,
          mode: typeof data.mode === "string" ? data.mode : undefined,
          hasExtToken: Boolean(String(extToken || "").trim()),
          hasAppToken: Boolean(String(appToken || "").trim()),
          quickFetchSession
        });
      } catch (e) {
        sendResponse({
          ok: true,
          reachable: false,
          offline: true,
          error: e instanceof Error ? e.message : String(e)
        });
      }
    })();
    return true;
  }
  if (msg?.type === "capture-active-tab") {
    const skipBot = Boolean(msg?.skipBotWallCheck);
    captureActiveTab(skipBot ? { skipBotWallCheck: true } : {})
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err) =>
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) })
      );
    return true;
  }
  if (msg?.type === "open-tcg-url-from-app") {
    openTcgUrlFromAppTab()
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err) =>
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) })
      );
    return true;
  }
  if (msg?.type === "open-and-capture-from-app") {
    const skipBot = Boolean(msg?.skipBotWallCheck);
    openAndCaptureFromAppTab(skipBot ? { skipBotWallCheck: true } : {})
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err) =>
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) })
      );
    return true;
  }
  if (msg?.type === "open-and-capture-url") {
    const skipBot = Boolean(msg?.skipBotWallCheck);
    openAndCaptureFromUrl(String(msg?.url || "").trim(), skipBot ? { skipBotWallCheck: true } : {})
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err) =>
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) })
      );
    return true;
  }
  if (msg?.type === "ext-get-dashboard-card-state") {
    getDashboardCardState({ source: msg?.source, url: msg?.url })
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err) =>
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) })
      );
    return true;
  }
  if (msg?.type === "ext-toggle-dashboard-card") {
    const tabId = Number(sender?.tab?.id || 0);
    const tabUrl = String(msg?.url || sender?.tab?.url || "");
    toggleDashboardCard({ source: msg?.source, url: tabUrl, tabId })
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err) =>
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) })
      );
    return true;
  }
  if (msg?.type === "ext-get-target-overlay-state") {
    loadStoreDoc()
      .then((store) => {
        const targets = Array.isArray(store?.targets) ? store.targets : [];
        const cards = Array.isArray(store?.cards) ? store.cards : [];
        sendResponse({
          ok: true,
          itemIds: targets
            .map((t) => String(t?.itemId || "").trim())
            .filter((id) => /^\d{4,}$/.test(id)),
          cards: cards.map((c) => ({ id: c.id, name: String(c?.name || "") }))
        });
      })
      .catch(() =>
        sendResponse({
          ok: true,
          itemIds: [],
          cards: [],
          offline: true
        })
      );
    return true;
  }
  if (msg?.type === "ext-sync-target-listing-snapshots") {
    const rows = Array.isArray(msg?.rows) ? msg.rows : [];
    applyTargetListingSnapshots(rows)
      .then((r) => sendResponse({ ok: true, ...r }))
      .catch((err) =>
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) })
      );
    return true;
  }
  if (msg?.type === "ext-add-quick-target") {
    const payload = msg?.payload && typeof msg.payload === "object" ? msg.payload : {};
    addQuickTargetFromListing(payload)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) =>
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) })
      );
    return true;
  }
  if (msg?.type === "ext-ebay-session-report") {
    void (async () => {
      const now = Date.now();
      if (ebaySessionPostInFlight) {
        sendResponse({ ok: true, skipped: true });
        return;
      }
      if (now - lastEbaySessionPostAt < EBAY_SESSION_POST_MIN_MS) {
        sendResponse({ ok: true, skipped: true });
        return;
      }
      ebaySessionPostInFlight = true;
      try {
        const st = msg.status;
        const status =
          st === "signed-in" || st === "signed-out" || st === "unknown" ? st : "unknown";
        const url = String(msg.url || "").trim().slice(0, 2048);
        const title = String(msg.title || "").trim().slice(0, 512);
        await postEbaySessionResult({ status, url, title });
        lastEbaySessionPostAt = Date.now();
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
      } finally {
        ebaySessionPostInFlight = false;
      }
    })();
    return true;
  }
  return true;
});
