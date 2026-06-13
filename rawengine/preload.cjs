const { contextBridge, ipcRenderer } = require("electron");

function readRuntimeSync() {
  try {
    const raw = ipcRenderer.sendSync("rawengine:runtime-sync");
    if (typeof raw === "string" && raw.trim()) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return {};
}

contextBridge.exposeInMainWorld("rawEngine", {
  runtime: () => ipcRenderer.invoke("rawengine:runtime"),
  /** Fresh sync every call — avoids caching `{}` if preload ran before IPC was ready (breaks API base in Win-Unpacked). */
  runtimeSync: () => readRuntimeSync(),
  openPath: (p) => ipcRenderer.invoke("rawengine:open-path", p || ""),
  openBundledExtensionFolder: () => ipcRenderer.invoke("rawengine:open-bundled-extension-folder"),
  getBundledExtensionPath: () => ipcRenderer.invoke("rawengine:get-bundled-extension-path"),
  clipboardWriteText: (text) => ipcRenderer.invoke("rawengine:clipboard-write-text", String(text ?? "")),
  openEdgeExtensionsSettings: () => ipcRenderer.invoke("rawengine:open-edge-extensions-settings"),
  openCaptureBrowserExtensions: (kind) =>
    ipcRenderer.invoke("rawengine:open-capture-browser-extensions", kind),
  getDefaultCaptureBrowser: () => ipcRenderer.invoke("rawengine:get-default-capture-browser"),
  prepareExtensionInstall: () => ipcRenderer.invoke("rawengine:prepare-extension-install"),
  copyExtensionFolderPath: () => ipcRenderer.invoke("rawengine:copy-extension-folder-path"),
  resyncBrowserExtension: (opts) =>
    ipcRenderer.invoke("rawengine:resync-browser-extension", opts && typeof opts === "object" ? opts : {}),
  shouldShowExtensionGuide: () => ipcRenderer.invoke("rawengine:should-show-extension-guide"),
  clearExtensionGuideMarker: () => ipcRenderer.invoke("rawengine:clear-extension-guide-marker"),
  openMicrosoftEdgeUrls: (urls) =>
    ipcRenderer.invoke("rawengine:open-microsoft-edge-urls", Array.isArray(urls) ? urls : []),
  factoryReset: (opts) => ipcRenderer.invoke("rawengine:factory-reset", opts || {}),
  importChromiumCookies: (opts) =>
    ipcRenderer.invoke("rawengine:import-chromium-cookies", opts && typeof opts === "object" ? opts : {}),
  captureLog: {
    append: (entry) => ipcRenderer.invoke("rawengine-capture-log:append", entry || {}),
    openWindow: () => ipcRenderer.invoke("rawengine-capture-log:open"),
    getInfo: () => ipcRenderer.invoke("rawengine-capture-log:get-info"),
    readTail: (n) => ipcRenderer.invoke("rawengine-capture-log:read-tail", n),
    revealFile: () => ipcRenderer.invoke("rawengine-capture-log:reveal"),
  },
  browser: {
    newTab: (url) => ipcRenderer.invoke("rawengine-browser:new-tab", url || ""),
    activate: (id) => ipcRenderer.invoke("rawengine-browser:activate", id),
    closeTab: (id) => ipcRenderer.invoke("rawengine-browser:close-tab", id),
    listTabs: () => ipcRenderer.invoke("rawengine-browser:list"),
    captureTab: (tabId, mode, options) =>
      ipcRenderer.invoke("rawengine-browser:capture-tab", {
        tabId,
        mode,
        options,
      }),
    openOrFocusUrl: (url) =>
      ipcRenderer.invoke("rawengine-browser:open-or-focus-url", url || ""),
    sniperClick: (args) => ipcRenderer.invoke("rawengine-browser:sniper-click", args || {}),
    ebayListingProbe: (args) =>
      ipcRenderer.invoke("rawengine-browser:ebay-listing-probe", args && typeof args === "object" ? args : {}),
    ebaySessionStatus: () => ipcRenderer.invoke("rawengine-browser:ebay-session-status"),
    clearEbaySession: () => ipcRenderer.invoke("rawengine-browser:clear-ebay-session"),
    ebayOrganicNavigate: (args) =>
      ipcRenderer.invoke(
        "rawengine-browser:ebay-organic-navigate",
        args && typeof args === "object" ? args : {}
      ),
    screenshot: (mode) =>
      ipcRenderer.invoke("rawengine-browser:screenshot-start", {
        mode:
          mode === "choose"
            ? "choose"
            : mode === "fullpage" || mode === "full"
              ? "fullpage"
              : mode === "region"
                ? "region"
                : "viewport",
      }),
  },
  scrapeGate: {
    waitForAck: (meta) =>
      ipcRenderer.invoke("rawengine-scrape-gate:wait-for-ack", meta && typeof meta === "object" ? meta : {}),
    signal: () => ipcRenderer.invoke("rawengine-scrape-gate:signal"),
  },
  captureChrome: {
    publish: (state) =>
      ipcRenderer.invoke(
        "rawengine-capture-chrome:publish",
        state && typeof state === "object" ? state : {}
      ),
  },
  focusPortfolioWindow: () => ipcRenderer.invoke("rawengine:focus-portfolio-window"),
  onQuickFetchCancel: (cb) => {
    if (typeof cb !== "function") return () => {};
    const handler = () => {
      try {
        cb();
      } catch {
        /* ignore */
      }
    };
    ipcRenderer.on("rawengine-app:cancel-quick-fetch", handler);
    return () => ipcRenderer.removeListener("rawengine-app:cancel-quick-fetch", handler);
  },
  onOpenUserGuide: (cb) => {
    if (typeof cb !== "function") return () => {};
    const handler = () => {
      try {
        cb();
      } catch {
        /* ignore */
      }
    };
    ipcRenderer.on("rawengine-app:open-user-guide", handler);
    return () => ipcRenderer.removeListener("rawengine-app:open-user-guide", handler);
  },
});
