import type { Card } from '../../types';
import { fetchCardByIdFromServer } from '../../serverSync';
import { ebayGradedLaneFromUrl } from './ebayGradedLane';

const POLL_MS = 2000;
const LOG_EVERY_MS = 10_000;
const STALE_POLL_MS = 30_000;
/** One pass landed but not the other — switch to sequential wait instead of spinning. */
const PARTIAL_BUFFER_FALLBACK_MS = 45_000;

export class DualEbayPartialBuffersError extends Error {
  readonly card: Card;
  readonly missingPass: QuickFetchPollPass;

  constructor(card: Card, missingPass: QuickFetchPollPass) {
    super(
      missingPass === 'ebay-graded-no'
        ? 'Graded No capture missing — capture the Graded=No tab in Edge (or run Dual graded again).'
        : 'Graded Yes capture missing — capture the Graded=Yes tab in Edge (or run Dual graded again).'
    );
    this.name = 'DualEbayPartialBuffersError';
    this.card = card;
    this.missingPass = missingPass;
  }
}

export type EbayExtensionBaseline = {
  capturedAt: number;
  rowCount: number;
  listingCount: number;
  sourceUrl?: string;
  capturePass?: string;
};

export type QuickFetchPollPass = 'ebay-graded-no' | 'ebay-graded-yes';

export const ebayBaselineFromCard = (
  card: Pick<Card, 'ebayExtensionSnapshot'>,
  capturedAtFloor = 0
): EbayExtensionBaseline => {
  const snap = card.ebayExtensionSnapshot;
  return {
    capturedAt: Math.max(capturedAtFloor, snap?.capturedAt ?? 0),
    rowCount: snap?.rowCount ?? snap?.listings?.length ?? 0,
    listingCount: snap?.listings?.length ?? 0,
    sourceUrl: snap?.sourceUrl,
    capturePass: snap?.capturePass,
  };
};

const baselineFromSnap = (
  snap: Card['ebayExtensionSnapshot'] | null | undefined
): EbayExtensionBaseline => ({
  capturedAt: snap?.capturedAt ?? 0,
  rowCount: snap?.rowCount ?? snap?.listings?.length ?? 0,
  listingCount: snap?.listings?.length ?? 0,
  sourceUrl: snap?.sourceUrl,
  capturePass: snap?.capturePass,
});

export const cardHasDualEbayPassBuffers = (card: Pick<Card, 'ebayExtensionSnapshotNo' | 'ebayExtensionSnapshotYes'>): boolean => {
  const noRows = card.ebayExtensionSnapshotNo?.listings?.length ?? 0;
  const yesRows = card.ebayExtensionSnapshotYes?.listings?.length ?? 0;
  return noRows > 0 && yesRows > 0;
};

export const ebaySnapshotAdvanced = (
  card: Pick<Card, 'ebayExtensionSnapshot'>,
  baseline: EbayExtensionBaseline,
  options?: { expectedPass?: QuickFetchPollPass }
): boolean => {
  const snap = card.ebayExtensionSnapshot;
  if (!snap) return false;
  const capturedAt = snap.capturedAt ?? 0;
  const rowCount = snap.rowCount ?? snap.listings?.length ?? 0;
  const listingCount = snap.listings?.length ?? 0;
  if (
    capturedAt > baseline.capturedAt ||
    rowCount > baseline.rowCount ||
    listingCount > baseline.listingCount
  ) {
    return true;
  }
  if (options?.expectedPass === 'ebay-graded-yes') {
    const baseLane = ebayGradedLaneFromUrl(baseline.sourceUrl);
    const curLane = ebayGradedLaneFromUrl(snap.sourceUrl);
    if (baseLane === 'no' && curLane === 'yes') return true;
    if (snap.capturePass === 'ebay-graded-yes' && baseline.capturePass !== 'ebay-graded-yes') {
      return true;
    }
  }
  if (options?.expectedPass === 'ebay-graded-no') {
    if (snap.capturePass === 'ebay-graded-no' && baseline.capturePass !== 'ebay-graded-no') {
      return true;
    }
  }
  return false;
};

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException('Quick Fetch cancelled', 'AbortError');
};

const baselinesEqual = (a: EbayExtensionBaseline, b: EbayExtensionBaseline): boolean =>
  a.capturedAt === b.capturedAt &&
  a.rowCount === b.rowCount &&
  a.listingCount === b.listingCount &&
  a.sourceUrl === b.sourceUrl &&
  a.capturePass === b.capturePass;

export async function pollUntilEbayExtensionCapture(
  cardId: string,
  baseline: EbayExtensionBaseline,
  options: {
    signal?: AbortSignal;
    timeoutMs: number;
    expectedPass?: QuickFetchPollPass;
    onWaiting?: () => void;
    onDetected?: (card: Card) => void;
    onStalePoll?: (detail: {
      elapsedMs: number;
      baseline: EbayExtensionBaseline;
      current: EbayExtensionBaseline;
    }) => void;
    onPollTick?: (detail: {
      elapsedMs: number;
      current: EbayExtensionBaseline;
      baseline: EbayExtensionBaseline;
    }) => void | Promise<void>;
  }
): Promise<Card> {
  const { signal, timeoutMs, expectedPass, onWaiting, onDetected, onStalePoll, onPollTick } = options;
  onWaiting?.();
  const deadline = Date.now() + timeoutMs;
  let lastLogAt = 0;
  let staleNotifiedAt = 0;
  const startedAt = Date.now();

  while (Date.now() < deadline) {
    throwIfAborted(signal);
    const c = await fetchCardByIdFromServer(cardId);
    if (c && ebaySnapshotAdvanced(c, baseline, { expectedPass })) {
      onDetected?.(c);
      return c;
    }
    const now = Date.now();
    const elapsedMs = now - startedAt;
    const snap = c?.ebayExtensionSnapshot;
    const current = baselineFromSnap(snap);
    if (onStalePoll && now - staleNotifiedAt >= STALE_POLL_MS && baselinesEqual(baseline, current)) {
      staleNotifiedAt = now;
      onStalePoll({ elapsedMs, baseline, current });
    }
    if (onPollTick && now - lastLogAt >= LOG_EVERY_MS) {
      lastLogAt = now;
      await onPollTick({ elapsedMs, baseline, current });
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
    throwIfAborted(signal);
  }

  throw new Error(
    'Timed out waiting for the Edge extension capture to merge into this card. Use the puzzle icon → capture the active tab in Edge, then try again.'
  );
}

/** Wait until server has both graded-lane snapshots (dual button or sequential per-tab capture). */
export async function pollUntilDualEbayPassBuffers(
  cardId: string,
  options: {
    signal?: AbortSignal;
    timeoutMs: number;
    onWaiting?: () => void;
    onDetected?: (card: Card) => void;
    onPollTick?: (detail: { elapsedMs: number; noRows: number; yesRows: number }) => void | Promise<void>;
    onBufferProgress?: (detail: { elapsedMs: number; noRows: number; yesRows: number }) => void;
    onStalePoll?: (detail: { elapsedMs: number; noRows: number; yesRows: number }) => void;
    partialFallbackMs?: number;
  }
): Promise<Card> {
  const {
    signal,
    timeoutMs,
    onWaiting,
    onDetected,
    onPollTick,
    onBufferProgress,
    onStalePoll,
    partialFallbackMs = PARTIAL_BUFFER_FALLBACK_MS,
  } = options;
  onWaiting?.();
  const deadline = Date.now() + timeoutMs;
  const startedAt = Date.now();
  let lastLogAt = 0;
  let staleNotifiedAt = 0;
  let partialSince = 0;

  while (Date.now() < deadline) {
    throwIfAborted(signal);
    const c = await fetchCardByIdFromServer(cardId);
    if (c && cardHasDualEbayPassBuffers(c)) {
      onDetected?.(c);
      return c;
    }
    const now = Date.now();
    const elapsedMs = now - startedAt;
    const noRows = c?.ebayExtensionSnapshotNo?.listings?.length ?? 0;
    const yesRows = c?.ebayExtensionSnapshotYes?.listings?.length ?? 0;
    onBufferProgress?.({ elapsedMs, noRows, yesRows });

    const hasPartial = (noRows > 0) !== (yesRows > 0);
    if (hasPartial) {
      if (!partialSince) partialSince = now;
      else if (now - partialSince >= partialFallbackMs && c) {
        throw new DualEbayPartialBuffersError(
          c,
          noRows > 0 ? 'ebay-graded-yes' : 'ebay-graded-no'
        );
      }
    } else {
      partialSince = 0;
    }

    if (onStalePoll && now - staleNotifiedAt >= STALE_POLL_MS && hasPartial) {
      staleNotifiedAt = now;
      onStalePoll({ elapsedMs, noRows, yesRows });
    }
    if (onPollTick && now - lastLogAt >= LOG_EVERY_MS) {
      lastLogAt = now;
      await onPollTick({ elapsedMs, noRows, yesRows });
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
    throwIfAborted(signal);
  }

  throw new Error(
    'Timed out waiting for both Graded No and Graded Yes Edge captures. Use Dual graded in the extension, or capture each tab once.'
  );
}
