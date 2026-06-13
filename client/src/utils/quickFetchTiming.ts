/** Persisted Quick Fetch delays/options (RawEngine captureTab + client sleeps). */

export type QuickFetchTiming = {
  tabUrlVerifyPollMs: number;
  ebayPostActivateMs: number;
  ebayImpatienceMs: number;
  ebayPerPageTarget: number;
  /** Cap for eBay / page when Quick refresh + watermark (incremental). */
  ebayQuickRefreshMaxPerPage: number;
  /** ms subtracted from latest stored soldAt to form deep paging stop threshold. */
  ebayQuickStopBufferMs: number;
  ebayDeepFetchConcurrency: number;
  /** Max ms for eBay deep paging phase (extractor clamps 30s–240s). */
  ebayDeepBudgetMs: number;
  tcgSinglePostActivateMs: number;
  tcgDeepInitialSettleMs: number;
  tcgDeepAfterDefaultActivateMs: number;
  /** After default capture completes: first pause before deep capture (dual-tab used 500 ms here). */
  tcgDeepBetweenCapturesLeadMs: number;
  tcgDeepBeforeDeepCaptureMs: number;
  tcgImpatienceMs: number;
  tcgPrePageSettleMs: number;
  tcgViewMoreWaitMs: number;
  tcgDeepExtraSettleMs: number;
  tcgMinSalesRows: number;
  tcgSalesFeedTimeoutMs: number;
  tcgSalesFeedPollMs: number;
  tcgViewMoreMaxAttempts: number;
  /** Applied to post-activate/settle sleeps when Quick refresh is on and timing is not customized. */
  quickRefreshSleepMultiplier: number;
};

export const DEFAULT_QUICK_FETCH_TIMING: QuickFetchTiming = {
  tabUrlVerifyPollMs: 400,
  ebayPostActivateMs: 1000,
  ebayImpatienceMs: 700,
  ebayPerPageTarget: 120,
  ebayQuickRefreshMaxPerPage: 60,
  ebayQuickStopBufferMs: 86_400_000,
  ebayDeepFetchConcurrency: 4,
  ebayDeepBudgetMs: 120_000,
  tcgSinglePostActivateMs: 2800,
  tcgDeepInitialSettleMs: 2300,
  tcgDeepAfterDefaultActivateMs: 500,
  tcgDeepBetweenCapturesLeadMs: 500,
  tcgDeepBeforeDeepCaptureMs: 950,
  tcgImpatienceMs: 1100,
  tcgPrePageSettleMs: 1800,
  tcgViewMoreWaitMs: 1400,
  tcgDeepExtraSettleMs: 550,
  tcgMinSalesRows: 3,
  tcgSalesFeedTimeoutMs: 28000,
  tcgSalesFeedPollMs: 300,
  tcgViewMoreMaxAttempts: 4,
  quickRefreshSleepMultiplier: 0.5,
};

/** Embedded / hybrid TCG path: shorter settles when timing is not user-customized. */
export const FAST_EMBEDDED_QUICK_FETCH_TIMING: Partial<QuickFetchTiming> = {
  ebayPostActivateMs: 300,
  ebayImpatienceMs: 0,
  tcgSinglePostActivateMs: 800,
  tcgDeepInitialSettleMs: 900,
  tcgDeepAfterDefaultActivateMs: 200,
  tcgDeepBetweenCapturesLeadMs: 200,
  tcgDeepBeforeDeepCaptureMs: 350,
  tcgImpatienceMs: 0,
  tcgPrePageSettleMs: 600,
  tcgViewMoreWaitMs: 500,
  tcgDeepExtraSettleMs: 250,
};

export type QuickFetchCaptureProfile = 'fast' | 'simulated';

export function resolveQuickFetchTiming(
  store: QuickFetchTimingStore,
  profile: QuickFetchCaptureProfile
): QuickFetchTiming {
  if (profile === 'simulated' || store.customized) return store.timing;
  return applyQuickFetchTimingPatch(store.timing, FAST_EMBEDDED_QUICK_FETCH_TIMING);
}

export type QuickFetchTimingStore = {
  timing: QuickFetchTiming;
  /** User edited timing — disables Quick refresh sleep multiplier. */
  customized: boolean;
};

const STORAGE_KEY = 'pcgr:quick_fetch_timing:v1';

export function clampMs(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function applyQuickFetchTimingPatch(
  base: QuickFetchTiming,
  partial: Partial<QuickFetchTiming>
): QuickFetchTiming {
  return mergeTimingPartial({ ...base, ...partial } as Partial<Record<string, unknown>>);
}

function mergeTimingPartial(raw: Partial<Record<string, unknown>>): QuickFetchTiming {
  const d = DEFAULT_QUICK_FETCH_TIMING;
  const num = (k: keyof QuickFetchTiming): number => {
    const v = raw[k as string];
    return typeof v === 'number' && Number.isFinite(v) ? v : d[k];
  };
  return {
    tabUrlVerifyPollMs: clampMs(num('tabUrlVerifyPollMs'), 50, 120000),
    ebayPostActivateMs: clampMs(num('ebayPostActivateMs'), 0, 120000),
    ebayImpatienceMs: clampMs(num('ebayImpatienceMs'), 0, 60000),
    ebayPerPageTarget: clampInt(num('ebayPerPageTarget'), 50, 240),
    ebayQuickRefreshMaxPerPage: clampInt(num('ebayQuickRefreshMaxPerPage'), 25, 240),
    ebayQuickStopBufferMs: clampMs(num('ebayQuickStopBufferMs'), 0, 30 * 86_400_000),
    ebayDeepFetchConcurrency: clampInt(num('ebayDeepFetchConcurrency'), 1, 8),
    ebayDeepBudgetMs: clampMs(num('ebayDeepBudgetMs'), 30_000, 240_000),
    tcgSinglePostActivateMs: clampMs(num('tcgSinglePostActivateMs'), 0, 120000),
    tcgDeepInitialSettleMs: clampMs(num('tcgDeepInitialSettleMs'), 0, 120000),
    tcgDeepAfterDefaultActivateMs: clampMs(num('tcgDeepAfterDefaultActivateMs'), 0, 120000),
    tcgDeepBetweenCapturesLeadMs: clampMs(num('tcgDeepBetweenCapturesLeadMs'), 0, 120000),
    tcgDeepBeforeDeepCaptureMs: clampMs(num('tcgDeepBeforeDeepCaptureMs'), 0, 120000),
    tcgImpatienceMs: clampMs(num('tcgImpatienceMs'), 0, 60000),
    tcgPrePageSettleMs: clampMs(num('tcgPrePageSettleMs'), 0, 120000),
    tcgViewMoreWaitMs: clampMs(num('tcgViewMoreWaitMs'), 0, 120000),
    tcgDeepExtraSettleMs: clampMs(num('tcgDeepExtraSettleMs'), 0, 120000),
    tcgMinSalesRows: clampInt(num('tcgMinSalesRows'), 0, 100),
    tcgSalesFeedTimeoutMs: clampMs(num('tcgSalesFeedTimeoutMs'), 1000, 300000),
    tcgSalesFeedPollMs: clampMs(num('tcgSalesFeedPollMs'), 50, 10000),
    tcgViewMoreMaxAttempts: clampInt(num('tcgViewMoreMaxAttempts'), 1, 20),
    quickRefreshSleepMultiplier: clampMs(num('quickRefreshSleepMultiplier'), 0.1, 1),
  };
}

export function loadQuickFetchTimingStore(): QuickFetchTimingStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { timing: { ...DEFAULT_QUICK_FETCH_TIMING }, customized: false };
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const customized = parsed.customized === true;
    const tIn = parsed.timing;
    if (tIn && typeof tIn === 'object') {
      return { timing: mergeTimingPartial(tIn as Partial<Record<string, unknown>>), customized };
    }
    if (typeof parsed.tabUrlVerifyPollMs === 'number' || typeof parsed.ebayPostActivateMs === 'number') {
      return { timing: mergeTimingPartial(parsed), customized };
    }
    return { timing: { ...DEFAULT_QUICK_FETCH_TIMING }, customized };
  } catch {
    return { timing: { ...DEFAULT_QUICK_FETCH_TIMING }, customized: false };
  }
}

export function saveQuickFetchTimingStore(store: QuickFetchTimingStore): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        customized: store.customized,
        timing: store.timing,
      })
    );
  } catch {
    /* quota / private mode */
  }
}

/** Post-activate / settle sleeps only (not URL poll). Quick refresh halves unless customized. */
export function resolvePostActivateSleep(
  baseMs: number,
  opts: {
    incremental: boolean;
    customized: boolean;
    timing: QuickFetchTiming;
  }
): number {
  const ms = clampMs(baseMs, 0, 120000);
  if (opts.customized || !opts.incremental) return ms;
  const m = opts.timing.quickRefreshSleepMultiplier;
  const mult = typeof m === 'number' && m > 0 && m <= 1 ? m : DEFAULT_QUICK_FETCH_TIMING.quickRefreshSleepMultiplier;
  return Math.round(ms * mult);
}

export function buildEbayCaptureOptions(
  timing: QuickFetchTiming,
  ebaySoldWatermarkMs: number | null,
  opts: {
    quickFetchIncremental: boolean;
    profile?: QuickFetchCaptureProfile;
    sealedQuickFetch?: boolean;
    aggressiveDeep?: boolean;
  }
): Record<string, unknown> {
  const incremental = opts.quickFetchIncremental === true;
  const sealed = opts.sealedQuickFetch === true;
  const fast = opts.profile === 'fast';
  const hasWm = ebaySoldWatermarkMs != null && Number.isFinite(ebaySoldWatermarkMs as number);
  const quick = incremental && hasWm;
  const perPage = quick
    ? Math.min(
        sealed ? timing.ebayQuickRefreshMaxPerPage : timing.ebayPerPageTarget,
        Math.max(25, Math.min(240, timing.ebayQuickRefreshMaxPerPage))
      )
    : timing.ebayPerPageTarget;
  const bufferMs = clampMs(timing.ebayQuickStopBufferMs, 0, 30 * 86_400_000);
  const o: Record<string, unknown> = {
    skipUpload: true,
    simulateImpatience: !fast,
    impatienceMs: fast ? 0 : clampMs(timing.ebayImpatienceMs, 0, 60000),
    ebayPerPageTarget: perPage,
    ebayDeepFetchConcurrency: timing.ebayDeepFetchConcurrency,
    ebayDeepBudgetMs: timing.ebayDeepBudgetMs,
    ebayAdaptivePerPage: hasWm,
  };
  if (opts.aggressiveDeep) {
    o.ebayDeepFetchConcurrency = Math.max(o.ebayDeepFetchConcurrency as number, 6);
  }
  if (hasWm && ebaySoldWatermarkMs != null) {
    o.ebaySoldWatermarkMs = ebaySoldWatermarkMs;
    o.ebayStopDeepPagingWhenPageMaxSoldAtLteMs = ebaySoldWatermarkMs - bufferMs;
  }
  if (quick) {
    o.ebayQuickRefresh = true;
  }
  return o;
}

export function buildTcgCaptureOptions(
  timing: QuickFetchTiming,
  tcgSalesWatermarkMs: number | null = null,
  opts?: { profile?: QuickFetchCaptureProfile }
): Record<string, unknown> {
  const fast = opts?.profile === 'fast';
  const o: Record<string, unknown> = {
    simulateImpatience: !fast,
    impatienceMs: fast ? 0 : timing.tcgImpatienceMs,
    openTcgViewMoreData: true,
    tcgViewMoreWaitMs: timing.tcgViewMoreWaitMs,
    tcgPrePageSettleMs: timing.tcgPrePageSettleMs,
    tcgDeepExtraSettleMs: timing.tcgDeepExtraSettleMs,
    tcgMinSalesRows: timing.tcgMinSalesRows,
    tcgSalesFeedTimeoutMs: timing.tcgSalesFeedTimeoutMs,
    tcgSalesFeedPollMs: timing.tcgSalesFeedPollMs,
    tcgViewMoreMaxAttempts: timing.tcgViewMoreMaxAttempts,
  };
  if (tcgSalesWatermarkMs != null) o.tcgSalesWatermarkMs = tcgSalesWatermarkMs;
  return o;
}
