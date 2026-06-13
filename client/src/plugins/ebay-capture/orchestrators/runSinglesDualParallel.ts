import type { EmbeddedSinglesDualDeps, SinglesDualCaptureResult } from '../types';
import { finalizeSinglesDualCapture } from './finalizeSinglesDual';

export async function runSinglesDualParallel(
  deps: EmbeddedSinglesDualDeps
): Promise<SinglesDualCaptureResult> {
  const {
    ebayUrl,
    ebayUrlGradedNo,
    ebayUrlGradedYes,
    qfTiming,
    ebayQuickCaptureMode,
    ebayQuickCap,
    ebayCaptureOpts,
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

  await appendCapLog?.({
    scope: 'ebayCapturePlugin',
    message: 'Parallel dual: open Graded No + Yes tabs',
    detail: { pluginId: 'singles-dual-parallel', ebayUrl },
  });

  const tabNo = await openEbayTab(ebayUrlGradedNo, quickFetchReuseTab, 'eBay graded no', true);
  const tabYes = await openEbayTab(ebayUrlGradedYes, quickFetchReuseTab, 'eBay graded yes', true);
  openedTabIds.push(tabNo, tabYes);

  await Promise.all([activate(tabNo), activate(tabYes)]);
  await postSleep(qfTiming.ebayPostActivateMs);
  throwIfAborted();
  bumpCapture('eBay: parallel capture (Graded No + Yes)');

  const laneOpts = {
    ...ebayCaptureOpts,
    ebayParallelLane: true,
    ebaySkipGradedFacetClick: ebayQuickCap,
    ebayGradedFacetAlreadyApplied: ebayQuickCap,
  };

  const laneErrors: SinglesDualCaptureResult['laneErrors'] = {};

  const runLane = async (lane: 'no' | 'yes', tabId: number, url: string) => {
    try {
      return await captureTab(
        tabId,
        ebayQuickCaptureMode,
        {
          ...laneOpts,
          ebayGradedFacet: lane,
          expectedCapture: { kind: 'ebay', targetUrl: url },
        },
        { phase: `eBay parallel ${lane}`, tabId, lane }
      );
    } catch (err) {
      laneErrors[lane] = err instanceof Error ? err.message : String(err);
      return null;
    }
  };

  const [echoNo, echoYes] = await Promise.all([
    runLane('no', tabNo, ebayUrlGradedNo),
    runLane('yes', tabYes, ebayUrlGradedYes),
  ]);

  await Promise.all([closeTab(tabNo), closeTab(tabYes)]);
  openedTabIds.pop();
  openedTabIds.pop();

  if (!echoNo && !echoYes) {
    throw new Error(
      `Both parallel lanes failed. No: ${laneErrors.no ?? '?'} · Yes: ${laneErrors.yes ?? '?'}`
    );
  }
  if (!echoNo || !echoYes) {
    bumpCapture(
      `eBay: partial parallel capture — ${!echoNo ? 'Graded No failed' : 'Graded Yes failed'}`
    );
  } else {
    bumpCapture('eBay: parallel passes done — merging');
  }

  return finalizeSinglesDualCapture(deps, echoNo, echoYes, {
    parallelDual: true,
    laneErrors: Object.keys(laneErrors).length ? laneErrors : undefined,
  });
}
