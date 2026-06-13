import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  EBAY_SESSION_EXTENSION_MAX_AGE_MS,
  parseEbaySessionExtensionReport,
} from './ebaySessionFromMeta';

describe('parseEbaySessionExtensionReport', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null when missing or stale', () => {
    expect(parseEbaySessionExtensionReport(undefined)).toBeNull();
    expect(parseEbaySessionExtensionReport({})).toBeNull();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
    const old = Date.now() - EBAY_SESSION_EXTENSION_MAX_AGE_MS - 60_000;
    expect(
      parseEbaySessionExtensionReport({
        ebaySessionExtensionReport: { status: 'signed-in', reportedAt: old },
      })
    ).toBeNull();
  });

  it('parses fresh signed-in report', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
    const reportedAt = Date.now() - 60_000;
    const r = parseEbaySessionExtensionReport({
      ebaySessionExtensionReport: {
        status: 'signed-in',
        reportedAt,
        url: 'https://www.ebay.com/',
        title: 'eBay',
      },
    });
    expect(r?.status).toBe('signed-in');
    expect(r?.url).toContain('ebay.com');
    expect(r?.reportedAt).toBe(reportedAt);
  });
});
