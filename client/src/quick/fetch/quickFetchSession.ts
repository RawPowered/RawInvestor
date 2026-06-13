import { patchPortfolioMetaOnServer } from '../../serverSync';
import type { EbayQuickFetchProfile } from './resolveSealedQuickFetch';

export type QuickFetchSessionPass = 'ebay' | 'tcg' | 'ebay-graded-no' | 'ebay-graded-yes';

export type QuickFetchSessionDoc = {
  active: boolean;
  expectedCaptureMode: 'default' | 'deep';
  profile: EbayQuickFetchProfile;
  pass?: QuickFetchSessionPass;
  cardId?: string;
  /** Edge extension: match open tabs for dual graded capture */
  gradedNoUrl?: string;
  gradedYesUrl?: string;
  updatedAt: number;
};

export async function publishQuickFetchSession(
  session: QuickFetchSessionDoc | null
): Promise<void> {
  try {
    if (!session || !session.active) {
      await patchPortfolioMetaOnServer({
        quickFetchSession: {
          active: false,
          expectedCaptureMode: 'default',
          profile: 'sealed-single',
          updatedAt: Date.now(),
        },
      });
      return;
    }
    await patchPortfolioMetaOnServer({ quickFetchSession: session });
  } catch {
    /* extension sync is best-effort */
  }
}
