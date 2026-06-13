import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const openMicrosoftEdgeUrls = vi.fn();
const isRawEngineShell = vi.fn();
const getRawEngineRuntime = vi.fn();

vi.mock('../apiBase', () => ({
  openMicrosoftEdgeUrls: (...args: unknown[]) => openMicrosoftEdgeUrls(...args),
  isRawEngineShell: () => isRawEngineShell(),
  getRawEngineRuntime: () => getRawEngineRuntime(),
}));

describe('openEbayUrl', () => {
  beforeEach(() => {
    openMicrosoftEdgeUrls.mockReset();
    isRawEngineShell.mockReset();
    getRawEngineRuntime.mockReset();
    vi.stubGlobal('window', { open: vi.fn() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns error for empty url', async () => {
    const { openEbayUrl } = await import('./openEbayUrl');
    expect(await openEbayUrl('')).toEqual({ ok: false, error: 'empty-url' });
  });

  it('uses Edge bridge on Raw Investor Windows', async () => {
    isRawEngineShell.mockReturnValue(true);
    getRawEngineRuntime.mockReturnValue({ osPlatform: 'win32' });
    openMicrosoftEdgeUrls.mockResolvedValue({ ok: true, opened: 1 });
    const { openEbayUrl } = await import('./openEbayUrl');
    const r = await openEbayUrl('https://www.ebay.com/itm/1234567890');
    expect(r.ok).toBe(true);
    expect(openMicrosoftEdgeUrls).toHaveBeenCalledWith(['https://www.ebay.com/itm/1234567890']);
    expect(window.open).not.toHaveBeenCalled();
  });

  it('falls back to window.open outside shell', async () => {
    isRawEngineShell.mockReturnValue(false);
    const { openEbayUrl } = await import('./openEbayUrl');
    const r = await openEbayUrl('https://www.ebay.com/sch/i.html?_nkw=test');
    expect(r.ok).toBe(true);
    expect(window.open).toHaveBeenCalledWith(
      'https://www.ebay.com/sch/i.html?_nkw=test',
      '_blank',
      'noopener,noreferrer'
    );
  });
});
