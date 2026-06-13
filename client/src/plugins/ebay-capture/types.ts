import type { QuickFetchTiming } from '../../utils/quickFetchTiming';
import type { Card } from '../../types';
import type { EbayExtractPayload } from '../../utils/ebayQuickFetch';
import type { EbayExtensionSnapshot } from '../../types';

export type EbayCaptureLane = 'no' | 'yes';

export type EbayCapturePluginSettings = {
  captureEbayDualParallel: boolean;
  /** One RawEngine tab, two passes — fallback when parallel tabs stall. */
  ebaySingleInjectionDualFacet: boolean;
  ebayAggressiveDeep: boolean;
  maxConcurrentCards: number;
  /** Graded No + Yes dual-tab Quick Fetch (off by default; single sold-search tab is standard). */
  ebayLegacyDualGraded: boolean;
};

export const DEFAULT_EBAY_CAPTURE_PLUGIN_SETTINGS: EbayCapturePluginSettings = {
  captureEbayDualParallel: false,
  ebaySingleInjectionDualFacet: false,
  ebayAggressiveDeep: false,
  maxConcurrentCards: 1,
  ebayLegacyDualGraded: false,
};

export type EbayCaptureDiagnostics = {
  pagesScanned?: number;
  ebayDeepFetchConcurrency?: number;
  ebayDeepFetchConcurrencyInitial?: number;
  ebayDeepAdaptiveConcurrencyReduced?: boolean;
  ebayDeepFetchPhaseMs?: number;
  parallelDual?: boolean;
};

export type SinglesDualVerified = {
  snapshot: EbayExtensionSnapshot;
  ebayVerificationArchive?: Card['ebayVerificationArchive'];
  ebayArchivedSaleKeys?: string[];
};

export type SinglesDualCaptureResult = {
  verified: SinglesDualVerified;
  captureDiagnostics: string;
  laneErrors?: Partial<Record<EbayCaptureLane, string>>;
};

export type EmbeddedSinglesDualDeps = {
  card: Card;
  ebayUrl: string;
  ebayUrlGradedNo: string;
  ebayUrlGradedYes: string;
  quickFetchIncremental: boolean;
  qfTiming: QuickFetchTiming;
  ebayQuickCaptureMode: 'default' | 'deep';
  ebayQuickCap: boolean;
  ebayCaptureOpts: Record<string, unknown>;
  openEbayTab: (
    targetUrl: string,
    reuse: boolean,
    logLabel: string,
    forceNew: boolean
  ) => Promise<number>;
  captureTab: (
    tabId: number,
    mode: 'default' | 'deep',
    options: Record<string, unknown>,
    gateDetail: Record<string, unknown>
  ) => Promise<{ raw?: EbayExtractPayload; rowCount?: number; captureStats?: Record<string, unknown> }>;
  activate: (tabId: number) => Promise<unknown>;
  closeTab: (tabId: number) => Promise<unknown>;
  postSleep: (ms: number) => Promise<unknown>;
  bumpCapture: (label: string) => void;
  throwIfAborted: () => void;
  appendCapLog?: (entry: {
    scope?: string;
    message?: string;
    detail?: unknown;
  }) => Promise<unknown>;
  quickFetchReuseTab: boolean;
  openedTabIds: number[];
};

export type PortfolioBatchCardJob = {
  cardId: string;
  cardName: string;
  status: 'pending' | 'running' | 'done' | 'error';
  message?: string;
};
