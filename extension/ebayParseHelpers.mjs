/**
 * eBay sold-search helpers — unit-tested source of truth for behavior.
 * Inline `parseSoldAt` / `parseGradeTag` inside `extractCurrentPageInTab` in
 * extractPageInTab.mjs must stay in sync (Electron injects that function via
 * .toString(); it cannot import this module at runtime).
 */

/** @param {string} title */
export function parseEbayGradeTag(title) {
  const t = String(title || '').toUpperCase();
  const grader = /\bPSA\b/.test(t)
    ? 'PSA'
    : /\bCGC\b/.test(t)
      ? 'CGC'
      : /\bBGS\b|\bBECKETT\b/.test(t)
        ? 'BGS'
        : /\bSGC\b/.test(t)
          ? 'SGC'
          : /\bTAG\b/.test(t)
            ? 'TAG'
            : null;

  const mPristine =
    t.match(/\b(?:PRISTINE|BLACK LABEL)\s*(10)\b/) || t.match(/\b10\s*(?:PRISTINE|BLACK LABEL)\b/);
  const mSimple = t.match(/\b(?:PSA|CGC|BGS|SGC|TAG|BECKETT)\s*(\d{1,2}(?:\.\d)?)\b/);

  let gradeTag = null;
  if (mPristine && grader) gradeTag = `${grader} 10 PRISTINE`;
  else if (mSimple && grader) gradeTag = `${grader} ${mSimple[1]}`;
  else if (grader) {
    const gEsc = grader.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const mGemMint = t.match(
      new RegExp(`\\b${gEsc}\\b[\\s\\S]{0,140}?\\bGEM\\s+MINT\\s+(\\d{1,2}(?:\\.\\d)?)\\b`, 'i')
    );
    const mMintGrade = t.match(
      new RegExp(`\\b${gEsc}\\b[\\s\\S]{0,100}?\\bMINT\\s+(\\d{1,2}(?:\\.\\d)?)\\b`, 'i')
    );
    if (mGemMint) gradeTag = `${grader} ${mGemMint[1]} GEM MINT`;
    else if (mMintGrade && !mSimple) gradeTag = `${grader} ${mMintGrade[1]} MINT`;
  }

  return { grader, gradeTag, isGraded: Boolean(grader && gradeTag) };
}

/** @param {string} text full card row / container text */
export function parseEbaySoldAt(text) {
  const raw = String(text || '').replace(/\s+/g, ' ');
  let m = raw.match(
    /Sold\s+((?:[A-Za-z]{3,9}|\d{1,2}\/\d{1,2}\/\d{2,4})[\s,]+\d{4}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{2,4})/i
  );
  if (!m) m = raw.match(/Sold\s+(\d{4}-\d{2}-\d{2})/i);
  if (!m) return null;
  const datePart = m[1].trim();

  const hasExplicitTime =
    /(?:^|[\s,;T])\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?/i.test(datePart) ||
    /t\d{2}:\d{2}/i.test(datePart);

  const isoDay = datePart.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDay) {
    const y = Number(isoDay[1]);
    const mo = Number(isoDay[2]) - 1;
    const da = Number(isoDay[3]);
    return new Date(y, mo, da, 12, 0, 0, 0).getTime();
  }

  const parsed = Date.parse(datePart);
  if (!Number.isFinite(parsed)) return null;
  if (hasExplicitTime) return parsed;

  const d = new Date(parsed);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0).getTime();
}
