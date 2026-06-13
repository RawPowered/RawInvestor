import { Database, SlidersHorizontal, Terminal } from 'lucide-react';
import { formatRelative } from '../utils/time';
import { SettingsPanel } from './SettingsPanel';
import { RawEngineCaptureDiagnostics } from './RawEngineCaptureDiagnostics';
import type { AdminPanelSection, CollectionImportIssue, CollectionImportProgress } from './types';
import type { Fees } from '../types';
import type { PortfolioKindScope } from '../sort';
import type { SyncStatus } from '../serverSync';
import type { QuickFetchTiming } from '../utils/quickFetchTiming';
import type { QuickCardAdminSettings } from '../utils/quickCardAdminSettings';
import type { StreamerSkinId } from '../quick/streamer/skins/types';

const fmtBytes = (n: number): string => {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
};

export type AdminStatsState = {
  captureStats: {
    dbPath: string;
    dbSizeBytes: number;
    totalCaptures: number;
    bySource: Array<{ source: 'tcgplayer' | 'pricecharting' | 'ebay'; count: number }>;
    oldestCapturedAt: number | null;
    newestCapturedAt: number | null;
  };
  portfolio: {
    dataFile: string;
    backupVaultDir?: string;
    backupsCount: number;
    latestBackup: string | null;
  };
  portfolioSqlite?: {
    dbPath: string;
    dbSizeBytes: number;
    hasSnapshot: boolean;
    updatedAt: number | null;
    cardCount: number;
  };
  appPortfolio?: { dbPath: string; cardCount: number };
  rotatingBackups?: {
    sqlDir: string;
    jsonDir: string;
    sqlCount: number;
    jsonCount: number;
    latestSql: string | null;
    latestJson: string | null;
    backupSettings: {
      intervalDays: number;
      retainSql: number;
      retainJson: number;
      enabledSql: boolean;
      enabledJson: boolean;
      lastRunAt: number;
    };
  };
};

export const AdminControlPanel = ({
  adminSection,
  onAdminSectionChange,
  settingsProps,
  adminBusy,
  adminError,
  adminStats,
  onRefreshStats,
  onEbayTitleBackfill,
  onRepairPricechartingLinks,
  onRebuildPricechartingStats,
  onRunRotatingBackup,
}: {
  adminSection: AdminPanelSection;
  onAdminSectionChange: (s: AdminPanelSection) => void;
  settingsProps: {
    fees: Fees;
    setFees: (f: Fees) => void;
    onResetFees: () => void;
    psaToken: string;
    setPsaToken: (t: string) => void;
    googleCseKey: string;
    setGoogleCseKey: (t: string) => void;
    googleCseCx: string;
    setGoogleCseCx: (t: string) => void;
    syncStatus: SyncStatus;
    lastSavedAt: number | null;
    onExport: () => void;
    onExportCardsNdjson: () => void;
    onImport: (file: File) => void;
    onImportCollection: (file: File, opts: { skipIfAlreadyInCollection: boolean }) => void;
    importProgress: CollectionImportProgress | null;
    importIssues: CollectionImportIssue[];
    onRetryFailedImport: (opts: { skipIfAlreadyInCollection: boolean }) => void;
    onExportImportIssues: () => void;
    onExportRetryFile: () => void;
    extensionLatestOnlyMode: boolean;
    onExtensionLatestOnlyModeChange: (v: boolean) => void;
    portfolioKindScope: PortfolioKindScope;
    onPortfolioKindScopeChange: (v: PortfolioKindScope) => void;
    quickFetchTiming: QuickFetchTiming;
    onQuickFetchTimingFieldChange: <K extends keyof QuickFetchTiming>(k: K, v: QuickFetchTiming[K]) => void;
    onResetQuickFetchTimingDefaults: () => void;
    quickCardAdminSettings: QuickCardAdminSettings;
    onQuickCardAdminSettingsChange: (patch: Partial<QuickCardAdminSettings>) => void;
    streamerSkinId: StreamerSkinId;
    onStreamerSkinIdChange: (id: StreamerSkinId) => void;
    onGoogleCseKeysSaved?: (updatedAt: number) => void;
  };
  adminBusy: boolean;
  adminError: string | null;
  adminStats: AdminStatsState | null;
  onRefreshStats: () => void;
  onEbayTitleBackfill: (dryRun: boolean) => void;
  onRepairPricechartingLinks: (dryRun: boolean) => void;
  onRebuildPricechartingStats: (dryRun: boolean) => void;
  onRunRotatingBackup?: () => void;
}) => {
  return (
    <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 px-4 md:px-6 py-4 text-white">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-75">Control panel</p>
        <h3 className="text-lg font-black tracking-tight">Admin</h3>
        <p className="text-xs text-white/70 font-medium mt-1 max-w-prose">
          Configuration, portfolio storage, and database maintenance in one place.
        </p>
      </div>

      <div
        role="tablist"
        aria-label="Admin sections"
        className="flex flex-wrap gap-2 px-4 pt-4 border-b border-slate-100 bg-slate-50/80"
      >
        <button
          type="button"
          role="tab"
          aria-selected={adminSection === 'configuration'}
          onClick={() => onAdminSectionChange('configuration')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-t-lg text-xs font-black uppercase tracking-widest border border-b-0 transition-colors ${
            adminSection === 'configuration'
              ? 'bg-white text-slate-900 border-slate-200 shadow-sm relative top-[1px]'
              : 'bg-transparent text-slate-600 border-transparent hover:text-slate-900'
          }`}
        >
          <SlidersHorizontal size={14} />
          Configuration
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={adminSection === 'database'}
          onClick={() => onAdminSectionChange('database')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-t-lg text-xs font-black uppercase tracking-widest border border-b-0 transition-colors ${
            adminSection === 'database'
              ? 'bg-white text-slate-900 border-slate-200 shadow-sm relative top-[1px]'
              : 'bg-transparent text-slate-600 border-transparent hover:text-slate-900'
          }`}
        >
          <Database size={14} />
          Database & maintenance
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={adminSection === 'diagnostics'}
          onClick={() => onAdminSectionChange('diagnostics')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-t-lg text-xs font-black uppercase tracking-widest border border-b-0 transition-colors ${
            adminSection === 'diagnostics'
              ? 'bg-white text-slate-900 border-slate-200 shadow-sm relative top-[1px]'
              : 'bg-transparent text-slate-600 border-transparent hover:text-slate-900'
          }`}
        >
          <Terminal size={14} />
          Diagnostics
        </button>
      </div>

      <div className="p-4 md:p-6">
        {adminSection === 'configuration' ? (
          <SettingsPanel {...settingsProps} embedded />
        ) : adminSection === 'database' ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-black uppercase tracking-[0.12em] text-slate-700">Database & maintenance</h4>
                <p className="text-xs text-slate-500 font-medium">
                  Monitor extension captures, portfolio databases, rotating backups, and maintenance jobs.
                </p>
                <p className="text-[11px] text-slate-500 mt-2 max-w-prose leading-relaxed">
                  <span className="font-semibold text-slate-600">Factory reset</span> is under{' '}
                  <span className="font-semibold">Configuration</span> →{' '}
                  <span className="font-semibold">Portfolio & backups</span> →{' '}
                  <span className="font-semibold">Factory reset…</span> (desktop app only). Maintenance APIs here require auth
                  only when the API runs in hardened production; the packaged app sends{' '}
                  <code className="font-mono bg-slate-100 px-1 rounded text-[10px]">x-pcgr-app-token</code> automatically.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void onRefreshStats()}
                  disabled={adminBusy}
                  className="px-3 py-2 rounded-lg text-xs font-black uppercase tracking-widest border border-slate-200 bg-slate-50 hover:bg-slate-100 disabled:opacity-50"
                >
                  Refresh Admin Stats
                </button>
                {onRunRotatingBackup ? (
                  <button
                    type="button"
                    onClick={() => void onRunRotatingBackup()}
                    disabled={adminBusy}
                    className="px-3 py-2 rounded-lg text-xs font-black uppercase tracking-widest border border-slate-200 bg-teal-50 text-teal-900 hover:bg-teal-100 disabled:opacity-50"
                  >
                    Run rotating backup now
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => void onEbayTitleBackfill(true)}
                  disabled={adminBusy}
                  className="px-3 py-2 rounded-lg text-xs font-black uppercase tracking-widest border border-slate-200 bg-amber-50 text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                >
                  Dry Run eBay Backfill
                </button>
                <button
                  type="button"
                  onClick={() => void onEbayTitleBackfill(false)}
                  disabled={adminBusy}
                  className="px-3 py-2 rounded-lg text-xs font-black uppercase tracking-widest border border-slate-200 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                >
                  Run eBay Backfill
                </button>
                <button
                  type="button"
                  onClick={() => void onRepairPricechartingLinks(true)}
                  disabled={adminBusy}
                  className="px-3 py-2 rounded-lg text-xs font-black uppercase tracking-widest border border-slate-200 bg-violet-50 text-violet-700 hover:bg-violet-100 disabled:opacity-50"
                >
                  Dry Run PC Link Repair
                </button>
                <button
                  type="button"
                  onClick={() => void onRepairPricechartingLinks(false)}
                  disabled={adminBusy}
                  className="px-3 py-2 rounded-lg text-xs font-black uppercase tracking-widest border border-slate-200 bg-violet-100 text-violet-800 hover:bg-violet-200 disabled:opacity-50"
                >
                  Run PC Link Repair
                </button>
                <button
                  type="button"
                  onClick={() => void onRebuildPricechartingStats(true)}
                  disabled={adminBusy}
                  className="px-3 py-2 rounded-lg text-xs font-black uppercase tracking-widest border border-slate-200 bg-fuchsia-50 text-fuchsia-700 hover:bg-fuchsia-100 disabled:opacity-50"
                >
                  Dry Run PC Stats Rebuild
                </button>
                <button
                  type="button"
                  onClick={() => void onRebuildPricechartingStats(false)}
                  disabled={adminBusy}
                  className="px-3 py-2 rounded-lg text-xs font-black uppercase tracking-widest border border-slate-200 bg-fuchsia-100 text-fuchsia-800 hover:bg-fuchsia-200 disabled:opacity-50"
                >
                  Run PC Stats Rebuild
                </button>
              </div>
            </div>
            {adminError && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{adminError}</div>
            )}
            {adminStats ? (
              <div className="grid md:grid-cols-2 gap-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
                  <div className="text-[10px] uppercase tracking-[0.11em] font-bold text-slate-500">Capture Database</div>
                  <div className="text-xs text-slate-700">
                    Total captures:{' '}
                    <span className="font-semibold text-slate-900">{adminStats.captureStats.totalCaptures}</span>
                  </div>
                  <div className="text-xs text-slate-700">
                    File size: <span className="font-semibold text-slate-900">{fmtBytes(adminStats.captureStats.dbSizeBytes)}</span>
                  </div>
                  <div className="text-xs text-slate-700">
                    Oldest:{' '}
                    <span className="font-semibold text-slate-900">
                      {adminStats.captureStats.oldestCapturedAt ? formatRelative(adminStats.captureStats.oldestCapturedAt) : '—'}
                    </span>
                  </div>
                  <div className="text-xs text-slate-700">
                    Newest:{' '}
                    <span className="font-semibold text-slate-900">
                      {adminStats.captureStats.newestCapturedAt ? formatRelative(adminStats.captureStats.newestCapturedAt) : '—'}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 break-all">{adminStats.captureStats.dbPath}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {adminStats.captureStats.bySource.map((s) => (
                      <span key={s.source} className="px-2 py-1 rounded-full border border-slate-200 bg-white text-[10px] font-semibold text-slate-700">
                        {s.source}: {s.count}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3 space-y-2">
                  <div className="text-[10px] uppercase tracking-[0.11em] font-bold text-emerald-800">
                    Primary portfolio (v2 SQLite)
                  </div>
                  <p className="text-[11px] text-slate-600 leading-snug">
                    Runtime source of truth for cards. All reads/writes go here.
                  </p>
                  <div className="text-xs text-slate-700">
                    Cards: <span className="font-semibold text-slate-900">{adminStats.appPortfolio?.cardCount ?? 0}</span>
                  </div>
                  {adminStats.appPortfolio?.dbPath ? (
                    <div className="text-[11px] text-slate-500 break-all">{adminStats.appPortfolio.dbPath}</div>
                  ) : (
                    <div className="text-[11px] text-slate-400">—</div>
                  )}
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2 md:col-span-2">
                  <div className="text-[10px] uppercase tracking-[0.11em] font-bold text-slate-500">
                    Legacy portfolio snapshot (single-row SQLite)
                  </div>
                  <p className="text-[11px] text-slate-600 leading-snug max-w-prose">
                    Older mirror format — not the v2 row store. Use &quot;Primary portfolio&quot; above for card counts.
                  </p>
                  <div className="text-xs text-slate-700">
                    Snapshot card count:{' '}
                    <span className="font-semibold text-slate-900">{adminStats.portfolioSqlite?.cardCount ?? 0}</span>
                  </div>
                  <div className="text-xs text-slate-700">
                    File size:{' '}
                    <span className="font-semibold text-slate-900">{fmtBytes(adminStats.portfolioSqlite?.dbSizeBytes ?? 0)}</span>
                  </div>
                  <div className="text-xs text-slate-700">
                    Last snapshot write:{' '}
                    <span className="font-semibold text-slate-900">
                      {adminStats.portfolioSqlite?.updatedAt ? formatRelative(adminStats.portfolioSqlite.updatedAt) : '—'}
                    </span>
                  </div>
                  {adminStats.portfolioSqlite?.dbPath ? (
                    <div className="text-[11px] text-slate-500 break-all">{adminStats.portfolioSqlite.dbPath}</div>
                  ) : null}
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2 md:col-span-2">
                  <div className="text-[10px] uppercase tracking-[0.11em] font-bold text-slate-500">
                    portfolio.json + dated vault
                  </div>
                  <div className="text-xs text-slate-700">
                    Dated vault backups: <span className="font-semibold text-slate-900">{adminStats.portfolio.backupsCount}</span>
                  </div>
                  <div className="text-xs text-slate-700">
                    Latest vault file: <span className="font-semibold text-slate-900">{adminStats.portfolio.latestBackup ?? '—'}</span>
                  </div>
                  <div className="text-[11px] text-slate-500 break-all">{adminStats.portfolio.dataFile}</div>
                  {adminStats.portfolio.backupVaultDir ? (
                    <div className="text-xs text-slate-700">
                      Vault dir:{' '}
                      <span className="font-semibold text-slate-900 break-all">{adminStats.portfolio.backupVaultDir}</span>
                    </div>
                  ) : null}
                </div>
                {adminStats.rotatingBackups ? (
                  <div className="rounded-xl border border-teal-200 bg-teal-50/40 p-3 space-y-2 md:col-span-2">
                    <div className="text-[10px] uppercase tracking-[0.11em] font-bold text-teal-900">
                      Rotating portfolio backups (v2 SQLite + JSON export)
                    </div>
                    <p className="text-[11px] text-slate-600 leading-snug max-w-prose">
                      Scheduled copies under your data directory (default interval{' '}
                      {adminStats.rotatingBackups.backupSettings.intervalDays} days). SQL backups are primary recovery;
                      JSON is fallback/portability.
                    </p>
                    <div className="grid sm:grid-cols-2 gap-2 text-xs text-slate-700">
                      <div>
                        SQL files:{' '}
                        <span className="font-semibold text-slate-900">{adminStats.rotatingBackups.sqlCount}</span>
                        <span className="block text-[11px] text-slate-500 break-all mt-0.5">
                          {adminStats.rotatingBackups.sqlDir}
                        </span>
                        <span className="text-[11px] text-slate-500">
                          Latest: {adminStats.rotatingBackups.latestSql ?? '—'}
                        </span>
                      </div>
                      <div>
                        JSON exports:{' '}
                        <span className="font-semibold text-slate-900">{adminStats.rotatingBackups.jsonCount}</span>
                        <span className="block text-[11px] text-slate-500 break-all mt-0.5">
                          {adminStats.rotatingBackups.jsonDir}
                        </span>
                        <span className="text-[11px] text-slate-500">
                          Latest: {adminStats.rotatingBackups.latestJson ?? '—'}
                        </span>
                      </div>
                    </div>
                    <div className="text-[11px] text-slate-600">
                      Retention: SQL {adminStats.rotatingBackups.backupSettings.retainSql}, JSON{' '}
                      {adminStats.rotatingBackups.backupSettings.retainJson}. Enabled: SQL{' '}
                      {adminStats.rotatingBackups.backupSettings.enabledSql ? 'yes' : 'no'}, JSON{' '}
                      {adminStats.rotatingBackups.backupSettings.enabledJson ? 'yes' : 'no'}. Last run:{' '}
                      {adminStats.rotatingBackups.backupSettings.lastRunAt
                        ? formatRelative(adminStats.rotatingBackups.backupSettings.lastRunAt)
                        : '—'}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-slate-500">No admin stats loaded yet.</p>
            )}
          </div>
        ) : (
          <RawEngineCaptureDiagnostics />
        )}
      </div>
    </div>
  );
};
