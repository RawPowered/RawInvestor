import type { Card, GemRateSearchResult, GemRateStats } from '../types';
import { apiUrl } from '../apiBase';
import { buildGemRateQuery } from './searchQueries';
import type { PortfolioKindScope } from '../sort';

export type GemRateEnrichmentPatch = {
  gemrateCandidates?: Card['gemrateCandidates'];
  gemrateId?: string;
  gemRateStats?: GemRateStats | null;
};

export function shouldSkipGemRateForCard(
  card: Pick<Card, 'portfolioKind' | 'name' | 'set' | 'cardNumber'>,
  portfolioKindScope: PortfolioKindScope
): boolean {
  if (card.portfolioKind === 'sealed' || portfolioKindScope === 'sealed') return true;
  return !buildGemRateQuery({
    name: card.name,
    set: card.set,
    cardNumber: card.cardNumber,
  });
}

/** Best-effort GemRate search + card-details; returns fields to merge onto the card. */
export async function fetchGemRateEnrichment(
  card: Card,
  portfolioKindScope: PortfolioKindScope
): Promise<GemRateEnrichmentPatch | null> {
  if (shouldSkipGemRateForCard(card, portfolioKindScope)) return null;

  const q = buildGemRateQuery({
    name: card.name,
    set: card.set,
    cardNumber: card.cardNumber,
  });
  if (!q) return null;

  const patch: GemRateEnrichmentPatch = {};

  try {
    const gr = await fetch(apiUrl(`/api/gemrate/search?q=${encodeURIComponent(q)}`));
    if (!gr.ok) return null;
    const payload = (await gr.json()) as GemRateSearchResult;
    const candidates = payload.candidates || [];
    patch.gemrateCandidates = candidates;
    const universal = candidates.find((c) => c.populationType === 'Universal');
    const gid = universal?.gemrateId || candidates[0]?.gemrateId || '';
    if (gid) patch.gemrateId = gid;
  } catch {
    return null;
  }

  const gid = (patch.gemrateId ?? card.gemrateId ?? '').trim();
  if (!gid) return patch;

  if (card.gemRateStats?.gemrateId === gid) return patch;

  try {
    const dr = await fetch(apiUrl(`/api/gemrate/card-details?gemrate_id=${encodeURIComponent(gid)}`));
    if (!dr.ok) return patch;
    const d = (await dr.json()) as { psa10Pct: number | null; universalGemsPct: number | null };
    patch.gemRateStats = {
      gemrateId: gid,
      psa10Pct: d.psa10Pct ?? null,
      universalGemsPct: d.universalGemsPct ?? null,
      fetchedAt: Date.now(),
    };
  } catch {
    /* stats optional */
  }

  return patch;
}
