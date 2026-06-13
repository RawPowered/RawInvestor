import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_EBAY_CAPTURE_PLUGIN_SETTINGS,
  type EbayCapturePluginSettings,
} from '../types';

const STORAGE_KEY = 'pcgr:ebay_capture_plugin:v1';

export function loadEbayCapturePluginSettings(): EbayCapturePluginSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_EBAY_CAPTURE_PLUGIN_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<EbayCapturePluginSettings>;
    return {
      captureEbayDualParallel: parsed.captureEbayDualParallel === true,
      ebaySingleInjectionDualFacet: parsed.ebaySingleInjectionDualFacet === true,
      ebayAggressiveDeep: parsed.ebayAggressiveDeep === true,
      ebayLegacyDualGraded: parsed.ebayLegacyDualGraded === true,
      maxConcurrentCards:
        typeof parsed.maxConcurrentCards === 'number' && parsed.maxConcurrentCards >= 1
          ? Math.min(4, Math.round(parsed.maxConcurrentCards))
          : DEFAULT_EBAY_CAPTURE_PLUGIN_SETTINGS.maxConcurrentCards,
    };
  } catch {
    return { ...DEFAULT_EBAY_CAPTURE_PLUGIN_SETTINGS };
  }
}

export function saveEbayCapturePluginSettings(settings: EbayCapturePluginSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* quota */
  }
}

export function useEbayCapturePluginSettings() {
  const [settings, setSettings] = useState<EbayCapturePluginSettings>(() =>
    loadEbayCapturePluginSettings()
  );

  useEffect(() => {
    saveEbayCapturePluginSettings(settings);
  }, [settings]);

  const patch = useCallback((partial: Partial<EbayCapturePluginSettings>) => {
    setSettings((prev) => ({ ...prev, ...partial }));
  }, []);

  return { settings, patch, setSettings };
}

/** Deep concurrency cap when dual parallel lanes run (shared session load). */
export function effectiveEbayDeepConcurrency(
  timingConcurrency: number,
  dualParallel: boolean
): number {
  const base = Math.max(1, Math.min(8, Math.floor(timingConcurrency)));
  return dualParallel ? Math.min(base, 4) : base;
}
