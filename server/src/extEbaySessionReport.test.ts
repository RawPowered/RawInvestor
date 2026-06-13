import { describe, expect, it } from 'vitest';
import { defaultEmptyMeta } from './portfolioCardsRepository.js';
import {
  mergeEbaySessionExtensionReport,
  parseEbaySessionExtensionPostBody,
} from './extEbaySessionReport.js';

describe('parseEbaySessionExtensionPostBody', () => {
  it('accepts minimal valid body', () => {
    const p = parseEbaySessionExtensionPostBody({ status: 'signed-in' });
    expect(p).toEqual({ status: 'signed-in', url: '', title: '' });
  });

  it('accepts url and title', () => {
    const p = parseEbaySessionExtensionPostBody({
      status: 'unknown',
      url: 'https://www.ebay.com/itm/1',
      title: 'eBay',
    });
    expect(p?.status).toBe('unknown');
    expect(p?.url).toContain('ebay.com');
    expect(p?.title).toBe('eBay');
  });

  it('rejects invalid status', () => {
    expect(parseEbaySessionExtensionPostBody({ status: 'maybe' })).toBeNull();
    expect(parseEbaySessionExtensionPostBody(null)).toBeNull();
    expect(parseEbaySessionExtensionPostBody([])).toBeNull();
  });
});

describe('mergeEbaySessionExtensionReport', () => {
  it('merges report without dropping fees', () => {
    const cur = defaultEmptyMeta();
    const fees = cur.fees;
    const next = mergeEbaySessionExtensionReport(
      cur,
      { status: 'signed-out', url: 'https://www.ebay.com/', title: 'Sign in' },
      99
    );
    expect(next.fees).toEqual(fees);
    expect(next.ebaySessionExtensionReport).toEqual({
      status: 'signed-out',
      url: 'https://www.ebay.com/',
      title: 'Sign in',
      reportedAt: 99,
    });
    expect(next.updatedAt).toBe(99);
  });
});
