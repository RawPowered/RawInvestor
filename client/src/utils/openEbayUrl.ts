import type { MouseEvent } from 'react';
import {
  getRawEngineRuntime,
  isRawEngineShell,
  openMicrosoftEdgeUrls,
} from '../apiBase';

/** Open an eBay (or eBay-hosted) URL in system Microsoft Edge when running Raw Investor on Windows. */
export async function openEbayUrl(url: string): Promise<{ ok: boolean; error?: string }> {
  const href = String(url || '').trim();
  if (!href) return { ok: false, error: 'empty-url' };

  if (isRawEngineShell() && getRawEngineRuntime().osPlatform === 'win32') {
    const r = await openMicrosoftEdgeUrls([href]);
    if (r.ok) return { ok: true };
  }

  if (typeof window !== 'undefined') {
    window.open(href, '_blank', 'noopener,noreferrer');
    return { ok: true };
  }
  return { ok: false, error: 'no-window' };
}

export function onEbayLinkClick(e: MouseEvent<HTMLAnchorElement>, url: string): void {
  e.preventDefault();
  void openEbayUrl(url);
}
