import { openMicrosoftEdgeUrls } from '../../../apiBase';
import type { Card } from '../../../types';
import {
  mergeDualGradedEbayCaptures,
  verifyAndArchiveEbayOutliers,
  type EbayExtractPayload,
} from '../../../utils/ebayQuickFetch';
import { patchCardOnServer } from '../../../serverSync';
import { postMergedEbayCaptureToServer } from '../../../services/extensionCapture';
import type { EbayQuickFetchPlan } from '../../../quick/fetch/ebayQuickFetchPlan';
import {
  DualEbayPartialBuffersError,
  ebayBaselineFromCard,
  pollUntilDualEbayPassBuffers,
  pollUntilEbayExtensionCapture,
  type QuickFetchPollPass,
} from '../../../quick/fetch/pollExtensionCapture';
import { publishQuickFetchSession } from '../../../quick/fetch/quickFetchSession';

function snapshotToEbayPayload(
  snap: NonNullable<Card['ebayExtensionSnapshot']>,
  lane: 'no' | 'yes'
): EbayExtractPayload {
  const dual = snap.ebayDualCaptureStats;
  const captureStats =
    lane === 'yes'
      ? {
          pagesScanned: dual?.gradedYesPages ?? 1,
          gradedFacetApplied: dual?.gradedFacetAppliedYes === true,
        }
      : {
          pagesScanned: dual?.gradedNoPages ?? 1,
          gradedFacetApplied: dual?.gradedFacetAppliedNo === true,
        };
  return {
    data: {
      listings: snap.listings ?? [],
      excludedListings: snap.rejectedListings ?? [],
      query: snap.query,
      captureMode: snap.captureMode,
      hasMore: snap.hasMore,
      captureStats,
    },
  } as EbayExtractPayload;
}

async function finalizeDualMerge(
  card: Card,
  snapNo: NonNullable<Card['ebayExtensionSnapshot']>,
  snapYes: NonNullable<Card['ebayExtensionSnapshot']>,
  ebayPlan: EbayQuickFetchPlan
): Promise<{
  updatedCard: Card | null;
  patchErrors: string[];
  captureDiagnostics: string;
}> {
  const patchErrors: string[] = [];
  const payNo = snapshotToEbayPayload(snapNo, 'no');
  const payYes = snapshotToEbayPayload(snapYes, 'yes');
  const mergedSnap = mergeDualGradedEbayCaptures(payNo, payYes, ebayPlan.urls.baseUrl);
  const verified = await verifyAndArchiveEbayOutliers(
    card,
    mergedSnap,
    card.ebayVerificationArchive,
    card.ebayArchivedSaleKeys
  );
  const patched = await patchCardOnServer(card.id, {
    ebayExtensionSnapshot: verified.snapshot,
    ebayVerificationArchive: verified.ebayVerificationArchive,
    ebayArchivedSaleKeys: verified.ebayArchivedSaleKeys,
    ebayExtensionSnapshotNo: null,
    ebayExtensionSnapshotYes: null,
  });
  let updatedCard: Card | null = null;
  if (patched.ok) updatedCard = patched.card;
  else patchErrors.push(`eBay snapshot PATCH failed: ${patched.error ?? 'unknown'}`);

  const dual = verified.snapshot.ebayDualCaptureStats;
  const captureDiagnostics = [
    `eBay (Edge): ${verified.snapshot.rowCount ?? 0} merged rows (dual-tab · extension)`,
    dual
      ? `passes: No ${dual.gradedNoPages}pg/${dual.gradedNoRows} · Yes ${dual.gradedYesPages}pg/${dual.gradedYesRows}`
      : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const canonUp = await postMergedEbayCaptureToServer(verified.snapshot);
  if (!canonUp.ok && canonUp.error) patchErrors.push(`Canonical eBay capture DB sync: ${canonUp.error}`);

  return { updatedCard, patchErrors, captureDiagnostics };
}

function pickPassSnapshot(
  card: Card,
  pass: QuickFetchPollPass
): NonNullable<Card['ebayExtensionSnapshot']> | null {
  const buffered =
    pass === 'ebay-graded-no' ? card.ebayExtensionSnapshotNo : card.ebayExtensionSnapshotYes;
  if (buffered?.listings?.length) return buffered;
  const live = card.ebayExtensionSnapshot;
  if (live?.listings?.length && live.capturePass === pass) return live;
  return null;
}

function resolvePassSnapshots(card: Card): {
  snapNo: NonNullable<Card['ebayExtensionSnapshot']>;
  snapYes: NonNullable<Card['ebayExtensionSnapshot']>;
} | null {
  const snapNo = pickPassSnapshot(card, 'ebay-graded-no');
  const snapYes = pickPassSnapshot(card, 'ebay-graded-yes');
  if (snapNo && snapYes) return { snapNo, snapYes };
  return null;
}

async function pollForSingleDualPass(
  card: Card,
  pass: QuickFetchPollPass,
  _gradedUrl: string,
  ebayPlan: EbayQuickFetchPlan,
  deps: Pick<
    EdgeDualPassPollDeps,
    'signal' | 'pollTimeoutMs' | 'bump' | 'throwIfAborted' | 'log' | 'setDualCaptureProgress'
  >
): Promise<Card> {
  const { signal, pollTimeoutMs, bump, throwIfAborted, log, setDualCaptureProgress } = deps;
  await publishQuickFetchSession({
    active: true,
    expectedCaptureMode: ebayPlan.extensionCaptureMode,
    profile: ebayPlan.profile,
    pass,
    cardId: card.id,
    gradedNoUrl: ebayPlan.urls.gradedNo ?? undefined,
    gradedYesUrl: ebayPlan.urls.gradedYes ?? undefined,
    updatedAt: Date.now(),
  });
  throwIfAborted();
  const baseline = ebayBaselineFromCard(card, card.ebayExtensionSnapshot?.capturedAt ?? 0);
  bump(
    pass === 'ebay-graded-no'
      ? 'Waiting for Edge — Graded No merge…'
      : 'Waiting for Edge — Graded Yes merge…'
  );
  return pollUntilEbayExtensionCapture(card.id, baseline, {
    signal,
    timeoutMs: pollTimeoutMs,
    expectedPass: pass,
    onWaiting: () =>
      bump(
        pass === 'ebay-graded-no'
          ? 'Waiting for Edge — Graded No merge…'
          : 'Waiting for Edge — Graded Yes merge…'
      ),
    onDetected: () => {
      setDualCaptureProgress?.(
        pass === 'ebay-graded-no' ? 1 : 0,
        pass === 'ebay-graded-yes' ? 1 : 0
      );
      bump(
        pass === 'ebay-graded-no'
          ? 'Graded No detected — capture Graded Yes tab next'
          : 'Graded Yes detected — merging…'
      );
    },
    onPollTick: async (detail) => {
      await log(`Edge eBay poll (${pass === 'ebay-graded-no' ? 'graded no' : 'graded yes'})`, {
        pluginId: 'edge-dual-pass',
        ...detail,
      });
    },
  });
}

export type EdgeDualPassPollDeps = {
  card: Card;
  signal?: AbortSignal;
  ebayPlan: EbayQuickFetchPlan;
  ebayBaselineAt: number;
  /** Phase label; set advanceStep true only for major milestones. */
  bump: (label: string, options?: { advanceStep?: boolean }) => void;
  setDualCaptureProgress?: (noPassRows: number, yesPassRows: number) => void;
  throwIfAborted: () => void;
  pollTimeoutMs: number;
  log: (message: string, detail?: Record<string, unknown>) => Promise<void>;
  openBothTabsFirst?: boolean;
};

export type EdgeDualPassPollResult = {
  updatedCard: Card | null;
  patchErrors: string[];
  captureDiagnostics: string;
  ebayBaselineAt: number;
  gradedNoDone: boolean;
  gradedYesDone: boolean;
};

async function clearDualPassBuffers(cardId: string): Promise<void> {
  await patchCardOnServer(cardId, {
    ebayExtensionSnapshotNo: null,
    ebayExtensionSnapshotYes: null,
  });
}

export async function runEdgeDualPassPoll(deps: EdgeDualPassPollDeps): Promise<EdgeDualPassPollResult> {
  const {
    card,
    signal,
    ebayPlan,
    ebayBaselineAt: startBaseline,
    bump,
    setDualCaptureProgress,
    throwIfAborted,
    pollTimeoutMs,
    log,
    openBothTabsFirst = true,
  } = deps;

  const patchErrors: string[] = [];
  let updatedCard: Card | null = null;
  let ebayBaselineAt = startBaseline;
  let captureDiagnostics = '';
  let gradedNoDone = false;
  let gradedYesDone = false;

  const pollDeps = {
    signal,
    pollTimeoutMs,
    bump,
    throwIfAborted,
    log,
    setDualCaptureProgress,
  };

  try {
    if (ebayPlan.profile === 'sealed-single') {
      throw new Error(
        'Edge dual graded pass is for singles only; sealed products use a single ungraded sold URL.'
      );
    }
    const gradedNo = ebayPlan.urls.gradedNo;
    const gradedYes = ebayPlan.urls.gradedYes;
    if (!gradedNo || !gradedYes) {
      throw new Error(
        'Singles dual eBay capture requires Graded=No and Graded=Yes URLs on the plan.'
      );
    }

    if (openBothTabsFirst) {
      bump('Edge: open Graded No + Yes tabs — use Dual graded in extension (or capture each tab)', {
        advanceStep: true,
      });
      const r = await openMicrosoftEdgeUrls([gradedNo, gradedYes]);
      if (!r.ok) throw new Error(r.error || 'Could not open Microsoft Edge.');
      await log('Edge opened both graded URLs', { pluginId: 'edge-dual-pass', passCount: 2 });
    }

    await publishQuickFetchSession({
      active: true,
      expectedCaptureMode: ebayPlan.extensionCaptureMode,
      profile: ebayPlan.profile,
      pass: 'ebay-graded-no',
      cardId: card.id,
      gradedNoUrl: gradedNo,
      gradedYesUrl: gradedYes,
      updatedAt: Date.now(),
    });
    throwIfAborted();

    bump('Edge: capture Graded No + Yes (Dual graded button captures both tabs)');
    setDualCaptureProgress?.(0, 0);

    let dualCard: Card | null = null;
    try {
      dualCard = await pollUntilDualEbayPassBuffers(card.id, {
        signal,
        timeoutMs: pollTimeoutMs,
        onWaiting: () => bump('Waiting for Edge — Graded No + Yes merges…'),
        onDetected: () => {
          setDualCaptureProgress?.(1, 1);
          bump('Both graded passes detected — merging…', { advanceStep: true });
        },
        onBufferProgress: ({ noRows, yesRows }) => setDualCaptureProgress?.(noRows > 0 ? 1 : 0, yesRows > 0 ? 1 : 0),
        onStalePoll: ({ noRows, yesRows }) => {
          bump(
            noRows > 0 && yesRows > 0
              ? 'Dual graded may have finished — checking pass buffers…'
              : `Captured ${noRows > 0 ? 'Graded No' : yesRows > 0 ? 'Graded Yes' : 'partial'} — waiting for other pass…`
          );
        },
        onPollTick: async (detail) => {
          await log('Edge eBay poll (dual buffers)', {
            pluginId: 'edge-dual-pass',
            ...detail,
          });
        },
      });
      gradedNoDone = true;
      gradedYesDone = true;
    } catch (dualErr) {
      if (dualErr instanceof DualEbayPartialBuffersError) {
        const missingPass = dualErr.missingPass;
        const havePass = missingPass === 'ebay-graded-no' ? 'ebay-graded-yes' : 'ebay-graded-no';
        await log('Edge dual-buffer partial — waiting for missing pass', {
          pluginId: 'edge-dual-pass',
          missingPass,
        });
        const partialCard = dualErr.card;
        const existingSnap = pickPassSnapshot(partialCard, havePass);
        if (!existingSnap) {
          throw new Error(
            `Partial dual capture lost the ${havePass === 'ebay-graded-yes' ? 'Graded Yes' : 'Graded No'} snapshot. Capture both tabs again.`
          );
        }
        if (havePass === 'ebay-graded-yes') gradedYesDone = true;
        else gradedNoDone = true;

        bump(
          missingPass === 'ebay-graded-no'
            ? 'Graded Yes captured — now capture Graded No tab in Edge'
            : 'Graded No captured — now capture Graded Yes tab in Edge'
        );
        const afterMissing = await pollForSingleDualPass(
          card,
          missingPass,
          missingPass === 'ebay-graded-no' ? gradedNo : gradedYes,
          ebayPlan,
          pollDeps
        );
        if (missingPass === 'ebay-graded-no') gradedNoDone = true;
        else gradedYesDone = true;

        const snapNo =
          missingPass === 'ebay-graded-no'
            ? pickPassSnapshot(afterMissing, 'ebay-graded-no')!
            : existingSnap;
        const snapYes =
          missingPass === 'ebay-graded-yes'
            ? pickPassSnapshot(afterMissing, 'ebay-graded-yes')!
            : existingSnap;
        if (!snapNo || !snapYes) {
          throw new Error('Could not resolve both graded pass snapshots after partial capture.');
        }
        const fin = await finalizeDualMerge(card, snapNo, snapYes, ebayPlan);
        updatedCard = fin.updatedCard;
        patchErrors.push(...fin.patchErrors);
        captureDiagnostics = fin.captureDiagnostics;
        await clearDualPassBuffers(card.id);
        return {
          updatedCard,
          patchErrors,
          captureDiagnostics,
          ebayBaselineAt,
          gradedNoDone,
          gradedYesDone,
        };
      } else {
        await log('Edge dual-buffer wait incomplete — sequential poll fallback', {
          pluginId: 'edge-dual-pass',
          error: dualErr instanceof Error ? dualErr.message : String(dualErr),
        });

        bump('Edge: eBay Graded No — capture in Edge (false BOT_CHECK? use “No challenge here” in extension)');
        if (!openBothTabsFirst) {
          const rNo = await openMicrosoftEdgeUrls([gradedNo]);
          if (!rNo.ok) throw new Error(rNo.error || 'Could not open Microsoft Edge.');
        }
        const afterNo = await pollForSingleDualPass(card, 'ebay-graded-no', gradedNo, ebayPlan, pollDeps);
        gradedNoDone = true;
        ebayBaselineAt = afterNo.ebayExtensionSnapshot?.capturedAt ?? ebayBaselineAt;
        const snapNoFrozen = afterNo.ebayExtensionSnapshotNo ?? afterNo.ebayExtensionSnapshot;
        if (!snapNoFrozen) throw new Error('eBay extension snapshot missing after Graded No capture.');

        bump('Edge: eBay Graded Yes — capture in Edge, then merge');
        if (!openBothTabsFirst) {
          const rYes = await openMicrosoftEdgeUrls([gradedYes]);
          if (!rYes.ok) throw new Error(rYes.error || 'Could not open Microsoft Edge.');
        } else {
          await log('Edge graded-yes tab already open', { url: gradedYes.slice(0, 120) });
        }
        const afterYes = await pollForSingleDualPass(card, 'ebay-graded-yes', gradedYes, ebayPlan, pollDeps);
        gradedYesDone = true;

        const snapNo = snapNoFrozen;
        const snapYes = pickPassSnapshot(afterYes, 'ebay-graded-yes');
        if (!snapYes) throw new Error('eBay extension snapshot missing after Graded Yes capture.');

        const fin = await finalizeDualMerge(card, snapNo, snapYes, ebayPlan);
        updatedCard = fin.updatedCard;
        patchErrors.push(...fin.patchErrors);
        captureDiagnostics = fin.captureDiagnostics;
        await clearDualPassBuffers(card.id);
        return {
          updatedCard,
          patchErrors,
          captureDiagnostics,
          ebayBaselineAt,
          gradedNoDone,
          gradedYesDone,
        };
      }
    }

    if (!dualCard) {
      throw new Error('Dual graded eBay captures did not land on the card.');
    }

    const resolved = resolvePassSnapshots(dualCard);
    if (!resolved) {
      throw new Error('Graded No/Yes pass buffers missing after dual capture.');
    }

    const fin = await finalizeDualMerge(card, resolved.snapNo, resolved.snapYes, ebayPlan);
    updatedCard = fin.updatedCard;
    patchErrors.push(...fin.patchErrors);
    captureDiagnostics = fin.captureDiagnostics;

    await clearDualPassBuffers(card.id);

    return {
      updatedCard,
      patchErrors,
      captureDiagnostics,
      ebayBaselineAt,
      gradedNoDone,
      gradedYesDone,
    };
  } finally {
    await publishQuickFetchSession(null);
  }
}
