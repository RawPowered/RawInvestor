import type { Hunt, Target } from '../types';

type ArsenalApply = (patch: { hunts?: Hunt[]; targets?: Target[] }) => void;

let getSnapshot: (() => { hunts: Hunt[]; targets: Target[] }) | null = null;
let applyPatch: ArsenalApply | null = null;
let rehydrateFromServer: (() => Promise<void>) | null = null;

export const registerArsenalSyncBridge = (opts: {
  getSnapshot: () => { hunts: Hunt[]; targets: Target[] };
  applyPatch: ArsenalApply;
  rehydrateFromServer: () => Promise<void>;
}) => {
  getSnapshot = opts.getSnapshot;
  applyPatch = opts.applyPatch;
  rehydrateFromServer = opts.rehydrateFromServer;
};

export const unregisterArsenalSyncBridge = () => {
  getSnapshot = null;
  applyPatch = null;
  rehydrateFromServer = null;
};

export const getArsenalForPortfolioExport = (): { hunts: Hunt[]; targets: Target[] } | null =>
  getSnapshot?.() ?? null;

export const applyArsenalPortfolioImport = (patch: { hunts?: Hunt[]; targets?: Target[] }) => {
  applyPatch?.(patch);
};

export const arsenalRehydrateFromServer = () => rehydrateFromServer?.() ?? Promise.resolve();
