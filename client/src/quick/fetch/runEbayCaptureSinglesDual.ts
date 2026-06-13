import type { Card } from '../../types';
import type { EbayQuickFetchPlan } from './ebayQuickFetchPlan';
import type { EmbeddedSinglesDualDeps, SinglesDualCaptureResult } from '../../plugins/ebay-capture/types';
import {
  loadEbayCapturePluginSettings,
  effectiveEbayDeepConcurrency,
} from '../../plugins/ebay-capture/hooks/useEbayCapturePluginSettings';

export type EmbeddedEbaySinglesDualDeps = EmbeddedSinglesDualDeps & {
  card: Card;
  ebayPlan: EbayQuickFetchPlan;
};

export async function runEbayCaptureSinglesDualEmbedded(
  deps: EmbeddedEbaySinglesDualDeps
): Promise<SinglesDualCaptureResult> {
  if (!loadEbayCapturePluginSettings().ebayLegacyDualGraded) {
    throw new Error('Legacy dual graded eBay capture is disabled. Use single sold-search tab capture.');
  }
  const plugin = loadEbayCapturePluginSettings();
  const dualParallel = plugin.captureEbayDualParallel;

  const cappedConc = effectiveEbayDeepConcurrency(
    deps.qfTiming.ebayDeepFetchConcurrency,
    dualParallel
  );
  const ebayCaptureOpts = {
    ...deps.ebayCaptureOpts,
    ebayDeepFetchConcurrency: cappedConc,
    ebayDeepBudgetMs: deps.qfTiming.ebayDeepBudgetMs,
    ...(dualParallel ? { ebayParallelLane: true } : {}),
  };
  const depsWithOpts = { ...deps, ebayCaptureOpts };

  if (plugin.ebaySingleInjectionDualFacet) {
    const { runSinglesDualSingleInjection } = await import(
      '../../plugins/ebay-capture/orchestrators/runSinglesDualSingleInjection'
    );
    return runSinglesDualSingleInjection(depsWithOpts);
  }

  if (dualParallel) {
    const { runSinglesDualParallel } = await import(
      '../../plugins/ebay-capture/orchestrators/runSinglesDualParallel'
    );
    return runSinglesDualParallel(depsWithOpts);
  }

  const { runSinglesDualSequential } = await import(
    '../../plugins/ebay-capture/orchestrators/runSinglesDualSequential'
  );
  return runSinglesDualSequential(depsWithOpts);
}
