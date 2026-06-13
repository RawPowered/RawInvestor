import type { Card } from '../types';

export type GraderBrand = 'psa' | 'beckett' | 'cgc' | 'tag';
export type GraderCompany = 'PSA' | 'CGC' | 'BGS' | 'SGC' | 'TAG' | 'ACE' | 'AI';

export const graderFromKey = (k: string): GraderBrand | null => {
  const s = (k || '').toLowerCase();
  if (s.includes('psa')) return 'psa';
  if (s.includes('bgs') || s.includes('beckett')) return 'beckett';
  if (s.includes('cgc')) return 'cgc';
  if (s.includes('tag')) return 'tag';
  return null;
};

export const gradeLevelToken = (k: string): string | null => {
  const m = (k || '').toLowerCase().match(/(?:^|_)(\d{1,2}(?:_\d)?)(?:$|_)/);
  return m ? m[1] : null;
};

export const recommendGraderFromEstimated = (card: Card): { brand: GraderBrand; label: string } | null => {
  const targetKey = (card.estimatedGradeKey || '').trim();
  if (!targetKey || !card.allPrices?.length) return null;
  const lvl = gradeLevelToken(targetKey);
  if (!lvl) {
    const direct = graderFromKey(targetKey);
    if (!direct) return null;
    return { brand: direct, label: direct.toUpperCase() };
  }

  const ranked = card.allPrices
    .map((p) => ({
      ...p,
      brand: graderFromKey(p.key),
      lvl: gradeLevelToken(p.key),
    }))
    .filter((p) => p.brand && p.lvl === lvl && Number.isFinite(p.price) && p.price > 0)
    .sort((a, b) => {
      if (b.price !== a.price) return b.price - a.price;
      const score = (brand: GraderBrand | null) =>
        brand === 'psa' ? 4 : brand === 'beckett' ? 3 : brand === 'cgc' ? 2 : 1;
      return score(b.brand as GraderBrand) - score(a.brand as GraderBrand);
    });
  if (ranked.length === 0) return null;
  const brand = ranked[0].brand as GraderBrand;
  const label = brand === 'beckett' ? 'BGS' : brand.toUpperCase();
  return { brand, label };
};

export const companyGradeFromKey = (keyRaw: string): { company: GraderCompany; grade: string } | null => {
  const key = String(keyRaw || '').toLowerCase();
  const m = key.match(/(psa|cgc|bgs|sgc|tag|ace)_(\d{1,2}(?:_\d)?)/);
  if (!m) return null;
  const company: GraderCompany =
    m[1] === 'psa'
      ? 'PSA'
      : m[1] === 'cgc'
        ? 'CGC'
        : m[1] === 'bgs'
          ? 'BGS'
          : m[1] === 'sgc'
            ? 'SGC'
            : m[1] === 'ace'
              ? 'ACE'
              : 'TAG';
  return { company, grade: m[2].replace('_', '.') };
};
