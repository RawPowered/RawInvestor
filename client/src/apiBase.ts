/**
 * When the UI is loaded from file:// (Electron production), relative `/api` and
 * `/images` URLs must be rewritten to the local pcgr-server base. In dev, Vite
 * proxies `/api` so the base stays empty.
 */
export function getApiBase(): string {
  if (typeof window === 'undefined') return '';
  try {
    const url = getRuntimeSync().apiBaseUrl;
    if (typeof url === 'string' && url.trim()) return url.replace(/\/$/, '');
  } catch {
    /* ignore */
  }
  return '';
}

export type RawEngineRuntimeInfo = {
  apiBaseUrl?: string;
  appToken?: string;
  /** Same value as server `PCGR_EXT_TOKEN` — paste into the MV3 extension popup. */
  extToken?: string;
  psaTokenPersistent?: boolean;
  userDataDir?: string;
  backupVaultDir?: string;
  runtimeDataDir?: string;
  isPackaged?: boolean;
  /** Node/Electron `process.platform` from the shell (e.g. `win32`). */
  osPlatform?: string;
  /** Win/Mac: `userData/logs/rawengine-capture.log` — share this file when debugging capture. */
  captureLogPath?: string;
};

export type RawEngineChromiumCookieImportResult = {
  ok: boolean;
  imported: number;
  skipped: number;
  errors: number;
  details: string[];
};

/** Electron preload bridge (subset used by the React client). */
export type RawEngineBridge = {
  runtimeSync?: () => RawEngineRuntimeInfo;
  openPath?: (p: string) => Promise<{ ok?: boolean; error?: string }>;
  /** Opens Explorer to shipped MV3 extension (Chrome/Edge load unpacked). */
  openBundledExtensionFolder?: () => Promise<{ ok?: boolean; error?: string; path?: string }>;
  /** Windows: open http(s) URLs in Microsoft Edge (microsoft-edge: scheme). */
  openMicrosoftEdgeUrls?: (urls: string[]) => Promise<{ ok?: boolean; error?: string; opened?: number }>;
  getBundledExtensionPath?: () => Promise<{ ok?: boolean; path?: string; error?: string }>;
  clipboardWriteText?: (text: string) => Promise<{ ok?: boolean; error?: string }>;
  openEdgeExtensionsSettings?: () => Promise<{ ok?: boolean; error?: string; browser?: string }>;
  openCaptureBrowserExtensions?: (
    kind?: 'edge' | 'chrome'
  ) => Promise<{ ok?: boolean; error?: string; browser?: string; url?: string }>;
  getDefaultCaptureBrowser?: () => Promise<{ browser?: 'edge' | 'chrome'; progId?: string }>;
  prepareExtensionInstall?: () => Promise<{
    ok?: boolean;
    error?: string;
    browser?: 'edge' | 'chrome';
    extensionPath?: string;
  }>;
  copyExtensionFolderPath?: () => Promise<{
    ok?: boolean;
    error?: string;
    path?: string;
    browser?: 'edge' | 'chrome';
  }>;
  resyncBrowserExtension?: (opts?: {
    openFolder?: boolean;
    copyClipboard?: boolean;
    openBrowser?: boolean;
  }) => Promise<{
    ok?: boolean;
    error?: string;
    browser?: 'edge' | 'chrome';
    extensionPath?: string;
    hint?: string;
    folderOpened?: boolean;
    pathCopied?: boolean;
  }>;
  shouldShowExtensionGuide?: () => Promise<{ show?: boolean }>;
  clearExtensionGuideMarker?: () => Promise<{ ok?: boolean }>;
  /** Subscribe to Help → User Guide; returns unsubscribe. */
  onOpenUserGuide?: (cb: () => void) => () => void;
  importChromiumCookies?: (opts?: { edge?: boolean; chrome?: boolean }) => Promise<RawEngineChromiumCookieImportResult>;
  /** Focus Raw Investor app tab and bring host window forward (after Quick Fetch). */
  focusPortfolioWindow?: () => Promise<{ ok?: boolean }>;
};

function getRuntimeSync(): RawEngineRuntimeInfo {
  const el = window as Window & { rawEngine?: RawEngineBridge };
  return el.rawEngine?.runtimeSync?.() ?? {};
}

/** Electron preload bridge (empty object in plain browser). */
export function getRawEngineRuntime(): RawEngineRuntimeInfo {
  return typeof window !== 'undefined' ? getRuntimeSync() : {};
}

/** True when the app runs inside Raw Engine (preload exposes `window.rawEngine`). */
export function isRawEngineShell(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean((window as Window & { rawEngine?: unknown }).rawEngine);
}

/** Open a folder in Explorer / Finder (Electron only). */
export async function openLocalPath(p: string): Promise<void> {
  const el = window as Window & { rawEngine?: RawEngineBridge };
  const fn = el.rawEngine?.openPath;
  if (fn) await fn(p);
}

/** Opens stable `userData/browser-extension-edge` (synced from bundled extension on launch). */
export async function openBundledExtensionFolder(): Promise<{ ok: boolean; error?: string }> {
  const fn = (window as Window & { rawEngine?: RawEngineBridge }).rawEngine?.openBundledExtensionFolder;
  if (!fn) return { ok: false, error: 'Not running in Raw Investor desktop shell.' };
  const r = await fn();
  return { ok: r?.ok === true, error: typeof r?.error === 'string' ? r.error : undefined };
}

/** Windows desktop: launch each URL in Microsoft Edge (user runs Tab Capture extension). */
export async function openMicrosoftEdgeUrls(urls: string[]): Promise<{ ok: boolean; error?: string; opened?: number }> {
  const fn = (window as Window & { rawEngine?: RawEngineBridge }).rawEngine?.openMicrosoftEdgeUrls;
  if (!fn) return { ok: false, error: 'Not available (use Raw Investor on Windows desktop).' };
  const r = await fn(urls);
  return {
    ok: r?.ok === true,
    error: typeof r?.error === 'string' ? r.error : undefined,
    opened: typeof r?.opened === 'number' ? r.opened : undefined,
  };
}

export async function getBundledExtensionPath(): Promise<{ ok: boolean; path?: string; error?: string }> {
  const fn = (window as Window & { rawEngine?: RawEngineBridge }).rawEngine?.getBundledExtensionPath;
  if (!fn) return { ok: false, error: 'Not running in Raw Investor desktop shell.' };
  const r = await fn();
  return {
    ok: r?.ok === true,
    path: typeof r?.path === 'string' ? r.path : undefined,
    error: typeof r?.error === 'string' ? r.error : undefined,
  };
}

export async function copyTextToClipboard(text: string): Promise<{ ok: boolean; error?: string }> {
  const fn = (window as Window & { rawEngine?: RawEngineBridge }).rawEngine?.clipboardWriteText;
  if (!fn) return { ok: false, error: 'Clipboard not available outside the desktop shell.' };
  const r = await fn(text);
  return { ok: r?.ok === true, error: typeof r?.error === 'string' ? r.error : undefined };
}

/** Windows: open extensions page in the default browser (Edge or Chrome). */
export async function openCaptureBrowserExtensionsPage(
  kind?: 'edge' | 'chrome'
): Promise<{ ok: boolean; error?: string; browser?: string }> {
  const fn = (window as Window & { rawEngine?: RawEngineBridge }).rawEngine?.openCaptureBrowserExtensions;
  if (!fn) return { ok: false, error: 'Not available outside the Raw Investor desktop shell.' };
  const r = await fn(kind);
  return {
    ok: r?.ok === true,
    error: typeof r?.error === 'string' ? r.error : undefined,
    browser: r?.browser === 'chrome' || r?.browser === 'edge' ? r.browser : undefined,
  };
}

/** @deprecated Prefer openCaptureBrowserExtensionsPage */
export async function openEdgeExtensionsPage(): Promise<{ ok: boolean; error?: string }> {
  return openCaptureBrowserExtensionsPage('edge');
}

/** Sync extension files + pcgr-connection.json only (no folder/browser). */
export async function prepareExtensionInstall(): Promise<{
  ok: boolean;
  error?: string;
  browser?: 'edge' | 'chrome';
  extensionPath?: string;
}> {
  const fn = (window as Window & { rawEngine?: RawEngineBridge }).rawEngine?.prepareExtensionInstall;
  if (!fn) return { ok: false, error: 'Not available outside the Raw Investor desktop shell.' };
  const r = await fn();
  return {
    ok: r?.ok === true,
    error: typeof r?.error === 'string' ? r.error : undefined,
    browser: r?.browser === 'chrome' || r?.browser === 'edge' ? r.browser : undefined,
    extensionPath: typeof r?.extensionPath === 'string' ? r.extensionPath : undefined,
  };
}

/** Copy extension folder path to clipboard (install guide step 1). */
export async function copyExtensionFolderPath(): Promise<{
  ok: boolean;
  error?: string;
  path?: string;
  browser?: 'edge' | 'chrome';
}> {
  const fn = (window as Window & { rawEngine?: RawEngineBridge }).rawEngine?.copyExtensionFolderPath;
  if (!fn) return { ok: false, error: 'Not available outside the Raw Investor desktop shell.' };
  const r = await fn();
  return {
    ok: r?.ok === true,
    error: typeof r?.error === 'string' ? r.error : undefined,
    path: typeof r?.path === 'string' ? r.path : undefined,
    browser: r?.browser === 'chrome' || r?.browser === 'edge' ? r.browser : undefined,
  };
}

/** Re-sync extension files; optional open folder/browser (defaults: files only). */
export async function resyncBrowserExtension(opts?: {
  openFolder?: boolean;
  copyClipboard?: boolean;
  openBrowser?: boolean;
}): Promise<{
  ok: boolean;
  error?: string;
  browser?: 'edge' | 'chrome';
  hint?: string;
}> {
  const fn = (window as Window & { rawEngine?: RawEngineBridge }).rawEngine?.resyncBrowserExtension;
  if (!fn) return { ok: false, error: 'Not available outside the Raw Investor desktop shell.' };
  const r = await fn(opts);
  return {
    ok: r?.ok === true,
    error: typeof r?.error === 'string' ? r.error : undefined,
    browser: r?.browser === 'chrome' || r?.browser === 'edge' ? r.browser : undefined,
    hint: typeof r?.hint === 'string' ? r.hint : undefined,
  };
}

export async function getDefaultCaptureBrowser(): Promise<{ browser: 'edge' | 'chrome'; progId?: string }> {
  const fn = (window as Window & { rawEngine?: RawEngineBridge }).rawEngine?.getDefaultCaptureBrowser;
  if (!fn) return { browser: 'edge' };
  const r = await fn();
  const b = r?.browser === 'chrome' ? 'chrome' : 'edge';
  return { browser: b, progId: typeof r?.progId === 'string' ? r.progId : undefined };
}

export function apiUrl(path: string): string {
  const base = getApiBase();
  if (!path.startsWith('/')) return path;
  if (!base) return path;
  return `${base}${path}`;
}

export function buildApiHeaders(base?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(base || {}) };
  const runtime = typeof window !== 'undefined' ? getRuntimeSync() : {};
  const token = String(runtime.appToken || '').trim();
  if (token) headers['x-pcgr-app-token'] = token;
  return headers;
}

export function shouldPersistPsaToken(): boolean {
  if (typeof window === 'undefined') return true;
  return getRuntimeSync().psaTokenPersistent === true;
}

/** Prefix server-relative paths (e.g. /images/…) for img src and CSS url(). */
export function resolveServerUrl(href: string | null | undefined): string {
  if (href == null || href === '') return '';
  if (/^https?:\/\//i.test(href)) return href;
  return apiUrl(href.startsWith('/') ? href : `/${href}`);
}

export async function focusRawEnginePortfolioWindow(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  const fn = (window as Window & { rawEngine?: RawEngineBridge }).rawEngine?.focusPortfolioWindow;
  if (!fn) return false;
  try {
    const r = await fn();
    return r?.ok !== false;
  } catch {
    return false;
  }
}
