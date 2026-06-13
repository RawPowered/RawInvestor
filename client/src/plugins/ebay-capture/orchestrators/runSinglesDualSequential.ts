import type { EmbeddedSinglesDualDeps, SinglesDualCaptureResult } from '../types';
import { finalizeSinglesDualCapture } from './finalizeSinglesDual';

export async function runSinglesDualSequential(
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
    message: 'Phase 2a: open eBay tab — Graded No pass',
    detail: { pluginId: 'singles-dual-sequential', ebayUrl },
  });
  const ebayTabId1 = await openEbayTab(ebayUrlGradedNo, quickFetchReuseTab, 'eBay graded no', true);
  openedTabIds.push(ebayTabId1);
  await activate(ebayTabId1);
  await postSleep(qfTiming.ebayPostActivateMs);
  throwIfAborted();
  bumpCapture('eBay: scanning sold listings (pass 1 — Graded No)');

  const echoNo = await captureTab(
    ebayTabId1,
    ebayQuickCaptureMode,
    {
      ...ebayCaptureOpts,
      ebayGradedFacet: 'no',
      ebaySkipGradedFacetClick: ebayQuickCap,
      ebayGradedFacetAlreadyApplied: ebayQuickCap,
      expectedCapture: { kind: 'ebay', targetUrl: ebayUrlGradedNo },
    },
    { phase: 'eBay capture Graded No', tabId: ebayTabId1 }
  );
  await closeTab(ebayTabId1);
  openedTabIds.pop();

  bumpCapture('eBay: pass 1 done — opening Graded Yes');
  const ebayTabId2 = await openEbayTab(ebayUrlGradedYes, quickFetchReuseTab, 'eBay graded yes', true);
  openedTabIds.push(ebayTabId2);
  await activate(ebayTabId2);
  await postSleep(qfTiming.ebayPostActivateMs);
  throwIfAborted();
  bumpCapture('eBay: scanning sold listings (pass 2 — Graded Yes)');

  const echoYes = await captureTab(
    ebayTabId2,
    ebayQuickCaptureMode,
    {
      ...ebayCaptureOpts,
      ebayGradedFacet: 'yes',
      ebaySkipGradedFacetClick: ebayQuickCap,
      ebayGradedFacetAlreadyApplied: ebayQuickCap,
      expectedCapture: { kind: 'ebay', targetUrl: ebayUrlGradedYes },
    },
    { phase: 'eBay capture Graded Yes', tabId: ebayTabId2 }
  );
  await closeTab(ebayTabId2);
  openedTabIds.pop();

  bumpCapture('eBay: pass 2 done — merging results');
  return finalizeSinglesDualCapture(deps, echoNo, echoYes);
}
