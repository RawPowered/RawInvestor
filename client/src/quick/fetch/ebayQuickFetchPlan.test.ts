import { describe, expect, it } from 'vitest';
import { resolveSealedQuickFetch, ebayProfileForCard } from './resolveSealedQuickFetch';
import { edgeEbayPollTimeoutMs, planEbayQuickFetch } from './ebayQuickFetchPlan';
import { DEFAULT_QUICK_FETCH_TIMING } from '../../utils/quickFetchTiming';
import type { Card } from '../../types';

const baseCard = (): Card =>
  ({
    id: 'c1',
    name: 'Test Product',
    set: 'Set',
    cardNumber: '1',
    raw: 10,
    p10: 0.3,
    p9: 0.5,
  }) as Card;

describe('resolveSealedQuickFetch', () => {
  it('true when portfolioKind is sealed', () => {
    expect(resolveSealedQuickFetch({ portfolioKind: 'sealed' }, 'all')).toBe(true);
    expect(ebayProfileForCard({ portfolioKind: 'sealed' }, 'single')).toBe('sealed-single');
  });

  it('true when scope is sealed and kind unset', () => {
    expect(resolveSealedQuickFetch({}, 'sealed')).toBe(true);
  });

  it('false for single card on singles scope', () => {
    expect(resolveSealedQuickFetch({ portfolioKind: 'single' }, 'single')).toBe(false);
    expect(ebayProfileForCard({ portfolioKind: 'single' }, 'single')).toBe('sealed-single');
  });

  it('single kind wins over sealed scope', () => {
    expect(resolveSealedQuickFetch({ portfolioKind: 'single' }, 'sealed')).toBe(false);
  });
});

describe('planEbayQuickFetch', () => {
  it('sealed incremental: single URL, default capture, no graded URLs', () => {
    const card = { ...baseCard(), portfolioKind: 'sealed' as const };
    const plan = planEbayQuickFetch(card, 'all', DEFAULT_QUICK_FETCH_TIMING, true, 'hybrid');
    expect(plan.profile).toBe('sealed-single');
    expect(plan.ebayPassCount).toBe(1);
    expect(plan.urls.gradedNo).toBeNull();
    expect(plan.urls.gradedYes).toBeNull();
    expect(plan.captureMode).toBe('default');
    expect(plan.captureOpts.ebaySkipGradedFacetClick).toBe(true);
  });

  it('sealed via scope when kind unset', () => {
    const plan = planEbayQuickFetch(baseCard(), 'sealed', DEFAULT_QUICK_FETCH_TIMING, false, 'hybrid');
    expect(plan.profile).toBe('sealed-single');
    expect(plan.captureMode).toBe('deep');
    expect(plan.urls.gradedNo).toBeNull();
    expect(plan.urls.gradedYes).toBeNull();
  });

  it('singles non-incremental deep: single sold URL, no Graded facet', () => {
    const card = { ...baseCard(), portfolioKind: 'single' as const };
    const plan = planEbayQuickFetch(card, 'single', DEFAULT_QUICK_FETCH_TIMING, false, 'hybrid');
    expect(plan.profile).toBe('sealed-single');
    expect(plan.ebayPassCount).toBe(1);
    expect(plan.urls.gradedNo).toBeNull();
    expect(plan.urls.gradedYes).toBeNull();
    expect(plan.urls.baseUrl).toContain('LH_Sold=1');
    expect(plan.urls.baseUrl).not.toContain('Graded=');
    expect(plan.captureMode).toBe('deep');
    expect(plan.captureOpts.ebaySkipGradedFacetClick).toBe(true);
    expect(plan.ebayQuickRefresh).toBe(false);
  });

  it('singles incremental: single sold URL', () => {
    const card = {
      ...baseCard(),
      portfolioKind: 'single' as const,
      ebayExtensionSnapshot: {
        sourceUrl: 'https://www.ebay.com/sch/i.html?_nkw=test',
        query: 'test',
        capturedAt: Date.now() - 1000,
        captureMode: 'default' as const,
        hasMore: false,
        rowCount: 1,
        listings: [
          {
            title: 'x',
            price: 1,
            soldAt: Date.now(),
            itemId: '1',
            itemUrl: 'https://www.ebay.com/itm/1',
          },
        ],
      },
    };
    const plan = planEbayQuickFetch(card, 'single', DEFAULT_QUICK_FETCH_TIMING, true, 'hybrid');
    expect(plan.profile).toBe('sealed-single');
    expect(plan.ebayPassCount).toBe(1);
    expect(plan.urls.gradedNo).toBeNull();
    expect(plan.urls.gradedYes).toBeNull();
    expect(plan.captureMode).toBe('default');
  });

  it('edgeEbayPollTimeoutMs: longer for More history', () => {
    expect(edgeEbayPollTimeoutMs({ extensionCaptureMode: 'deep' })).toBe(600_000);
    expect(edgeEbayPollTimeoutMs({ extensionCaptureMode: 'default' })).toBe(180_000);
  });
});
