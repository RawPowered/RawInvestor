import type { Card } from '../../types';
import {
  buildEbayDeepSnapshotFromSingleCapture,
  verifyAndArchiveEbayOutliers,
  type EbayExtractPayload,
} from '../../utils/ebayQuickFetch';
import { mergeIncrementalEbaySnapshots } from '../../utils/quickFetchIncremental';
import type { EbayQuickFetchPlan } from './ebayQuickFetchPlan';
import type { QuickFetchTiming } from '../../utils/quickFetchTiming';

export type EmbeddedEbaySealedDeps = {
  card: Card;
  ebayPlan: EbayQuickFetchPlan;
  ebayUrl: string;
  quickFetchIncremental: boolean;
  qfTiming: QuickFetchTiming;
  ebayQuickCaptureMode: 'default' | 'deep';
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
  ) => Promise<{ raw?: EbayExtractPayload; rowCount?: number; captureStats?: { pagesScanned?: number } }>;
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

export async function runEbayCaptureSealedEmbedded(
  deps: EmbeddedEbaySealedDeps
): Promise<{
  verified: Awaited<ReturnType<typeof verifyAndArchiveEbayOutliers>>;
  captureDiagnostics: string;
}> {
  const {
    card,
    ebayPlan,
    ebayUrl,
    quickFetchIncremental,
    qfTiming,
    ebayQuickCaptureMode,
    openEbayTab,
    captureTab,
    activate,
    closeTab,
    postSleep,
    bumpCapture,
    throwIfAborted,
    appendCapLog,
    quickFetchReuseTab,
    openedTabIds,
  } = deps;

  const modeLabel =
    ebayQuickCaptureMode === 'default' ? 'sealed quick (first page)' : 'sealed deep';

  await appendCapLog?.({
    scope: 'quickFetch',
    message: `Phase 2: open eBay tab — ${modeLabel}`,
    detail: { ebayUrl, ebayProfile: ebayPlan.profile, ebayPassCount: 1 },
  });

  const ebayTabId = await openEbayTab(ebayUrl, quickFetchReuseTab, `eBay ${modeLabel}`, true);
  openedTabIds.push(ebayTabId);
  await activate(ebayTabId);
  await postSleep(qfTiming.ebayPostActivateMs);
  throwIfAborted();
  bumpCapture(`eBay: scanning sold listings (${modeLabel})`);

  await appendCapLog?.({
    scope: 'quickFetch',
    message: `Phase 2: capture eBay ${modeLabel} (no graded facet)`,
    detail: { tabId: ebayTabId },
  });

  const echo = await captureTab(
    ebayTabId,
    ebayQuickCaptureMode,
    {
      ...ebayPlan.captureOpts,
      ebaySkipGradedFacetClick: true,
      expectedCapture: { kind: 'ebay', targetUrl: ebayUrl },
    },
    { phase: `eBay capture ${modeLabel}`, tabId: ebayTabId }
  );

  await closeTab(ebayTabId);
  openedTabIds.pop();

  bumpCapture('eBay: sealed pass done — merging results');
  const rawSingle = echo?.raw ?? (echo as unknown as EbayExtractPayload);

  let mergedSealed = buildEbayDeepSnapshotFromSingleCapture(rawSingle, ebayUrl);
  if (quickFetchIncremental && card.ebayExtensionSnapshot) {
    const priorRows = card.ebayExtensionSnapshot.listings?.length ?? 0;
    mergedSealed = mergeIncrementalEbaySnapshots(card.ebayExtensionSnapshot, mergedSealed);
    await appendCapLog?.({
      scope: 'quickFetch',
      message: 'eBay incremental merge',
      detail: { priorRowCount: priorRows, mergedRowCount: mergedSealed.rowCount },
    });
  }

  const verifiedSealed = await verifyAndArchiveEbayOutliers(
    card,
    mergedSealed,
    card.ebayVerificationArchive,
    card.ebayArchivedSaleKeys
  );

  const ebRowsS = verifiedSealed.snapshot.rowCount ?? 0;
  const ebExclS = verifiedSealed.snapshot.rejectedListings?.length ?? 0;
  const prevArchS = card.ebayVerificationArchive?.length ?? 0;
  const archNS = Math.max(0, (verifiedSealed.ebayVerificationArchive?.length ?? 0) - prevArchS);

  const captureDiagnostics = [
    `eBay: ${ebRowsS} rows (sealed · ${modeLabel}, target ${qfTiming.ebayPerPageTarget}/pg)`,
    ebExclS > 0 ? `${ebExclS} parser mismatches → rejected` : '',
    archNS > 0 ? `${archNS} high-price outliers archived (verify)` : '',
  ]
    .filter((x) => typeof x === 'string' && x.length > 0)
    .join(' · ');

  return { verified: verifiedSealed, captureDiagnostics };
}
