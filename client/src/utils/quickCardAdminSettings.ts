import type { QuickFetchMarketMode } from './quickFetchMarketMode';
import { loadQuickFetchMarketMode } from './quickFetchMarketMode';

export type GemRateQuickMode = 'every_time' | 'every_n_days';

export type QuickCardAdminSettings = {
  gemRateOnQuickRefresh: boolean;
  gemRateQuickMode: GemRateQuickMode;
  gemRateQuickIntervalDays: number;
  autoQuickRefreshOnLoad: boolean;
  quickFetchMarketMode: QuickFetchMarketMode;
};

export const STORAGE_KEY_QUICK_CARD_ADMIN = 'pcgr:quick:admin_settings:v1';

export const DEFAULT_QUICK_CARD_ADMIN_SETTINGS: QuickCardAdminSettings = {
  gemRateOnQuickRefresh: false,
  gemRateQuickMode: 'every_n_days',
  gemRateQuickIntervalDays: 7,
  autoQuickRefreshOnLoad: false,
  quickFetchMarketMode: 'hybrid',
};

const MS_PER_DAY = 86_400_000;

export function normalizeQuickCardAdminSettings(
  raw: Partial<QuickCardAdminSettings> | null | undefined
): QuickCardAdminSettings {
  const base = { ...DEFAULT_QUICK_CARD_ADMIN_SETTINGS };
  if (!raw || typeof raw !== 'object') return base;
  return {
    gemRateOnQuickRefresh: raw.gemRateOnQuickRefresh === true,
    gemRateQuickMode: raw.gemRateQuickMode === 'every_time' ? 'every_time' : 'every_n_days',
    gemRateQuickIntervalDays: clampDays(raw.gemRateQuickIntervalDays, base.gemRateQuickIntervalDays),
    autoQuickRefreshOnLoad: raw.autoQuickRefreshOnLoad === true,
    quickFetchMarketMode:
      raw.quickFetchMarketMode === 'embedded_all' || raw.quickFetchMarketMode === 'edge_backup'
        ? raw.quickFetchMarketMode
        : 'hybrid',
  };
}

function clampDays(v: unknown, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : fallback;
  return Math.max(1, Math.min(365, n));
}

export function loadQuickCardAdminSettings(): QuickCardAdminSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_QUICK_CARD_ADMIN);
    if (raw) {
      return normalizeQuickCardAdminSettings(JSON.parse(raw) as Partial<QuickCardAdminSettings>);
    }
  } catch {
    /* ignore */
  }
  return {
    ...DEFAULT_QUICK_CARD_ADMIN_SETTINGS,
    quickFetchMarketMode: loadQuickFetchMarketMode(),
  };
}

export function saveQuickCardAdminSettings(settings: QuickCardAdminSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY_QUICK_CARD_ADMIN, JSON.stringify(settings));
  } catch {
    /* quota */
  }
}

/** Whether Gem Rate should run on this Quick Refresh given admin schedule and card timestamps. */
export function shouldFetchGemRateOnQuickRefresh(
  settings: QuickCardAdminSettings,
  card: { lastQuickRefreshAt?: number; gemRateStats?: { fetchedAt?: number } | null },
  nowMs = Date.now()
): boolean {
  if (!settings.gemRateOnQuickRefresh) return false;
  if (settings.gemRateQuickMode === 'every_time') return true;
  const last =
    typeof card.lastQuickRefreshAt === 'number' && card.lastQuickRefreshAt > 0
      ? card.lastQuickRefreshAt
      : card.gemRateStats?.fetchedAt;
  if (typeof last !== 'number' || last <= 0) return true;
  const days = clampDays(settings.gemRateQuickIntervalDays, 7);
  return nowMs - last >= days * MS_PER_DAY;
}

export function autoQuickRefreshStampKey(cardId: string, dayKey: string): string {
  return `pcgr:quick:auto_refresh:${cardId}:${dayKey}`;
}

export function todayUtcDayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function hasAutoQuickRefreshStamp(cardId: string, dayKey = todayUtcDayKey()): boolean {
  try {
    return localStorage.getItem(autoQuickRefreshStampKey(cardId, dayKey)) === '1';
  } catch {
    return false;
  }
}

export function setAutoQuickRefreshStamp(cardId: string, dayKey = todayUtcDayKey()): void {
  try {
    localStorage.setItem(autoQuickRefreshStampKey(cardId, dayKey), '1');
  } catch {
    /* ignore */
  }
}
