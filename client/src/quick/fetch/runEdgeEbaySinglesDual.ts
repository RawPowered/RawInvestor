import type { Card } from '../../types';

import type { EbayQuickFetchPlan } from './ebayQuickFetchPlan';

import { loadEbayCapturePluginSettings } from '../../plugins/ebay-capture/hooks/useEbayCapturePluginSettings';
import { ebayBaselineFromCard } from './pollExtensionCapture';



export type EdgeEbaySinglesDualDeps = {

  card: Card;

  signal?: AbortSignal;

  ebayPlan: EbayQuickFetchPlan;

  ebayBaselineAt: number;

  bump: (label: string, options?: { advanceStep?: boolean }) => void;

  setDualCaptureProgress?: (noPassRows: number, yesPassRows: number) => void;

  throwIfAborted: () => void;

  pollTimeoutMs: number;

  log: (message: string, detail?: Record<string, unknown>) => Promise<void>;

};



export type EdgeEbaySinglesDualResult = {

  updatedCard: Card | null;

  patchErrors: string[];

  captureDiagnostics: string;

  ebayBaselineAt: number;

};



export async function runEdgeEbaySinglesDual(

  deps: EdgeEbaySinglesDualDeps

): Promise<EdgeEbaySinglesDualResult> {
  if (!loadEbayCapturePluginSettings().ebayLegacyDualGraded) {
    throw new Error('Legacy dual graded eBay capture is disabled. Use single sold-search tab capture.');
  }

  const { runEdgeDualPassPoll } = await import(

    '../../plugins/ebay-capture/orchestrators/runEdgeDualPassPoll'

  );

  const startBaseline = ebayBaselineFromCard(deps.card, deps.ebayBaselineAt).capturedAt;

  const result = await runEdgeDualPassPoll({

    ...deps,

    ebayBaselineAt: startBaseline,

    openBothTabsFirst: true,

  });

  return {

    updatedCard: result.updatedCard,

    patchErrors: result.patchErrors,

    captureDiagnostics: result.captureDiagnostics,

    ebayBaselineAt: result.ebayBaselineAt,

  };

}


