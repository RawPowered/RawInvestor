import { openMicrosoftEdgeUrls } from '../apiBase';
import type { Card, TcgplayerSalesSnapshot } from '../types';
import { archiveTcgSalesPriceOutliers } from '../utils/ebayQuickFetch';
import { fetchCardByIdFromServer, patchCardOnServer } from '../serverSync';
import type { QuickFetchTiming } from '../utils/quickFetchTiming';
import { edgeEbayPollTimeoutMs, type EbayQuickFetchPlan } from './fetch/ebayQuickFetchPlan';
import { isLegacyDualGradedProfile } from './fetch/resolveSealedQuickFetch';
import { runEdgeEbaySealed } from './fetch/runEdgeEbaySealed';
import { runEdgeEbaySinglesDual } from './fetch/runEdgeEbaySinglesDual';

const POLL_MS = 2000;
const STEP_TIMEOUT_MS = 180_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException('Quick Fetch cancelled', 'AbortError');
};

async function pollUntilCardPredicate(
  cardId: string,
  pred: (c: Card) => boolean,
  signal: AbortSignal | undefined,
  timeoutMs: number
): Promise<Card> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    throwIfAborted(signal);
    const c = await fetchCardByIdFromServer(cardId);
    if (c && pred(c)) return c;
    await sleep(POLL_MS);
    throwIfAborted(signal);
  }
  throw new Error(
    'Timed out waiting for the Edge extension capture to merge into this card. Use the puzzle icon → capture the active tab in Edge, then try again.'
  );
}

export type EdgeGuidedQuickFetchDeps = {
  card: Card;
  signal?: AbortSignal;
  /** eBay routing plan (sealed-single vs singles-dual). */
  ebayPlan: EbayQuickFetchPlan;
  tcgUrl: string | null;
  effectiveTcgDeep: boolean;
  qfTiming: QuickFetchTiming;
  setPhase: (label: string) => void;
  setProgressPct: (n: number) => void;
  appendCapLog?: (entry: {
    level?: string;
    scope?: string;
    message?: string;
    detail?: unknown;
  }) => Promise<unknown>;
  skipTcgExtensionPhase?: boolean;
  skipEbayExtensionPhase?: boolean;
};

/**
 * Full Quick Fetch without embedded RawEngine capture: opens Microsoft Edge with
 * marketplace URLs so the user runs MV3 Tab Capture while signed into Edge.
 */
export async function runEdgeGuidedFullQuickFetch(
  deps: EdgeGuidedQuickFetchDeps
): Promise<{
  tcgWarning?: string;
  captureDiagnostics?: string;
  updatedCard?: Card | null;
  patchErrors: string[];
}> {
  const {
    card,
    signal,
    ebayPlan,
    tcgUrl,
    effectiveTcgDeep,
    qfTiming,
    setPhase,
    setProgressPct,
    appendCapLog,
    skipTcgExtensionPhase = false,
    skipEbayExtensionPhase = false,
  } = deps;

  const patchErrors: string[] = [];
  let tcgWarning: string | undefined;
  let captureDiagnostics: string | undefined;
  let updatedCard: Card | null = null;

  const log = async (message: string, detail?: Record<string, unknown>) => {
    try {
      await appendCapLog?.({ scope: 'quickFetch', message, detail });
    } catch {
      /* ignore */
    }
  };

  await log('Quick Fetch Edge-guided start', {
    cardId: card.id,
    ebayProfile: ebayPlan.profile,
    ebayPassCount: ebayPlan.ebayPassCount,
    resolvedSealed: ebayPlan.resolvedSealed,
    extensionCaptureMode: ebayPlan.extensionCaptureMode,
    hasTcgUrl: Boolean(tcgUrl),
    tcgDeep: effectiveTcgDeep,
    skipTcgExtensionPhase,
  });

  let ebayBaselineAt = card.ebayExtensionSnapshot?.capturedAt ?? 0;
  let tcgBaselineAt = card.tcgplayerSalesSnapshot?.capturedAt ?? 0;
  const tcgBaselineRows = card.tcgplayerSalesSnapshot?.rowCount ?? 0;

  const tcgEdgeSteps = tcgUrl && !skipTcgExtensionPhase ? 1 : 0;
  /** Dual graded eBay is one logical step; progress inside poll is driven by pass buffers. */
  const ebayEdgeSteps = skipEbayExtensionPhase ? 0 : 1;
  const steps = tcgEdgeSteps + ebayEdgeSteps + 1;
  let step = 0;
  const bump = (label: string, options?: { advanceStep?: boolean }) => {
    throwIfAborted(signal);
    setPhase(label);
    if (options?.advanceStep === false) return;
    step = Math.min(steps - 1, step + 1);
    setProgressPct(Math.min(99, Math.round((step / steps) * 100)));
  };
  const ebayProgressStart = tcgEdgeSteps > 0 ? 35 : 8;
  const setDualCaptureProgress = (noPassDone: number, yesPassDone: number) => {
    if (skipEbayExtensionPhase) return;
    const frac = (noPassDone > 0 ? 0.5 : 0) + (yesPassDone > 0 ? 0.5 : 0);
    setProgressPct(Math.min(99, Math.round(ebayProgressStart + (94 - ebayProgressStart) * frac)));
  };

  const edgePoll = (cardId: string, pred: (c: Card) => boolean) =>
    pollUntilCardPredicate(cardId, pred, signal, STEP_TIMEOUT_MS);

  if (tcgUrl && !skipTcgExtensionPhase) {
    bump(
      effectiveTcgDeep
        ? 'Edge: TCG — set extension popup to Deep if needed, then capture'
        : 'Edge: TCG — capture product tab in Edge (extension toolbar)'
    );
    const r1 = await openMicrosoftEdgeUrls([tcgUrl]);
    if (!r1.ok) throw new Error(r1.error || 'Could not open Microsoft Edge.');
    await log('Edge opened TCG URL', { url: tcgUrl.slice(0, 220) });
    const cTcg = await edgePoll(
      card.id,
      (c) =>
        (c.tcgplayerSalesSnapshot?.capturedAt ?? 0) > tcgBaselineAt ||
        (c.tcgplayerSalesSnapshot?.rowCount ?? 0) > tcgBaselineRows
    );
    tcgBaselineAt = cTcg.tcgplayerSalesSnapshot?.capturedAt ?? tcgBaselineAt;
    const rows = cTcg.tcgplayerSalesSnapshot?.rowCount ?? 0;
    if (rows < qfTiming.tcgMinSalesRows) {
      tcgWarning = `TCGPlayer capture from Edge looks thin (${rows} rows). Scroll / expand sales in Edge, capture again, or retry.`;
    }
    updatedCard = cTcg;
  }

  if (skipEbayExtensionPhase) {
    bump('eBay API satisfied — finishing (no Edge capture needed)');
    const apiRows = card.ebaySales?.count ?? 0;
    captureDiagnostics = apiRows
      ? `eBay API: ${apiRows} sold rows (skipped Edge tab capture)`
      : 'eBay API lane active — no new sold rows; extension capture skipped';
    await log('Edge eBay skipped (API incremental lane)', { apiRows, ebayProfile: ebayPlan.profile });
  } else if (!isLegacyDualGradedProfile(ebayPlan.profile)) {
    const ebayPollMs = edgeEbayPollTimeoutMs(ebayPlan);
    const sealedRes = await runEdgeEbaySealed({
      card,
      signal,
      ebayPlan,
      ebayBaselineAt,
      bump,
      throwIfAborted: () => throwIfAborted(signal),
      pollTimeoutMs: ebayPollMs,
      log,
    });
    patchErrors.push(...sealedRes.patchErrors);
    captureDiagnostics = sealedRes.captureDiagnostics;
    if (sealedRes.updatedCard) updatedCard = sealedRes.updatedCard;
    ebayBaselineAt = sealedRes.ebayBaselineAt;
  } else {
    bump('Edge: eBay dual graded capture (No + Yes tabs)…', { advanceStep: false });
    const dualRes = await runEdgeEbaySinglesDual({
      card,
      signal,
      ebayPlan,
      ebayBaselineAt,
      bump,
      setDualCaptureProgress,
      throwIfAborted: () => throwIfAborted(signal),
      pollTimeoutMs: edgeEbayPollTimeoutMs(ebayPlan),
      log,
    });
    patchErrors.push(...dualRes.patchErrors);
    captureDiagnostics = dualRes.captureDiagnostics;
    if (dualRes.updatedCard) updatedCard = dualRes.updatedCard;
    ebayBaselineAt = dualRes.ebayBaselineAt;
  }

  if (tcgUrl && updatedCard?.tcgplayerSalesSnapshot) {
    bump('Saving TCG snapshot (sealed outlier pass)…');
    let tcgSnapToSave: TcgplayerSalesSnapshot = updatedCard.tcgplayerSalesSnapshot;
    let tcgArchivedKeysOut: string[] | undefined;
    if (ebayPlan.resolvedSealed) {
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
      ...(ebayPlan.resolvedSealed && tcgArchivedKeysOut
        ? { tcgplayerArchivedSaleKeys: tcgArchivedKeysOut }
        : {}),
    });
    if (tcgPatched.ok) updatedCard = tcgPatched.card;
    else patchErrors.push(`TCG snapshot PATCH failed: ${tcgPatched.error ?? 'unknown'}`);
  }

  bump('Edge-guided Quick Fetch done', { advanceStep: true });
  setProgressPct(100);
  await log('Quick Fetch Edge-guided complete', {
    patchErrors: patchErrors.length,
    ebayProfile: ebayPlan.profile,
    ebayPassCount: ebayPlan.ebayPassCount,
  });

  return { tcgWarning, captureDiagnostics, updatedCard, patchErrors };
}
