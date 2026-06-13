import type { Card, TcgplayerSalesSnapshot } from '../../types';
import { resolveTcgplayerProductUrl } from '../../masterListExternalLinks';
import { verifyTabUrlForQuickFetch, type CaptureSiteKind } from '../../rawengine/tabUrlVerify';
import {
  mergeTcgDualRawEngineCaptures,
  type TcgCaptureEcho,
} from '../../rawengine/mergeTcgDualCaptures';
import {
  archiveTcgSalesPriceOutliers,
  verifyAndArchiveEbayOutliers,
  type EbayExtractPayload,
} from '../../utils/ebayQuickFetch';
import {
  getEbaySoldWatermarkMs,
  getTcgSalesWatermarkMs,
  mergeIncrementalTcgSnapshots,
} from '../../utils/quickFetchIncremental';
import { buildTcgCaptureOptions, resolvePostActivateSleep } from '../../utils/quickFetchTiming';
import { captureProfileForMarketMode } from '../../utils/quickFetchMarketMode';
import type { QuickFetchPreflightKind } from '../QuickFetchMarketplacePreflight';
import { fetchCardByIdFromServer, loadPortfolioMetaFromServer, patchCardOnServer } from '../../serverSync';
import { parseEbaySessionExtensionReport } from '../../ebaySessionFromMeta';
import { postMergedEbayCaptureToServer } from '../../services/extensionCapture';
import { runEbayCaptureSealedEmbedded } from './runEbayCaptureSealed';
import { isLegacyDualGradedProfile } from './resolveSealedQuickFetch';
import { runEbayCaptureSinglesDualEmbedded } from './runEbayCaptureSinglesDual';
import { loadEbayCapturePluginSettings } from '../../plugins/ebay-capture/hooks/useEbayCapturePluginSettings';
import type { QuickFetchContext, EmbeddedQuickFetchParams, QuickFetchOutcome } from './types';

const STORAGE_KEY_QUICK_FETCH_EBAY_ORGANIC = 'pcgr:quick:ebay_organic:v1';
const STORAGE_KEY_QUICK_FETCH_SKIP_MARKET_PREFLIGHT = 'pcgr:quick:fetch_skip_market_preflight:v1';

export async function runEmbeddedQuickFetch(
  ctx: QuickFetchContext,
  params: EmbeddedQuickFetchParams
): Promise<QuickFetchOutcome> {
  const {
    card,
    signal,
    stopAfterTcgPhase = false,
    skipEbayTabCapture,
    apiLaneDiag,
    ebayPlan,
    qfTiming,
    qfCustom,
  } = params;
  const {
    quickFetchIncremental,
    quickFetchMarketMode,
    quickFetchReuseTab,
    quickFetchRequireDeckReady,
    quickFetchTcgDeep,
    setQuickFetchPhase,
    setQuickFetchProgressPct,
    setQuickEbayCaptureDiagnostics,
    requestMarketPreflight,
    rawEngine,
  } = ctx;

  const throwIfAborted = () => {
    if (signal?.aborted) throw new DOMException('Quick Fetch cancelled', 'AbortError');
  };
  throwIfAborted();

  const tcgUrl = resolveTcgplayerProductUrl(card);
  const openedTabIds: number[] = [];
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const captureProfile = captureProfileForMarketMode(quickFetchMarketMode);
  const postSleep = (ms: number) =>
    sleep(
      resolvePostActivateSleep(ms, {
        incremental: quickFetchIncremental,
        customized: qfCustom,
        timing: qfTiming,
      })
    );
  let tcgWarning: string | undefined;
  let captureDiagnostics: string | undefined;
  let updatedCard: Card | null = null;
  const patchErrors: string[] = [];
  const effectiveTcgDeep = !quickFetchIncremental && quickFetchTcgDeep;
  const tcgSalesWm = quickFetchIncremental ? getTcgSalesWatermarkMs(card) : null;
  const sealedQuickFetch = ebayPlan.resolvedSealed;
  const ebayCaptureOpts = ebayPlan.captureOpts;
  const ebayQuickCap = ebayPlan.ebayQuickRefresh;
  const ebayQuickCaptureMode = ebayPlan.captureMode;
  const ebayUrl = ebayPlan.urls.baseUrl;
  const ebayUrlGradedNo = ebayPlan.urls.gradedNo ?? ebayUrl;
  const ebayUrlGradedYes = ebayPlan.urls.gradedYes ?? ebayUrl;

  const getRawEngineBrowser = rawEngine.getBrowser;
  const getRawEngineCaptureLog = rawEngine.getCaptureLog;
  const getRawEngineScrapeGate = rawEngine.getScrapeGate;

    const browser = getRawEngineBrowser();
    if (!browser?.newTab || !browser?.captureTab || !browser?.closeTab || !browser?.activate) {
      throw new Error('RawEngine browser automation bridge is not available.');
    }
    const captureTab = browser.captureTab;
    const closeTab = browser.closeTab;
    const activate = browser.activate;
    const capLog = getRawEngineCaptureLog();
    const scrapeGate = getRawEngineScrapeGate();

    type CapturePost = {
      rowCount?: number | null;
      tcgFeedSanity?: {
        timedOutWaitingForFeed?: boolean;
        rowsAfterWait?: number;
        viewMoreClickCount?: number;
        modalDetected?: boolean;
      } | null;
    };

    const tcgCaptureOpts = buildTcgCaptureOptions(qfTiming, tcgSalesWm, { profile: captureProfile });

    const waitForVerifiedTabUrl = async (
      tabId: number,
      kind: CaptureSiteKind,
      targetUrl: string,
      logLabel: string
    ): Promise<void> => {
      const deadline = Date.now() + 45_000;
      let lastReason = '';
      while (Date.now() < deadline) {
        const tabs = await browser.listTabs?.();
        const row = tabs?.find((t) => Number(t.id) === tabId);
        const actual = row?.url ?? '';
        if (actual) {
          const v = verifyTabUrlForQuickFetch({ kind, targetUrl, actualUrl: actual });
          if (v.ok) {
            await capLog?.append?.({
              scope: 'quickFetch',
              message: `${logLabel}: tab URL verified`,
              detail: { tabId },
            });
            return;
          }
          lastReason = v.reason;
        }
        throwIfAborted();
        await sleep(qfTiming.tabUrlVerifyPollMs);
      }
      await capLog?.append?.({
        scope: 'quickFetch',
        message: `${logLabel}: URL verify timeout — try Reload on capture control deck`,
        detail: { tabId, lastReason },
      });
      throw new Error(
        `Tab ${tabId} did not load the expected page in time (${lastReason || 'no URL'}).`
      );
    };

    const openRawEngineTabForQuickFetch = async (
      url: string,
      kind: CaptureSiteKind,
      reuse: boolean,
      logLabel: string,
      forceNew: boolean,
      tabOpts?: { navigateUrl?: string; skipVerify?: boolean }
    ): Promise<number> => {
      const openUrl = String(tabOpts?.navigateUrl || url || '').trim() || url;
      const skipVerify = tabOpts?.skipVerify === true;
      const allowReuse = reuse && !forceNew && Boolean(browser.openOrFocusUrl);
      if (allowReuse) {
        await capLog?.append?.({
          scope: 'quickFetch',
          message: `${logLabel}: openOrFocusUrl (reuse)`,
          detail: { url: openUrl.slice(0, 200), verifyAgainst: url.slice(0, 200) },
        });
        const out = await browser.openOrFocusUrl!(openUrl);
        const id = typeof out?.id === 'number' ? out.id : null;
        if (id == null) throw new Error(`openOrFocusUrl did not return a tab for ${openUrl}`);
        if (!skipVerify) await waitForVerifiedTabUrl(id, kind, url, logLabel);
        return id;
      }
      await capLog?.append?.({
        scope: 'quickFetch',
        message: `${logLabel}: newTab`,
        detail: { url: openUrl.slice(0, 200), verifyAgainst: url.slice(0, 200) },
      });
      const opened = await browser.newTab?.(openUrl);
      let id: number | null = null;
      if (opened && typeof opened === 'object' && Number.isFinite(Number(opened.id))) {
        id = Number(opened.id);
      }
      if (id == null) throw new Error(`Failed to open RawEngine tab for: ${openUrl}`);
      if (!skipVerify) await waitForVerifiedTabUrl(id, kind, url, logLabel);
      return id;
    };

    let ebayOrganicEnabled = false;
    try {
      ebayOrganicEnabled = localStorage.getItem(STORAGE_KEY_QUICK_FETCH_EBAY_ORGANIC) === '1';
    } catch {
      ebayOrganicEnabled = false;
    }

    const openEbayTabForQuickFetch = async (
      targetUrl: string,
      reuse: boolean,
      logLabel: string,
      forceNew: boolean
    ): Promise<number> => {
      const organic =
        captureProfile !== 'fast' &&
        ebayOrganicEnabled &&
        typeof browser.ebayOrganicNavigate === 'function';
      if (!organic) {
        return await openRawEngineTabForQuickFetch(
          targetUrl,
          'ebay',
          reuse,
          logLabel,
          forceNew
        );
      }
      const home = 'https://www.ebay.com/';
      const tabId = await openRawEngineTabForQuickFetch(
        targetUrl,
        'ebay',
        reuse,
        logLabel,
        forceNew,
        { navigateUrl: home, skipVerify: true }
      );
      const nav = (await browser.ebayOrganicNavigate!({
        tabId,
        targetUrl,
        allowDirectFallback: true,
      })) as { ok?: boolean; error?: string; fellBack?: boolean };
      await capLog?.append?.({
        scope: 'quickFetch',
        message: `${logLabel}: eBay organic navigate`,
        detail: nav as Record<string, unknown>,
      });
      if (!nav?.ok) {
        await capLog?.append?.({
          scope: 'quickFetch',
          level: 'warn',
          message: `${logLabel}: eBay organic navigate failed`,
          detail: nav as Record<string, unknown>,
        });
        throw new Error(
          nav.error
            ? `eBay organic navigation failed: ${nav.error}`
            : 'eBay organic navigation failed'
        );
      }
      await waitForVerifiedTabUrl(tabId, 'ebay', targetUrl, logLabel);
      return tabId;
    };

    const maybeAwaitDeckReady = async (detail: Record<string, unknown>) => {
      if (!quickFetchRequireDeckReady || !scrapeGate?.waitForAck) return;
      throwIfAborted();
      await capLog?.append?.({
        scope: 'quickFetch',
        message: 'Paused — click Ready on capture control deck',
        detail,
      });
      setQuickFetchPhase(`Waiting for Ready: ${String(detail.phase ?? 'step')}`);
      const ack = scrapeGate.waitForAck(detail);
      if (!signal) {
        await ack;
        return;
      }
      await Promise.race([
        ack,
        new Promise<never>((_, rej) => {
          if (signal.aborted) rej(new DOMException('Quick Fetch cancelled', 'AbortError'));
          signal.addEventListener(
            'abort',
            () => rej(new DOMException('Quick Fetch cancelled', 'AbortError')),
            { once: true }
          );
        }),
      ]);
    };

    const captureTabWithGate = async (
      tabId: number,
      mode: 'default' | 'deep',
      options: Record<string, unknown>,
      gateDetail: Record<string, unknown>
    ) => {
      throwIfAborted();
      await maybeAwaitDeckReady(gateDetail);
      throwIfAborted();
      setQuickFetchPhase(String(gateDetail.phase ?? 'Capturing…'));
      await capLog?.append?.({
        scope: 'quickFetch',
        message: `captureTab start (${mode})`,
        detail: { tabId, phase: gateDetail.phase },
      });
      const result = await captureTab(tabId, mode, options);
      throwIfAborted();
      await capLog?.append?.({
        scope: 'quickFetch',
        message: `captureTab done (${mode})`,
        detail: { tabId, phase: gateDetail.phase },
      });
      return result;
    };

    const needsMarketLoginPreflight =
      quickFetchMarketMode !== 'edge_backup' &&
      !quickFetchIncremental &&
      (ebayQuickCaptureMode === 'deep' || effectiveTcgDeep);
    if (needsMarketLoginPreflight) {
      let skipPreflight = false;
      try {
        skipPreflight = localStorage.getItem(STORAGE_KEY_QUICK_FETCH_SKIP_MARKET_PREFLIGHT) === '1';
      } catch {
        skipPreflight = false;
      }
      if (!skipPreflight) {
        let ebayStatus: string | undefined;
        try {
          const meta = await loadPortfolioMetaFromServer();
          const ext = parseEbaySessionExtensionReport(meta as Record<string, unknown> | null | undefined);
          if (ext) ebayStatus = ext.status;
        } catch {
          /* fall through to embedded */
        }
        if (ebayStatus == null && browser?.ebaySessionStatus) {
          try {
            const es = (await browser.ebaySessionStatus()) as { status?: string };
            if (es && typeof es.status === 'string') ebayStatus = es.status;
          } catch {
            /* ignore */
          }
        }
        const kind: QuickFetchPreflightKind =
          ebayStatus === 'signed-out' ? 'signed-out' : 'generic';
        const choice = await requestMarketPreflight(kind);
        if (choice === 'stop') throw new DOMException('Quick Fetch cancelled', 'AbortError');
      }
    }

    try {
      throwIfAborted();
      let captureStep = 0;
      const ebayStepBudget = ebayPlan.ebayPassCount === 1 ? 2 : 4;
      const totalCaptureSteps =
        1 +
        (tcgUrl ? (effectiveTcgDeep ? 3 : 2) : 0) +
        ebayStepBudget +
        (tcgUrl ? 1 : 0) +
        1;
      const bumpCapture = (label: string) => {
        throwIfAborted();
        captureStep += 1;
        setQuickFetchPhase(label);
        setQuickFetchProgressPct(
          Math.min(100, Math.round((captureStep / totalCaptureSteps) * 100))
        );
      };

      bumpCapture('Quick Fetch: preparing');
      await capLog?.append?.({
        scope: 'quickFetch',
        message: 'Quick Fetch start (sequential phased)',
        detail: {
          cardId: card.id,
          ebayProfile: ebayPlan.profile,
          ebayPassCount: ebayPlan.ebayPassCount,
          resolvedSealed: ebayPlan.resolvedSealed,
          sealedQuickFetch,
          hasTcgUrl: Boolean(tcgUrl),
          quickRefresh: quickFetchIncremental,
          tcgDeep: effectiveTcgDeep,
          reuseTab: quickFetchReuseTab,
          captureSteps: totalCaptureSteps,
        },
      });

      if (quickFetchIncremental) {
        await capLog?.append?.({
          scope: 'quickFetch',
          message: 'Quick refresh watermarks',
          detail: {
            ebaySoldWatermarkMs: getEbaySoldWatermarkMs(card),
            tcgSalesWatermarkMs: getTcgSalesWatermarkMs(card),
          },
        });
      }
      await capLog?.append?.({
        scope: 'quickFetch',
        message: 'eBay capture options (effective)',
        detail: {
          ebayQuickRefresh: Boolean(ebayCaptureOpts.ebayQuickRefresh),
          ebayQuickCaptureMode,
          ebayGradedInUrl: ebayQuickCap,
          ebayPerPageTarget: ebayCaptureOpts.ebayPerPageTarget,
          ebaySoldWatermarkMs: ebayCaptureOpts.ebaySoldWatermarkMs ?? null,
          ebayStopDeepPagingWhenPageMaxSoldAtLteMs:
            ebayCaptureOpts.ebayStopDeepPagingWhenPageMaxSoldAtLteMs ?? null,
          ebayDeepFetchConcurrency: ebayCaptureOpts.ebayDeepFetchConcurrency,
        },
      });

      const runEbayDual = async (): Promise<
        Awaited<ReturnType<typeof runEbayCaptureSinglesDualEmbedded>>
      > => {
        const captureTabTyped = (
          tabId: number,
          mode: 'default' | 'deep',
          opts: Record<string, unknown>,
          gate: Record<string, unknown>
        ) =>
          captureTabWithGate(tabId, mode, opts, gate) as Promise<{
            raw?: EbayExtractPayload;
            rowCount?: number;
            captureStats?: { pagesScanned?: number };
          }>;

        const appendCapLog = capLog?.append
          ? async (entry: { scope?: string; message?: string; detail?: unknown }) => {
              await capLog.append!({
                scope: entry.scope,
                message: entry.message ?? '',
                detail: entry.detail,
              });
            }
          : undefined;

        if (!isLegacyDualGradedProfile(ebayPlan.profile)) {
          return runEbayCaptureSealedEmbedded({
            card,
            ebayPlan,
            ebayUrl,
            quickFetchIncremental,
            qfTiming,
            ebayQuickCaptureMode,
            openEbayTab: openEbayTabForQuickFetch,
            captureTab: captureTabTyped,
            activate,
            closeTab,
            postSleep,
            bumpCapture,
            throwIfAborted,
            appendCapLog,
            quickFetchReuseTab,
            openedTabIds,
          });
        }

        return runEbayCaptureSinglesDualEmbedded({
          card,
          ebayPlan,
          ebayUrl,
          ebayUrlGradedNo,
          ebayUrlGradedYes,
          quickFetchIncremental,
          qfTiming,
          ebayQuickCaptureMode,
          ebayQuickCap,
          ebayCaptureOpts,
          openEbayTab: openEbayTabForQuickFetch,
          captureTab: captureTabTyped,
          activate,
          closeTab,
          postSleep,
          bumpCapture,
          throwIfAborted,
          appendCapLog,
          quickFetchReuseTab,
          openedTabIds,
        });
      };

      const runTcg = async (): Promise<{
        tcgWarning?: string;
        mergedSnap?: TcgplayerSalesSnapshot | null;
      } | null> => {
        if (!tcgUrl) return null;

        if (effectiveTcgDeep) {
          await capLog?.append?.({
            scope: 'quickFetch',
            message: 'Phase 1a: open TCG tab (default then deep, single tab)',
            detail: { tcgUrl },
          });
          const tcgTabSeq = await openRawEngineTabForQuickFetch(
            tcgUrl,
            'tcgplayer',
            quickFetchReuseTab,
            'TCG sequential',
            true
          );
          openedTabIds.push(tcgTabSeq);
          await activate(tcgTabSeq);
          await postSleep(qfTiming.tcgDeepInitialSettleMs);
          throwIfAborted();
          bumpCapture('TCG: capturing default product view');

          await capLog?.append?.({
            scope: 'quickFetch',
            message: 'Phase 1b: capture TCG default (same tab)',
            detail: { tabId: tcgTabSeq },
          });
          await activate(tcgTabSeq);
          await postSleep(qfTiming.tcgDeepAfterDefaultActivateMs);
          throwIfAborted();
          const echoDefault = (await captureTabWithGate(
            tcgTabSeq,
            'default',
            {
              ...tcgCaptureOpts,
              skipUpload: true,
              expectedCapture: { kind: 'tcgplayer', targetUrl: tcgUrl },
            },
            { phase: 'TCG capture default tab', tabId: tcgTabSeq }
          )) as CapturePost;
          await capLog?.append?.({
            scope: 'quickFetch',
            message: 'TCG default-tab capture done',
            detail: {
              tabId: tcgTabSeq,
              rows: echoDefault?.rowCount ?? null,
            },
          });

          bumpCapture('TCG: capturing deep / view-more pass');
          await capLog?.append?.({
            scope: 'quickFetch',
            message: 'Phase 1c: capture TCG deep (same tab)',
            detail: { tabId: tcgTabSeq },
          });
          await activate(tcgTabSeq);
          await postSleep(qfTiming.tcgDeepBetweenCapturesLeadMs);
          await postSleep(qfTiming.tcgDeepBeforeDeepCaptureMs);
          throwIfAborted();
          const echoDeep = (await captureTabWithGate(
            tcgTabSeq,
            'deep',
            {
              ...tcgCaptureOpts,
              skipUpload: true,
              expectedCapture: { kind: 'tcgplayer', targetUrl: tcgUrl },
            },
            { phase: 'TCG capture deep tab', tabId: tcgTabSeq }
          )) as CapturePost;
          await capLog?.append?.({
            scope: 'quickFetch',
            message: 'TCG deep capture done',
            detail: {
              tabId: tcgTabSeq,
              rows: echoDeep?.rowCount ?? null,
            },
          });

          bumpCapture('TCG: merging default + deep results');
          let mergedSnap = mergeTcgDualRawEngineCaptures(
            echoDefault as TcgCaptureEcho,
            echoDeep as TcgCaptureEcho,
            tcgUrl
          );
          if (quickFetchIncremental && card.tcgplayerSalesSnapshot && mergedSnap) {
            const priorRows = card.tcgplayerSalesSnapshot.latestSalesRows?.length ?? 0;
            mergedSnap = mergeIncrementalTcgSnapshots(card.tcgplayerSalesSnapshot, mergedSnap);
            await capLog?.append?.({
              scope: 'quickFetch',
              message: 'TCG incremental merge',
              detail: {
                priorRowCount: priorRows,
                mergedRowCount: mergedSnap.rowCount,
              },
            });
          }

          const sanity = echoDeep?.tcgFeedSanity ?? echoDefault?.tcgFeedSanity;
          const rows =
            mergedSnap != null
              ? mergedSnap.rowCount
              : Math.max(
                  typeof echoDeep?.rowCount === 'number' ? echoDeep.rowCount : 0,
                  typeof echoDefault?.rowCount === 'number' ? echoDefault.rowCount : 0
                );
          let warn: string | undefined;
          if (sanity?.timedOutWaitingForFeed || rows < qfTiming.tcgMinSalesRows) {
            warn =
              `TCGPlayer latest-sales capture looks thin (${rows} rows, sequential default+deep). ` +
              `Modal: ${sanity?.modalDetected ? 'yes' : 'no'}, ` +
              `View-more clicks: ${sanity?.viewMoreClickCount ?? 0}. ` +
              `Try again or open the TCG tab manually once.`;
          }
          return { tcgWarning: warn, mergedSnap };
        }

        await capLog?.append?.({
          scope: 'quickFetch',
          message: 'Phase 1: open TCG tab (single capture)',
          detail: { tcgUrl },
        });
        const tcgTabId = await openRawEngineTabForQuickFetch(
          tcgUrl,
          'tcgplayer',
          quickFetchReuseTab,
          'TCG single',
          false
        );
        openedTabIds.push(tcgTabId);
        await activate(tcgTabId);
        await postSleep(qfTiming.tcgSinglePostActivateMs);
        throwIfAborted();
        bumpCapture('TCG: capturing latest sales');
        await capLog?.append?.({
          scope: 'quickFetch',
          message: 'Phase 1: capture TCG default',
          detail: { tabId: tcgTabId },
        });
        const tcgCap = (await captureTabWithGate(
          tcgTabId,
          'default',
          {
            ...tcgCaptureOpts,
            expectedCapture: { kind: 'tcgplayer', targetUrl: tcgUrl },
          },
          { phase: 'TCG capture single', tabId: tcgTabId }
        )) as CapturePost;
        const sanity = tcgCap?.tcgFeedSanity;
        const rows = typeof tcgCap?.rowCount === 'number' ? tcgCap.rowCount : 0;
        let warn: string | undefined;
        if (sanity?.timedOutWaitingForFeed || rows < qfTiming.tcgMinSalesRows) {
          warn =
            `TCGPlayer latest-sales capture looks thin (${rows} rows). ` +
            `Modal: ${sanity?.modalDetected ? 'yes' : 'no'}, ` +
            `View-more clicks: ${sanity?.viewMoreClickCount ?? 0}. ` +
            `Try again or open the TCG tab manually once.`;
        }
        bumpCapture('TCG: single-tab capture done');
        return { tcgWarning: warn };
      };

      let tcgOutcome: {
        tcgWarning?: string;
        mergedSnap?: TcgplayerSalesSnapshot | null;
      } | null = null;

      if (tcgUrl) {
        await capLog?.append?.({
          scope: 'quickFetch',
          message: 'Phase 1: TCG pipeline (fast — before eBay)',
          detail: { tcgUrl },
        });
        tcgOutcome = await runTcg();
      }

      if (stopAfterTcgPhase) {
        throwIfAborted();
        if (tcgUrl) {
          bumpCapture('Saving TCG snapshot to portfolio…');
          if (tcgOutcome?.mergedSnap) {
            let tcgSnapToSave = tcgOutcome.mergedSnap;
            let tcgArchivedKeysOut: string[] | undefined;
            if (sealedQuickFetch) {
              const ar = archiveTcgSalesPriceOutliers(
                card,
                tcgSnapToSave,
                card.tcgplayerArchivedSaleKeys
              );
              tcgSnapToSave = ar.snapshot;
              tcgArchivedKeysOut = ar.tcgplayerArchivedSaleKeys;
            }
            const tcgPatched = await patchCardOnServer(card.id, {
              tcgplayerSalesSnapshot: tcgSnapToSave,
              ...(sealedQuickFetch && tcgArchivedKeysOut
                ? { tcgplayerArchivedSaleKeys: tcgArchivedKeysOut }
                : {}),
            });
            if (tcgPatched.ok) {
              updatedCard = tcgPatched.card;
            } else {
              patchErrors.push(`TCG snapshot PATCH failed: ${tcgPatched.error ?? 'unknown'}`);
            }
          }
        }
        if (tcgOutcome?.tcgWarning) tcgWarning = tcgOutcome.tcgWarning;
        await capLog?.append?.({
          scope: 'quickFetch',
          message:
            'Quick Fetch hybrid: embedded TCG phase complete — Edge + Tab Capture runs next for eBay only',
          detail: { cardId: card.id },
        });
        return {
          patchErrors,
          ...(tcgWarning ? { tcgWarning } : {}),
          ...(updatedCard ? { updatedCard } : {}),
          captureDiagnostics:
            'Embedded TCG done. Next: Microsoft Edge opens for eBay — capture each tab from the extension.',
        };
      }

      await capLog?.append?.({
        scope: 'quickFetch',
        message: tcgUrl
          ? sealedQuickFetch
            ? 'Phase 2: eBay sealed single deep (after TCG)'
            : 'Phase 2: eBay graded dual (after TCG)'
          : sealedQuickFetch
            ? 'Phase 1: eBay sealed single deep (no TCG URL on card)'
            : 'Phase 1: eBay graded dual (no TCG URL on card)',
        detail: { ebayUrl },
      });
      const ebayOutcome = skipEbayTabCapture
        ? {
            verified: null as Awaited<ReturnType<typeof verifyAndArchiveEbayOutliers>> | null,
            captureDiagnostics: apiLaneDiag ?? 'eBay API lane (no tab capture)',
          }
        : await runEbayDual();

      let tcgPatchOk: boolean | 'skipped' = 'skipped';
      if (tcgUrl) {
        bumpCapture('Saving TCG snapshot to portfolio…');
        if (tcgOutcome?.mergedSnap) {
          let tcgSnapToSave = tcgOutcome.mergedSnap;
          let tcgArchivedKeysOut: string[] | undefined;
          if (sealedQuickFetch) {
            const ar = archiveTcgSalesPriceOutliers(
              card,
              tcgSnapToSave,
              card.tcgplayerArchivedSaleKeys
            );
            tcgSnapToSave = ar.snapshot;
            tcgArchivedKeysOut = ar.tcgplayerArchivedSaleKeys;
          }
          const tcgPatched = await patchCardOnServer(card.id, {
            tcgplayerSalesSnapshot: tcgSnapToSave,
            ...(sealedQuickFetch && tcgArchivedKeysOut
              ? { tcgplayerArchivedSaleKeys: tcgArchivedKeysOut }
              : {}),
          });
          if (tcgPatched.ok) {
            updatedCard = tcgPatched.card;
            tcgPatchOk = true;
          } else {
            tcgPatchOk = false;
            patchErrors.push(`TCG snapshot PATCH failed: ${tcgPatched.error ?? 'unknown'}`);
          }
        }
      }

      let ebayPatchOk = false;
      if (skipEbayTabCapture) {
        bumpCapture('eBay API lane complete (skipped tab capture)');
        updatedCard = (await fetchCardByIdFromServer(card.id)) ?? updatedCard ?? card;
        captureDiagnostics = [apiLaneDiag, ebayOutcome.captureDiagnostics].filter(Boolean).join(' · ');
        ebayPatchOk = true;
      } else if (ebayOutcome.verified) {
        bumpCapture('Saving eBay snapshot to portfolio…');
        const patchedEbay = await patchCardOnServer(card.id, {
          ebayExtensionSnapshot: ebayOutcome.verified.snapshot,
          ebayVerificationArchive: ebayOutcome.verified.ebayVerificationArchive,
          ebayArchivedSaleKeys: ebayOutcome.verified.ebayArchivedSaleKeys,
        });
        if (patchedEbay.ok) {
          updatedCard = patchedEbay.card;
          ebayPatchOk = true;
        } else {
          patchErrors.push(`eBay snapshot PATCH failed: ${patchedEbay.error ?? 'unknown'}`);
        }
        captureDiagnostics = ebayOutcome.captureDiagnostics;
        const dual = ebayOutcome.verified.snapshot.ebayDualCaptureStats;
        const plugin = loadEbayCapturePluginSettings();
        setQuickEbayCaptureDiagnostics?.({
          pagesScanned: (dual?.gradedNoPages ?? 0) + (dual?.gradedYesPages ?? 0),
          ebayDeepFetchConcurrency: ebayCaptureOpts.ebayDeepFetchConcurrency as number | undefined,
          parallelDual: plugin.captureEbayDualParallel,
        });

        const canonUp = await postMergedEbayCaptureToServer(ebayOutcome.verified.snapshot);
        if (!canonUp.ok && canonUp.error) {
          patchErrors.push(`Canonical eBay capture DB sync: ${canonUp.error}`);
        } else if (canonUp.ok) {
          const touched = canonUp.portfolioMerge?.touched;
          if (typeof touched === 'number' && touched === 0) {
            await capLog?.append?.({
              scope: 'quickFetch',
              level: 'info',
              message: 'Canonical eBay capture: no portfolio rows matched merge (expected if no card shares this eBay URL)',
              detail: { touched },
            });
          }
        }

        await capLog?.append?.({
          scope: 'quickFetch',
          message: 'Quick Fetch PATCH summary',
          detail: {
            tcgPatch: tcgPatchOk,
            ebayPatch: ebayPatchOk,
            ebayMergedListings: ebayOutcome.verified.snapshot.rowCount,
            ebayDualCaptureStats: ebayOutcome.verified.snapshot.ebayDualCaptureStats,
          },
        });
      }

      if (tcgOutcome?.tcgWarning) tcgWarning = tcgOutcome.tcgWarning;
    } finally {
      for (let i = openedTabIds.length - 1; i >= 0; i -= 1) {
        const id = openedTabIds[i];
        try {
          await closeTab(id);
        } catch {
          // keep cleanup best-effort so chart refresh still runs
        }
      }
    }
    const out: {
      tcgWarning?: string;
      captureDiagnostics?: string;
      updatedCard?: Card | null;
      patchErrors: string[];
    } = { patchErrors };
    if (tcgWarning) out.tcgWarning = tcgWarning;
    if (captureDiagnostics) out.captureDiagnostics = captureDiagnostics;
    if (updatedCard) out.updatedCard = updatedCard;
    return out;
}
