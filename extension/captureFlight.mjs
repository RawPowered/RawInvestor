/** @typedef {{ active: boolean; tabId?: number; tabTitle?: string; source?: string; mode?: string; startedAt?: number; pass?: string | null; queue?: { total: number; done: number; currentLabel?: string } }} CaptureFlight */

const FLIGHT_KEY = "captureFlight";
const DEFAULT_ACTION_TITLE = "Raw Investor Capture";

/** @type {ReturnType<typeof setInterval> | null} */
let badgeTimer = null;

export const readCaptureFlight = async () => {
  const data = await chrome.storage.session.get(FLIGHT_KEY);
  const flight = data[FLIGHT_KEY];
  return flight && typeof flight === "object" && flight.active ? /** @type {CaptureFlight} */ (flight) : null;
};

/** @param {CaptureFlight | null} flight */
export const writeCaptureFlight = async (flight) => {
  if (flight && flight.active) {
    await chrome.storage.session.set({ [FLIGHT_KEY]: flight });
  } else {
    await chrome.storage.session.remove(FLIGHT_KEY);
  }
};

export const clearCaptureFlight = async () => {
  stopBadgeTimer();
  await writeCaptureFlight(null);
  try {
    await chrome.action.setBadgeText({ text: "" });
    await chrome.action.setTitle({ title: DEFAULT_ACTION_TITLE });
  } catch {
    /* ignore */
  }
};

/** @param {CaptureFlight} flight */
const formatBadgeText = (flight) => {
  if (flight.queue && flight.queue.total > 1) {
    const done = Number(flight.queue.done) || 0;
    const total = flight.queue.total;
    const current = Math.min(done + 1, total);
    return `${current}/${total}`;
  }
  if (flight.startedAt) {
    const s = Math.floor((Date.now() - flight.startedAt) / 1000);
    if (s > 99) return "99+";
    if (s > 0) return String(s);
  }
  return "…";
};

/** @param {CaptureFlight} flight */
const formatActionTitle = (flight) => {
  const elapsed = flight.startedAt ? Math.floor((Date.now() - flight.startedAt) / 1000) : 0;
  const src = flight.source ? String(flight.source) : "tab";
  const mode = flight.mode === "deep" ? "deep" : "quick";
  let pass = "";
  if (flight.pass === "ebay-graded-no") pass = " · Graded No";
  else if (flight.pass === "ebay-graded-yes") pass = " · Graded Yes";
  let q = "";
  if (flight.queue && flight.queue.total > 1) {
    q = ` · ${flight.queue.done ?? 0}/${flight.queue.total}`;
    if (flight.queue.currentLabel) q += ` ${flight.queue.currentLabel}`;
  }
  return `Capturing ${src} (${mode}) — ${elapsed}s${pass}${q}`;
};

/** @param {() => Promise<CaptureFlight | null>} getFlight */
export const startBadgeTimer = (getFlight) => {
  stopBadgeTimer();
  const tick = async () => {
    const flight = await getFlight();
    if (!flight?.active) return;
    try {
      await chrome.action.setBadgeBackgroundColor({ color: "#0f766e" });
      await chrome.action.setBadgeText({ text: formatBadgeText(flight) });
      await chrome.action.setTitle({ title: formatActionTitle(flight) });
    } catch {
      /* ignore */
    }
  };
  void tick();
  badgeTimer = setInterval(() => void tick(), 1000);
};

export const stopBadgeTimer = () => {
  if (badgeTimer) {
    clearInterval(badgeTimer);
    badgeTimer = null;
  }
};

/** @param {string} url */
export const ebayGradedLaneFromUrl = (url) => {
  try {
    const u = new URL(String(url || ""));
    const graded = String(u.searchParams.get("Graded") || u.searchParams.get("graded") || "")
      .trim()
      .toLowerCase();
    if (graded === "no") return "no";
    if (graded === "yes") return "yes";
    return null;
  } catch {
    return null;
  }
};

/**
 * @param {string} tabUrl
 * @param {{ pass?: string } | null | undefined} qfSession
 */
export const derivePassFromUrlAndSession = (tabUrl, qfSession) => {
  const lane = ebayGradedLaneFromUrl(tabUrl);
  if (lane === "no") return "ebay-graded-no";
  if (lane === "yes") return "ebay-graded-yes";
  const pass = qfSession?.pass;
  if (pass === "ebay-graded-no" || pass === "ebay-graded-yes") return pass;
  return null;
};

/** @param {string} pass */
export const passLabel = (pass) => {
  if (pass === "ebay-graded-no") return "Graded No";
  if (pass === "ebay-graded-yes") return "Graded Yes";
  if (pass === "ebay") return "eBay";
  if (pass === "tcg") return "TCG";
  return pass || "";
};
