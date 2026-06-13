/** Minimal RawEngine bridge types for Quick Fetch embedded capture. */

export type RawEngineBrowserTab = { id?: number; url?: string; title?: string };

export type RawEngineBrowserApi = {
  newTab?: (url: string) => Promise<{ ok?: boolean; id?: number | null } | boolean>;
  activate?: (id: number) => Promise<boolean>;
  closeTab?: (id: number) => Promise<boolean>;
  listTabs?: () => Promise<RawEngineBrowserTab[]>;
  openOrFocusUrl?: (
    url: string
  ) => Promise<{ ok?: boolean; id?: number | null; reused?: boolean } | null>;
  captureTab?: (
    tabId: number,
    mode?: 'default' | 'deep',
    options?: Record<string, unknown>
  ) => Promise<unknown>;
  ebaySessionStatus?: () => Promise<{ status?: string; ok?: boolean; error?: string }>;
  ebayOrganicNavigate?: (args: {
    tabId: number;
    targetUrl: string;
    allowDirectFallback?: boolean;
    timeoutMs?: number;
  }) => Promise<{ ok?: boolean; error?: string; fellBack?: boolean; detail?: unknown }>;
};

export type RawEngineScrapeGateApi = {
  waitForAck?: (meta: Record<string, unknown>) => Promise<unknown>;
};

export type RawEngineCaptureLogApi = {
  append?: (entry: {
    level?: string;
    scope?: string;
    message: string;
    detail?: unknown;
  }) => Promise<{ ok?: boolean }>;
};
