import type { Card } from '../../types';

import { ebaySoldSearchUrlForCard, ebaySoldSearchUrlForCardWithGraded } from '../../masterListExternalLinks';

import type { PortfolioKindScope } from '../../sort';

import {

  buildEbayCaptureOptions,

  type QuickFetchCaptureProfile,

  type QuickFetchTiming,

} from '../../utils/quickFetchTiming';

import { captureProfileForMarketMode, type QuickFetchMarketMode } from '../../utils/quickFetchMarketMode';

import { getEbaySoldWatermarkMs } from '../../utils/quickFetchIncremental';

import { loadEbayCapturePluginSettings } from '../../plugins/ebay-capture/hooks/useEbayCapturePluginSettings';

import {

  ebayProfileForCard,

  isLegacyDualGradedProfile,

  resolveSealedQuickFetch,

  type EbayQuickFetchProfile,

} from './resolveSealedQuickFetch';



export type { EbayQuickFetchProfile };



export type EbayQuickFetchUrls = {

  baseUrl: string;

  gradedNo: string | null;

  gradedYes: string | null;

};



export type EbayQuickFetchPlan = {

  profile: EbayQuickFetchProfile;

  resolvedSealed: boolean;

  ebayPassCount: 1 | 2;

  urls: EbayQuickFetchUrls;

  /** RawEngine captureTab mode for eBay (embedded path). */

  captureMode: 'default' | 'deep';

  /** Extension popup hint: Quick vs More history. */

  extensionCaptureMode: 'default' | 'deep';

  captureOpts: Record<string, unknown>;

  ebayQuickRefresh: boolean;

};



const buildSinglePassPlan = (

  profile: EbayQuickFetchProfile,

  resolvedSealed: boolean,

  baseUrl: string,

  quickFetchIncremental: boolean,

  captureOpts: Record<string, unknown>,

  ebayQuickRefresh: boolean

): EbayQuickFetchPlan => {

  const captureMode: 'default' | 'deep' = quickFetchIncremental ? 'default' : 'deep';

  return {

    profile,

    resolvedSealed,

    ebayPassCount: 1,

    urls: { baseUrl, gradedNo: null, gradedYes: null },

    captureMode,

    extensionCaptureMode: captureMode,

    captureOpts: {

      ...captureOpts,

      ebaySkipGradedFacetClick: true,

    },

    ebayQuickRefresh,

  };

};



export const planEbayQuickFetch = (

  card: Card,

  portfolioKindScope: PortfolioKindScope,

  timing: QuickFetchTiming,

  quickFetchIncremental: boolean,

  marketMode: QuickFetchMarketMode

): EbayQuickFetchPlan => {

  const captureProfile: QuickFetchCaptureProfile = captureProfileForMarketMode(marketMode);

  const resolvedSealed = resolveSealedQuickFetch(card, portfolioKindScope);

  const profile = ebayProfileForCard(card, portfolioKindScope);

  const baseUrl = ebaySoldSearchUrlForCard(card);

  const ebaySoldWm = quickFetchIncremental ? getEbaySoldWatermarkMs(card) : null;



  const plugin = loadEbayCapturePluginSettings();

  const captureOpts = buildEbayCaptureOptions(timing, ebaySoldWm, {

    quickFetchIncremental,

    profile: captureProfile,

    sealedQuickFetch: resolvedSealed,

    aggressiveDeep: plugin.ebayAggressiveDeep,

  });



  const ebayQuickRefresh = Boolean(captureOpts.ebayQuickRefresh);



  if (!isLegacyDualGradedProfile(profile)) {

    return buildSinglePassPlan(

      profile,

      resolvedSealed,

      baseUrl,

      quickFetchIncremental,

      captureOpts,

      ebayQuickRefresh

    );

  }



  const gradedNo = ebaySoldSearchUrlForCardWithGraded(card, 'no');

  const gradedYes = ebaySoldSearchUrlForCardWithGraded(card, 'yes');



  return {

    profile: 'singles-dual',

    resolvedSealed: false,

    ebayPassCount: 2,

    urls: { baseUrl, gradedNo, gradedYes },

    captureMode: 'deep',

    extensionCaptureMode: quickFetchIncremental ? 'default' : 'deep',

    captureOpts,

    ebayQuickRefresh,

  };

};



/** Edge poll budget: More history needs longer than Quick (~100 sales). */

export const edgeEbayPollTimeoutMs = (plan: Pick<EbayQuickFetchPlan, 'extensionCaptureMode'>): number =>

  plan.extensionCaptureMode === 'deep' ? 600_000 : 180_000;


