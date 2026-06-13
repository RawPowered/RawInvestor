const panelSetup = document.getElementById("panelSetup");
const panelMain = document.getElementById("panelMain");
const serverBaseEl = document.getElementById("serverBase");
const extTokenEl = document.getElementById("extToken");
const appTokenEl = document.getElementById("appToken");
const captureModeEl = document.getElementById("captureMode");
const capturePerfPresetEl = document.getElementById("capturePerfPreset");
const targetUrlEl = document.getElementById("targetUrl");
const modeDefaultBtn = document.getElementById("modeDefaultBtn");
const modeDeepBtn = document.getElementById("modeDeepBtn");
const captureBtn = document.getElementById("captureBtn");
const captureBothGradedBtn = document.getElementById("captureBothGradedBtn");
const captureFlightBanner = document.getElementById("captureFlightBanner");
const ebayDualCaptureParallelEl = document.getElementById("ebayDualCaptureParallel");
const openFromAppBtn = document.getElementById("openFromAppBtn");
const openAndCaptureBtn = document.getElementById("openAndCaptureBtn");
const statusEl = document.getElementById("status");
const finishSetupBtn = document.getElementById("finishSetupBtn");
const backToMainBtn = document.getElementById("backToMainBtn");
const changeConnectionBtn = document.getElementById("changeConnectionBtn");
const appStatusPill = document.getElementById("appStatusPill");
const botWallOverride = document.getElementById("botWallOverride");
const captureIgnoreBotBtn = document.getElementById("captureIgnoreBotBtn");
const reloadFromAppBtn = document.getElementById("reloadFromAppBtn");

/** @type {"first" | "change"} */
let setupEntry = "first";

const setStatus = (msg, isErr = false) => {
  statusEl.textContent = msg;
  statusEl.style.color = isErr ? "#b91c1c" : "#0f766e";
};

const showSetup = () => {
  panelSetup?.classList.remove("hidden");
  panelMain?.classList.add("hidden");
  if (backToMainBtn) {
    const showBack = setupEntry === "change";
    backToMainBtn.classList.toggle("hidden", !showBack);
  }
};

const showMain = () => {
  panelSetup?.classList.add("hidden");
  panelMain?.classList.remove("hidden");
  refreshMainSummary();
};

const setAppStatusPill = (state) => {
  if (!appStatusPill) return;
  appStatusPill.classList.remove("running", "stopped", "checking");
  if (state === "running") {
    appStatusPill.textContent = "Running";
    appStatusPill.classList.add("running");
  } else if (state === "stopped") {
    appStatusPill.textContent = "Not Running";
    appStatusPill.classList.add("stopped");
  } else {
    appStatusPill.textContent = "Checking…";
    appStatusPill.classList.add("checking");
  }
};

const refreshMainSummary = () => {
  setAppStatusPill("checking");
};

const syncModeUi = () => {
  const deep = captureModeEl?.value === "deep";
  modeDefaultBtn?.classList.toggle("active", !deep);
  modeDeepBtn?.classList.toggle("active", deep);
};

const setCaptureMode = (mode) => {
  if (!captureModeEl) return;
  captureModeEl.value = mode === "deep" ? "deep" : "default";
  syncModeUi();
};

const formatEbayStats = (stats) => {
  if (!stats) return "";
  const g = stats.gradeCounts || {};
  const lines = [
    `Root: ${stats.rootSelectorUsed || "?"} | li.s-item:${stats.liSItemCount ?? "?"} listitem:${stats.listitemCount ?? "?"} data-view mi:${stats.dataViewMiCount ?? "?"} (legacy sum:${stats.sItemCount ?? "?"})`,
    `Current-page rows: ${stats.currentPageRows ?? "?"} | Sold candidates: ${stats.soldCandidates ?? "?"}`
  ];
  lines.push(
    `Pages scanned: ${stats.pagesScanned ?? "?"} | Listing rows scanned: ${stats.scannedLinks ?? "?"} | Unique item IDs: ${stats.uniqueItemIdsSeen ?? "?"} | Deep conc: ${stats.ebayDeepFetchConcurrency ?? "?"}${stats.ebayDeepFetchConcurrencyInitial != null && stats.ebayDeepFetchConcurrencyInitial !== stats.ebayDeepFetchConcurrency ? ` (started ${stats.ebayDeepFetchConcurrencyInitial})` : ""}`
  );
  if (Number.isFinite(stats.ebayDeepFetchPhaseMs)) {
    lines.push(`Deep phase: ${(stats.ebayDeepFetchPhaseMs / 1000).toFixed(1)}s`);
  }
  lines.push(`Duplicate links in-page skipped: ${stats.duplicateItemLinksSkipped || 0}`);
  lines.push(
    `Duplicates skipped: ${(stats.dedupedWithinPages || 0) + (stats.dedupedAcrossPages || 0)}`
  );
  lines.push(
    `Skipped - noContainer:${stats.skippedNoContainer || 0} ad:${stats.skippedAd || 0} notSold:${stats.skippedNotSold || 0} belowPager:${stats.skippedBelowPager || 0} noTitle:${stats.skippedNoTitle || 0} noPriceNode:${stats.skippedNoStructuredPrice || 0} ambiguousPrice:${stats.skippedAmbiguousPrice || 0} (sum noTitle/Price:${stats.skippedNoTitleOrPrice || 0})`
  );
  lines.push(`PSA ${g.PSA || 0} | CGC ${g.CGC || 0} | BGS ${g.BGS || 0} | SGC ${g.SGC || 0} | TAG ${g.TAG || 0} | RAW ${g.RAW || 0}`);
  if (stats.ebayDeepAdaptiveConcurrencyReduced) lines.push("Adaptive: lowered deep fetch concurrency after batch failures.");
  return lines.join("\n");
};

const formatPerfTail = (src, stats, wallMs) => {
  const parts = [];
  if (Number.isFinite(wallMs) && wallMs > 0) parts.push(`Wall ${(wallMs / 1000).toFixed(2)}s`);
  if (src === "TCGPLAYER" && stats && Number.isFinite(stats.tcgRowsPerSec))
    parts.push(`${stats.tcgRowsPerSec.toFixed(1)} rows/s`);
  if (src === "TCGPLAYER" && stats?.clearFiltersClicked) parts.push("Cleared modal filters once");
  return parts.length ? `\n${parts.join(" · ")}` : "";
};

const hideBotWallOverride = () => botWallOverride?.classList.add("hidden");
const showBotWallOverride = () => botWallOverride?.classList.remove("hidden");
const isBotCheckError = (msg) => /BOT_CHECK/i.test(String(msg || ""));

/** @param {{ ok?: boolean; result?: Record<string, unknown> }} rsp */
const handleActiveCaptureSuccess = (rsp) => {
  hideBotWallOverride();
  const src = rsp.result?.source ? String(rsp.result.source).toUpperCase() : "CAPTURE";
  const rc = Number.isFinite(rsp.result?.rowCount) ? Number(rsp.result.rowCount) : null;
  const stats = rsp.result?.captureStats || null;
  const wallMs = Number.isFinite(rsp.result?.captureWallMs) ? Number(rsp.result.captureWallMs) : null;
  const perf = formatPerfTail(src, stats, wallMs);
  if (rc != null) {
    if (rc > 0) {
      const extra = src === "EBAY" && stats ? formatEbayStats(stats) : "";
      setStatus(
        `${src}: captured ${rc} rows.\nSaved: ${rsp.result.file || "ok"}${perf}${extra ? `\n${extra}` : ""}`
      );
    } else {
      const extra = src === "EBAY" && stats ? `\n${formatEbayStats(stats)}` : "";
      setStatus(
        `${src}: captured 0 rows.\nOpen the sales table on that tab first, then capture again.${perf}${extra}`,
        true
      );
    }
  } else {
    setStatus(`Saved capture: ${rsp.result.file || "ok"}${perf}`);
  }
};

const passLabelPopup = (pass) => {
  if (pass === "ebay-graded-no") return "Graded No";
  if (pass === "ebay-graded-yes") return "Graded Yes";
  return pass ? String(pass) : "";
};

/** @param {Record<string, unknown>} flight */
const formatFlightStatus = (flight) => {
  const elapsed = flight.startedAt ? Math.floor((Date.now() - Number(flight.startedAt)) / 1000) : 0;
  const src = flight.source ? String(flight.source).toUpperCase() : "TAB";
  const mode = flight.mode === "deep" ? "More history" : "Quick";
  const pass = flight.pass ? ` · ${passLabelPopup(String(flight.pass))}` : "";
  let q = "";
  const queue = flight.queue && typeof flight.queue === "object" ? flight.queue : null;
  if (queue && Number(queue.total) > 1) {
    q = `\nQueue: ${queue.done ?? 0}/${queue.total}`;
    if (queue.currentLabel) q += ` (${queue.currentLabel})`;
  }
  const title = flight.tabTitle ? `\nTab: ${flight.tabTitle}` : "";
  return `Capturing ${src} (${mode}) — ${elapsed}s${pass}${q}${title}\nYou can switch tabs; check the toolbar badge or revisit the captured tab.`;
};

const setCaptureControlsDisabled = (disabled) => {
  if (captureBtn) captureBtn.disabled = disabled;
  if (captureBothGradedBtn) captureBothGradedBtn.disabled = disabled;
  if (captureIgnoreBotBtn) captureIgnoreBotBtn.disabled = disabled;
  if (openAndCaptureBtn) openAndCaptureBtn.disabled = disabled;
};

/** @param {Record<string, unknown> | null | undefined} flight */
const applyCaptureFlightUi = (flight, quickFetchSession, gradedTabCounts) => {
  lastFlight = flight?.active ? flight : null;
  const inFlight = Boolean(flight?.active);
  captureFlightBanner?.classList.toggle("visible", inFlight);
  if (captureFlightBanner && inFlight) {
    captureFlightBanner.textContent = formatFlightStatus(flight).replace(/\n/g, " · ");
  }
  setCaptureControlsDisabled(inFlight);
  const showBoth =
    Boolean(quickFetchSession?.active) &&
    quickFetchSession?.profile === "singles-dual" &&
    gradedTabCounts &&
    Number(gradedTabCounts.no) >= 1 &&
    Number(gradedTabCounts.yes) >= 1 &&
    !inFlight;
  captureBothGradedBtn?.classList.toggle("hidden", !showBoth);
  if (inFlight) {
    setStatus(formatFlightStatus(flight), false);
    statusEl.style.color = "#065f46";
  }
};

const refreshCaptureFlight = async () => {
  try {
    const rsp = await chrome.runtime.sendMessage({ type: "ext-get-capture-flight" });
    if (!rsp?.ok) return null;
    applyCaptureFlightUi(rsp.flight, rsp.quickFetchSession, rsp.gradedTabCounts);
    if (!rsp.flight?.active && !rsp.quickFetchSession?.active) stopFlightPoll();
    return rsp;
  } catch {
    return null;
  }
};

const startFlightPoll = () => {
  if (flightPollTimer) return;
  flightPollTimer = setInterval(() => {
    void refreshCaptureFlight();
  }, 1000);
};

const stopFlightPoll = () => {
  if (flightPollTimer) {
    clearInterval(flightPollTimer);
    flightPollTimer = null;
  }
};

const loadPrefs = async () => {
  const {
    serverBase = "http://localhost:3001",
    extToken = "",
    appToken = "",
    captureMode = "default",
    capturePerfPreset = "default",
    targetUrl = "",
    ebayDualCaptureParallel = false
  } = await chrome.storage.local.get([
    "serverBase",
    "extToken",
    "appToken",
    "captureMode",
    "capturePerfPreset",
    "targetUrl",
    "ebayDualCaptureParallel"
  ]);
  if (serverBaseEl) serverBaseEl.value = serverBase;
  if (extTokenEl) extTokenEl.value = extToken;
  if (appTokenEl) appTokenEl.value = appToken;
  if (captureModeEl) captureModeEl.value = captureMode === "deep" ? "deep" : "default";
  if (capturePerfPresetEl) capturePerfPresetEl.value = capturePerfPreset === "fast" ? "fast" : "default";
  if (targetUrlEl) targetUrlEl.value = String(targetUrl || "");
  if (ebayDualCaptureParallelEl) {
    ebayDualCaptureParallelEl.checked = ebayDualCaptureParallel === true;
  }
  syncModeUi();
  refreshMainSummary();
};

const savePrefs = async () => {
  const perfVal =
    capturePerfPresetEl && capturePerfPresetEl.value === "fast" ? "fast" : "default";
  await chrome.storage.local.set({
    serverBase: (serverBaseEl?.value || "").trim() || "http://localhost:3001",
    extToken: (extTokenEl?.value || "").trim(),
    appToken: (appTokenEl?.value || "").trim(),
    captureMode: captureModeEl?.value === "deep" ? "deep" : "default",
    capturePerfPreset: perfVal,
    targetUrl: (targetUrlEl?.value || "").trim(),
    ebayDualCaptureParallel: Boolean(ebayDualCaptureParallelEl?.checked)
  });
};

const normalizedTargetUrl = () => String(targetUrlEl?.value || "").trim();

const quickFetchBanner = document.getElementById("quickFetchBanner");
let qfPollTimer = null;
let flightPollTimer = null;
/** @type {Record<string, unknown> | null} */
let lastFlight = null;
/** @type {string | null} */
let qfUserModeBeforeSession = null;

const setQfCoachPulse = (on) => {
  for (const el of [modeDefaultBtn, modeDeepBtn, captureBtn]) {
    el?.classList.toggle("qf-pulse", on);
  }
};

const applyQuickFetchSession = (session) => {
  const active = Boolean(session?.active);
  const expected = session?.expectedCaptureMode === "deep" ? "deep" : "default";
  const capturing = Boolean(lastFlight?.active);
  quickFetchBanner?.classList.toggle("visible", active);
  setQfCoachPulse(active && !capturing);
  if (active) {
    const pass = session?.pass ? ` · ${passLabelPopup(String(session.pass))}` : "";
    const profile = session?.profile ? ` (${session.profile})` : "";
    const modeLabel = expected === "deep" ? "More history" : "Quick";
    if (quickFetchBanner) {
      if (capturing) {
        quickFetchBanner.innerHTML = `Quick Fetch active${profile}${pass} — <strong>capture in progress</strong> (toolbar badge). Reopen tabs to see the on-page banner.`;
      } else if (session?.profile === "singles-dual" && (session.pass === "ebay-graded-no" || session.pass === "ebay-graded-yes")) {
        quickFetchBanner.innerHTML = `Quick Fetch · ${modeLabel} — capture <strong>${passLabelPopup(String(session.pass))}</strong> tab, or use <strong>Capture both graded eBay tabs</strong> when both are open.`;
      } else {
        quickFetchBanner.innerHTML = `Quick Fetch active${profile}${pass} — <strong>${modeLabel}</strong> capture selected below. Toolbar puzzle icon → <strong>Capture this tab</strong>.`;
      }
    }
    if (captureModeEl && captureModeEl.value !== expected) {
      if (qfUserModeBeforeSession == null) {
        qfUserModeBeforeSession = captureModeEl.value === "deep" ? "deep" : "default";
      }
      setCaptureMode(expected);
      void savePrefs();
    }
    if (!qfPollTimer) {
      qfPollTimer = setInterval(() => {
        void pingApiHealth();
      }, 2000);
    }
    startFlightPoll();
  } else {
    if (qfPollTimer) {
      clearInterval(qfPollTimer);
      qfPollTimer = null;
    }
    if (!lastFlight?.active) stopFlightPoll();
    if (qfUserModeBeforeSession != null) {
      setCaptureMode(qfUserModeBeforeSession);
      qfUserModeBeforeSession = null;
      void savePrefs();
    }
  }
};

const pingApiHealth = async () => {
  try {
    const [rsp, flightRsp] = await Promise.all([
      chrome.runtime.sendMessage({ type: "ext-ping-api-health" }),
      chrome.runtime.sendMessage({ type: "ext-get-capture-flight" })
    ]);
    const session = rsp?.quickFetchSession ?? flightRsp?.quickFetchSession ?? null;
    applyQuickFetchSession(session);
    if (flightRsp?.ok) {
      applyCaptureFlightUi(flightRsp.flight, flightRsp.quickFetchSession, flightRsp.gradedTabCounts);
    }
    if (flightRsp?.flight?.active || lastFlight?.active) {
      startFlightPoll();
      return;
    }
    if (!rsp?.ok) {
      setAppStatusPill("stopped");
      return;
    }
    if (rsp.offline || !rsp.reachable) {
      setAppStatusPill("stopped");
      setStatus("Raw Investor is not running on this PC. Open the desktop app, then reopen this popup.", true);
      return;
    }
    const mode = String(rsp.mode || "").toLowerCase();
    const tokenRequired = mode === "hardened";
    const extOk = Boolean(rsp.hasExtToken);
    const appOk = Boolean(rsp.hasAppToken);
    if (tokenRequired && !extOk) {
      setAppStatusPill("stopped");
      setStatus("Raw Investor is running, but this browser is not linked yet. Open the desktop app once, then reopen this popup.");
    } else {
      setAppStatusPill("running");
      if (tokenRequired && extOk) {
        const bits = ["Ready to capture."];
        if (appOk) bits.push("App key saved.");
        setStatus(bits.join(" "));
      } else {
        setStatus("Ready to capture.");
      }
    }
  } catch {
    setAppStatusPill("stopped");
  }
};

let saveDebounceTimer = null;

const flushSaveAndRefresh = async () => {
  if (saveDebounceTimer) {
    clearTimeout(saveDebounceTimer);
    saveDebounceTimer = null;
  }
  try {
    await savePrefs();
    refreshMainSummary();
    await pingApiHealth();
  } catch (e) {
    setStatus(e instanceof Error ? e.message : String(e), true);
  }
};

const scheduleSaveAndRefresh = () => {
  if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(() => {
    saveDebounceTimer = null;
    void flushSaveAndRefresh();
  }, 320);
};

ebayDualCaptureParallelEl?.addEventListener("change", scheduleSaveAndRefresh);

captureBothGradedBtn?.addEventListener("click", async () => {
  try {
    captureBothGradedBtn.disabled = true;
    hideBotWallOverride();
    await flushSaveAndRefresh();
    const serverBase = (serverBaseEl?.value || "").trim();
    if (!/^https?:\/\/(localhost|127\.0\.0\.1):\d+\/?$/i.test(serverBase.trim())) {
      throw new Error("Use http://localhost:PORT (or 127.0.0.1) matching Raw Investor.");
    }
    const rsp = await chrome.runtime.sendMessage({
      type: "capture-qf-graded-ebay-tabs",
      skipBotWallCheck: false
    });
    if (!rsp?.ok) throw new Error(rsp?.error || "Dual capture failed.");
    const results = Array.isArray(rsp.result?.results) ? rsp.result.results : [];
    const rows = results.reduce((n, r) => {
      const rc = Number.isFinite(r?.rowCount) ? Number(r.rowCount) : 0;
      return n + rc;
    }, 0);
    setStatus(`Dual graded capture done — ${rows} total rows across ${results.length} passes.`);
    hideBotWallOverride();
    await refreshCaptureFlight();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setStatus(msg, true);
    if (isBotCheckError(msg)) showBotWallOverride();
    else hideBotWallOverride();
  } finally {
    await refreshCaptureFlight();
  }
});

const wireAutoSave = () => {
  const els = [serverBaseEl, extTokenEl, appTokenEl, capturePerfPresetEl, targetUrlEl].filter(Boolean);
  for (const el of els) {
    el.addEventListener("input", scheduleSaveAndRefresh);
    el.addEventListener("change", scheduleSaveAndRefresh);
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushSaveAndRefresh();
  });
};

modeDefaultBtn?.addEventListener("click", () => {
  setCaptureMode("default");
  scheduleSaveAndRefresh();
});
modeDeepBtn?.addEventListener("click", () => {
  setCaptureMode("deep");
  scheduleSaveAndRefresh();
});

const tryApplyConnectionFile = async () => {
  try {
    await chrome.runtime.sendMessage({ type: "ext-apply-pcgr-connection-file" });
    await loadPrefs();
  } catch {
    /* ignore */
  }
};

const computeNeedsSetup = async () => {
  await tryApplyConnectionFile();
  const { setupWizardComplete, extToken } = await chrome.storage.local.get([
    "setupWizardComplete",
    "extToken"
  ]);
  try {
    const rsp = await chrome.runtime.sendMessage({ type: "ext-ping-api-health" });
    if (!rsp?.ok || rsp.offline || !rsp.reachable) {
      return !setupWizardComplete;
    }
    const mode = String(rsp.mode || "").toLowerCase();
    const tokenRequired = mode === "hardened";
    const extOk = Boolean(String(extToken || "").trim()) || Boolean(rsp.hasExtToken);
    if (tokenRequired && !extOk) return true;
    if (!setupWizardComplete) {
      await chrome.storage.local.set({ setupWizardComplete: true });
    }
    return false;
  } catch {
    return !setupWizardComplete;
  }
};

finishSetupBtn?.addEventListener("click", async () => {
  try {
    finishSetupBtn.disabled = true;
    setStatus("Checking connection…");
    await tryApplyConnectionFile();
    await flushSaveAndRefresh();
    const serverBase = (serverBaseEl?.value || "").trim();
    if (serverBase && !/^https?:\/\/(localhost|127\.0\.0\.1):\d+\/?$/i.test(serverBase.trim())) {
      throw new Error("Service address must be a local address (support only).");
    }
    const rsp = await chrome.runtime.sendMessage({ type: "ext-ping-api-health" });
    if (!rsp?.ok || rsp.offline || !rsp.reachable) {
      throw new Error("Raw Investor is not running. Open the desktop app on this PC, then try again.");
    }
    const mode = String(rsp.mode || "").toLowerCase();
    const extTok = (extTokenEl?.value || "").trim();
    if (mode === "hardened" && !extTok && !rsp.hasExtToken) {
      throw new Error("Open Raw Investor on this PC so this browser can link automatically, then try again.");
    }
    await chrome.storage.local.set({ setupWizardComplete: true });
    setupEntry = "first";
    setStatus("Connected. You can capture from the next screen.");
    showMain();
    await pingApiHealth();
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), true);
  } finally {
    finishSetupBtn.disabled = false;
  }
});

backToMainBtn?.addEventListener("click", async () => {
  try {
    await flushSaveAndRefresh();
    showMain();
    await pingApiHealth();
  } catch (e) {
    setStatus(e instanceof Error ? e.message : String(e), true);
  }
});

changeConnectionBtn?.addEventListener("click", () => {
  setupEntry = "change";
  showSetup();
  void pingApiHealth();
});

reloadFromAppBtn?.addEventListener("click", async () => {
  try {
    reloadFromAppBtn.disabled = true;
    setStatus("Reloading connection from app folder…");
    await tryApplyConnectionFile();
    await loadPrefs();
    const needs = await computeNeedsSetup();
    if (needs) {
      showSetup();
    } else {
      showMain();
    }
    await pingApiHealth();
  } catch (e) {
    setStatus(e instanceof Error ? e.message : String(e), true);
  } finally {
    reloadFromAppBtn.disabled = false;
  }
});

captureBtn?.addEventListener("click", async () => {
  try {
    setCaptureControlsDisabled(true);
    hideBotWallOverride();
    setStatus("Capturing…");
    startFlightPoll();
    await flushSaveAndRefresh();
    const serverBase = (serverBaseEl?.value || "").trim();
    if (!/^https?:\/\/(localhost|127\.0\.0\.1):\d+\/?$/i.test(serverBase.trim())) {
      throw new Error("Use http://localhost:PORT (or 127.0.0.1) matching Raw Investor.");
    }
    const rsp = await chrome.runtime.sendMessage({ type: "capture-active-tab", skipBotWallCheck: false });
    if (!rsp?.ok) {
      throw new Error(rsp?.error || "Capture failed.");
    }
    handleActiveCaptureSuccess(rsp);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setStatus(msg, true);
    if (isBotCheckError(msg)) showBotWallOverride();
    else hideBotWallOverride();
  } finally {
    await refreshCaptureFlight();
  }
});

captureIgnoreBotBtn?.addEventListener("click", async () => {
  try {
    setCaptureControlsDisabled(true);
    setStatus("Capturing (skipped bot check)…");
    startFlightPoll();
    await flushSaveAndRefresh();
    const serverBase = (serverBaseEl?.value || "").trim();
    if (!/^https?:\/\/(localhost|127\.0\.0\.1):\d+\/?$/i.test(serverBase.trim())) {
      throw new Error("Use http://localhost:PORT (or 127.0.0.1) matching Raw Investor.");
    }
    const rsp = await chrome.runtime.sendMessage({ type: "capture-active-tab", skipBotWallCheck: true });
    if (!rsp?.ok) {
      throw new Error(rsp?.error || "Capture failed.");
    }
    handleActiveCaptureSuccess(rsp);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setStatus(msg, true);
    if (isBotCheckError(msg)) showBotWallOverride();
    else hideBotWallOverride();
  } finally {
    await refreshCaptureFlight();
  }
});

openFromAppBtn?.addEventListener("click", async () => {
  try {
    openFromAppBtn.disabled = true;
    setStatus("Opening link…");
    await flushSaveAndRefresh();
    const rsp = await chrome.runtime.sendMessage({ type: "open-tcg-url-from-app" });
    if (!rsp?.ok) {
      throw new Error(rsp?.error || "Open URL failed.");
    }
    setStatus(`Opened: ${rsp.result.openedUrl}`);
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), true);
  } finally {
    openFromAppBtn.disabled = false;
  }
});

openAndCaptureBtn?.addEventListener("click", async () => {
  try {
    openAndCaptureBtn.disabled = true;
    hideBotWallOverride();
    setStatus("Opening and capturing…");
    await flushSaveAndRefresh();
    const serverBase = (serverBaseEl?.value || "").trim();
    if (!/^https?:\/\/(localhost|127\.0\.0\.1):\d+\/?$/i.test(serverBase.trim())) {
      throw new Error("Use http://localhost:PORT (or 127.0.0.1) matching Raw Investor.");
    }
    const targetUrl = normalizedTargetUrl();
    const message = targetUrl
      ? { type: "open-and-capture-url", url: targetUrl }
      : { type: "open-and-capture-from-app" };
    const rsp = await chrome.runtime.sendMessage(message);
    if (!rsp?.ok) {
      throw new Error(rsp?.error || "Open + capture failed.");
    }
    const rc = Number.isFinite(rsp.result?.capture?.rowCount)
      ? Number(rsp.result.capture.rowCount)
      : null;
    const src = rsp.result?.capture?.source ? String(rsp.result.capture.source).toUpperCase() : "CAPTURE";
    const stats = rsp.result?.capture?.captureStats || null;
    const wallMs = Number.isFinite(rsp.result?.capture?.captureWallMs)
      ? Number(rsp.result.capture.captureWallMs)
      : null;
    const extra = src === "EBAY" && stats ? formatEbayStats(stats) : "";
    const perf = formatPerfTail(src, stats, wallMs);
    setStatus(
      rc != null
        ? `Opened + captured ${rc} rows.\nSaved: ${rsp.result.capture?.file || "ok"}${perf}${extra ? `\n${extra}` : ""}`
        : `Opened + saved capture: ${rsp.result.capture?.file || "ok"}${perf}`
    );
    if (rsp?.result?.openedUrl) setStatus(`${statusEl.textContent}\nOpened: ${rsp.result.openedUrl}`);
    hideBotWallOverride();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setStatus(msg, true);
    if (isBotCheckError(msg)) showBotWallOverride();
    else hideBotWallOverride();
  } finally {
    openAndCaptureBtn.disabled = false;
  }
});

void (async () => {
  await tryApplyConnectionFile();
  await loadPrefs();
  wireAutoSave();
  setupEntry = "first";
  const needs = await computeNeedsSetup();
  if (needs) {
    showSetup();
    await pingApiHealth();
  } else {
    showMain();
    await pingApiHealth();
    await refreshCaptureFlight();
    if (lastFlight?.active) startFlightPoll();
  }
})();
