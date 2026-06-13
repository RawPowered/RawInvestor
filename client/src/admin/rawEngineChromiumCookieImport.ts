import type { RawEngineChromiumCookieImportResult } from '../apiBase';

export type RawEngineChromiumCookieImportOptions = {
  edge?: boolean;
  chrome?: boolean;
};

export const getRawEngineImportChromiumCookies = (): ((
  opts?: RawEngineChromiumCookieImportOptions
) => Promise<RawEngineChromiumCookieImportResult>) | null => {
  if (typeof window === 'undefined') return null;
  const w = window as Window & {
    rawEngine?: {
      importChromiumCookies?: (
        opts?: RawEngineChromiumCookieImportOptions
      ) => Promise<RawEngineChromiumCookieImportResult>;
    };
  };
  return w.rawEngine?.importChromiumCookies ?? null;
};
