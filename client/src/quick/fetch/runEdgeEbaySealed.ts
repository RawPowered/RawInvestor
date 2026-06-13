import { openMicrosoftEdgeUrls } from '../../apiBase';
import type { Card } from '../../types';
import { verifyAndArchiveEbayOutliers } from '../../utils/ebayQuickFetch';
import { patchCardOnServer } from '../../serverSync';
import { postMergedEbayCaptureToServer } from '../../services/extensionCapture';
import type { EbayQuickFetchPlan } from './ebayQuickFetchPlan';
import {
  ebayBaselineFromCard,
  pollUntilEbayExtensionCapture,
} from './pollExtensionCapture';

export type EdgeEbaySealedDeps = {
  card: Card;
  signal?: AbortSignal;
  ebayPlan: EbayQuickFetchPlan;
  ebayBaselineAt: number;
  bump: (label: string) => void;
  throwIfAborted: () => void;
  pollTimeoutMs: number;
  log: (message: string, detail?: Record<string, unknown>) => Promise<void>;
};

export type EdgeEbaySealedResult = {
  updatedCard: Card | null;
  patchErrors: string[];
  captureDiagnostics: string;
  ebayBaselineAt: number;
};

export async function runEdgeEbaySealed(deps: EdgeEbaySealedDeps): Promise<EdgeEbaySealedResult> {
  const {
    card,
    signal,
    ebayPlan,
    ebayBaselineAt: startBaseline,
    bump,
    throwIfAborted,
    pollTimeoutMs,
    log,
  } = deps;

  const patchErrors: string[] = [];
  let updatedCard: Card | null = null;
  let ebayBaselineAt = startBaseline;
  const extHint =
    ebayPlan.extensionCaptureMode === 'default'
      ? 'extension Quick (~100 sales)'
      : 'extension More history';

  const baseline = ebayBaselineFromCard(card, startBaseline);

  const tabLabel = ebayPlan.resolvedSealed ? 'sealed sold search' : 'sold search';
  bump(`Edge: eBay ${tabLabel} — one tab (${extHint})`);
  await log(`Edge eBay ${tabLabel} — user steps`, {
    steps: [
      `Set extension to ${extHint}`,
      'Capture the active eBay sold tab (puzzle icon)',
      'App will continue automatically when merge is detected',
    ],
    ebayProfile: ebayPlan.profile,
    extensionCaptureMode: ebayPlan.extensionCaptureMode,
  });

  const r2 = await openMicrosoftEdgeUrls([ebayPlan.urls.baseUrl]);
  if (!r2.ok) throw new Error(r2.error || 'Could not open Microsoft Edge.');
  await log(`Edge opened eBay ${tabLabel} URL`, {
    url: ebayPlan.urls.baseUrl.slice(0, 220),
    ebayProfile: ebayPlan.profile,
    ebayPassCount: ebayPlan.ebayPassCount,
    extensionCaptureMode: ebayPlan.extensionCaptureMode,
    pollBaseline: baseline,
  });
  throwIfAborted();

  bump('Waiting for Edge extension merge…');
  const cEb = await pollUntilEbayExtensionCapture(card.id, baseline, {
    signal,
    timeoutMs: pollTimeoutMs,
    onWaiting: () => bump('Waiting for Edge extension merge…'),
    onDetected: () => bump('eBay capture detected — saving…'),
    onPollTick: async (detail) => {
      await log('Edge eBay poll (waiting for extension)', detail);
    },
  });

  ebayBaselineAt = cEb.ebayExtensionSnapshot?.capturedAt ?? ebayBaselineAt;
  const snap = cEb.ebayExtensionSnapshot;
  if (!snap) throw new Error('eBay extension snapshot missing after capture.');
  const verified = await verifyAndArchiveEbayOutliers(
    card,
    snap,
    card.ebayVerificationArchive,
    card.ebayArchivedSaleKeys
  );
  const patched = await patchCardOnServer(card.id, {
    ebayExtensionSnapshot: verified.snapshot,
    ebayVerificationArchive: verified.ebayVerificationArchive,
    ebayArchivedSaleKeys: verified.ebayArchivedSaleKeys,
  });
  if (patched.ok) updatedCard = patched.card;
  else patchErrors.push(`eBay snapshot PATCH failed: ${patched.error ?? 'unknown'}`);
  const ebRowsS = verified.snapshot.rowCount ?? 0;
  const captureDiagnostics = `eBay (Edge): ${ebRowsS} rows (${tabLabel} · ${extHint})`;

  const canonUp = await postMergedEbayCaptureToServer(verified.snapshot);
  if (!canonUp.ok && canonUp.error) patchErrors.push(`Canonical eBay capture DB sync: ${canonUp.error}`);

  return { updatedCard, patchErrors, captureDiagnostics, ebayBaselineAt };
}
