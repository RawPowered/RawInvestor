import type { Card } from '../../types';
import type { PortfolioKindScope } from '../../sort';
import type { QuickFetchMarketMode } from '../../utils/quickFetchMarketMode';
import type { QuickFetchTiming, QuickFetchTimingStore } from '../../utils/quickFetchTiming';
import type { EbayQuickFetchPlan } from './ebayQuickFetchPlan';
import type { QuickFetchPreflightKind } from '../QuickFetchMarketplacePreflight';
import type { EbayCaptureDiagnostics } from '../../plugins/ebay-capture/types';
import type {
  RawEngineBrowserApi,
  RawEngineCaptureLogApi,
  RawEngineScrapeGateApi,
} from './rawEngineBridge';

export type QuickFetchOutcome = {
  tcgWarning?: string;
  captureDiagnostics?: string;
  updatedCard?: Card | null;
  patchErrors: string[];
};

/** Shared Quick Fetch inputs wired from App.tsx. */
export type QuickFetchContext = {
  quickFetchIncremental: boolean;
  quickFetchTimingStore: QuickFetchTimingStore;
  quickFetchMarketMode: QuickFetchMarketMode;
  quickFetchTcgDeep: boolean;
  portfolioKindScope: PortfolioKindScope;
  quickFetchReuseTab: boolean;
  quickFetchRequireDeckReady: boolean;
  setQuickFetchPhase: (label: string | null) => void;
  setQuickFetchProgressPct: (n: number | null) => void;
  setQuickEbayCaptureDiagnostics?: (stats: EbayCaptureDiagnostics | null) => void;
  requestMarketPreflight: (kind: QuickFetchPreflightKind) => Promise<'continue' | 'stop'>;
  rawEngine: {
    getBrowser: () => RawEngineBrowserApi | null;
    getCaptureLog: () => RawEngineCaptureLogApi | null;
    getScrapeGate: () => RawEngineScrapeGateApi | null;
    isShell: () => boolean;
    getRuntime: () => { osPlatform?: string };
  };
};

export type EmbeddedQuickFetchParams = {
  card: Card;
  signal?: AbortSignal;
  stopAfterTcgPhase?: boolean;
  skipEbayTabCapture: boolean;
  apiLaneDiag?: string;
  ebayPlan: EbayQuickFetchPlan;
  qfTiming: QuickFetchTiming;
  qfCustom: boolean;
};

export type QuickFetchEbayContext = {
  card: Card;
  ebayPlan: EbayQuickFetchPlan;
  timing: QuickFetchTiming;
};
