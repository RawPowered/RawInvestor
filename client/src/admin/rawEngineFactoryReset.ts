export type RawEngineFactoryResetOptions = {
  preserveLoginSessions?: boolean;
  clearCacheAndBrowsingHistory?: boolean;
  clearPasswordAndUsernameHistory?: boolean;
};

export type RawEngineFactoryResetResult =
  | { ok: true }
  | { ok: false; cancelled?: boolean; error?: string };

export const getRawEngineFactoryReset = (): ((
  opts: RawEngineFactoryResetOptions
) => Promise<RawEngineFactoryResetResult>) | null => {
  if (typeof window === 'undefined') return null;
  const w = window as Window & {
    rawEngine?: { factoryReset?: (opts: RawEngineFactoryResetOptions) => Promise<RawEngineFactoryResetResult> };
  };
  return w.rawEngine?.factoryReset ?? null;
};
