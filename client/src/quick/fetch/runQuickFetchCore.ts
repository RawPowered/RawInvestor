import type { Card } from '../../types';
import { resolveTcgplayerProductUrl } from '../../masterListExternalLinks';
import { fetchCardByIdFromServer } from '../../serverSync';
import { fetchEbayApiConfigStatus } from '../../services/ebayApiSold';
import { refreshEbaySalesViaApi } from '../../utils/ebayApiRefresh';
import { runEbayApiIncrementalLane } from '../../utils/ebayApiIncrementalLane';
import { getEbaySoldWatermarkMs } from '../../utils/quickFetchIncremental';
import { resolveQuickFetchTiming } from '../../utils/quickFetchTiming';
import { captureProfileForMarketMode } from '../../utils/quickFetchMarketMode';
import { runEdgeGuidedFullQuickFetch } from '../runEdgeGuidedFullQuickFetch';
import { planEbayQuickFetch } from './ebayQuickFetchPlan';
import { isLegacyDualGradedProfile } from './resolveSealedQuickFetch';
import { runEmbeddedQuickFetch } from './runEmbeddedQuickFetch';
import { publishQuickFetchSession } from './quickFetchSession';
import { checkExtensionCaptureHealth } from '../../services/extensionCaptureHealth';
import type { QuickFetchContext, QuickFetchOutcome } from './types';

function wrapAppendCapLog(
  capLog: ReturnType<QuickFetchContext['rawEngine']['getCaptureLog']>
) {
  const appendFn =
    capLog && typeof capLog.append === 'function' ? capLog.append.bind(capLog) : null;
  return appendFn
    ? async (entry: {
        level?: string;
        scope?: string;
        message?: string;
        detail?: unknown;
      }) => {
        await appendFn({ ...entry, message: entry.message ?? '' });
      }
    : undefined;
}

/**
 * Top-level Quick Fetch: API lane, hybrid (embedded TCG + Edge eBay), edge_backup, or full embedded.
 */
export async function runQuickFetch(
  ctx: QuickFetchContext,
  card: Card,
  signal?: AbortSignal,
  options?: { stopAfterTcgPhase?: boolean }
): Promise<QuickFetchOutcome> {
  const stopAfterTcgPhase = options?.stopAfterTcgPhase === true;
  const throwIfAborted = () => {
    if (signal?.aborted) throw new DOMException('Quick Fetch cancelled', 'AbortError');
  };
  throwIfAborted();

  const {
    quickFetchIncremental,
    quickFetchTimingStore,
    quickFetchMarketMode,
    quickFetchTcgDeep,
    portfolioKindScope,
  } = ctx;

  const tcgUrl = resolveTcgplayerProductUrl(card);
  const captureProfile = captureProfileForMarketMode(quickFetchMarketMode);
  const qfTiming = resolveQuickFetchTiming(quickFetchTimingStore, captureProfile);
  const qfCustom = quickFetchTimingStore.customized;

  const patchErrors: string[] = [];
  let apiLaneDiag: string | undefined;
  let skipEbayTabCapture = false;
  let updatedCard: Card | null = null;

  const ebaySoldWm = quickFetchIncremental ? getEbaySoldWatermarkMs(card) : null;
  const ebayPlan = planEbayQuickFetch(
    card,
    portfolioKindScope,
    qfTiming,
    quickFetchIncremental,
    quickFetchMarketMode
  );
  const ebayCaptureOpts = ebayPlan.captureOpts;

  const winQuickFetchShellEarly =
    ctx.rawEngine.isShell() &&
    String(ctx.rawEngine.getRuntime().osPlatform || '').toLowerCase() === 'win32';
  const usesEdgeCapture =
    winQuickFetchShellEarly &&
    !stopAfterTcgPhase &&
    (quickFetchMarketMode === 'hybrid' || quickFetchMarketMode === 'edge_backup');
  if (usesEdgeCapture && isLegacyDualGradedProfile(ebayPlan.profile)) {
    const capLogEarly = ctx.rawEngine.getCaptureLog();
    const appendEarly = wrapAppendCapLog(capLogEarly);
    const health = await checkExtensionCaptureHealth();
    if (!health.reachable || health.hint) {
      await appendEarly?.({
        scope: 'quickFetch',
        level: health.reachable ? 'info' : 'warn',
        message: health.hint ?? 'Extension API health check',
        detail: { reachable: health.reachable, mode: health.mode },
      });
      if (health.hint && health.reachable) {
        ctx.setQuickFetchPhase(health.hint.slice(0, 120));
      } else if (!health.reachable && health.hint) {
        ctx.setQuickFetchPhase(health.hint.slice(0, 120));
      }
    }
  }

  if (stopAfterTcgPhase) {
    await publishQuickFetchSession({
      active: true,
      expectedCaptureMode: ebayPlan.extensionCaptureMode,
      profile: ebayPlan.profile,
      pass: 'tcg',
      cardId: card.id,
      updatedAt: Date.now(),
    });
  } else {
    await publishQuickFetchSession({
      active: true,
      expectedCaptureMode: ebayPlan.extensionCaptureMode,
      profile: ebayPlan.profile,
      pass: tcgUrl ? 'tcg' : 'ebay',
      cardId: card.id,
      updatedAt: Date.now(),
    });
  }

  const apiLimit = Math.max(
    10,
    Math.min(
      200,
      Math.floor(Number(ebayCaptureOpts.ebayPerPageTarget) || qfTiming.ebayQuickRefreshMaxPerPage || 60)
    )
  );

  if (quickFetchIncremental) {
    const apiLane = await runEbayApiIncrementalLane(card, {
      watermarkMs: ebaySoldWm,
      limit: apiLimit,
    });
    if (apiLane.error) patchErrors.push(`eBay API: ${apiLane.error}`);
    if (apiLane.satisfied) {
      skipEbayTabCapture = true;
      apiLaneDiag = `eBay API: ${apiLane.summary?.count ?? 0} sold rows (skipped tab capture)`;
      updatedCard = (await fetchCardByIdFromServer(card.id)) ?? card;
    }
  } else {
    try {
      const st = await fetchEbayApiConfigStatus();
      if (st.configured) {
        const bg = await refreshEbaySalesViaApi(card, { windowDays: 30, limit: apiLimit });
        if (bg.apiError) patchErrors.push(`eBay API (background): ${bg.apiError}`);
        else if (bg.apiRowCount > 0) {
          apiLaneDiag = `eBay API: ${bg.apiRowCount} comps (parallel with tab capture)`;
        }
      }
    } catch {
      /* optional enrich */
    }
  }

  const winQuickFetchShell =
    ctx.rawEngine.isShell() &&
    String(ctx.rawEngine.getRuntime().osPlatform || '').toLowerCase() === 'win32';
  const canEdgePhase = winQuickFetchShell && !stopAfterTcgPhase;
  const useHybrid = canEdgePhase && quickFetchMarketMode === 'hybrid';
  const useEdgeBackup = canEdgePhase && quickFetchMarketMode === 'edge_backup';

  if (useHybrid) {
    const capLog = ctx.rawEngine.getCaptureLog();
    const appendCapLog = wrapAppendCapLog(capLog);

    let part1: QuickFetchOutcome = { patchErrors: [] };
    const embeddedBrowser = ctx.rawEngine.getBrowser();
    const canCaptureTcgInApp = Boolean(
      embeddedBrowser?.newTab && embeddedBrowser?.captureTab && embeddedBrowser?.closeTab
    );
    if (tcgUrl && canCaptureTcgInApp) {
      part1 = await runQuickFetch(ctx, card, signal, { stopAfterTcgPhase: true });
    } else if (tcgUrl) {
      const msg =
        'TCG in-app capture skipped — Raw Engine browser is not ready. Continuing with Edge eBay; restart the app if you need TCG in the embedded browser.';
      patchErrors.push(msg);
      await appendCapLog?.({
        scope: 'quickFetch',
        level: 'warn',
        message: msg,
        detail: { cardId: card.id },
      });
      ctx.setQuickFetchPhase('TCG skipped — opening Edge for eBay…');
    }

    const card2 = (await fetchCardByIdFromServer(card.id)) ?? card;
    const tcgUrl2 = resolveTcgplayerProductUrl(card2);
    const ebaySoldWm2 = quickFetchIncremental ? getEbaySoldWatermarkMs(card2) : null;
    const ebayPlan2 = planEbayQuickFetch(
      card2,
      portfolioKindScope,
      qfTiming,
      quickFetchIncremental,
      quickFetchMarketMode
    );

    let skipEbayEdge = skipEbayTabCapture;
    if (quickFetchIncremental && !skipEbayEdge) {
      const lane2 = await runEbayApiIncrementalLane(card2, {
        watermarkMs: ebaySoldWm2,
        limit: apiLimit,
      });
      if (lane2.error) part1.patchErrors.push(`eBay API: ${lane2.error}`);
      if (lane2.satisfied) skipEbayEdge = true;
    }

    await appendCapLog?.({
      scope: 'quickFetch',
      message: 'Hybrid Edge eBay plan',
      detail: {
        ebayProfile: ebayPlan2.profile,
        ebayPassCount: ebayPlan2.ebayPassCount,
        resolvedSealed: ebayPlan2.resolvedSealed,
        portfolioKindScope,
        cardPortfolioKind: card2.portfolioKind ?? null,
      },
    });

    await publishQuickFetchSession({
      active: true,
      expectedCaptureMode: ebayPlan2.extensionCaptureMode,
      profile: ebayPlan2.profile,
      pass: 'ebay',
      cardId: card2.id,
      updatedAt: Date.now(),
    });

    const extModeLabel =
      ebayPlan2.extensionCaptureMode === 'default'
        ? 'Quick (~100 sales)'
        : 'More history';
    ctx.setQuickFetchPhase(
      `TCG done — opening Edge for eBay (${ebayPlan2.ebayPassCount} tab, extension ${extModeLabel})`
    );

    if (skipEbayEdge) {
      ctx.setQuickFetchPhase('eBay API satisfied — finishing (no Edge capture needed)');
    }

    const part2 = await runEdgeGuidedFullQuickFetch({
      card: card2,
      signal,
      ebayPlan: ebayPlan2,
      tcgUrl: tcgUrl2,
      effectiveTcgDeep: !quickFetchIncremental && quickFetchTcgDeep,
      qfTiming,
      setPhase: (label) => ctx.setQuickFetchPhase(label),
      setProgressPct: (n) => ctx.setQuickFetchProgressPct(n),
      appendCapLog,
      skipTcgExtensionPhase: true,
      skipEbayExtensionPhase: skipEbayEdge,
    });

    return {
      patchErrors: [...part1.patchErrors, ...part2.patchErrors],
      tcgWarning: part1.tcgWarning ?? part2.tcgWarning,
      updatedCard: part2.updatedCard ?? part1.updatedCard ?? null,
      captureDiagnostics: [apiLaneDiag, part1.captureDiagnostics, part2.captureDiagnostics]
        .filter(Boolean)
        .join(' · '),
    };
  }

  if (useEdgeBackup) {
    const appendCapLog = wrapAppendCapLog(ctx.rawEngine.getCaptureLog());
    return runEdgeGuidedFullQuickFetch({
      card,
      signal,
      ebayPlan,
      tcgUrl,
      effectiveTcgDeep: !quickFetchIncremental && quickFetchTcgDeep,
      qfTiming,
      setPhase: (label) => ctx.setQuickFetchPhase(label),
      setProgressPct: (n) => ctx.setQuickFetchProgressPct(n),
      appendCapLog,
      skipEbayExtensionPhase: skipEbayTabCapture,
    });
  }

  const embedded = await runEmbeddedQuickFetch(ctx, {
    card,
    signal,
    stopAfterTcgPhase,
    skipEbayTabCapture,
    apiLaneDiag,
    ebayPlan,
    qfTiming,
    qfCustom,
  });

  return {
    ...embedded,
    updatedCard: embedded.updatedCard ?? updatedCard,
    captureDiagnostics:
      [apiLaneDiag, embedded.captureDiagnostics].filter(Boolean).join(' · ') || undefined,
    patchErrors: [...patchErrors, ...embedded.patchErrors],
  };
}
