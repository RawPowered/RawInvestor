/**
 * Thin proxy around PSA's public API so the browser never needs to touch
 * api.psacard.com directly (avoids CORS and keeps the token out of the page
 * request pipeline). PSA's free tier allows 100 calls/day per token.
 *
 * Docs:  https://www.psacard.com/publicapi/documentation
 * Auth:  Authorization: Bearer <token>  (token obtained free at psacard.com)
 */

const PSA_BASE = 'https://api.psacard.com/publicapi';

export type PsaPopulation = {
  specId: number | string;
  brand?: string;
  subject?: string;
  year?: string;
  cardNumber?: string;
  /** Counts keyed by display label ("PSA 10", "PSA 9", "Auth", etc.). */
  grades: Array<{ grade: string; population: number; qualifiedPopulation: number }>;
  totalPop: number;
  /** Raw JSON PSA returned — handy for debugging if the shape changes. */
  raw: unknown;
};

const GRADE_FIELD_ORDER: Array<{ field: string; label: string }> = [
  { field: 'Auth', label: 'Authentic' },
  { field: 'Grade1', label: 'PSA 1' },
  { field: 'Grade1_5', label: 'PSA 1.5' },
  { field: 'Grade2', label: 'PSA 2' },
  { field: 'Grade3', label: 'PSA 3' },
  { field: 'Grade4', label: 'PSA 4' },
  { field: 'Grade5', label: 'PSA 5' },
  { field: 'Grade6', label: 'PSA 6' },
  { field: 'Grade7', label: 'PSA 7' },
  { field: 'Grade8', label: 'PSA 8' },
  { field: 'Grade8_5', label: 'PSA 8.5' },
  { field: 'Grade9', label: 'PSA 9' },
  { field: 'Grade9_5', label: 'PSA 9.5' },
  { field: 'Grade10', label: 'PSA 10' },
];

/**
 * Normalizes the PSA population response into a predictable shape. PSA's API
 * has some naming quirks (PascalCase, occasional `Grade9_5` vs `Grade9.5`) so
 * we look up keys flexibly.
 */
const normalize = (raw: Record<string, unknown>, specId: string): PsaPopulation => {
  const pop = (raw['Population'] ?? raw['population'] ?? {}) as Record<string, unknown>;
  const qpop = (raw['PopulationWithQualifier'] ??
    raw['populationWithQualifier'] ??
    {}) as Record<string, unknown>;

  const getNum = (src: Record<string, unknown>, field: string): number => {
    // Try both PascalCase and the original dotted form (Grade9.5) + underscored.
    const candidates = [field, field.replace(/_/g, '.'), field.toLowerCase(), field.replace(/_/g, '')];
    for (const c of candidates) {
      const v = src[c];
      if (typeof v === 'number') return v;
      if (typeof v === 'string' && !isNaN(Number(v))) return Number(v);
    }
    return 0;
  };

  const grades = GRADE_FIELD_ORDER.map(({ field, label }) => ({
    grade: label,
    population: getNum(pop, field),
    qualifiedPopulation: getNum(qpop, field),
  })).filter((g) => g.population > 0 || g.qualifiedPopulation > 0);

  const totalPop =
    getNum(pop, 'TotalPop') ||
    grades.reduce((s, g) => s + g.population + g.qualifiedPopulation, 0);

  return {
    specId: (raw['SpecID'] ?? raw['specId'] ?? specId) as string | number,
    brand: (raw['Brand'] as string) || (raw['brand'] as string) || '',
    subject: (raw['Subject'] as string) || (raw['subject'] as string) || '',
    year: String((raw['Year'] as string | number) ?? raw['year'] ?? ''),
    cardNumber: (raw['CardNumber'] as string) || (raw['cardNumber'] as string) || '',
    grades,
    totalPop,
    raw,
  };
};

export const fetchPsaPopulation = async (
  specId: string,
  token: string
): Promise<PsaPopulation> => {
  if (!/^\d+$/.test(specId)) {
    throw new Error(`Invalid PSA SpecID: "${specId}" (must be numeric)`);
  }
  if (!token) throw new Error('PSA API token required');

  const url = `${PSA_BASE}/pop/GetPSASpecPopulation/${specId}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  if (res.status === 401) throw new Error('PSA API rejected the token (401)');
  if (res.status === 429) throw new Error('PSA API rate limit hit (429) — free tier is 100 calls/day');
  if (!res.ok) throw new Error(`PSA API ${res.status}: ${res.statusText}`);

  const json = (await res.json()) as Record<string, unknown>;
  return normalize(json, specId);
};
