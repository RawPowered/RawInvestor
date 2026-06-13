import { apiUrl, buildApiHeaders, getApiBase, getRawEngineRuntime } from '../apiBase';

export type ExtensionCaptureHealth = {
  reachable: boolean;
  status?: number;
  mode?: string;
  hasExtTokenInApp: boolean;
  hint?: string;
};

/** Best-effort API reachability before Edge Quick Fetch (tokens live in MV3 popup storage). */
export async function checkExtensionCaptureHealth(): Promise<ExtensionCaptureHealth> {
  const rt = getRawEngineRuntime();
  const hasExtTokenInApp = Boolean(String(rt.extToken || '').trim());
  const base = getApiBase();
  if (!base) {
    return {
      reachable: false,
      hasExtTokenInApp,
      hint: 'API base unavailable — relaunch Raw Investor desktop app.',
    };
  }
  try {
    const res = await fetch(apiUrl('/api/health'), {
      headers: buildApiHeaders({ Accept: 'application/json' }),
      cache: 'no-store',
    });
    const data = (await res.json().catch(() => ({}))) as { mode?: string };
    const mode = typeof data.mode === 'string' ? data.mode : undefined;
    const tokenRequired = mode === 'hardened';
    let hint: string | undefined;
    if (!res.ok) {
      hint = `API health ${res.status} — relaunch Raw Investor if you quit the app recently.`;
    } else if (tokenRequired && !hasExtTokenInApp) {
      hint = 'Open Raw Investor on this PC so the Edge extension can link automatically.';
    } else if (tokenRequired) {
      hint = 'Open the Edge extension popup — it should show Running when Raw Investor is open.';
    }
    return {
      reachable: res.ok,
      status: res.status,
      mode,
      hasExtTokenInApp,
      hint,
    };
  } catch {
    return {
      reachable: false,
      hasExtTokenInApp,
      hint: 'Raw Investor is not running — open the desktop app on this PC, then retry Quick Fetch.',
    };
  }
}
