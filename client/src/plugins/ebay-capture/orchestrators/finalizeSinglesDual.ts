import {
  mergeDualGradedEbayCaptures,
  verifyAndArchiveEbayOutliers,
  type EbayExtractPayload,
} from '../../../utils/ebayQuickFetch';
import { mergeIncrementalEbaySnapshots } from '../../../utils/quickFetchIncremental';
import type { EmbeddedSinglesDualDeps, SinglesDualCaptureResult } from '../types';

export async function finalizeSinglesDualCapture(
  deps: Pick<
    EmbeddedSinglesDualDeps,
    'card' | 'ebayUrl' | 'quickFetchIncremental' | 'qfTiming' | 'ebayQuickCap' | 'appendCapLog'
  >,
  echoNo: { raw?: EbayExtractPayload } | EbayExtractPayload | null | undefined,
  echoYes: { raw?: EbayExtractPayload } | EbayExtractPayload | null | undefined,
  opts?: { parallelDual?: boolean; laneErrors?: SinglesDualCaptureResult['laneErrors'] }
): Promise<SinglesDualCaptureResult> {
  const { card, ebayUrl, quickFetchIncremental, qfTiming, ebayQuickCap, appendCapLog } = deps;
  const rawNo = (echoNo as { raw?: EbayExtractPayload })?.raw ?? (echoNo as EbayExtractPayload);
  const rawYes = (echoYes as { raw?: EbayExtractPayload })?.raw ?? (echoYes as EbayExtractPayload);

  let mergedSnap = mergeDualGradedEbayCaptures(rawNo, rawYes, ebayUrl);
  if (quickFetchIncremental && card.ebayExtensionSnapshot) {
    const priorRows = card.ebayExtensionSnapshot.listings?.length ?? 0;
    mergedSnap = mergeIncrementalEbaySnapshots(card.ebayExtensionSnapshot, mergedSnap);
    await appendCapLog?.({
      scope: 'ebayCapturePlugin',
      message: 'eBay incremental merge',
      detail: { pluginId: 'singles-dual', priorRowCount: priorRows, mergedRowCount: mergedSnap.rowCount },
    });
  }

  const verified = await verifyAndArchiveEbayOutliers(
    card,
    mergedSnap,
    card.ebayVerificationArchive,
    card.ebayArchivedSaleKeys
  );

  const dual = verified.snapshot.ebayDualCaptureStats;
  const ebRows = verified.snapshot.rowCount ?? 0;
  const ebExcl = verified.snapshot.rejectedListings?.length ?? 0;
  const prevArch = card.ebayVerificationArchive?.length ?? 0;
  const archN = Math.max(0, (verified.ebayVerificationArchive?.length ?? 0) - prevArch);

  const laneErr =
    opts?.laneErrors && (opts.laneErrors.no || opts.laneErrors.yes)
      ? ` lane errors: ${[opts.laneErrors.no ? `No: ${opts.laneErrors.no}` : '', opts.laneErrors.yes ? `Yes: ${opts.laneErrors.yes}` : ''].filter(Boolean).join('; ')}`
      : '';

  const captureDiagnostics = [
    `eBay: ${ebRows} merged rows (${ebayQuickCap ? 'quick refresh · deep · new sold only' : 'deep'}, target ${qfTiming.ebayPerPageTarget}/pg, Graded No+Yes${opts?.parallelDual ? ' · parallel' : ''})`,
    dual
      ? `passes: No ${dual.gradedNoPages}pg/${dual.gradedNoRows} · Yes ${dual.gradedYesPages}pg/${dual.gradedYesRows}`
      : '',
    ebExcl > 0 ? `${ebExcl} parser mismatches → rejected` : '',
    archN > 0 ? `${archN} high-RAW outliers archived (verify)` : '',
    dual?.gradedFacetAppliedNo === false || dual?.gradedFacetAppliedYes === false
      ? 'graded facet UI not applied — refine sidebar manually if needed'
      : '',
    laneErr,
  ]
    .filter((x) => typeof x === 'string' && x.length > 0)
    .join(' · ');

  return { verified, captureDiagnostics, laneErrors: opts?.laneErrors };
}
