/** How Quick Fetch reaches TCGPlayer vs eBay (persisted). */

export type QuickFetchMarketMode = 'hybrid' | 'embedded_all' | 'edge_backup';

export const STORAGE_KEY_QUICK_FETCH_MARKET_MODE = 'pcgr:quick:fetch_market_mode:v1';

const LEGACY_EDGE_FULL = 'pcgr:quick:fetch_edge_extension_full:v1';
const LEGACY_HYBRID = 'pcgr:quick:fetch_hybrid_embedded_tcg_edge_ebay:v1';

export function loadQuickFetchMarketMode(): QuickFetchMarketMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY_QUICK_FETCH_MARKET_MODE);
    if (v === 'hybrid' || v === 'embedded_all' || v === 'edge_backup') return v;
  } catch {
    /* ignore */
  }
  try {
    const edgeFull = localStorage.getItem(LEGACY_EDGE_FULL) === '1';
    const hybrid = localStorage.getItem(LEGACY_HYBRID) === '1';
    if (edgeFull && !hybrid) return 'edge_backup';
    if (edgeFull && hybrid) return 'hybrid';
  } catch {
    /* ignore */
  }
  return 'hybrid';
}

export function saveQuickFetchMarketMode(mode: QuickFetchMarketMode): void {
  try {
    localStorage.setItem(STORAGE_KEY_QUICK_FETCH_MARKET_MODE, mode);
  } catch {
    /* quota */
  }
}

export function captureProfileForMarketMode(mode: QuickFetchMarketMode): 'fast' | 'simulated' {
  return mode === 'edge_backup' ? 'simulated' : 'fast';
}
