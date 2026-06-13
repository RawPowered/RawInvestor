/**
 * Keep in sync with `parseEbayTitleMeta` in server/src/extensionCapture.ts (title inference for sold listings).
 */
import type { EbayExtensionListing } from '../types';

export const parseEbayTitleMeta = (
  titleRaw: unknown
): {
  gradeTag: string | null;
  grader: 'PSA' | 'CGC' | 'BGS' | 'SGC' | 'TAG' | 'ACE' | 'AI' | null;
  isGraded: boolean;
  conditionTag: 'NM' | 'LP' | 'MP' | 'HP' | 'DMG' | null;
} => {
  const t = String(titleRaw || '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const grader: 'PSA' | 'CGC' | 'BGS' | 'SGC' | 'TAG' | 'ACE' | 'AI' | null = /\bPSA\b/.test(t)
    ? 'PSA'
    : /\bCGC\b/.test(t)
      ? 'CGC'
      : /\bBGS\b|\bBECKETT\b/.test(t)
        ? 'BGS'
        : /\bSGC\b/.test(t)
          ? 'SGC'
          : /\bACE\b/.test(t)
            ? 'ACE'
            : /\bAI(?:\s*GRADE(?:D)?)?\b/.test(t)
              ? 'AI'
              : /\bTAG\b/.test(t)
                ? 'TAG'
                : null;
  const gluedGrader =
    t.match(/\b(PSA|CGC|BGS|SGC|TAG|ACE|AI)(?:\s*)(10|[1-9](?:\.\d)?)\b/) ??
    t.match(/\b(10|[1-9](?:\.\d)?)(?:\s*)(PSA|CGC|BGS|SGC|TAG|ACE|AI)\b/);
  const gluedGraderName = gluedGrader
    ? ((/PSA|CGC|BGS|SGC|TAG|ACE|AI/.exec(gluedGrader[0])?.[0] ?? null) as
        | 'PSA'
        | 'CGC'
        | 'BGS'
        | 'SGC'
        | 'TAG'
        | 'ACE'
        | 'AI'
        | null)
    : null;
  const mPristine =
    t.match(/\b(?:PRISTINE|BLACK LABEL)\s*(10)\b/) ||
    t.match(/\b10\s*(?:PRISTINE|BLACK LABEL)\b/);
  const mSimple = t.match(/\b(?:PSA|CGC|BGS|SGC|TAG|ACE|AI|BECKETT)\s*(\d{1,2}(?:\.\d)?)\b/);
  const mSimpleNoSpace =
    t.match(/\b(?:PSA|CGC|BGS|SGC|TAG|ACE|AI)(10|[1-9](?:\.\d)?)\b/) ||
    t.match(/\b(10|[1-9](?:\.\d)?)(?:PSA|CGC|BGS|SGC|TAG|ACE|AI)\b/);
  const resolvedGrader = grader ?? gluedGraderName;
  const resolvedGrade = mSimple?.[1] ?? mSimpleNoSpace?.[1] ?? null;
  const gradeTag =
    mPristine && resolvedGrader
      ? `${resolvedGrader} 10 PRISTINE`
      : resolvedGrade && resolvedGrader
        ? `${resolvedGrader} ${resolvedGrade}`
        : null;
  const conditionTag: 'NM' | 'LP' | 'MP' | 'HP' | 'DMG' | null = /\bNEAR MINT\b|\bNM\b/.test(t)
    ? 'NM'
    : /\bLIGHTLY PLAYED\b|\bLP\b/.test(t)
      ? 'LP'
      : /\bMODERATELY PLAYED\b|\bMP\b/.test(t)
        ? 'MP'
        : /\bHEAVILY PLAYED\b|\bHP\b/.test(t)
          ? 'HP'
          : /\bDAMAGED\b|\bDMG\b/.test(t)
            ? 'DMG'
            : null;
  return { gradeTag, grader: resolvedGrader, isGraded: Boolean(resolvedGrader && gradeTag), conditionTag };
};

/** Mirrors server normalizeOneEbayListingRow merge rules for grade fields from title. */
export const enrichEbayListingFromTitle = <T extends EbayExtensionListing>(r: T): T => {
  const parsed = parseEbayTitleMeta(r.title);
  const extGrade =
    r.gradeTag != null && String(r.gradeTag).trim() !== '' ? String(r.gradeTag).trim() : null;
  const extGraderRaw =
    r.grader != null && String(r.grader).trim() !== '' ? String(r.grader).trim().toUpperCase() : '';
  const extGrader =
    extGraderRaw && /^PSA|CGC|BGS|SGC|TAG|ACE|AI$/.test(extGraderRaw)
      ? (extGraderRaw as NonNullable<EbayExtensionListing['grader']>)
      : null;
  const isGraded = r.isGraded === true || parsed.isGraded;
  const gradeMerged = extGrade ?? parsed.gradeTag;
  const graderMerged = extGrader ?? parsed.grader;
  const conditionMerged = r.conditionTag ?? parsed.conditionTag;

  return {
    ...r,
    isGraded,
    gradeTag: isGraded ? gradeMerged : null,
    grader: isGraded ? graderMerged : null,
    conditionTag: conditionMerged ?? null,
  };
};
