import type { Card } from '../../types';
import { effectivePortfolioKind, type PortfolioKindScope } from '../../sort';
import { loadEbayCapturePluginSettings } from '../../plugins/ebay-capture/hooks/useEbayCapturePluginSettings';

/** Single sold-search tab (default). Legacy dual uses Graded=No/Yes URLs. */
export type EbayQuickFetchProfile = 'sealed-single' | 'singles-dual';

export const isLegacyDualGradedProfile = (profile: EbayQuickFetchProfile): boolean =>
  profile === 'singles-dual';

/** True when Quick Fetch should use sealed eBay routing (single pass, no graded facet). */
export const resolveSealedQuickFetch = (
  card: Pick<Card, 'portfolioKind'>,
  portfolioKindScope: PortfolioKindScope = 'all'
): boolean => effectivePortfolioKind(card, portfolioKindScope) === 'sealed';

export const ebayProfileForCard = (
  card: Pick<Card, 'portfolioKind'>,
  portfolioKindScope: PortfolioKindScope
): EbayQuickFetchProfile => {
  if (resolveSealedQuickFetch(card, portfolioKindScope)) return 'sealed-single';
  if (loadEbayCapturePluginSettings().ebayLegacyDualGraded) return 'singles-dual';
  return 'sealed-single';
};

export const ebayPassCountForProfile = (profile: EbayQuickFetchProfile): 1 | 2 =>
  profile === 'sealed-single' ? 1 : 2;
