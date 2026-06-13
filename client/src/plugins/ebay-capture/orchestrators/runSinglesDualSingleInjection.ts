import type { EmbeddedSinglesDualDeps, SinglesDualCaptureResult } from '../types';
import { finalizeSinglesDualCapture } from './finalizeSinglesDual';

/** One tab, two extract passes (Graded No then Yes) — avoids multi-tab extract stalls. */
export async function runSinglesDualSingleInjection(
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
    message: 'Single-tab dual facet: open one eBay tab',
    detail: { pluginId: 'singles-dual-single-injection', ebayUrl },
  });

  const tabId = await openEbayTab(ebayUrlGradedNo, quickFetchReuseTab, 'eBay dual single-tab', true);
  openedTabIds.push(tabId);

  const runPass = async (lane: 'no' | 'yes', url: string) => {
    await activate(tabId);
    await postSleep(qfTiming.ebayPostActivateMs);
    throwIfAborted();
    bumpCapture(`eBay: single-tab pass (${lane === 'no' ? 'Graded No' : 'Graded Yes'})`);
    return captureTab(
      tabId,
      ebayQuickCaptureMode,
      {
        ...ebayCaptureOpts,
        ebayGradedFacet: lane,
        ebaySkipGradedFacetClick: ebayQuickCap,
        ebayGradedFacetAlreadyApplied: ebayQuickCap,
        expectedCapture: { kind: 'ebay', targetUrl: url },
      },
      { phase: `eBay single-tab ${lane}`, tabId, lane }
    );
  };

  const echoNo = await runPass('no', ebayUrlGradedNo);
  const echoYes = await runPass('yes', ebayUrlGradedYes);
  await closeTab(tabId);
  openedTabIds.pop();

  bumpCapture('eBay: single-tab dual passes done — merging');
  return finalizeSinglesDualCapture(deps, echoNo, echoYes, {
    parallelDual: false,
  });
}
