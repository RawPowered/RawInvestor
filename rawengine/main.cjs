const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Menu,
  shell,
  session,
  clipboard,
} = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { spawn, execSync } = require("child_process");
const { getRawEngineTabbedBrowser } = require("./tabbed-browser.cjs");
const {
  appendCaptureLog,
  captureLogBus,
  getCaptureLogPath,
  readTailLines,
} = require("./capture-logger.cjs");
const {
  ensurePackagedRuntimeDecrypted,
  resolveSecureRuntimeRoot,
} = require("./decrypt-runtime.cjs");
const chromiumCookieImport = require("./chromiumCookieImport.cjs");

if (!app.requestSingleInstanceLock()) {
  try {
    appendCaptureLog({
      scope: "boot",
      level: "warn",
      message: "second instance blocked (single-instance lock not acquired)",
      detail: {},
    });
    dialog.showErrorBox(
      "Raw Investor",
      "Another copy is already running.\n\nIf you do not see the window, check the taskbar or Task Manager for RawInvestor.exe."
    );
  } catch {
    /* ignore */
  }
  app.quit();
  process.exit(0);
}
app.on("second-instance", () => {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      return;
    }
    if (launcherWindowRef && !launcherWindowRef.isDestroyed()) {
      launcherWindowRef.show();
      launcherWindowRef.focus();
    }
  } catch (err) {
    console.warn("[rawengine] second-instance:", err);
  }
});

const isDev = !app.isPackaged;
/** Packaged builds: set `RAWENGINE_ENABLE_DEVTOOLS=1` to re-enable DevTools (support / debugging). */
const allowDevTools = isDev || String(process.env.RAWENGINE_ENABLE_DEVTOOLS || "").trim() === "1";
/** Decrypted client/server/extension tree under userData when secure-runtime is shipped. */
let packagedDecryptedRoot = null;

/** Packaged: use a Chrome-like default UA so remote sites do not see an `Electron/…` token. */
function applyPackagedEmbeddedBrowserUserAgent() {
  if (isDev) return;
  const chrome = process.versions.chrome;
  if (!chrome) return;
  const ua = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`;
  try {
    session.defaultSession.setUserAgent(ua);
  } catch (err) {
    console.warn("[rawengine] session.setUserAgent failed:", err);
  }
}

/** Prefer unpacked copy when present so BrowserWindow can load HTML/preload outside asar (Windows packaged). */
function resolveRawEngineAsset(...parts) {
  const joined = path.join(...parts);
  const besideMain = path.join(__dirname, joined);
  const unpacked = path.join(process.resourcesPath, "app.asar.unpacked", "rawengine", joined);
  try {
    if (app.isPackaged && fs.existsSync(unpacked)) return unpacked;
  } catch {
    /* ignore */
  }
  try {
    if (fs.existsSync(besideMain)) return besideMain;
  } catch {
    /* ignore */
  }
  try {
    if (fs.existsSync(unpacked)) return unpacked;
  } catch {
    /* ignore */
  }
  return besideMain;
}

/** electron-builder portable target sets PORTABLE_EXECUTABLE_DIR — keep profile beside the EXE (USB / tester drops). */
const portableExeDir = String(process.env.PORTABLE_EXECUTABLE_DIR || "").trim();
if (portableExeDir && app.isPackaged) {
  try {
    app.setPath("userData", path.join(portableExeDir, "pcgr-runtime-data"));
    console.log("[rawengine] portable userData ->", app.getPath("userData"));
  } catch (err) {
    console.warn("[rawengine] portable userData override failed:", err);
  }
}

/** Portable Windows EXE — license dialog before every session. */
const isPortablePackagedBuild = Boolean(portableExeDir && app.isPackaged);

const rendererUrl = process.env.RAWENGINE_RENDERER_URL || "http://localhost:5173";

/** R brand icon: dev = repo build/; packaged = extraResources build/icon.ico (win/icon also embedded in EXE). */
function getAppIconPath() {
  if (app.isPackaged) {
    const res = path.join(process.resourcesPath, "build", "icon.ico");
    try {
      if (fs.existsSync(res)) return res;
    } catch {
      /* ignore */
    }
  }
  const dev = path.join(__dirname, "..", "build", "icon.ico");
  try {
    if (fs.existsSync(dev)) return dev;
  } catch {
    /* ignore */
  }
  return undefined;
}
const apiPort = process.env.RAWENGINE_API_PORT || "3001";
/** Filled by `initializeRuntimeSecrets()` (must run after `app` paths are usable). */
let runtimeAppToken = "";
let runtimeExtToken = "";
let runtimeMaintToken = "";
let runtimeSecretsInitialized = false;

/**
 * When PCGR_* tokens are not set in the environment, load or create stable values
 * under userData so restarts do not rotate secrets and break the MV3 extension.
 */
function initializeRuntimeSecrets() {
  if (runtimeSecretsInitialized) return;
  const ud = app.getPath("userData");
  try {
    fs.mkdirSync(ud, { recursive: true });
  } catch {
    /* ignore */
  }
  const secretsPath = path.join(ud, "runtime-secrets.json");
  let stored = {};
  try {
    const raw = fs.readFileSync(secretsPath, "utf8");
    stored = JSON.parse(raw);
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) stored = {};
  } catch {
    stored = {};
  }

  const envApp = String(process.env.PCGR_APP_TOKEN || "").trim();
  const envExt = String(process.env.PCGR_EXT_TOKEN || "").trim();
  const envMaint = String(process.env.PCGR_MAINT_TOKEN || "").trim();

  runtimeAppToken =
    envApp ||
    String(stored.appToken || "").trim() ||
    crypto.randomBytes(24).toString("hex");
  runtimeExtToken =
    envExt ||
    String(stored.extToken || "").trim() ||
    crypto.randomBytes(24).toString("hex");
  runtimeMaintToken =
    envMaint ||
    String(stored.maintToken || "").trim() ||
    runtimeAppToken;

  const out = { ...stored };
  if (!envApp) out.appToken = runtimeAppToken;
  if (!envExt) out.extToken = runtimeExtToken;
  if (!envMaint) out.maintToken = runtimeMaintToken;
  if (!envApp || !envExt || !envMaint) {
    try {
      fs.writeFileSync(secretsPath, `${JSON.stringify(out)}\n`, "utf8");
    } catch (err) {
      console.warn("[rawengine] runtime-secrets write failed:", err);
    }
  }

  runtimeSecretsInitialized = true;
}

ipcMain.on("rawengine:runtime-sync", (event) => {
  initializeRuntimeSecrets();
  const ud = app.getPath("userData");
  const backupVaultDir =
    String(process.env.PCGR_BACKUPS_DIR || "").trim() ||
    path.join(ud, "portfolio-backups-vault");
  event.returnValue = JSON.stringify({
    apiBaseUrl:
      process.env.RAWENGINE_API_URL || `http://127.0.0.1:${apiPort}`,
    appToken: runtimeAppToken,
    extToken: runtimeExtToken,
    psaTokenPersistent: String(process.env.PCGR_PSA_TOKEN_PERSIST || "").trim() === "1",
    userDataDir: ud,
    backupVaultDir,
    runtimeDataDir: path.join(ud, "runtime-data"),
    isPackaged: app.isPackaged,
    captureLogPath: path.join(ud, "logs", "rawengine-capture.log"),
    osPlatform: process.platform,
  });
});

ipcMain.handle("rawengine:open-path", async (_evt, rawPath) => {
  const p = String(rawPath || "").trim();
  if (!p) return { ok: false, error: "empty path" };
  const err = await shell.openPath(p);
  if (err) return { ok: false, error: err };
  return { ok: true };
});

const STABLE_EXTENSION_SUBDIR = "browser-extension-edge";

/**
 * @returns {string | null}
 */
function resolveBundledExtensionDir() {
  const packaged = path.join(process.resourcesPath, STABLE_EXTENSION_SUBDIR);
  try {
    if (fs.existsSync(path.join(packaged, "manifest.json"))) return packaged;
  } catch {
    /* ignore */
  }
  const dev = path.join(__dirname, "..", "extension");
  try {
    if (fs.existsSync(path.join(dev, "manifest.json"))) return dev;
  } catch {
    /* ignore */
  }
  return null;
}

/** Persistent MV3 folder for Edge/Chrome Load unpacked (survives reboot; not tied to install dir). */
function resolveStableExtensionDir() {
  return path.join(app.getPath("userData"), STABLE_EXTENSION_SUBDIR);
}

const PCGR_CONNECTION_FILENAME = "pcgr-connection.json";

/**
 * Written beside the stable MV3 folder so Edge/Chrome can auto-load keys without paste.
 * @param {string} stableDir
 * @param {string} [extensionVersion]
 * @returns {{ ok: boolean; error?: string }}
 */
function writePcgrConnectionFile(stableDir, extensionVersion = "0.0.0") {
  initializeRuntimeSecrets();
  const serverBase = String(
    process.env.RAWENGINE_API_URL || `http://127.0.0.1:${apiPort}`
  )
    .trim()
    .replace(/\/$/, "");
  const payload = {
    version: String(extensionVersion || "0.0.0"),
    serverBase,
    extToken: runtimeExtToken,
    appToken: runtimeAppToken,
    writtenAt: Date.now(),
  };
  try {
    fs.mkdirSync(stableDir, { recursive: true });
    fs.writeFileSync(
      path.join(stableDir, PCGR_CONNECTION_FILENAME),
      `${JSON.stringify(payload, null, 2)}\n`,
      "utf8"
    );
    return { ok: true };
  } catch (err) {
    console.warn("[rawengine] writePcgrConnectionFile failed:", err);
    return { ok: false, error: String(err?.message || err) };
  }
}

/**
 * @returns {{ ok: boolean; path?: string; error?: string }}
 */
function refreshExtensionConnectionFile() {
  const dir = resolveUserExtensionDir();
  if (!dir) return { ok: false, error: "extension-folder-missing" };
  let ver = "0.0.0";
  try {
    const raw = fs.readFileSync(path.join(dir, "manifest.json"), "utf8");
    const man = JSON.parse(raw);
    if (man && typeof man.version === "string") ver = man.version;
  } catch {
    /* ignore */
  }
  const w = writePcgrConnectionFile(dir, ver);
  if (!w.ok) return { ok: false, error: w.error };
  return { ok: true, path: path.join(dir, PCGR_CONNECTION_FILENAME) };
}

/**
 * @param {string} src
 * @param {string} dest
 */
function copyExtensionTreeSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    if (name === "node_modules" || name === ".git") continue;
    const from = path.join(src, name);
    const to = path.join(dest, name);
    const st = fs.statSync(from);
    if (st.isDirectory()) {
      copyExtensionTreeSync(from, to);
    } else {
      fs.copyFileSync(from, to);
    }
  }
}

/**
 * @returns {{ ok: boolean, path?: string, error?: string, synced?: boolean }}
 */
function ensureStableExtensionInstall() {
  const bundled = resolveBundledExtensionDir();
  if (!bundled) {
    const stableOnly = resolveStableExtensionDir();
    try {
      if (fs.existsSync(path.join(stableOnly, "manifest.json"))) {
        let ver = "0.0.0";
        try {
          const raw = fs.readFileSync(path.join(stableOnly, "manifest.json"), "utf8");
          const man = JSON.parse(raw);
          if (man && typeof man.version === "string") ver = man.version;
        } catch {
          /* ignore */
        }
        writePcgrConnectionFile(stableOnly, ver);
        return { ok: true, path: stableOnly, synced: false };
      }
    } catch {
      /* ignore */
    }
    return { ok: false, error: "Extension source not found (bundled or dev extension/)." };
  }

  const stable = resolveStableExtensionDir();
  let bundledVersion = "0.0.0";
  try {
    const raw = fs.readFileSync(path.join(bundled, "manifest.json"), "utf8");
    const man = JSON.parse(raw);
    if (man && typeof man.version === "string") bundledVersion = man.version;
  } catch {
    /* ignore */
  }

  let needsSync = true;
  const metaPath = path.join(stable, "install-meta.json");
  try {
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
      if (meta && meta.version === bundledVersion && fs.existsSync(path.join(stable, "manifest.json"))) {
        needsSync = false;
      }
    }
  } catch {
    needsSync = true;
  }

  if (needsSync) {
    try {
      if (fs.existsSync(stable)) {
        fs.rmSync(stable, { recursive: true, force: true });
      }
      copyExtensionTreeSync(bundled, stable);
      fs.writeFileSync(
        metaPath,
        JSON.stringify({ version: bundledVersion, syncedAt: Date.now() }, null, 2),
        "utf8"
      );
      console.log("[rawengine] synced browser extension to stable path:", stable);
    } catch (err) {
      console.warn("[rawengine] ensureStableExtensionInstall failed:", err);
      return { ok: false, error: String(err?.message || err) };
    }
    writePcgrConnectionFile(stable, bundledVersion);
    return { ok: true, path: stable, synced: true };
  }

  writePcgrConnectionFile(stable, bundledVersion);
  return { ok: true, path: stable, synced: false };
}

/**
 * User-facing extension path (stable LocalAppData copy).
 * @returns {string | null}
 */
function resolveUserExtensionDir() {
  const stable = resolveStableExtensionDir();
  try {
    if (fs.existsSync(path.join(stable, "manifest.json"))) return stable;
  } catch {
    /* ignore */
  }
  const ensured = ensureStableExtensionInstall();
  return ensured.ok && ensured.path ? ensured.path : null;
}

ipcMain.handle("rawengine:open-bundled-extension-folder", async () => {
  const p = resolveUserExtensionDir();
  if (!p) {
    return {
      ok: false,
      error:
        "Extension folder not found. Reinstall Raw Investor or run from a build that includes the extension.",
    };
  }
  const err = await shell.openPath(p);
  if (err) return { ok: false, error: err };
  return { ok: true, path: p };
});

ipcMain.handle("rawengine:get-bundled-extension-path", async () => {
  const p = resolveUserExtensionDir();
  if (!p) {
    return {
      ok: false,
      error:
        "Extension folder not found. Reinstall Raw Investor or run from a build that includes the extension.",
    };
  }
  return { ok: true, path: p };
});

ipcMain.handle("rawengine:refresh-extension-connection-file", async () => {
  return refreshExtensionConnectionFile();
});

/** @returns {string} */
function readWinDefaultHttpProgId() {
  if (process.platform !== "win32") return "";
  const keys = [
    "HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice",
    "HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice",
  ];
  for (const key of keys) {
    try {
      const out = execSync(`reg query "${key}" /v ProgId`, {
        encoding: "utf8",
        windowsHide: true,
        timeout: 5000,
      });
      const m = out.match(/ProgId\s+REG_\w+\s+(\S+)/i);
      if (m && m[1]) return String(m[1]).trim();
    } catch {
      /* try next key */
    }
  }
  return "";
}

/** @returns {"edge" | "chrome"} */
function detectDefaultCaptureBrowserKind() {
  if (process.platform !== "win32") return "edge";
  const progId = readWinDefaultHttpProgId().toLowerCase();
  if (
    progId.includes("chromehtml") ||
    (progId.includes("chrome") && !progId.includes("edge") && !progId.includes("msedge"))
  ) {
    return "chrome";
  }
  if (progId.includes("bravehtml") || progId.includes("brave")) return "chrome";
  return "edge";
}

/** @returns {string | null} */
function resolveChromeExecutable() {
  const candidates = [
    path.join(process.env.PROGRAMFILES || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(
      process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)",
      "Google",
      "Chrome",
      "Application",
      "chrome.exe"
    ),
    path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/** @returns {string | null} */
function resolveEdgeExecutable() {
  const candidates = [
    path.join(
      process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)",
      "Microsoft",
      "Edge",
      "Application",
      "msedge.exe"
    ),
    path.join(process.env.PROGRAMFILES || "C:\\Program Files", "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Microsoft", "Edge", "Application", "msedge.exe"),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/**
 * @param {"edge" | "chrome" | undefined} kind
 */
async function openCaptureBrowserExtensionsPage(kind) {
  const browser = kind === "chrome" || kind === "edge" ? kind : detectDefaultCaptureBrowserKind();
  const internalUrl = browser === "chrome" ? "chrome://extensions" : "edge://extensions";

  if (process.platform !== "win32") {
    return { ok: false, error: "Opening browser extensions is only supported on Windows.", browser };
  }

  if (browser === "chrome") {
    try {
      await shell.openExternal("googlechrome://extensions/");
      return { ok: true, browser: "chrome", url: internalUrl, method: "protocol" };
    } catch {
      /* spawn fallback */
    }
    const chromeExe = resolveChromeExecutable();
    if (!chromeExe) {
      return { ok: false, error: "Google Chrome not found on this PC.", browser: "chrome", url: internalUrl };
    }
    try {
      spawn(chromeExe, ["--new-window", internalUrl], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      }).unref();
      return { ok: true, browser: "chrome", url: internalUrl, method: "spawn" };
    } catch (err) {
      return { ok: false, error: String(err?.message || err), browser: "chrome", url: internalUrl };
    }
  }

  try {
    await shell.openExternal(`microsoft-edge:${internalUrl}`);
    return { ok: true, browser: "edge", url: internalUrl, method: "protocol" };
  } catch {
    /* spawn fallback */
  }
  const edgeExe = resolveEdgeExecutable();
  if (!edgeExe) {
    return { ok: false, error: "Microsoft Edge not found on this PC.", browser: "edge", url: internalUrl };
  }
  try {
    spawn(edgeExe, ["--new-window", internalUrl], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    return { ok: true, browser: "edge", url: internalUrl, method: "spawn" };
  } catch (err) {
    return { ok: false, error: String(err?.message || err), browser: "edge", url: internalUrl };
  }
}

/**
 * Sync extension tree + pcgr-connection.json only (no Explorer, clipboard, or browser).
 */
async function prepareExtensionInstallFiles() {
  const browser = detectDefaultCaptureBrowserKind();
  const sync = ensureStableExtensionInstall();
  if (!sync.ok) {
    return { ok: false, error: sync.error || "Could not sync extension files.", browser };
  }
  const conn = refreshExtensionConnectionFile();
  if (!conn.ok) {
    return {
      ok: false,
      error: conn.error || "Could not write connection settings for the extension.",
      browser,
      extensionPath: sync.path,
    };
  }
  const extensionPath = sync.path || path.dirname(String(conn.path || ""));
  return {
    ok: true,
    browser,
    extensionPath,
    connectionPath: conn.path,
  };
}

/**
 * Copy stable extension folder path to clipboard (does not open Explorer).
 */
async function copyExtensionFolderPathToClipboard() {
  const prep = await prepareExtensionInstallFiles();
  if (!prep.ok || !prep.extensionPath) {
    return { ok: false, error: prep.error || "Extension folder not ready.", browser: prep.browser };
  }
  try {
    clipboard.writeText(prep.extensionPath);
    return { ok: true, path: prep.extensionPath, browser: prep.browser };
  } catch (err) {
    return { ok: false, error: String(err?.message || err), browser: prep.browser };
  }
}

/**
 * Optional power-user re-sync; defaults avoid opening folder/browser (use install guide instead).
 * @param {{ openFolder?: boolean, copyClipboard?: boolean, openBrowser?: boolean }} [opts]
 */
async function resyncBrowserExtensionCapture(opts = {}) {
  const openFolder = opts.openFolder === true;
  const copyClipboard = opts.copyClipboard === true;
  const openBrowser = opts.openBrowser === true;

  const prep = await prepareExtensionInstallFiles();
  if (!prep.ok) {
    return { ok: false, error: prep.error, browser: prep.browser };
  }

  const { browser, extensionPath, connectionPath } = prep;
  let folderOpened = false;
  if (openFolder && extensionPath) {
    const err = await shell.openPath(extensionPath);
    folderOpened = !err;
  }

  let pathCopied = false;
  if (copyClipboard && extensionPath) {
    try {
      clipboard.writeText(extensionPath);
      pathCopied = true;
    } catch {
      /* ignore */
    }
  }

  let extensionsPage = { ok: false };
  if (openBrowser) {
    extensionsPage = await openCaptureBrowserExtensionsPage(browser);
  }

  const browserLabel = browser === "chrome" ? "Chrome" : "Edge";
  const hintParts = [];
  if (openBrowser) {
    if (extensionsPage.ok) {
      hintParts.push(`Opened ${browserLabel} extensions.`);
    } else {
      hintParts.push(
        `Could not open ${browserLabel} automatically${extensionsPage.error ? `: ${extensionsPage.error}` : ""}. Open ${internalUrlForBrowser(browser)} manually.`
      );
    }
  }
  if (folderOpened) hintParts.push("Extension folder opened in File Explorer.");
  if (pathCopied) hintParts.push("Extension folder path copied to clipboard.");
  if (openBrowser) {
    hintParts.push(
      "On the extensions page, click Reload on Raw Investor Tab Capture — or Load unpacked again using the copied folder."
    );
    hintParts.push("Reopen the extension popup; it should show Running while Raw Investor is open.");
  }
  if (!hintParts.length) {
    hintParts.push("Extension files and connection settings refreshed.");
  }

  const ok =
    prep.ok &&
    (!openBrowser || extensionsPage.ok) &&
    (!openFolder || folderOpened || Boolean(extensionPath));

  return {
    ok,
    browser,
    extensionPath,
    connectionPath,
    folderOpened,
    pathCopied,
    extensionsPage,
    hint: hintParts.join(" "),
  };
}

/** @param {"edge" | "chrome"} browser */
function internalUrlForBrowser(browser) {
  return browser === "chrome" ? "chrome://extensions" : "edge://extensions";
}

ipcMain.handle("rawengine:get-default-capture-browser", async () => ({
  browser: detectDefaultCaptureBrowserKind(),
  progId: readWinDefaultHttpProgId() || undefined,
}));

ipcMain.handle("rawengine:open-capture-browser-extensions", async (_evt, rawKind) => {
  const kind =
    rawKind === "chrome" || rawKind === "edge" ? rawKind : detectDefaultCaptureBrowserKind();
  return openCaptureBrowserExtensionsPage(kind);
});

ipcMain.handle("rawengine:prepare-extension-install", async () => prepareExtensionInstallFiles());

ipcMain.handle("rawengine:copy-extension-folder-path", async () => copyExtensionFolderPathToClipboard());

ipcMain.handle("rawengine:resync-browser-extension", async (_evt, rawOpts) => {
  const o = rawOpts && typeof rawOpts === "object" ? rawOpts : {};
  return resyncBrowserExtensionCapture({
    openFolder: o.openFolder === true,
    copyClipboard: o.copyClipboard === true,
    openBrowser: o.openBrowser === true,
  });
});

ipcMain.handle("rawengine:should-show-extension-guide", async () => {
  if (!app.isPackaged) return { show: false };
  const markerPath = path.join(process.resourcesPath, "pcgr-first-run.json");
  try {
    if (!fs.existsSync(markerPath)) return { show: false };
    const raw = fs.readFileSync(markerPath, "utf8");
    const j = JSON.parse(raw);
    return { show: Boolean(j && j.showExtensionGuide) };
  } catch {
    return { show: false };
  }
});

ipcMain.handle("rawengine:clear-extension-guide-marker", async () => {
  const markerPath = path.join(process.resourcesPath, "pcgr-first-run.json");
  try {
    if (fs.existsSync(markerPath)) fs.unlinkSync(markerPath);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("rawengine:clipboard-write-text", async (_evt, raw) => {
  const text = typeof raw === "string" ? raw : String(raw ?? "");
  if (!text.trim()) return { ok: false, error: "empty-text" };
  if (text.length > 32_000) return { ok: false, error: "text-too-long" };
  try {
    clipboard.writeText(text);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("rawengine:open-edge-extensions-settings", async () => {
  const r = await openCaptureBrowserExtensionsPage("edge");
  return { ok: r.ok, error: r.error, browser: r.browser };
});

ipcMain.handle("rawengine:open-microsoft-edge-urls", async (_evt, rawUrls) => {
  const arr = Array.isArray(rawUrls)
    ? rawUrls.map((u) => String(u || "").trim()).filter(Boolean)
    : [];
  if (!arr.length) return { ok: false, error: "no-urls", opened: 0 };
  if (process.platform !== "win32") {
    return { ok: false, error: "Microsoft Edge URL launch is only supported on Windows.", opened: 0 };
  }
  const errs = [];
  for (let i = 0; i < arr.length; i += 1) {
    const href = arr[i];
    try {
      const u = new URL(href);
      if (u.protocol !== "https:" && u.protocol !== "http:") {
        errs.push(`${href}: unsupported protocol`);
        continue;
      }
      const host = u.hostname.toLowerCase();
      const allowed =
        host === "www.ebay.com" ||
        host === "ebay.com" ||
        host === "m.ebay.com" ||
        host.endsWith(".ebay.com") ||
        host === "www.tcgplayer.com" ||
        host === "tcgplayer.com" ||
        host === "www.pricecharting.com" ||
        host === "pricecharting.com" ||
        host === "localhost" ||
        host === "127.0.0.1";
      if (!allowed) {
        errs.push(`${href}: host not allowed for Edge launch`);
        continue;
      }
      const edgeUri = `microsoft-edge:${u.href}`;
      await shell.openExternal(edgeUri);
    } catch (e) {
      errs.push(`${href}: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (i < arr.length - 1) await new Promise((r) => setTimeout(r, 550));
  }
  if (errs.length) return { ok: false, error: errs.join("; "), opened: arr.length - errs.length };
  return { ok: true, opened: arr.length };
});

ipcMain.handle("rawengine:import-chromium-cookies", async (_evt, rawOpts) => {
  const o = rawOpts && typeof rawOpts === "object" ? rawOpts : {};
  const edge = o.edge !== false;
  const chrome = o.chrome !== false;
  try {
    return await chromiumCookieImport.importChromiumCookiesIntoSession(session.defaultSession, {
      edge,
      chrome,
    });
  } catch (err) {
    return {
      ok: false,
      imported: 0,
      skipped: 0,
      errors: 1,
      details: [String(err?.message || err)],
    };
  }
});

let mainWindow;
let apiProcess;
let captureExtension;
let rawEngineTabbedBrowser;
let bootCancelled = false;
let launcherWindowRef = null;
let captureDiagnosticsEnabled = false;
let captureLogWindow = null;
let rawEngineSchedulerTimer = null;
let rawEngineTargetWatchTimer = null;
const firedOnceHuntKeys = new Set();
const firedRecurringMinuteKeyByHuntId = new Map();
/** @type {Map<string, number>} */
const targetWatchLastPoll = new Map();
/** One-shot timers: pre-open listing tab near sniper window (per target id). */
/** @type {Map<string, ReturnType<typeof setTimeout>>} */
const sniperPreopenTimers = new Map();
/** @type {Map<string, number>} */
const sniperPreopenFireAtByTargetId = new Map();
/** Throttle immediate pre-opens when already inside the sniper window. */
/** @type {Map<string, number>} */
const sniperPreopenLastOpenMs = new Map();

const captureDiagnosticsSettingsPath = path.join(
  app.getPath("userData"),
  "capture-diagnostics.json"
);
try {
  const raw = fs.readFileSync(captureDiagnosticsSettingsPath, "utf8");
  const parsed = JSON.parse(raw);
  captureDiagnosticsEnabled = parsed?.captureDiagnosticsEnabled === true;
} catch {
  // defaults to false
}

function resolveProdHtml() {
  if (packagedDecryptedRoot) {
    const p = path.join(packagedDecryptedRoot, "client", "dist", "index.html");
    if (fs.existsSync(p)) return p;
  }
  return path.join(__dirname, "..", "client", "dist", "index.html");
}

function resolveBundledServerEntry() {
  if (packagedDecryptedRoot) {
    const p = path.join(packagedDecryptedRoot, "server", "dist", "index.js");
    if (fs.existsSync(p)) return p;
  }
  const candidates = [
    path.join(
      process.resourcesPath,
      "app.asar.unpacked",
      "server",
      "dist",
      "index.js"
    ),
    path.join(process.resourcesPath, "server", "dist", "index.js"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function startBundledApiServerProcess(serverEntry) {
  const serverRoot = path.join(path.dirname(serverEntry), "..");
  const runtimeDataRoot = path.join(app.getPath("userData"), "runtime-data");
  const nodeCli = String(process.env.RAWENGINE_NODE_EXE || "").trim();
  const useNode =
    nodeCli && fs.existsSync(nodeCli)
      ? [nodeCli, serverEntry]
      : [process.execPath, serverEntry];
  const backupVaultDir =
    String(process.env.PCGR_BACKUPS_DIR || "").trim() ||
    path.join(app.getPath("userData"), "portfolio-backups-vault");
  const bundledPwBrowsers = path.join(process.resourcesPath, "playwright-browsers");
  const spawnEnv = {
    ...process.env,
    NODE_ENV: "production",
    PORT: apiPort,
    PCGR_APP_TOKEN: runtimeAppToken,
    PCGR_EXT_TOKEN: runtimeExtToken,
    PCGR_MAINT_TOKEN: runtimeMaintToken,
    PCGR_BACKUPS_DIR: backupVaultDir,
    PCGR_DATA_DIR: process.env.PCGR_DATA_DIR || path.join(runtimeDataRoot, "data"),
    PCGR_IMAGES_DIR: process.env.PCGR_IMAGES_DIR || path.join(runtimeDataRoot, "images"),
    PCGR_UPLOADS_DIR: process.env.PCGR_UPLOADS_DIR || path.join(runtimeDataRoot, "uploads"),
  };
  const pwBrowsersFromEnv = String(process.env.PLAYWRIGHT_BROWSERS_PATH || "").trim();
  if (pwBrowsersFromEnv) {
    spawnEnv.PLAYWRIGHT_BROWSERS_PATH = pwBrowsersFromEnv;
  } else if (app.isPackaged && fs.existsSync(bundledPwBrowsers)) {
    /** Shipped next to the app — end users do not install Playwright or Node.js separately. */
    spawnEnv.PLAYWRIGHT_BROWSERS_PATH = bundledPwBrowsers;
  }
  if (!nodeCli || !fs.existsSync(nodeCli)) {
    spawnEnv.ELECTRON_RUN_AS_NODE = "1";
  }

  if (app.isPackaged) {
    const bundledServerNodeModules = path.join(
      process.resourcesPath,
      "app.asar.unpacked",
      "server",
      "node_modules"
    );
    if (fs.existsSync(bundledServerNodeModules)) {
      const prev = String(spawnEnv.NODE_PATH || process.env.NODE_PATH || "").trim();
      spawnEnv.NODE_PATH = prev
        ? `${bundledServerNodeModules}${path.delimiter}${prev}`
        : bundledServerNodeModules;
    }
  }

  console.log(
    "[rawengine] spawning pcgr-server cwd=%s entry=%s",
    serverRoot,
    serverEntry
  );
  apiProcess = spawn(useNode[0], useNode.slice(1), {
    cwd: serverRoot,
    stdio: "inherit",
    env: spawnEnv,
  });

  apiProcess.on("error", (err) => {
    console.error("[rawengine] failed to spawn bundled API:", err);
  });

  apiProcess.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[rawengine] API server exited with code ${code}`);
    }
  });
}

async function waitForBundledApiHealthy(timeoutMs = 45000) {
  const base = (
    process.env.RAWENGINE_API_URL || `http://127.0.0.1:${apiPort}`
  ).replace(/\/$/, "");
  const healthUrl = `${base}/api/health`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(healthUrl, { cache: "no-store" });
      if (res.ok) return true;
    } catch {
      // port not listening yet or connection refused
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

function sendLauncherStatus(launcherWindow, payload) {
  if (launcherWindow && !launcherWindow.isDestroyed()) {
    launcherWindow.webContents.send("launcher:status", payload);
  }
}

function closeLauncherWindow(win) {
  if (!win || win.isDestroyed()) return;
  try {
    win.destroy();
  } catch {
    // ignore close race
  }
}

/**
 * Brings up the local API (bundled when packaged; external when in dev) and
 * waits for /api/health. Reports progress via onStatus for the launcher UI.
 */
async function prepareRuntimeEnvironment(onStatus) {
  const emit = (payload) => {
    try {
      if (typeof onStatus === "function") onStatus(payload);
    } catch (err) {
      console.error("[rawengine] launcher status callback failed:", err);
    }
  };

  initializeRuntimeSecrets();

  if (!app.isPackaged) {
    emit({
      label: "Connecting to local API",
      detail: `Waiting for http://127.0.0.1:${apiPort} — run npm run beta:dev if the API is not already running.`,
      steps: { check: "done", api: "done", connect: "active", extension: "", ui: "" },
    });
    console.log("[rawengine] dev mode: waiting for local API");
    const healthy = await waitForBundledApiHealthy(120000);
    if (!healthy) {
      emit({
        label: "Could not reach local API",
        detail: `No response at http://127.0.0.1:${apiPort}/api/health within 2 minutes.`,
        steps: { check: "done", api: "err", connect: "err", extension: "", ui: "" },
        bar: "error",
      });
      await dialog.showMessageBox({
        type: "error",
        title: "Raw Investor",
        message: "The local API server was not available.",
        detail:
          "Start it with npm run beta:dev, or set RAWENGINE_API_URL to a running server.",
      });
      return false;
    }
    emit({
      label: "Local API ready",
      detail: "Next: capture tools, then the dashboard.",
      steps: { check: "done", api: "done", connect: "done", extension: "", ui: "" },
    });
    console.log("[rawengine] local API healthy (dev)");
    return true;
  }

  emit({
    label: "Verifying installation",
    detail: "",
    steps: { check: "active", api: "", connect: "", extension: "", ui: "" },
  });

  try {
    packagedDecryptedRoot = ensurePackagedRuntimeDecrypted({ app, emit });
    if (packagedDecryptedRoot) {
      process.env.PCGR_EXTENSION_ROOT = path.join(packagedDecryptedRoot, "extension");
    } else {
      delete process.env.PCGR_EXTENSION_ROOT;
    }
    try {
      const sr = resolveSecureRuntimeRoot(app);
      console.log(
        "[rawengine] packaged boot:",
        sr ? `secure-runtime OK (${sr})` : "secure-runtime NOT FOUND (reinstall from latest installer)"
      );
    } catch {
      /* ignore */
    }
  } catch (err) {
    packagedDecryptedRoot = null;
    delete process.env.PCGR_EXTENSION_ROOT;
    console.error("[rawengine] decrypt runtime failed:", err);
    appendCaptureLog({
      scope: "boot",
      level: "error",
      message: "decrypt runtime failed",
      detail: String(err?.message || err),
    });
    emit({
      label: "Could not prepare app files",
      detail: String(err?.message || err),
      steps: { check: "err", api: "err", connect: "", extension: "", ui: "" },
      bar: "error",
    });
    await dialog.showMessageBox({
      type: "error",
      title: "Raw Investor",
      message: "Could not prepare application files.",
      detail: String(err?.message || err),
    });
    return false;
  }

  const serverEntry = resolveBundledServerEntry();
  if (!serverEntry) {
    console.error(
      "[rawengine] bundled API script not found under:",
      process.resourcesPath,
      "packagedDecryptedRoot=",
      packagedDecryptedRoot || "(null)"
    );
    appendCaptureLog({
      scope: "boot",
      level: "error",
      message: "bundled API script not found",
      detail: {
        resourcesPath: process.resourcesPath,
        packagedDecryptedRoot: packagedDecryptedRoot || null,
      },
    });
    emit({
      label: "Installation incomplete",
      detail: "Built-in server files are missing from this build.",
      steps: { check: "err", api: "", connect: "", extension: "", ui: "" },
      bar: "error",
    });
    const secureOk = resolveSecureRuntimeRoot(app) != null;
    const detail = !secureOk
      ? "Part of Raw Investor did not install correctly.\n\nPlease download and run the installer again. If you moved the app, keep RawInvestor.exe and the whole \"resources\" folder together in the same place."
      : packagedDecryptedRoot
        ? "A local data folder from a previous run looks incomplete.\n\nQuit Raw Investor, install again from the latest installer, or use Support to clear the app data folder for this version, then launch again."
        : "The built-in service could not be started.\n\nReinstall Raw Investor using the latest installer from your distributor.";
    await dialog.showMessageBox({
      type: "error",
      title: "Raw Investor",
      message: "The built-in service could not be found.",
      detail,
    });
    return false;
  }

  emit({
    label: "Starting local API server",
    detail: "",
    steps: { check: "done", api: "active", connect: "", extension: "", ui: "" },
  });

  console.log("[rawengine] starting bundled API:", serverEntry);
  startBundledApiServerProcess(serverEntry);

  emit({
    label: "Waiting for service",
    detail: `Checking http://127.0.0.1:${apiPort}/api/health`,
    steps: { check: "done", api: "done", connect: "active", extension: "", ui: "" },
  });

  /** First packaged cold boot can exceed 45s (decrypt runtime, native modules, disk). */
  const healthTimeoutMs = app.isPackaged ? 180000 : 45000;
  const healthy = await waitForBundledApiHealthy(healthTimeoutMs);
  if (!healthy) {
    appendCaptureLog({
      scope: "boot",
      level: "error",
      message: "bundled API /api/health did not become ready in time",
      detail: { apiPort, healthTimeoutMs },
    });
    emit({
      label: "Service did not start in time",
      detail: "Another app may be using the API port.",
      steps: { check: "done", api: "err", connect: "err", extension: "", ui: "" },
      bar: "error",
    });
    await dialog.showMessageBox({
      type: "error",
      title: "Raw Investor",
      message: "The local API server did not become ready in time.",
      detail: app.isPackaged
        ? `Nothing responded at http://127.0.0.1:${apiPort}/api/health within ${Math.round(healthTimeoutMs / 1000)}s. On a first launch after install, wait and try again once. If it keeps failing, another program may be using that port (change RAWENGINE_API_PORT) or antivirus may be blocking the app.`
        : `Nothing responded at http://127.0.0.1:${apiPort}/api/health. If another app uses that port, close it or set RAWENGINE_API_PORT before launch.`,
    });
    return false;
  }

  refreshExtensionConnectionFile();

  emit({
    label: "Local API ready",
    detail: "Next: capture tools, then the dashboard.",
    steps: { check: "done", api: "done", connect: "done", extension: "", ui: "" },
  });
  console.log("[rawengine] bundled API healthy");
  return true;
}

function createLauncherWindow() {
  const icon = getAppIconPath();
  const win = new BrowserWindow({
    ...(icon ? { icon } : {}),
    width: 520,
    height: 560,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    frame: false,
    titleBarStyle: "hidden",
    minimizable: false,
    closable: false,
    show: false,
    title: "Raw Investor — Starting",
    backgroundColor: "#0f172a",
    webPreferences: {
      preload: path.join(__dirname, "launcher-preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      devTools: allowDevTools,
    },
  });
  win.once("ready-to-show", () => win.show());
  win.loadFile(path.join(__dirname, "launcher.html"));
  launcherWindowRef = win;
  return win;
}

/**
 * Portable-only: full-screen license gate before boot (every launch).
 * @returns {Promise<boolean>}
 */
function waitPortableEulaAcceptance() {
  const icon = getAppIconPath();
  return new Promise((resolve) => {
    let done = false;
    /** @type {import("electron").BrowserWindow | null} */
    let win = null;
    const finish = (val) => {
      if (done) return;
      done = true;
      ipcMain.removeListener("portable-eula:respond", onResp);
      try {
        if (win && !win.isDestroyed()) win.close();
      } catch {
        /* ignore */
      }
      resolve(val);
    };
    const onResp = (_evt, payload) => {
      finish(payload === true);
    };
    ipcMain.on("portable-eula:respond", onResp);
    win = new BrowserWindow({
      ...(icon ? { icon } : {}),
      width: 560,
      height: 720,
      minWidth: 480,
      minHeight: 560,
      resizable: true,
      maximizable: true,
      fullscreenable: false,
      show: false,
      title: "Raw Investor — Portable license",
      backgroundColor: "#f8fafc",
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, "portable-eula-preload.cjs"),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        devTools: allowDevTools,
      },
    });
    win.once("ready-to-show", () => win.show());
    win.loadFile(path.join(__dirname, "portable-eula.html"));
    win.on("closed", () => finish(false));
  });
}

function stopBundledApiServer() {
  if (!apiProcess) return;
  apiProcess.kill();
  apiProcess = null;
}

/**
 * Removes local portfolio/capture data and optionally embedded-browser profile data for the in-app browser.
 * @param {{ preserveLoginSessions?: boolean; clearCacheAndBrowsingHistory?: boolean; clearPasswordAndUsernameHistory?: boolean }} opts
 */
/**
 * @param {{
 *   includeVault?: boolean;
 *   includeSecrets?: boolean;
 *   includeLogs?: boolean;
 *   includeStableExtension?: boolean;
 * }} [opts]
 */
function wipeRawInvestorUserData(opts = {}) {
  const ud = app.getPath("userData");
  const includeVault = opts.includeVault === true;
  const includeSecrets = opts.includeSecrets === true;
  const includeLogs = opts.includeLogs === true;
  const includeStableExtension = opts.includeStableExtension === true;

  const runtimeRoot = path.join(ud, "runtime-data");
  try {
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  } catch (err) {
    console.warn("[rawengine] wipe could not remove runtime-data:", err);
  }

  try {
    fs.unlinkSync(path.join(ud, "capture-diagnostics.json"));
  } catch {
    /* optional file */
  }

  if (includeVault) {
    const vault =
      String(process.env.PCGR_BACKUPS_DIR || "").trim() ||
      path.join(ud, "portfolio-backups-vault");
    try {
      fs.rmSync(vault, { recursive: true, force: true });
    } catch (err) {
      console.warn("[rawengine] wipe could not remove backup vault:", err);
    }
  }

  if (includeSecrets) {
    try {
      fs.unlinkSync(path.join(ud, "runtime-secrets.json"));
    } catch {
      /* optional */
    }
  }

  if (includeLogs) {
    try {
      fs.rmSync(path.join(ud, "logs"), { recursive: true, force: true });
    } catch {
      /* optional */
    }
  }

  if (includeStableExtension) {
    try {
      fs.rmSync(resolveStableExtensionDir(), { recursive: true, force: true });
    } catch (err) {
      console.warn("[rawengine] wipe could not remove stable extension copy:", err);
    }
  }
}

async function runFactoryReset(opts) {
  const preserveLoginSessions = opts?.preserveLoginSessions === true;
  const clearCacheAndBrowsingHistory = opts?.clearCacheAndBrowsingHistory !== false;
  const clearPasswordAndUsernameHistory = opts?.clearPasswordAndUsernameHistory === true;

  if (rawEngineTabbedBrowser && typeof rawEngineTabbedBrowser.closeAllWebTabs === "function") {
    rawEngineTabbedBrowser.closeAllWebTabs();
  }

  stopBundledApiServer();
  await new Promise((r) => setTimeout(r, 450));

  wipeRawInvestorUserData({
    includeVault: false,
    includeSecrets: false,
    includeLogs: false,
    includeStableExtension: false,
  });

  const ses = session.defaultSession;

  if (clearCacheAndBrowsingHistory) {
    await ses.clearCache().catch((e) => console.warn("[rawengine] clearCache", e));
    /** @type {Array<'backgroundFetch'|'cache'|'cookies'|'downloads'|'fileSystems'|'indexedDB'|'localStorage'|'serviceWorkers'|'webSQL'>} */
    const dataTypes = [
      "cache",
      "fileSystems",
      "indexedDB",
      "localStorage",
      "serviceWorkers",
      "webSQL",
      "downloads",
      "backgroundFetch",
    ];
    if (!preserveLoginSessions) dataTypes.push("cookies");
    await ses
      .clearData({ dataTypes })
      .catch((e) => console.warn("[rawengine] clearData", e));
    await ses.clearHostResolverCache().catch(() => {});
    await ses.clearAuthCache().catch(() => {});
    await ses.clearCodeCaches({ urls: [] }).catch(() => {});
    await ses.clearSharedDictionaryCache?.()?.catch?.(() => {});
  }

  if (clearPasswordAndUsernameHistory) {
    const names = [
      "Login Data",
      "Login Data-journal",
      "Web Data",
      "Web Data-journal",
      "Affiliation Database",
      "Affiliation Database-journal",
    ];
    for (const name of names) {
      try {
        fs.unlinkSync(path.join(ud, name));
      } catch {
        /* ignore missing */
      }
    }
  }

  try {
    if (captureExtension?.id) {
      ses.extensions.removeExtension(captureExtension.id);
      captureExtension = null;
    }
  } catch (e) {
    console.warn("[rawengine] factory reset removeExtension:", e);
  }
  await loadDomCaptureExtension();

  if (app.isPackaged) {
    const serverEntry = resolveBundledServerEntry();
    if (serverEntry) {
      startBundledApiServerProcess(serverEntry);
      await waitForBundledApiHealthy(60000);
    }
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.reloadIgnoringCache();
    } catch (e) {
      console.warn("[rawengine] reload after factory reset:", e);
    }
  }
}

/**
 * Installer may leave `resources/pcgr-pending-chromium-cookie-import.json`; first launch imports then removes it.
 * @param {import('electron').BrowserWindow | null} parentWindow
 */
async function maybeRunPendingChromiumCookieImport(parentWindow) {
  if (process.platform !== "win32") return;
  const rp = process.resourcesPath;
  const pending = chromiumCookieImport.readPendingMarker(rp);
  if (!pending) return;
  if (!pending.edge && !pending.chrome) {
    chromiumCookieImport.deletePendingMarker(rp);
    return;
  }
  const choice = await dialog.showMessageBox(parentWindow || undefined, {
    type: "question",
    buttons: ["Skip", "Import cookies"],
    defaultId: 1,
    cancelId: 0,
    noLink: true,
    title: "Marketplace sign-in",
    message:
      "Import Edge/Chrome cookies for eBay, TCGplayer, and PriceCharting into this app?",
    detail:
      "Close Edge and Chrome first if they are open (avoids file locks). Saved passwords are not imported. You can repeat this from Admin → Configuration.",
  });
  if (choice.response !== 1) {
    chromiumCookieImport.deletePendingMarker(rp);
    return;
  }
  try {
    const r = await chromiumCookieImport.importChromiumCookiesIntoSession(session.defaultSession, pending);
    appendCaptureLog({
      scope: "boot",
      level: r.errors > 0 && r.imported === 0 ? "warn" : "info",
      message: "pending chromium cookie import",
      detail: {
        imported: r.imported,
        skipped: r.skipped,
        errors: r.errors,
        ok: r.ok,
      },
    });
    if (r.imported === 0 && (r.errors > 0 || !r.ok)) {
      await dialog.showMessageBox(parentWindow || undefined, {
        type: "warning",
        title: "Cookie import",
        message: "No cookies were imported, or some sources failed.",
        detail: r.details.join("\n"),
      });
    }
  } catch (err) {
    await dialog.showMessageBox(parentWindow || undefined, {
      type: "error",
      title: "Cookie import",
      message: String(err?.message || err),
    });
  } finally {
    chromiumCookieImport.deletePendingMarker(rp);
  }
}

function parseCronField(raw, min, max) {
  const token = String(raw || "").trim();
  if (!token || token === "*") {
    const s = new Set();
    for (let i = min; i <= max; i += 1) s.add(i);
    return s;
  }
  const out = new Set();
  const parts = token.split(",");
  for (const partRaw of parts) {
    const part = partRaw.trim();
    if (!part) continue;
    if (part.includes("/")) {
      const [baseRaw, stepRaw] = part.split("/");
      const step = Number.parseInt(stepRaw || "", 10);
      if (!Number.isFinite(step) || step <= 0) continue;
      let start = min;
      let end = max;
      if (baseRaw && baseRaw !== "*") {
        if (baseRaw.includes("-")) {
          const [a, b] = baseRaw.split("-");
          const aa = Number.parseInt(a || "", 10);
          const bb = Number.parseInt(b || "", 10);
          if (Number.isFinite(aa) && Number.isFinite(bb)) {
            start = Math.max(min, aa);
            end = Math.min(max, bb);
          }
        } else {
          const n = Number.parseInt(baseRaw, 10);
          if (Number.isFinite(n)) {
            start = Math.max(min, n);
            end = max;
          }
        }
      }
      for (let i = start; i <= end; i += step) out.add(i);
      continue;
    }
    if (part.includes("-")) {
      const [a, b] = part.split("-");
      const aa = Number.parseInt(a || "", 10);
      const bb = Number.parseInt(b || "", 10);
      if (Number.isFinite(aa) && Number.isFinite(bb)) {
        for (let i = Math.max(min, aa); i <= Math.min(max, bb); i += 1) out.add(i);
      }
      continue;
    }
    const n = Number.parseInt(part, 10);
    if (Number.isFinite(n) && n >= min && n <= max) out.add(n);
  }
  return out;
}

function cronMatchesNow(cronExpr, now) {
  const parts = String(cronExpr || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length !== 5) return false;
  const [mi, hh, dd, mm, wd] = parts;
  const mins = parseCronField(mi, 0, 59);
  const hours = parseCronField(hh, 0, 23);
  const dom = parseCronField(dd, 1, 31);
  const mon = parseCronField(mm, 1, 12);
  const dow = parseCronField(wd, 0, 6);
  return (
    mins.has(now.getMinutes()) &&
    hours.has(now.getHours()) &&
    dom.has(now.getDate()) &&
    mon.has(now.getMonth() + 1) &&
    dow.has(now.getDay())
  );
}

async function fetchRawEngineStoreDoc() {
  const apiBase = String(process.env.RAWENGINE_API_URL || `http://localhost:${apiPort}`).replace(/\/$/, "");
  const r = await fetch(`${apiBase}/api/store`, {
    headers: {
      "x-pcgr-app-token": runtimeAppToken,
    },
  });
  if (!r.ok) throw new Error(`store-read-failed:${r.status}`);
  return r.json();
}

async function fetchRawEnginePortfolioMeta() {
  const apiBase = String(process.env.RAWENGINE_API_URL || `http://localhost:${apiPort}`).replace(/\/$/, "");
  const r = await fetch(`${apiBase}/api/portfolio/meta`, {
    headers: {
      "x-pcgr-app-token": runtimeAppToken,
      Accept: "application/json",
    },
  });
  if (!r.ok) throw new Error(`meta-read-failed:${r.status}`);
  return r.json();
}

function buildTargetUpdateFromProbe(t, probe) {
  if (!probe || probe.ok !== true) return null;
  const maxBid = Number(t.maxBidUsd || 0);
  const maxBin = Number(
    t.maxBinUsd != null && t.maxBinUsd !== "" ? Number(t.maxBinUsd) : maxBid
  );
  const cur = probe.currentBid != null ? Number(probe.currentBid) : null;
  const bin = probe.buyItNow != null ? Number(probe.buyItNow) : null;
  let highBidderAboveThreshold = false;
  if (cur != null && Number.isFinite(cur) && cur > maxBid) highBidderAboveThreshold = true;
  if (bin != null && Number.isFinite(bin) && bin > maxBin) highBidderAboveThreshold = true;
  const endsAtMs =
    probe.endsAtMs != null && Number.isFinite(Number(probe.endsAtMs)) ? Number(probe.endsAtMs) : null;
  const lastProbe = {
    atMs: Date.now(),
    currentBid: cur != null && cur > 0 ? cur : null,
    buyItNow: bin != null && bin > 0 ? bin : null,
    endsAtMs,
    parseOk: Boolean(probe.parseOk),
    highBidderAboveThreshold,
  };
  const out = {
    id: String(t.id || ""),
    lastProbe,
    updatedAt: Date.now(),
  };
  if (probe.title) out.listingTitle = String(probe.title).slice(0, 220);
  if (probe.imageUrl) out.listingImageUrl = String(probe.imageUrl).trim().slice(0, 2000);
  const lp = cur ?? bin;
  if (lp != null && Number.isFinite(lp)) out.listingPriceUsd = lp;
  out.listingCapturedAt = Date.now();
  return out;
}

async function patchPortfolioTargets(updates) {
  if (!Array.isArray(updates) || updates.length === 0) return;
  const apiBase = String(process.env.RAWENGINE_API_URL || `http://localhost:${apiPort}`).replace(/\/$/, "");
  const r = await fetch(`${apiBase}/api/portfolio/targets`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "x-pcgr-app-token": runtimeAppToken,
    },
    body: JSON.stringify({ updates }),
  });
  if (!r.ok) throw new Error(`targets-patch-failed:${r.status}`);
}

function clearSniperPreopenTimers() {
  for (const h of sniperPreopenTimers.values()) {
    clearTimeout(h);
  }
  sniperPreopenTimers.clear();
  sniperPreopenFireAtByTargetId.clear();
  sniperPreopenLastOpenMs.clear();
}

/**
 * Schedule a single openOrFocus near `endsAtMs - lead - buffer` per armed target.
 * Refreshes from latest meta/probe without relying on a coarse poll loop only.
 */
function syncSniperPreopenTimers(targets, openOrFocus) {
  const nowMs = Date.now();
  const want = new Set();
  if (!Array.isArray(targets) || typeof openOrFocus !== "function") return;
  for (const t of targets) {
    if (!t || typeof t !== "object") continue;
    if (t.armed !== true || t.sniperEnabled !== true) continue;
    if (t.lastProbe && t.lastProbe.highBidderAboveThreshold === true) continue;
    const listingUrl = String(t.listingUrl || "").trim();
    if (!listingUrl) continue;
    const leadMs = Number(t.sniperLeadMs || 0);
    const endsAtMs = Number(t?.lastProbe?.endsAtMs || 0);
    if (!Number.isFinite(endsAtMs) || endsAtMs <= 0) continue;
    const tid = String(t.id || "");
    if (!tid) continue;
    want.add(tid);

    if (nowMs > endsAtMs + 15_000) {
      if (sniperPreopenTimers.has(tid)) {
        clearTimeout(sniperPreopenTimers.get(tid));
        sniperPreopenTimers.delete(tid);
      }
      sniperPreopenFireAtByTargetId.delete(tid);
      continue;
    }

    const fireAtMs = endsAtMs - Math.max(1000, leadMs) - 4500;
    const delay = fireAtMs - nowMs;
    const prevFire = sniperPreopenFireAtByTargetId.get(tid);

    if (delay < 500) {
      if (sniperPreopenTimers.has(tid)) {
        clearTimeout(sniperPreopenTimers.get(tid));
        sniperPreopenTimers.delete(tid);
      }
      if (delay > -120_000) {
        const lastOpen = Number(sniperPreopenLastOpenMs.get(tid) || 0);
        if (nowMs - lastOpen > 20_000) {
          void openOrFocus(listingUrl);
          sniperPreopenLastOpenMs.set(tid, nowMs);
        }
      }
      sniperPreopenFireAtByTargetId.set(tid, fireAtMs);
      continue;
    }

    if (delay > 72 * 3600 * 1000) {
      if (sniperPreopenTimers.has(tid)) {
        clearTimeout(sniperPreopenTimers.get(tid));
        sniperPreopenTimers.delete(tid);
      }
      sniperPreopenFireAtByTargetId.delete(tid);
      continue;
    }

    if (
      sniperPreopenTimers.has(tid) &&
      prevFire != null &&
      Math.abs(prevFire - fireAtMs) < 2000
    ) {
      continue;
    }

    if (sniperPreopenTimers.has(tid)) {
      clearTimeout(sniperPreopenTimers.get(tid));
      sniperPreopenTimers.delete(tid);
    }
    const handle = setTimeout(() => {
      sniperPreopenTimers.delete(tid);
      sniperPreopenFireAtByTargetId.delete(tid);
      sniperPreopenLastOpenMs.delete(tid);
      void openOrFocus(listingUrl);
    }, delay);
    sniperPreopenTimers.set(tid, handle);
    sniperPreopenFireAtByTargetId.set(tid, fireAtMs);
  }

  for (const tid of sniperPreopenTimers.keys()) {
    if (!want.has(tid)) {
      clearTimeout(sniperPreopenTimers.get(tid));
      sniperPreopenTimers.delete(tid);
      sniperPreopenFireAtByTargetId.delete(tid);
      sniperPreopenLastOpenMs.delete(tid);
    }
  }
}

async function runTargetListingWatchPass() {
  const browser = rawEngineTabbedBrowser;
  if (!browser || typeof browser.runEbayListingProbe !== "function") return;
  let meta;
  try {
    meta = await fetchRawEnginePortfolioMeta();
  } catch {
    return;
  }
  const targets = Array.isArray(meta?.targets) ? meta.targets : [];
  const openOrFocusPre =
    typeof browser.openOrFocusUrl === "function"
      ? (url) => browser.openOrFocusUrl(url)
      : (url) => ({ id: browser.addTab(url), reused: false });
  syncSniperPreopenTimers(targets, openOrFocusPre);

  const now = Date.now();
  const updates = [];
  for (const t of targets) {
    if (!t || typeof t !== "object") continue;
    const armed = t.armed === true && t.sniperEnabled === true;
    const liveWatch = t.liveWatch === true;
    if (!armed && !liveWatch) continue;
    const listingUrl = String(t.listingUrl || "").trim();
    const itemId = String(t.itemId || "").trim();
    let itemUrl = "";
    if (listingUrl && /ebay\.com\/itm\//i.test(listingUrl)) {
      itemUrl = listingUrl.split("#")[0].split("?")[0];
    } else if (/^\d{6,}$/.test(itemId)) {
      itemUrl = `https://www.ebay.com/itm/${itemId}`;
    }
    if (!itemUrl) continue;

    const ends = Number(t?.lastProbe?.endsAtMs || 0);
    const fastWindowMs = 10 * 60 * 1000;
    const ultraMs = 60 * 1000;
    let interval = 52000;
    if (armed && Number.isFinite(ends) && ends > now) {
      const left = ends - now;
      if (left <= ultraMs) interval = 1100;
      else if (left <= fastWindowMs) interval = 4500;
      else interval = 18000;
    } else if (liveWatch) {
      interval = 56000;
    }

    const tid = String(t.id || "");
    if (!tid) continue;
    const last = Number(targetWatchLastPoll.get(tid) || 0);
    if (now - last < interval) continue;

    let tabRec =
      typeof browser.findWebTabByUrl === "function" ? browser.findWebTabByUrl(itemUrl) : null;
    let tabId = tabRec?.id ?? null;
    if (tabId == null && typeof browser.addTabQuiet === "function") {
      tabId = browser.addTabQuiet(itemUrl);
    }
    if (tabId == null) continue;
    if (typeof browser.isTabLoading === "function" && browser.isTabLoading(tabId)) continue;

    const probe = await browser.runEbayListingProbe(tabId);
    targetWatchLastPoll.set(tid, Date.now());
    const patch = buildTargetUpdateFromProbe(t, probe);
    if (patch) updates.push(patch);
  }
  if (updates.length === 0) return;
  try {
    await patchPortfolioTargets(updates);
  } catch (e) {
    console.warn("[rawengine] target watch patch failed:", e?.message || e);
  }
}

async function runRawEngineSchedulerTick() {
  if (!rawEngineTabbedBrowser) return;
  const openOrFocus =
    typeof rawEngineTabbedBrowser.openOrFocusUrl === "function"
      ? (url) => rawEngineTabbedBrowser.openOrFocusUrl(url)
      : (url) => ({ id: rawEngineTabbedBrowser.addTab(url), reused: false });
  const now = new Date();
  const nowMs = now.getTime();
  const currentMinuteKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;

  let doc = null;
  try {
    doc = await fetchRawEngineStoreDoc();
  } catch {
    return;
  }

  const hunts = Array.isArray(doc?.hunts) ? doc.hunts : [];
  for (const h of hunts) {
    if (!h || typeof h !== "object") continue;
    const id = String(h.id || "");
    const searchUrl = String(h.searchUrl || "").trim();
    if (!id || !searchUrl) continue;
    const schedule = h.schedule && typeof h.schedule === "object" ? h.schedule : null;
    if (!schedule) continue;

    if (schedule.kind === "once") {
      const atMs = Number(schedule.atMs || 0);
      if (!Number.isFinite(atMs) || atMs <= 0) continue;
      if (atMs > nowMs) continue;
      const fireKey = `${id}:${atMs}`;
      if (firedOnceHuntKeys.has(fireKey)) continue;
      firedOnceHuntKeys.add(fireKey);
      openOrFocus(searchUrl);
      continue;
    }

    if (schedule.kind === "recurring") {
      const cronLocal = String(schedule.cronLocal || "").trim();
      if (!cronLocal) continue;
      if (!cronMatchesNow(cronLocal, now)) continue;
      if (firedRecurringMinuteKeyByHuntId.get(id) === currentMinuteKey) continue;
      firedRecurringMinuteKeyByHuntId.set(id, currentMinuteKey);
      openOrFocus(searchUrl);
    }
  }

  // Sniper tab pre-open is driven by syncSniperPreopenTimers (listing watch pass + one-shot timers).
}

function startRawEngineScheduler() {
  if (rawEngineSchedulerTimer) return;
  const tick = () => {
    void runRawEngineSchedulerTick();
  };
  tick();
  rawEngineSchedulerTimer = setInterval(tick, 6000);
  if (!rawEngineTargetWatchTimer) {
    rawEngineTargetWatchTimer = setInterval(() => {
      void runTargetListingWatchPass();
    }, 2800);
  }
}

function stopRawEngineScheduler() {
  if (rawEngineSchedulerTimer) {
    clearInterval(rawEngineSchedulerTimer);
    rawEngineSchedulerTimer = null;
  }
  if (rawEngineTargetWatchTimer) {
    clearInterval(rawEngineTargetWatchTimer);
    rawEngineTargetWatchTimer = null;
  }
  clearSniperPreopenTimers();
}

function configureAutoUpdater() {
  if (isDev) return;

  const updateUrl = process.env.RAWENGINE_UPDATE_URL;
  if (!updateUrl) {
    console.warn("[rawengine] RAWENGINE_UPDATE_URL not set; updater disabled.");
    return;
  }

  autoUpdater.channel = "beta";
  autoUpdater.allowPrerelease = true;
  autoUpdater.autoDownload = false;
  autoUpdater.setFeedURL({ provider: "generic", url: updateUrl });

  autoUpdater.on("update-available", async () => {
    const result = await dialog.showMessageBox(mainWindow, {
      type: "info",
      buttons: ["Download", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: "Beta Update Available",
      message: "A new beta build is available.",
      detail: "Download now and install after restart?",
    });

    if (result.response === 0) {
      autoUpdater.downloadUpdate();
    }
  });

  autoUpdater.on("update-downloaded", async () => {
    const result = await dialog.showMessageBox(mainWindow, {
      type: "info",
      buttons: ["Restart and Install", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: "Update Ready",
      message: "The beta update was downloaded successfully.",
      detail: "Restart now to install the update.",
    });

    if (result.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });

  autoUpdater.checkForUpdates().catch((err) => {
    console.error("[rawengine] update check failed:", err);
  });
}

function checkForUpdatesInteractive() {
  if (isDev) {
    dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "Updater Disabled in Dev",
      message: "Updates are only available in packaged builds.",
    });
    return;
  }
  autoUpdater.checkForUpdates().catch((err) => {
    dialog.showMessageBox(mainWindow, {
      type: "error",
      title: "Update Check Failed",
      message: "Could not check for updates.",
      detail: String(err?.message || err),
    });
  });
}

function resolveExtensionPath() {
  if (process.env.RAWENGINE_EXTENSION_PATH) {
    return process.env.RAWENGINE_EXTENSION_PATH;
  }
  if (isDev) {
    return path.join(__dirname, "..", "extension");
  }
  if (packagedDecryptedRoot) {
    const p = path.join(packagedDecryptedRoot, "extension");
    if (fs.existsSync(p)) return p;
  }
  return path.join(process.resourcesPath, "app.asar.unpacked", "extension");
}

async function loadDomCaptureExtension() {
  const extensionPath = resolveExtensionPath();
  try {
    captureExtension = await session.defaultSession.extensions.loadExtension(
      extensionPath,
      {
        allowFileAccess: true,
      }
    );
    console.log(
      `[rawengine] extension loaded: ${captureExtension.name} (${captureExtension.id})`
    );
  } catch (err) {
    console.warn("[rawengine] failed to load capture extension:", err);
  }
}

const EXTENSION_LOAD_TIMEOUT_MS = 45000;

async function loadDomCaptureExtensionWithTimeout() {
  const extensionPath = resolveExtensionPath();
  try {
    await Promise.race([
      loadDomCaptureExtension(),
      new Promise((_, rej) =>
        setTimeout(
          () => rej(new Error(`extension load exceeded ${EXTENSION_LOAD_TIMEOUT_MS}ms`)),
          EXTENSION_LOAD_TIMEOUT_MS
        )
      ),
    ]);
    return true;
  } catch (err) {
    console.warn("[rawengine] capture extension load failed or timed out:", err);
    appendCaptureLog({
      scope: "boot",
      level: "error",
      message: "capture extension load failed or timed out",
      detail: { path: extensionPath, err: String(err?.message || err) },
    });
    return false;
  }
}

function openRawEngineCaptureLogWindow() {
  const parent = BrowserWindow.getFocusedWindow() || mainWindow;
  if (captureLogWindow && !captureLogWindow.isDestroyed()) {
    try {
      captureLogWindow.focus();
    } catch {
      /* ignore */
    }
    return;
  }
  const preloadPath = resolveRawEngineAsset("capture-log-preload.cjs");
  const htmlPath = resolveRawEngineAsset("capture-log.html");
  try {
    if (!fs.existsSync(htmlPath)) {
      dialog.showErrorBox(
        "Capture log UI missing",
        `Expected:\n${htmlPath}\n\nRebuild the app or check rawengine/ is unpacked (asarUnpack rawengine/**).`
      );
      return;
    }
  } catch {
    /* ignore */
  }

  captureLogWindow = new BrowserWindow({
    parent: parent && !parent.isDestroyed() ? parent : undefined,
    width: 960,
    height: 680,
    minWidth: 520,
    minHeight: 360,
    title: "RawEngine capture control deck",
    backgroundColor: "#0f172a",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      devTools: allowDevTools,
    },
  });
  const onLine = (payload) => {
    if (captureLogWindow && !captureLogWindow.isDestroyed()) {
      try {
        captureLogWindow.webContents.send("rawengine-capture-log:push", payload);
      } catch {
        /* ignore */
      }
    }
  };
  captureLogBus.on("line", onLine);
  captureLogWindow.once("closed", () => {
    captureLogBus.off("line", onLine);
    captureLogWindow = null;
  });
  captureLogWindow.loadFile(htmlPath).catch((err) => {
    console.error("[rawengine] capture-log window load failed:", err);
    try {
      dialog.showErrorBox("Capture log failed to load", String(err?.message || err));
    } catch {
      /* ignore */
    }
  });
  try {
    captureLogWindow.show();
  } catch {
    /* ignore */
  }
}

function createAppMenu(tabbed) {
  const captureParent = () => BrowserWindow.getFocusedWindow() || mainWindow;

  const template = [
    {
      label: "File",
      submenu: [
        {
          label: "New browser tab",
          accelerator: "Ctrl+T",
          click: () => tabbed.addTab("https://www.pricecharting.com/"),
        },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "View",
      submenu: [
        {
          label: "Capture diagnostics (skipped/passed/failed)",
          type: "checkbox",
          checked: captureDiagnosticsEnabled,
          click: (menuItem) => {
            captureDiagnosticsEnabled = Boolean(menuItem.checked);
            if (tabbed && typeof tabbed.setCaptureDiagnosticsEnabled === "function") {
              tabbed.setCaptureDiagnosticsEnabled(captureDiagnosticsEnabled);
            }
            try {
              fs.writeFileSync(
                captureDiagnosticsSettingsPath,
                JSON.stringify({ captureDiagnosticsEnabled }, null, 2),
                "utf8"
              );
            } catch {
              // ignore - setting will not persist
            }
          },
        },
        {
          label: "Capture control deck (log + heartbeat)",
          click: () => openRawEngineCaptureLogWindow(),
        },
        {
          label: "Reveal capture log file",
          click: () => {
            try {
              shell.showItemInFolder(getCaptureLogPath());
            } catch {
              /* ignore */
            }
          },
        },
        {
          label: "Back",
          accelerator: "Alt+Left",
          click: () => tabbed.backActive(),
        },
        {
          label: "Forward",
          accelerator: "Alt+Right",
          click: () => tabbed.forwardActive(),
        },
        {
          label: "Reload",
          accelerator: "CmdOrCtrl+R",
          click: () => tabbed.reloadActive(),
        },
        {
          label: "Force reload",
          accelerator: "CmdOrCtrl+Shift+R",
          click: () => tabbed.forceReloadActive(),
        },
        ...(allowDevTools
          ? [
              {
                label: "Toggle developer tools",
                accelerator:
                  process.platform === "darwin" ? "Alt+Command+I" : "Ctrl+Shift+I",
                click: () => tabbed.toggleDevToolsActive(),
              },
            ]
          : []),
        { type: "separator" },
        {
          label: "Actual size",
          accelerator: "CmdOrCtrl+0",
          click: () => tabbed.zoomResetActive(),
        },
        {
          label: "Zoom in",
          accelerator: "CmdOrCtrl+=",
          click: () => tabbed.zoomInActive(),
        },
        {
          label: "Zoom out",
          accelerator: "CmdOrCtrl+-",
          click: () => tabbed.zoomOutActive(),
        },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Capture",
      submenu: [
        {
          label: "Capture active browser tab",
          accelerator: "Ctrl+Shift+Y",
          click: async () => {
            const win = captureParent();
            try {
              await tabbed.captureActiveTab(win, {});
            } catch (err) {
              await dialog.showMessageBox(win || undefined, {
                type: "error",
                title: "Capture failed",
                message: String(err?.message || err),
              });
            }
          },
        },
        {
          label: "Capture active browser tab (deep)",
          click: async () => {
            const win = captureParent();
            try {
              await tabbed.captureActiveTab(win, { mode: "deep" });
            } catch (err) {
              await dialog.showMessageBox(win || undefined, {
                type: "error",
                title: "Capture failed",
                message: String(err?.message || err),
              });
            }
          },
        },
        { type: "separator" },
        {
          label: "Screenshot — visible area",
          accelerator: "Ctrl+Shift+S",
          click: async () => {
            const win = captureParent();
            const r = await tabbed.startScreenshot("viewport");
            if (r && !r.ok && !r.cancelled && r.error) {
              await dialog.showMessageBox(win || undefined, {
                type: "error",
                title: "Screenshot",
                message: r.error,
              });
            }
          },
        },
        {
          label: "Screenshot — full page (scroll stitch)",
          click: async () => {
            const win = captureParent();
            const r = await tabbed.startScreenshot("fullpage");
            if (r && !r.ok && !r.cancelled && r.error) {
              await dialog.showMessageBox(win || undefined, {
                type: "error",
                title: "Screenshot",
                message: r.error,
              });
            }
          },
        },
        {
          label: "Screenshot — drag region",
          click: async () => {
            const win = captureParent();
            const r = await tabbed.startScreenshot("region");
            if (r && !r.ok && !r.cancelled && r.error) {
              await dialog.showMessageBox(win || undefined, {
                type: "error",
                title: "Screenshot",
                message: r.error,
              });
            }
          },
        },
        { type: "separator" },
        {
          label: "Open TCGPlayer (new tab)",
          click: () => tabbed.openUrl("https://www.tcgplayer.com/"),
        },
        {
          label: "Open eBay Sold Search (new tab)",
          click: () =>
            tabbed.openUrl(
              "https://www.ebay.com/sch/i.html?_nkw=pokemon&LH_Sold=1&LH_Complete=1"
            ),
        },
        {
          label: "Open PriceCharting (new tab)",
          click: () => tabbed.openUrl("https://www.pricecharting.com/"),
        },
        { type: "separator" },
        {
          label: "Extension popup (toolbar)…",
          click: async () => {
            const win = captureParent();
            await dialog.showMessageBox(win || undefined, {
              type: "info",
              title: "Capture in Raw Investor",
              message:
                "Use Capture → Capture active browser tab after loading a supported page, or open the extension from the Raw Investor toolbar (puzzle icon) and pin “Raw Investor Tab Capture.”",
            });
          },
        },
      ],
    },
    {
      label: "Updates",
      submenu: [
        {
          label: "Check for Beta Updates",
          click: () => checkForUpdatesInteractive(),
        },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "User Guide",
          click: () => {
            try {
              if (tabbed && typeof tabbed.notifyOpenUserGuide === "function") {
                tabbed.notifyOpenUserGuide();
              }
            } catch (err) {
              console.error("[rawengine] User Guide menu:", err);
            }
          },
        },
        {
          label: "Raw Investor API health (browser)",
          click: () =>
            shell.openExternal(
              process.env.RAWENGINE_API_URL || `http://localhost:${apiPort}/api/health`
            ),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createMainWindow() {
  const icon = getAppIconPath();
  mainWindow = new BrowserWindow({
    ...(icon ? { icon } : {}),
    width: 1500,
    height: 980,
    minWidth: 1100,
    minHeight: 740,
    show: false,
    autoHideMenuBar: false,
    title: "Raw Investor",
    backgroundColor: "#0f172a",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      devTools: allowDevTools,
    },
  });

  mainWindow.setMaxListeners(32);

  mainWindow.loadURL("about:blank");

  await rawEngineTabbedBrowser.mountMainWindow(mainWindow, {
    isDev,
    allowDevTools,
    rendererUrl,
    prodIndexPath: resolveProdHtml(),
    preloadPath: path.join(__dirname, "preload.cjs"),
  });
}

app.whenReady().then(async () => {
  applyPackagedEmbeddedBrowserUserAgent();

  const extSync = ensureStableExtensionInstall();
  if (!extSync.ok) {
    console.warn("[rawengine] stable extension install:", extSync.error || "unknown");
  }

  ipcMain.handle("launcher:get-meta", () => ({
    version: app.getVersion(),
    isPackaged: app.isPackaged,
  }));

  ipcMain.handle("launcher:open-external", async (_evt, rawUrl) => {
    const urlStr = typeof rawUrl === "string" ? rawUrl.trim() : "";
    if (!urlStr) return { ok: false, error: "empty-url" };
    let parsed;
    try {
      parsed = new URL(urlStr);
    } catch {
      return { ok: false, error: "invalid-url" };
    }
    if (parsed.protocol !== "https:") return { ok: false, error: "https-only" };
    const h = parsed.hostname.toLowerCase();
    const allowed =
      h === "rawgraded.com" ||
      h.endsWith(".rawgraded.com") ||
      h === "instagram.com" ||
      h === "www.instagram.com" ||
      h === "x.com" ||
      h === "www.x.com" ||
      h === "twitter.com" ||
      h === "www.twitter.com";
    if (!allowed) return { ok: false, error: "host-not-allowed" };
    try {
      await shell.openExternal(urlStr);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  if (isPortablePackagedBuild) {
    const accepted = await waitPortableEulaAcceptance();
    if (!accepted) {
      app.quit();
      return;
    }
  }

  ipcMain.handle("rawengine-capture-log:append", (_evt, entry) => {
    try {
      appendCaptureLog(
        entry && typeof entry === "object"
          ? entry
          : { message: String(entry || "") }
      );
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });
  ipcMain.handle("rawengine-capture-log:open", () => {
    openRawEngineCaptureLogWindow();
    return { ok: true };
  });
  ipcMain.handle("rawengine-capture-log:get-info", () => ({
    path: getCaptureLogPath(),
  }));
  ipcMain.handle("rawengine-capture-log:read-tail", (_evt, n) =>
    readTailLines(Number(n) || 200)
  );
  ipcMain.handle("rawengine-capture-log:reveal", () => {
    try {
      shell.showItemInFolder(getCaptureLogPath());
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  /** Quick Fetch optional "Ready" ack from capture control deck (single waiter). */
  let scrapeGateWaiter = null;
  ipcMain.handle("rawengine-scrape-gate:wait-for-ack", async (_evt, meta) => {
    if (scrapeGateWaiter) {
      clearTimeout(scrapeGateWaiter.timeout);
      try {
        scrapeGateWaiter.reject(new Error("scrape-gate superseded"));
      } catch {
        /* ignore */
      }
      scrapeGateWaiter = null;
    }
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (scrapeGateWaiter && scrapeGateWaiter.reject === reject) {
          scrapeGateWaiter = null;
          reject(new Error("Ready gate timeout (10 min)"));
        }
      }, 600000);
      scrapeGateWaiter = { resolve, reject, meta: meta && typeof meta === "object" ? meta : {}, timeout };
    });
  });
  ipcMain.handle("rawengine-scrape-gate:signal", () => {
    if (!scrapeGateWaiter) return { ok: false, reason: "no-waiter" };
    const w = scrapeGateWaiter;
    scrapeGateWaiter = null;
    clearTimeout(w.timeout);
    w.resolve({ ok: true });
    appendCaptureLog({
      scope: "capture-deck",
      level: "info",
      message: "scrape Ready gate released",
      detail: {},
    });
    return { ok: true };
  });

  ipcMain.handle("launcher:cancel-boot", async () => {
    console.warn("[rawengine] boot cancelled from launcher UI");
    bootCancelled = true;
    sendLauncherStatus(launcherWindowRef, {
      label: "Cancelling boot…",
      detail: "Stopping startup process.",
      steps: { check: "err", api: "err", connect: "err", extension: "err", ui: "err" },
      bar: "error",
    });
    stopBundledApiServer();
    closeLauncherWindow(launcherWindowRef);
    launcherWindowRef = null;
    app.exit(0);
    return true;
  });

  const skipLauncher =
    process.env.RAWENGINE_SKIP_LAUNCHER === "1" ||
    process.env.RAWENGINE_SKIP_LAUNCHER === "true";

  let launcherWindow = null;
  if (!skipLauncher) {
    launcherWindow = createLauncherWindow();
    await new Promise((resolve) => {
      launcherWindow.webContents.once("did-finish-load", resolve);
    });
  }

  const apiOk = await prepareRuntimeEnvironment((payload) => {
    sendLauncherStatus(launcherWindow, payload);
  });

  if (bootCancelled) {
    stopBundledApiServer();
    app.exit(0);
    return;
  }

  if (!apiOk) {
    app.quit();
    return;
  }

  const prodHtmlPath = resolveProdHtml();
  if (!fs.existsSync(prodHtmlPath)) {
    console.error("[rawengine] dashboard HTML missing:", prodHtmlPath);
    await dialog.showMessageBox({
      type: "error",
      title: "Raw Investor",
      message: "The dashboard files are missing from this installation.",
      detail: `Expected:\n${prodHtmlPath}\n\nReinstall Raw Investor from the latest installer.`,
    });
    stopBundledApiServer();
    app.quit();
    return;
  }

  /** Register before any renderer loads so preload `invoke("rawengine:runtime")` never races. */
  ipcMain.handle("rawengine:runtime", () => ({
    mode: isDev ? "dev" : "production",
    apiBaseUrl: process.env.RAWENGINE_API_URL || `http://localhost:${apiPort}`,
    osPlatform: process.platform,
    extension: captureExtension
      ? {
          id: captureExtension.id,
          name: captureExtension.name,
        }
      : null,
  }));

  ipcMain.handle("rawengine:factory-reset", async (_evt, rawOpts) => {
    const preserveLoginSessions = rawOpts?.preserveLoginSessions === true;
    const clearCacheAndBrowsingHistory = rawOpts?.clearCacheAndBrowsingHistory !== false;
    const clearPasswordAndUsernameHistory = rawOpts?.clearPasswordAndUsernameHistory === true;

    const parent =
      mainWindow && !mainWindow.isDestroyed()
        ? mainWindow
        : BrowserWindow.getFocusedWindow();

    const backupVaultHint =
      String(process.env.PCGR_BACKUPS_DIR || "").trim() ||
      path.join(app.getPath("userData"), "portfolio-backups-vault");
    const detailLines = [
      "This removes the runtime-data folder (SQLite portfolio DB, images, extension captures, portfolio.json mirror, etc.).",
      `Dated JSON backups in the separate vault are kept by default: ${backupVaultHint}`,
      preserveLoginSessions
        ? "Embedded browser: cookies/sessions will be kept (saved passwords still follow the option below)."
        : "Embedded browser: cookies and site sessions will be cleared.",
      clearCacheAndBrowsingHistory
        ? "Cache, storage, and browsing-related data will be cleared per your selections."
        : "Skipping cache/history wipe (disk/portfolio data still removed).",
      clearPasswordAndUsernameHistory
        ? "Saved passwords and autofill data for the embedded browser will be removed."
        : "Saved passwords and autofill will not be deleted.",
      "The app will reload after reset.",
    ];

    const confirm = await dialog.showMessageBox(parent || undefined, {
      type: "warning",
      buttons: ["Cancel", "Erase all local data"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title: "Factory reset",
      message:
        "Erase all local portfolio data, runtime files, and optional browser data for this installation?",
      detail: detailLines.join("\n"),
    });

    if (confirm.response !== 1) {
      return { ok: false, cancelled: true };
    }

    try {
      await runFactoryReset({
        preserveLoginSessions,
        clearCacheAndBrowsingHistory,
        clearPasswordAndUsernameHistory,
      });
      return { ok: true };
    } catch (err) {
      console.error("[rawengine] factory-reset failed:", err);
      return { ok: false, error: String(err?.message || err) };
    }
  });

  // Create the main window before closing the launcher. If the launcher is the
  // only window, closing it triggers window-all-closed → app.quit() on Windows.
  let fullLauncherBootOk = false;
  let extensionLoadOkForUi = false;
  try {
    rawEngineTabbedBrowser = getRawEngineTabbedBrowser({
      session: session.defaultSession,
      getApiBaseUrl: () =>
        process.env.RAWENGINE_API_URL || `http://localhost:${apiPort}`,
      getExtToken: () => runtimeExtToken,
      getAppToken: () => runtimeAppToken,
    });
    if (typeof rawEngineTabbedBrowser.setCaptureDiagnosticsEnabled === "function") {
      rawEngineTabbedBrowser.setCaptureDiagnosticsEnabled(captureDiagnosticsEnabled);
    }
    rawEngineTabbedBrowser.registerIpc();
    createAppMenu(rawEngineTabbedBrowser);
    if (launcherWindow && !launcherWindow.isDestroyed()) {
      sendLauncherStatus(launcherWindow, {
        label: "Loading capture tools",
        detail: "Installing the in-app capture extension (first run can take up to a minute).",
        steps: { check: "done", api: "done", connect: "done", extension: "active", ui: "" },
      });
    }
    extensionLoadOkForUi = await loadDomCaptureExtensionWithTimeout();
    if (launcherWindow && !launcherWindow.isDestroyed()) {
      sendLauncherStatus(launcherWindow, {
        label: extensionLoadOkForUi
          ? "Loading dashboard"
          : "Loading dashboard (capture tools unavailable)",
        detail: extensionLoadOkForUi
          ? "Starting the tab strip and main window."
          : "The app will open; capture features may be limited until the extension loads.",
        steps: {
          check: "done",
          api: "done",
          connect: "done",
          extension: extensionLoadOkForUi ? "done" : "err",
          ui: "active",
        },
      });
    }
    await maybeRunPendingChromiumCookieImport(
      launcherWindow && !launcherWindow.isDestroyed() ? launcherWindow : null
    );
    await createMainWindow();
    fullLauncherBootOk = true;
    startRawEngineScheduler();
    configureAutoUpdater();
  } catch (err) {
    console.error("[rawengine] post-boot startup failed:", err);
    appendCaptureLog({
      scope: "boot",
      level: "error",
      message: "post-boot startup failed",
      detail: String(err?.message || err),
    });
    if (launcherWindow && !launcherWindow.isDestroyed()) {
      sendLauncherStatus(launcherWindow, {
        label: "Startup did not finish",
        detail: String(err?.message || err),
        steps: {
          check: "done",
          api: "done",
          connect: "done",
          extension: extensionLoadOkForUi ? "done" : "err",
          ui: "err",
        },
        bar: "error",
      });
    }
    try {
      await dialog.showMessageBox({
        type: "error",
        title: "Raw Investor",
        message: "Startup did not finish.",
        detail: `${String(err?.message || err)}\n\nIf this keeps happening, check the capture log (Help) or reinstall from the latest installer.`,
      });
    } catch {
      /* ignore */
    }
  } finally {
    if (launcherWindow && !launcherWindow.isDestroyed()) {
      if (fullLauncherBootOk) {
        sendLauncherStatus(launcherWindow, {
          label: "Opening Raw Investor…",
          detail: "",
          steps: {
            check: "done",
            api: "done",
            connect: "done",
            extension: extensionLoadOkForUi ? "done" : "err",
            ui: "done",
          },
          bar: "done",
        });
        await new Promise((r) => setTimeout(r, 400));
      } else if (!bootCancelled) {
        await new Promise((r) => setTimeout(r, 600));
      }
      closeLauncherWindow(launcherWindow);
      launcherWindowRef = null;
      launcherWindow = null;
    }

    if (fullLauncherBootOk && mainWindow && !mainWindow.isDestroyed()) {
      try {
        mainWindow.show();
        mainWindow.focus();
        if (process.platform === "win32") {
          mainWindow.setAlwaysOnTop(true);
          mainWindow.setAlwaysOnTop(false);
        }
      } catch (e2) {
        console.warn("[rawengine] main window show/focus after launcher:", e2);
      }
    }
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow().catch((e) => {
        console.error("[rawengine] createMainWindow (activate) failed:", e);
      });
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  stopRawEngineScheduler();
  stopBundledApiServer();
});
