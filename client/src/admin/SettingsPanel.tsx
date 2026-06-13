import { useEffect, useRef, useState } from 'react';
import {
  Settings2,
  KeyRound,
  ExternalLink,
  Sparkles,
  Cloud,
  Download,
  Upload,
  Trash2,
  Loader2,
  FolderOpen,
  Search,
  LayoutList,
  Clock,
  Store,
  Puzzle,
  Copy,
  RefreshCw,
} from 'lucide-react';
import type { Fees } from '../types';
import type { SyncStatus } from '../serverSync';
import { patchPortfolioMetaOnServer } from '../serverSync';
import { invalidateEbayApiConfigCache } from '../services/ebayApiSold';
import {
  apiUrl,
  buildApiHeaders,
  copyTextToClipboard,
  getBundledExtensionPath,
  getDefaultCaptureBrowser,
  getRawEngineRuntime,
  openBundledExtensionFolder,
  prepareExtensionInstall,
  openLocalPath,
  shouldPersistPsaToken,
} from '../apiBase';
import { Field, NumberInput, INPUT_CLASS as inputCls } from '../shared/formFields';
import { SyncBadge } from '../SyncBadge';
import { getRawEngineFactoryReset } from './rawEngineFactoryReset';
import { getRawEngineImportChromiumCookies } from './rawEngineChromiumCookieImport';
import type { CollectionImportIssue, CollectionImportProgress } from './types';
import type { PortfolioKindScope } from '../sort';
import type { QuickFetchTiming } from '../utils/quickFetchTiming';
import type { QuickCardAdminSettings } from '../utils/quickCardAdminSettings';
import type { StreamerSkinId } from '../quick/streamer/skins/types';
import { StreamerSkinPicker } from '../quick/streamer/StreamerSkinPicker';
import type { QuickFetchMarketMode } from '../utils/quickFetchMarketMode';
import { ExtensionInstallGuide } from '../extension/ExtensionInstallGuide';
import { EbayCapturePluginHost } from '../plugins/ebay-capture/components/EbayCapturePluginHost';
import { EbayCaptureTimingSectionLazy } from '../plugins/ebay-capture/registry';
import { useEbayCapturePluginSettings } from '../plugins/ebay-capture/hooks/useEbayCapturePluginSettings';

const SettingsPathRow = ({
  label,
  value,
  onOpen,
}: {
  label: string;
  value: string;
  onOpen: () => void;
}) => {
  const hasOpen =
    typeof window !== 'undefined' &&
    typeof (window as Window & { rawEngine?: { openPath?: unknown } }).rawEngine?.openPath === 'function';
  return (
    <div className="flex flex-wrap items-start gap-2 text-[11px]">
      <span className="text-slate-500 shrink-0 w-40 font-medium">{label}</span>
      <code className="flex-1 min-w-0 break-all text-slate-800 bg-white rounded px-2 py-1.5 border border-slate-100 leading-snug">
        {value}
      </code>
      {hasOpen ? (
        <button
          type="button"
          onClick={onOpen}
          className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-800 text-[10px] font-bold uppercase tracking-wide"
        >
          <FolderOpen size={12} /> Open
        </button>
      ) : null}
    </div>
  );
};

export const SettingsPanel = ({
  fees,
  setFees,
  onResetFees,
  psaToken,
  setPsaToken,
  googleCseKey,
  setGoogleCseKey,
  googleCseCx,
  setGoogleCseCx,
  syncStatus,
  lastSavedAt,
  onExport,
  onExportCardsNdjson,
  onImport,
  onImportCollection,
  importProgress,
  importIssues,
  onRetryFailedImport,
  onExportImportIssues,
  onExportRetryFile,
  extensionLatestOnlyMode,
  onExtensionLatestOnlyModeChange,
  portfolioKindScope,
  onPortfolioKindScopeChange,
  quickFetchTiming,
  onQuickFetchTimingFieldChange,
  onResetQuickFetchTimingDefaults,
  quickCardAdminSettings,
  onQuickCardAdminSettingsChange,
  streamerSkinId,
  onStreamerSkinIdChange,
  embedded = false,
  onGoogleCseKeysSaved,
}: {
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
  embedded?: boolean;
  /** After successful explicit Google CSE save — parent can align sync baseline / lastSavedAt. */
  onGoogleCseKeysSaved?: (updatedAt: number) => void;
}) => {
  const set = <K extends keyof Fees>(k: K, v: number) => setFees({ ...fees, [k]: v });
  const { settings: ebayPluginSettings, patch: patchEbayPluginSettings } = useEbayCapturePluginSettings();
  const [reveal, setReveal] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const importCollectionInputRef = useRef<HTMLInputElement | null>(null);
  const [skipDupes, setSkipDupes] = useState(true);
  const factoryReset = typeof window !== 'undefined' ? getRawEngineFactoryReset() : null;
  const importChromiumCookies = typeof window !== 'undefined' ? getRawEngineImportChromiumCookies() : null;
  const [preserveLoginSessions, setPreserveLoginSessions] = useState(false);
  const [clearCacheAndBrowsingHistory, setClearCacheAndBrowsingHistory] = useState(true);
  const [clearPasswordAndUsernameHistory, setClearPasswordAndUsernameHistory] = useState(false);
  const [factoryResetBusy, setFactoryResetBusy] = useState(false);
  const [factoryResetMessage, setFactoryResetMessage] = useState<string | null>(null);
  const [chromiumCookieImportBusy, setChromiumCookieImportBusy] = useState(false);
  const [chromiumCookieImportMessage, setChromiumCookieImportMessage] = useState<string | null>(null);
  const [ebayClientId, setEbayClientId] = useState('');
  const [ebayClientSecretDraft, setEbayClientSecretDraft] = useState('');
  const [ebayEnv, setEbayEnv] = useState<'production' | 'sandbox'>('production');
  const [ebaySecretConfigured, setEbaySecretConfigured] = useState(false);
  const [ebayEffectiveSource, setEbayEffectiveSource] = useState<'meta' | 'env' | null>(null);
  const [ebayEffectiveConfigured, setEbayEffectiveConfigured] = useState(false);
  const [ebayConfigBusy, setEbayConfigBusy] = useState(false);
  const [ebayTestBusy, setEbayTestBusy] = useState(false);
  const [ebaySoldTestBusy, setEbaySoldTestBusy] = useState(false);
  const [ebayApiFirstIncremental, setEbayApiFirstIncremental] = useState(true);
  const [ebayConfigMessage, setEbayConfigMessage] = useState<string | null>(null);
  const [googleCseSaveBusy, setGoogleCseSaveBusy] = useState(false);
  const [googleCseSaveMessage, setGoogleCseSaveMessage] = useState<string | null>(null);
  const [extFolderBusy, setExtFolderBusy] = useState(false);
  const [extFolderMessage, setExtFolderMessage] = useState<string | null>(null);
  const [extPath, setExtPath] = useState<string | null>(null);
  const [extPathLoading, setExtPathLoading] = useState(false);
  const [extSetupHint, setExtSetupHint] = useState<string | null>(null);
  const [extRefreshBusy, setExtRefreshBusy] = useState(false);
  const [extInstallGuideOpen, setExtInstallGuideOpen] = useState(false);
  const [defaultCaptureBrowser, setDefaultCaptureBrowser] = useState<'edge' | 'chrome'>('edge');
  const [storageLocations, setStorageLocations] = useState<{
    dataDir: string;
    backupVaultDir: string;
    legacyBackupsDir: string;
    portfolioJson: string;
    appPortfolioDb: string;
    imagesDir: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(apiUrl('/api/portfolio/storage-locations'), {
          headers: buildApiHeaders({ Accept: 'application/json' }),
        });
        if (!r.ok) return;
        const j = (await r.json()) as NonNullable<typeof storageLocations>;
        if (!cancelled && j?.backupVaultDir) setStorageLocations(j);
      } catch {
        /* offline */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(apiUrl('/api/ebay/config'), { headers: buildApiHeaders({ Accept: 'application/json' }) });
        const text = await r.text();
        let j: Record<string, unknown> = {};
        try {
          j = text ? (JSON.parse(text) as Record<string, unknown>) : {};
        } catch {
          j = {};
        }
        if (!r.ok) {
          if (!cancelled) {
            const err =
              typeof j.error === 'string' && j.error.trim()
                ? j.error.trim()
                : text.trim().length > 0 && text.trim().length < 400
                  ? text.trim()
                  : `Could not load eBay API settings (HTTP ${r.status}).`;
            setEbayConfigMessage(err);
          }
          return;
        }
        if (cancelled) return;
        setEbayClientId(typeof j.ebayClientId === 'string' ? j.ebayClientId : '');
        setEbaySecretConfigured(j.ebayClientSecretConfigured === true);
        setEbayEnv(j.ebayEnv === 'sandbox' ? 'sandbox' : 'production');
        setEbayEffectiveSource(j.effectiveCredentialSource === 'env' || j.effectiveCredentialSource === 'meta' ? j.effectiveCredentialSource : null);
        setEbayEffectiveConfigured(j.effectiveConfigured === true);
        setEbayApiFirstIncremental(j.ebayApiFirstIncremental !== false);
        setEbayClientSecretDraft('');
      } catch {
        /* offline */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const rawEngineRt = getRawEngineRuntime();
  const isElectronUi = Boolean(rawEngineRt.userDataDir || rawEngineRt.backupVaultDir);

  useEffect(() => {
    if (!isElectronUi) return;
    let cancelled = false;
    setExtPathLoading(true);
    void (async () => {
      const [pathR, browserR] = await Promise.all([getBundledExtensionPath(), getDefaultCaptureBrowser()]);
      if (cancelled) return;
      setExtPathLoading(false);
      if (pathR.ok && pathR.path) setExtPath(pathR.path);
      else setExtPath(null);
      setDefaultCaptureBrowser(browserR.browser);
    })();
    return () => {
      cancelled = true;
    };
  }, [isElectronUi]);

  const inner = (
    <>
      {embedded ? (
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 mb-2 border-b border-slate-100">
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Runtime</p>
          <div className="flex flex-wrap gap-2 justify-end">
            <span
              className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border ${
                isElectronUi
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  : 'bg-amber-50 text-amber-800 border-amber-200'
              }`}
            >
              {isElectronUi ? 'Desktop app' : 'Browser'}
            </span>
            {rawEngineRt.isPackaged ? (
              <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-slate-100 border border-slate-200 text-slate-700">
                Packaged EXE
              </span>
            ) : isElectronUi ? (
              <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-slate-100 border border-slate-200 text-slate-700">
                Dev / unpack
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      <div>
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-black uppercase tracking-widest text-sm flex items-center gap-2 text-slate-700">
            <Settings2 size={16} /> Fee Structure
          </h3>
          <button
            onClick={onResetFees}
            className="text-xs font-bold text-slate-500 hover:text-slate-800 uppercase tracking-wider"
          >
            Reset Defaults
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <Field label="Grading ($)">
            <NumberInput value={fees.gradingFee} onChange={(v) => set('gradingFee', v)} step={1} />
          </Field>
          <Field label="Ship->Grader ($)">
            <NumberInput value={fees.shipToGrader} onChange={(v) => set('shipToGrader', v)} step={0.5} />
          </Field>
          <Field label="Grader->You ($)">
            <NumberInput value={fees.shipFromGrader} onChange={(v) => set('shipFromGrader', v)} step={0.5} />
          </Field>
          <Field label="Sale Fee %">
            <NumberInput value={fees.saleFeePct} onChange={(v) => set('saleFeePct', v)} step={0.005} />
          </Field>
          <Field label="Sale Flat ($)">
            <NumberInput value={fees.saleFeeFlat} onChange={(v) => set('saleFeeFlat', v)} step={0.05} />
          </Field>
          <Field label="Ship->Buyer ($)">
            <NumberInput value={fees.shipToBuyer} onChange={(v) => set('shipToBuyer', v)} step={0.5} />
          </Field>
        </div>
      </div>

      <div className="border-t border-slate-200 pt-6">
        <div className="flex justify-between items-center mb-3">
          <h3 className="font-black uppercase tracking-widest text-sm flex items-center gap-2 text-slate-700">
            <KeyRound size={16} /> PSA API Token
          </h3>
          <a
            href="https://www.psacard.com/publicapi"
            target="_blank"
            rel="noreferrer"
            className="text-xs font-bold text-blue-600 hover:text-blue-800 uppercase tracking-wider flex items-center gap-1"
          >
            Get a free token <ExternalLink size={12} />
          </a>
        </div>
        <div className="flex gap-2">
          <input
            type={reveal ? 'text' : 'password'}
            placeholder="Paste PSA public API token..."
            className={inputCls + ' font-mono text-xs'}
            value={psaToken}
            onChange={(e) => setPsaToken(e.target.value.trim())}
          />
          <button
            onClick={() => setReveal((r) => !r)}
            className="bg-slate-100 hover:bg-slate-200 px-4 rounded-xl font-bold text-xs uppercase tracking-wider text-slate-600"
            type="button"
          >
            {reveal ? 'Hide' : 'Show'}
          </button>
        </div>
        <p className="text-xs text-slate-400 mt-2 font-medium">
          {shouldPersistPsaToken()
            ? 'Stored locally in your browser.'
            : 'Kept in memory for this app session (not persisted to localStorage).'}{' '}
          Free tier: 100 lookups/day. Required to fetch PSA population per card.
        </p>
      </div>

      <div className="border-t border-slate-200 pt-6">
        <div className="flex flex-wrap justify-between items-center gap-2 mb-3">
          <h3 className="font-black uppercase tracking-widest text-sm flex items-center gap-2 text-slate-700">
            <Search size={16} /> Google Programmable Search (buyer&apos;s guide)
          </h3>
          <div className="flex flex-wrap gap-3 text-xs font-bold uppercase tracking-wider">
            <a
              href="https://developers.google.com/custom-search/v1/overview"
              target="_blank"
              rel="noreferrer"
              className="text-blue-600 hover:text-blue-800 flex items-center gap-1"
            >
              Custom Search JSON API <ExternalLink size={12} />
            </a>
            <a
              href="https://programmablesearchengine.google.com/controlpanel/all"
              target="_blank"
              rel="noreferrer"
              className="text-blue-600 hover:text-blue-800 flex items-center gap-1"
            >
              Search engine (cx) <ExternalLink size={12} />
            </a>
          </div>
        </div>
        <p className="text-xs text-slate-500 font-medium mb-3 leading-relaxed">
          Optional: discover TCGPlayer buyer&apos;s guide URLs from the client. Keys are saved in portfolio meta (synced with your data). You can
          also set <code className="font-mono bg-slate-100 px-1 rounded text-[11px]">GOOGLE_CSE_KEY</code> /{' '}
          <code className="font-mono bg-slate-100 px-1 rounded text-[11px]">GOOGLE_CSE_CX</code> on the API server instead.
        </p>
        <Field label="API key">
          <input
            type="password"
            autoComplete="off"
            placeholder="AIza…"
            className={inputCls + ' font-mono text-xs'}
            value={googleCseKey}
            onChange={(e) => setGoogleCseKey(e.target.value.trim())}
          />
        </Field>
        <Field label="Search engine ID (cx)">
          <input
            type="text"
            autoComplete="off"
            placeholder="017576662512468239146:omuauf_lfve"
            className={inputCls + ' font-mono text-xs'}
            value={googleCseCx}
            onChange={(e) => setGoogleCseCx(e.target.value.trim())}
          />
        </Field>
        {googleCseSaveMessage ? (
          <p className="text-xs font-semibold text-slate-700 mt-2">{googleCseSaveMessage}</p>
        ) : null}
        <div className="flex flex-wrap gap-2 mt-3">
          <button
            type="button"
            disabled={googleCseSaveBusy}
            onClick={async () => {
              setGoogleCseSaveMessage(null);
              setGoogleCseSaveBusy(true);
              try {
                const doc = await patchPortfolioMetaOnServer({ googleCseKey, googleCseCx });
                if (!doc) {
                  setGoogleCseSaveMessage(
                    'Save failed — API unreachable or rejected the request (check app token in hardened mode).'
                  );
                  return;
                }
                setGoogleCseSaveMessage('Google search keys saved to portfolio meta.');
                const u = typeof doc.updatedAt === 'number' ? doc.updatedAt : Date.now();
                onGoogleCseKeysSaved?.(u);
              } catch (e) {
                setGoogleCseSaveMessage(e instanceof Error ? e.message : String(e));
              } finally {
                setGoogleCseSaveBusy(false);
              }
            }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 disabled:opacity-60 text-white text-xs font-bold uppercase tracking-wider"
          >
            {googleCseSaveBusy ? <Loader2 className="animate-spin" size={14} /> : null}
            {googleCseSaveBusy ? 'Saving…' : 'Save Google search keys'}
          </button>
        </div>
      </div>

      <div className="border-t border-slate-200 pt-6">
        <div className="flex flex-wrap justify-between items-center gap-2 mb-3">
          <h3 className="font-black uppercase tracking-widest text-sm flex items-center gap-2 text-slate-700">
            <Puzzle size={16} /> Chrome / Edge capture extension
          </h3>
        </div>
        <p className="text-xs text-slate-500 font-medium mb-3 leading-relaxed">
          Load the capture extension once in your browser (Developer mode → Load unpacked). Use{' '}
          <strong>Set up extension</strong> for the guided steps — nothing opens File Explorer unless you choose Advanced
          below. After reinstall or update, use <strong>Refresh connection file</strong> so keys sync without reopening
          the browser. The popup should show <strong>Running</strong> while Raw Investor is open (
          {defaultCaptureBrowser === 'chrome' ? 'Chrome' : 'Edge'}).
        </p>
        {typeof window !== 'undefined' &&
        typeof (window as Window & { rawEngine?: { openBundledExtensionFolder?: unknown } }).rawEngine
          ?.openBundledExtensionFolder === 'function' ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                Stable extension folder
              </p>
              {extPathLoading ? (
                <p className="text-xs text-slate-500 font-mono">Resolving path…</p>
              ) : extPath ? (
                <code className="text-xs text-slate-800 break-all block leading-snug">{extPath}</code>
              ) : (
                <p className="text-xs text-amber-800">Path unavailable — launch the desktop app once to sync the folder.</p>
              )}
              <p className="text-[10px] text-slate-500 mt-2">
                Extension status in Edge: <strong>Running</strong> or <strong>Not Running</strong> (see extension popup).
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setExtSetupHint(null);
                  setExtFolderMessage(null);
                  setExtInstallGuideOpen(true);
                }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-700 hover:bg-indigo-800 text-white text-xs font-bold uppercase tracking-wider"
              >
                <Puzzle size={14} />
                Set up extension
              </button>
              <button
                type="button"
                disabled={extRefreshBusy}
                onClick={async () => {
                  setExtSetupHint(null);
                  setExtFolderMessage(null);
                  setExtRefreshBusy(true);
                  try {
                    const r = await prepareExtensionInstall();
                    if (r.ok) {
                      setExtSetupHint(
                        'Connection file refreshed. In the extension popup use Reload connection, or reload the extension in your browser.'
                      );
                      const pathR = await getBundledExtensionPath();
                      if (pathR.ok && pathR.path) setExtPath(pathR.path);
                      if (r.browser) setDefaultCaptureBrowser(r.browser);
                    } else {
                      setExtSetupHint(r.error || 'Refresh could not complete.');
                    }
                  } finally {
                    setExtRefreshBusy(false);
                  }
                }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-600 hover:bg-slate-700 disabled:opacity-60 text-white text-xs font-bold uppercase tracking-wider"
              >
                {extRefreshBusy ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />}
                {extRefreshBusy ? 'Refreshing…' : 'Refresh connection file'}
              </button>
              <button
                type="button"
                disabled={!extPath || extPathLoading}
                onClick={async () => {
                  setExtSetupHint(null);
                  if (!extPath) return;
                  const r = await copyTextToClipboard(extPath);
                  setExtSetupHint(r.ok ? 'Copied folder path.' : r.error || 'Copy failed.');
                }}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-700 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-bold uppercase tracking-wider"
              >
                <Copy size={14} />
                Copy path
              </button>
            </div>
            <p className="text-[10px] text-slate-500">
              Advanced:{' '}
              <button
                type="button"
                disabled={extFolderBusy}
                onClick={async () => {
                  setExtFolderMessage(null);
                  setExtFolderBusy(true);
                  try {
                    const r = await openBundledExtensionFolder();
                    if (!r.ok) setExtFolderMessage(r.error || 'Could not open folder.');
                    else setExtFolderMessage('Opened extension folder in File Explorer.');
                  } finally {
                    setExtFolderBusy(false);
                  }
                }}
                className="text-indigo-600 hover:text-indigo-800 font-semibold underline disabled:opacity-50"
              >
                {extFolderBusy ? 'Opening…' : 'Open extension folder in Explorer'}
              </button>
            </p>
            {extSetupHint ? (
              <p className="text-xs text-slate-600 font-medium max-w-prose">{extSetupHint}</p>
            ) : null}
            {extFolderMessage ? (
              <span className="text-xs text-slate-600 font-medium max-w-md block">{extFolderMessage}</span>
            ) : null}
          </div>
        ) : (
          <p className="text-[11px] text-slate-400 font-medium">
            Open-folder shortcut is only available in the Raw Investor desktop shell.
          </p>
        )}
      </div>

      <div className="border-t border-slate-200 pt-6">
        <div className="flex flex-wrap justify-between items-center gap-2 mb-3">
          <h3 className="font-black uppercase tracking-widest text-sm flex items-center gap-2 text-slate-700">
            <Store size={16} /> eBay API (application OAuth)
          </h3>
          <a
            href="https://developer.ebay.com/api-docs/static/oauth-client-credentials-grant.html"
            target="_blank"
            rel="noreferrer"
            className="text-xs font-bold text-blue-600 hover:text-blue-800 uppercase tracking-wider flex items-center gap-1"
          >
            Client credentials <ExternalLink size={12} />
          </a>
        </div>
        <p className="text-xs text-slate-500 font-medium mb-3 leading-relaxed">
          Optional: <strong>Client ID</strong> and <strong>Client Secret</strong> for eBay&apos;s application token (sold comps / Marketplace Insights).
          Values here are stored in portfolio meta and take precedence over <code className="font-mono bg-slate-100 px-1 rounded text-[11px]">EBAY_CLIENT_ID</code> /{' '}
          <code className="font-mono bg-slate-100 px-1 rounded text-[11px]">EBAY_CLIENT_SECRET</code> on the server. This does not fix Google blocking sign-in inside the embedded
          browser; use eBay password login or the MV3 extension for full-site sessions. Marketplace Insights must be enabled on your eBay developer app for sold comps.
        </p>
        <label className="inline-flex items-center gap-2 text-xs text-slate-700 font-semibold mb-3">
          <input
            type="checkbox"
            checked={ebayApiFirstIncremental}
            onChange={(e) => setEbayApiFirstIncremental(e.target.checked)}
            className="rounded border-slate-300"
          />
          API-first on quick refresh (skip eBay tabs when API returns sold rows)
        </label>
        {ebayConfigMessage ? <p className="text-xs font-semibold text-slate-700 mb-2">{ebayConfigMessage}</p> : null}
        <p className="text-[11px] text-slate-500 mb-2">
          Active credentials:{' '}
          <span className="font-semibold text-slate-700">
            {ebayEffectiveConfigured
              ? `${ebayEffectiveSource === 'meta' ? 'Saved in portfolio' : 'Server environment'}`
              : 'Not configured'}
          </span>
          {ebaySecretConfigured ? (
            <span className="text-emerald-700 font-semibold"> — client secret on file</span>
          ) : null}
        </p>
        <Field label="Client ID (App ID)">
          <input
            type="text"
            autoComplete="off"
            className={inputCls + ' font-mono text-xs'}
            value={ebayClientId}
            onChange={(e) => setEbayClientId(e.target.value.trim())}
            placeholder="Your eBay developer app Client ID"
          />
        </Field>
        <Field label="Client secret">
          <input
            type="password"
            autoComplete="off"
            className={inputCls + ' font-mono text-xs'}
            value={ebayClientSecretDraft}
            onChange={(e) => setEbayClientSecretDraft(e.target.value)}
            placeholder={ebaySecretConfigured ? 'Leave blank to keep existing secret' : 'Client secret'}
          />
        </Field>
        <Field label="API environment">
          <select
            className={inputCls + ' text-xs'}
            value={ebayEnv}
            onChange={(e) => setEbayEnv(e.target.value === 'sandbox' ? 'sandbox' : 'production')}
          >
            <option value="production">Production</option>
            <option value="sandbox">Sandbox</option>
          </select>
        </Field>
        <div className="flex flex-wrap gap-2 mt-3">
          <button
            type="button"
            disabled={ebayConfigBusy}
            onClick={async () => {
              setEbayConfigMessage(null);
              setEbayConfigBusy(true);
              try {
                const body: Record<string, string | boolean> = {
                  ebayClientId,
                  ebayEnv,
                  ebayApiFirstIncremental,
                };
                if (ebayClientSecretDraft.trim()) body.ebayClientSecret = ebayClientSecretDraft.trim();
                const r = await fetch(apiUrl('/api/ebay/config'), {
                  method: 'PATCH',
                  headers: buildApiHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' }),
                  body: JSON.stringify(body),
                });
                const j = (await r.json().catch(() => ({}))) as {
                  ok?: boolean;
                  error?: string;
                  ebayClientSecretConfigured?: boolean;
                  effectiveCredentialSource?: string | null;
                  effectiveConfigured?: boolean;
                };
                if (!r.ok) {
                  setEbayConfigMessage(j.error || `Save failed (${r.status})`);
                  return;
                }
                setEbaySecretConfigured(j.ebayClientSecretConfigured === true);
                setEbayClientSecretDraft('');
                setEbayEffectiveSource(
                  j.effectiveCredentialSource === 'env' || j.effectiveCredentialSource === 'meta'
                    ? j.effectiveCredentialSource
                    : null
                );
                setEbayEffectiveConfigured(j.effectiveConfigured === true);
                invalidateEbayApiConfigCache();
                setEbayConfigMessage('eBay API settings saved.');
              } catch (e) {
                setEbayConfigMessage(e instanceof Error ? e.message : String(e));
              } finally {
                setEbayConfigBusy(false);
              }
            }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 disabled:opacity-60 text-white text-xs font-bold uppercase tracking-wider"
          >
            {ebayConfigBusy ? <Loader2 className="animate-spin" size={14} /> : null}
            {ebayConfigBusy ? 'Saving…' : 'Save eBay API'}
          </button>
          <button
            type="button"
            disabled={ebayConfigBusy || !ebaySecretConfigured}
            onClick={async () => {
              setEbayConfigMessage(null);
              setEbayConfigBusy(true);
              try {
                const r = await fetch(apiUrl('/api/ebay/config'), {
                  method: 'PATCH',
                  headers: buildApiHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' }),
                  body: JSON.stringify({ ebayClientSecret: '' }),
                });
                const j = (await r.json().catch(() => ({}))) as {
                  error?: string;
                  ebayClientSecretConfigured?: boolean;
                  effectiveCredentialSource?: string | null;
                  effectiveConfigured?: boolean;
                };
                if (!r.ok) {
                  setEbayConfigMessage(j.error || `Clear failed (${r.status})`);
                  return;
                }
                setEbaySecretConfigured(j.ebayClientSecretConfigured === true);
                setEbayClientSecretDraft('');
                setEbayEffectiveSource(
                  j.effectiveCredentialSource === 'env' || j.effectiveCredentialSource === 'meta'
                    ? j.effectiveCredentialSource
                    : null
                );
                setEbayEffectiveConfigured(j.effectiveConfigured === true);
                setEbayConfigMessage('Stored client secret removed.');
              } catch (e) {
                setEbayConfigMessage(e instanceof Error ? e.message : String(e));
              } finally {
                setEbayConfigBusy(false);
              }
            }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-300 text-slate-800 text-xs font-bold uppercase tracking-wider hover:bg-slate-50 disabled:opacity-50"
          >
            Clear secret
          </button>
          <button
            type="button"
            disabled={ebayTestBusy}
            onClick={async () => {
              setEbayConfigMessage(null);
              setEbayTestBusy(true);
              try {
                const r = await fetch(apiUrl('/api/ebay/test-token'), {
                  method: 'POST',
                  headers: buildApiHeaders({ Accept: 'application/json' }),
                });
                const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string; credentialSource?: string | null; env?: string | null };
                if (!r.ok || !j.ok) {
                  setEbayConfigMessage(j.error || `Token test failed (${r.status})`);
                  return;
                }
                setEbayConfigMessage(
                  `Token OK (${j.credentialSource === 'meta' ? 'portfolio' : j.credentialSource === 'env' ? 'environment' : 'unknown'}, ${j.env || 'n/a'}).`
                );
              } catch (e) {
                setEbayConfigMessage(e instanceof Error ? e.message : String(e));
              } finally {
                setEbayTestBusy(false);
              }
            }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white text-xs font-bold uppercase tracking-wider"
          >
            {ebayTestBusy ? <Loader2 className="animate-spin" size={14} /> : null}
            {ebayTestBusy ? 'Testing…' : 'Test token'}
          </button>
          <button
            type="button"
            disabled={ebaySoldTestBusy || !ebayEffectiveConfigured}
            onClick={async () => {
              setEbayConfigMessage(null);
              setEbaySoldTestBusy(true);
              try {
                const r = await fetch(
                  apiUrl(`/api/ebay/sold?q=${encodeURIComponent('pokemon card')}&windowDays=7&limit=10`),
                  { headers: buildApiHeaders({ Accept: 'application/json' }) }
                );
                const j = (await r.json().catch(() => ({}))) as {
                  count?: number;
                  median?: number | null;
                  error?: string;
                };
                if (!r.ok) {
                  setEbayConfigMessage(j.error || `Sold search test failed (${r.status})`);
                  return;
                }
                setEbayConfigMessage(
                  `Sold search OK: ${j.count ?? 0} rows${j.median != null ? `, median ${j.median}` : ''}.`
                );
              } catch (e) {
                setEbayConfigMessage(e instanceof Error ? e.message : String(e));
              } finally {
                setEbaySoldTestBusy(false);
              }
            }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-emerald-600 text-emerald-800 text-xs font-bold uppercase tracking-wider hover:bg-emerald-50 disabled:opacity-50"
          >
            {ebaySoldTestBusy ? <Loader2 className="animate-spin" size={14} /> : null}
            {ebaySoldTestBusy ? 'Testing sold search...' : 'Test sold search'}
          </button>
        </div>
      </div>

      <div className="border-t border-slate-200 pt-6">
        <h3 className="font-black uppercase tracking-widest text-sm flex items-center gap-2 text-slate-700 mb-3">
          <LayoutList size={16} /> Quick Card Module
        </h3>
        <label className="inline-flex items-center gap-2 text-xs text-slate-700 font-semibold">
          <input
            type="checkbox"
            checked={quickCardAdminSettings.gemRateOnQuickRefresh}
            onChange={(e) =>
              onQuickCardAdminSettingsChange({ gemRateOnQuickRefresh: e.target.checked })
            }
            className="rounded border-slate-300"
          />
          Fetch Gem Rate data on Quick Refresh
        </label>
        {quickCardAdminSettings.gemRateOnQuickRefresh ? (
          <div className="mt-3 ml-1 space-y-2 text-xs text-slate-700">
            <label className="flex items-center gap-2 font-semibold">
              <input
                type="radio"
                name="gem-rate-quick-mode"
                checked={quickCardAdminSettings.gemRateQuickMode === 'every_time'}
                onChange={() => onQuickCardAdminSettingsChange({ gemRateQuickMode: 'every_time' })}
              />
              Every quick refresh
            </label>
            <label className="flex flex-wrap items-center gap-2 font-semibold">
              <input
                type="radio"
                name="gem-rate-quick-mode"
                checked={quickCardAdminSettings.gemRateQuickMode === 'every_n_days'}
                onChange={() => onQuickCardAdminSettingsChange({ gemRateQuickMode: 'every_n_days' })}
              />
              Every
              <NumberInput
                value={quickCardAdminSettings.gemRateQuickIntervalDays}
                onChange={(v) =>
                  onQuickCardAdminSettingsChange({
                    gemRateQuickIntervalDays: Math.max(1, Math.min(365, Math.floor(v) || 1)),
                  })
                }
                step={1}
              />
              days (from last quick refresh)
            </label>
          </div>
        ) : (
          <p className="text-xs text-slate-500 mt-2">
            Full Fetch always updates Gem Rate on singles. Quick Refresh skips Gem Rate unless enabled above.
          </p>
        )}
        <label className="inline-flex items-center gap-2 text-xs text-slate-700 font-semibold mt-4 block">
          <input
            type="checkbox"
            checked={quickCardAdminSettings.autoQuickRefreshOnLoad}
            onChange={(e) =>
              onQuickCardAdminSettingsChange({ autoQuickRefreshOnLoad: e.target.checked })
            }
            className="rounded border-slate-300"
          />
          Auto Quick Refresh on load (once per card per day)
        </label>
        <p className="text-xs text-slate-500 mt-2">
          When you open a card in Quick, runs Quick Refresh automatically at most once per calendar day without clicking
          the button.
        </p>
        <div className="mt-5 pt-4 border-t border-slate-200">
          <p className="text-[11px] font-black uppercase tracking-widest text-slate-600 mb-2">
            Streamer Mode skin (default)
          </p>
          <StreamerSkinPicker
            skinId={streamerSkinId}
            onSkinIdChange={onStreamerSkinIdChange}
            className="max-w-xs"
          />
          <p className="text-xs text-slate-500 mt-2">
            Applies whenever you open Streamer Mode. You can also change the skin from the Streamer Mode toolbar.
          </p>
        </div>
        <details className="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
          <summary className="cursor-pointer text-[11px] font-bold uppercase tracking-widest text-slate-600">
            Advanced capture
          </summary>
          <p className="text-xs text-slate-500 mt-2 mb-2">
            Default is Hybrid (TCG in app, eBay in Edge). Quick Refresh cannot use Edge backup.
          </p>
          <div className="flex flex-col gap-1.5">
            {(
              [
                { id: 'hybrid' as const, label: 'Hybrid (default)', hint: 'TCG in app · eBay in Edge' },
                { id: 'embedded_all' as const, label: 'All in app', hint: 'TCG + eBay in Raw Engine' },
                { id: 'edge_backup' as const, label: 'Edge backup', hint: 'Manual in Edge + extension' },
              ] as const
            ).map((opt) => (
              <label key={opt.id} className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700">
                <input
                  type="radio"
                  name="admin-quick-market-mode"
                  checked={quickCardAdminSettings.quickFetchMarketMode === opt.id}
                  onChange={() =>
                    onQuickCardAdminSettingsChange({
                      quickFetchMarketMode: opt.id as QuickFetchMarketMode,
                    })
                  }
                />
                {opt.label}
                <span className="font-normal text-slate-500">({opt.hint})</span>
              </label>
            ))}
          </div>
        </details>
      </div>

      <div className="border-t border-slate-200 pt-6">
        <h3 className="font-black uppercase tracking-widest text-sm flex items-center gap-2 text-slate-700 mb-3">
          <Sparkles size={16} /> Extension Capture Refresh
        </h3>
        <label className="inline-flex items-center gap-2 text-xs text-slate-700 font-semibold">
          <input
            type="checkbox"
            checked={extensionLatestOnlyMode}
            onChange={(e) => onExtensionLatestOnlyModeChange(e.target.checked)}
            className="rounded border-slate-300"
          />
          Capture newest unseen eBay/TCG sales only (skip already scanned title/date rows)
        </label>
        <p className="text-xs text-slate-500 mt-2">
          Uses extension capture history from the database and ignores already-scanned rows during refresh so charts update
          faster with less redundant work.
        </p>
      </div>

      <div className="border-t border-slate-200 pt-6">
        <div className="flex flex-wrap justify-between items-center gap-2 mb-3">
          <h3 className="font-black uppercase tracking-widest text-sm flex items-center gap-2 text-slate-700">
            <Clock size={16} /> Quick fetch timing
          </h3>
          <button
            type="button"
            onClick={onResetQuickFetchTimingDefaults}
            className="text-xs font-bold text-slate-500 hover:text-slate-800 uppercase tracking-wider"
          >
            Restore defaults
          </button>
        </div>
        <p className="text-xs text-slate-500 mb-3 leading-relaxed">
          RawEngine Quick Card capture delays (this browser). Editing any value marks timing as customized and disables the
          Quick refresh sleep multiplier for post-activate waits until you restore defaults.
        </p>
        <details className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 mb-2">
          <summary className="cursor-pointer text-[11px] font-bold uppercase tracking-widest text-slate-600">
            General
          </summary>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 mt-3">
            <Field label="Tab URL verify poll (ms)">
              <NumberInput
                value={quickFetchTiming.tabUrlVerifyPollMs}
                onChange={(v) => onQuickFetchTimingFieldChange('tabUrlVerifyPollMs', v)}
                step={50}
              />
            </Field>
            <Field label="Quick refresh sleep multiplier">
              <NumberInput
                value={quickFetchTiming.quickRefreshSleepMultiplier}
                onChange={(v) => onQuickFetchTimingFieldChange('quickRefreshSleepMultiplier', v)}
                step={0.05}
              />
            </Field>
          </div>
        </details>
        <details className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 mb-2">
          <summary className="cursor-pointer text-[11px] font-bold uppercase tracking-widest text-slate-600">
            eBay capture (plugin)
          </summary>
          <EbayCapturePluginHost pluginId="timing" label="eBay capture timing">
            <EbayCaptureTimingSectionLazy
              quickFetchTiming={quickFetchTiming}
              onQuickFetchTimingFieldChange={onQuickFetchTimingFieldChange}
              pluginSettings={ebayPluginSettings}
              onPluginSettingsChange={patchEbayPluginSettings}
            />
          </EbayCapturePluginHost>
        </details>
        <details className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 mb-2">
          <summary className="cursor-pointer text-[11px] font-bold uppercase tracking-widest text-slate-600">
            TCG single-tab &amp; deep sequential
          </summary>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 mt-3">
            <Field label="TCG single post-activate (ms)">
              <NumberInput
                value={quickFetchTiming.tcgSinglePostActivateMs}
                onChange={(v) => onQuickFetchTimingFieldChange('tcgSinglePostActivateMs', v)}
                step={50}
              />
            </Field>
            <Field label="Deep: initial settle (ms)">
              <NumberInput
                value={quickFetchTiming.tcgDeepInitialSettleMs}
                onChange={(v) => onQuickFetchTimingFieldChange('tcgDeepInitialSettleMs', v)}
                step={50}
              />
            </Field>
            <Field label="Deep: before default capture (ms)">
              <NumberInput
                value={quickFetchTiming.tcgDeepAfterDefaultActivateMs}
                onChange={(v) => onQuickFetchTimingFieldChange('tcgDeepAfterDefaultActivateMs', v)}
                step={50}
              />
            </Field>
            <Field label="Deep: between captures lead (ms)">
              <NumberInput
                value={quickFetchTiming.tcgDeepBetweenCapturesLeadMs}
                onChange={(v) => onQuickFetchTimingFieldChange('tcgDeepBetweenCapturesLeadMs', v)}
                step={50}
              />
            </Field>
            <Field label="Deep: before deep capture (ms)">
              <NumberInput
                value={quickFetchTiming.tcgDeepBeforeDeepCaptureMs}
                onChange={(v) => onQuickFetchTimingFieldChange('tcgDeepBeforeDeepCaptureMs', v)}
                step={50}
              />
            </Field>
          </div>
        </details>
        <details className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
          <summary className="cursor-pointer text-[11px] font-bold uppercase tracking-widest text-slate-600">
            Advanced TCG capture options
          </summary>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 mt-3">
            <Field label="TCG impatience (ms)">
              <NumberInput
                value={quickFetchTiming.tcgImpatienceMs}
                onChange={(v) => onQuickFetchTimingFieldChange('tcgImpatienceMs', v)}
                step={50}
              />
            </Field>
            <Field label="TCG pre-page settle (ms)">
              <NumberInput
                value={quickFetchTiming.tcgPrePageSettleMs}
                onChange={(v) => onQuickFetchTimingFieldChange('tcgPrePageSettleMs', v)}
                step={50}
              />
            </Field>
            <Field label="TCG view-more wait (ms)">
              <NumberInput
                value={quickFetchTiming.tcgViewMoreWaitMs}
                onChange={(v) => onQuickFetchTimingFieldChange('tcgViewMoreWaitMs', v)}
                step={50}
              />
            </Field>
            <Field label="TCG deep extra settle (ms)">
              <NumberInput
                value={quickFetchTiming.tcgDeepExtraSettleMs}
                onChange={(v) => onQuickFetchTimingFieldChange('tcgDeepExtraSettleMs', v)}
                step={50}
              />
            </Field>
            <Field label="TCG min sales rows">
              <NumberInput
                value={quickFetchTiming.tcgMinSalesRows}
                onChange={(v) => onQuickFetchTimingFieldChange('tcgMinSalesRows', v)}
                step={1}
              />
            </Field>
            <Field label="TCG sales feed timeout (ms)">
              <NumberInput
                value={quickFetchTiming.tcgSalesFeedTimeoutMs}
                onChange={(v) => onQuickFetchTimingFieldChange('tcgSalesFeedTimeoutMs', v)}
                step={500}
              />
            </Field>
            <Field label="TCG sales feed poll (ms)">
              <NumberInput
                value={quickFetchTiming.tcgSalesFeedPollMs}
                onChange={(v) => onQuickFetchTimingFieldChange('tcgSalesFeedPollMs', v)}
                step={50}
              />
            </Field>
            <Field label="TCG view-more max attempts">
              <NumberInput
                value={quickFetchTiming.tcgViewMoreMaxAttempts}
                onChange={(v) => onQuickFetchTimingFieldChange('tcgViewMoreMaxAttempts', v)}
                step={1}
              />
            </Field>
          </div>
        </details>
      </div>

      <div className="border-t border-slate-200 pt-6">
        <div className="flex justify-between items-center mb-3">
          <h3 className="font-black uppercase tracking-widest text-sm flex items-center gap-2 text-slate-700">
            <Cloud size={16} /> Portfolio & backups
          </h3>
          <SyncBadge status={syncStatus} lastSavedAt={lastSavedAt} />
        </div>
        <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50/80 p-3">
          <Field label="Default portfolio tab (Singles / Sealed / All)">
            <div className="flex flex-wrap items-center gap-2">
              <LayoutList size={14} className="text-slate-400 shrink-0" />
              <select
                className={inputCls + ' flex-1 min-w-[12rem] text-xs font-semibold'}
                value={portfolioKindScope}
                onChange={(e) => onPortfolioKindScopeChange(e.target.value as PortfolioKindScope)}
              >
                <option value="single">Singles</option>
                <option value="sealed">Sealed</option>
                <option value="all">All</option>
              </select>
            </div>
          </Field>
          <p className="text-[11px] text-slate-500 mt-2 leading-snug">
            Applies to the master list scope and Quick picker. Saved with portfolio filters (localStorage / server meta).
          </p>
        </div>
        <p className="text-xs text-slate-500 font-medium leading-relaxed mb-3">
          Live card rows are stored in SQLite (
          <code className="font-mono bg-slate-100 px-1 rounded text-[11px]">app-portfolio/portfolio.db</code>
          ). Fees, filters, collections, and Arsenal metadata are stored as JSON alongside that database. Automatic dated JSON
          snapshots are written to a <span className="font-semibold text-slate-600">separate backup vault folder</span> so they
          stay available if you factory-reset the runtime folder.
        </p>
        {storageLocations ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 mb-4 space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Paths on this machine</p>
            <SettingsPathRow label="Data directory" value={storageLocations.dataDir} onOpen={() => void openLocalPath(storageLocations.dataDir)} />
            <SettingsPathRow
              label="Backup vault (dated JSON)"
              value={storageLocations.backupVaultDir}
              onOpen={() => void openLocalPath(storageLocations.backupVaultDir)}
            />
            <SettingsPathRow
              label="Portfolio SQLite"
              value={storageLocations.appPortfolioDb}
              onOpen={() => void openLocalPath(storageLocations.appPortfolioDb)}
            />
            <SettingsPathRow
              label="Legacy portfolio.json"
              value={storageLocations.portfolioJson}
              onOpen={() => void openLocalPath(storageLocations.portfolioJson)}
            />
          </div>
        ) : (
          <p className="text-[11px] text-slate-400 mb-4">Connect to the API to show local paths.</p>
        )}
        <p className="text-xs text-slate-600 font-semibold mb-2">Manual export / import</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onExport}
            className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-xl font-bold text-xs uppercase tracking-wider"
          >
            <Download size={14} /> Export portfolio
          </button>
          <button
            type="button"
            onClick={onExportCardsNdjson}
            className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-xl font-bold text-xs uppercase tracking-wider"
          >
            <Download size={14} /> Export cards (NDJSON)
          </button>
          <button
            type="button"
            onClick={() => importInputRef.current?.click()}
            className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-xl font-bold text-xs uppercase tracking-wider"
          >
            <Upload size={14} /> Import portfolio
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json,.ndjson,application/x-ndjson"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImport(f);
              e.target.value = '';
            }}
          />
        </div>
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600">PriceCharting Collection Import</p>
              <p className="text-xs text-slate-500 mt-1">
                Import PriceCharting <code>collection.csv</code> or <code>collection.zip</code>. We auto-search, resolve product
                URL, scrape details, and add cards.
              </p>
            </div>
            <button
              type="button"
              onClick={() => importCollectionInputRef.current?.click()}
              className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-xl font-semibold text-xs uppercase tracking-[0.11em]"
            >
              <Upload size={14} /> Import collection file
            </button>
            <input
              ref={importCollectionInputRef}
              type="file"
              accept=".csv,.zip,text/csv,application/zip,application/x-zip-compressed"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onImportCollection(f, { skipIfAlreadyInCollection: skipDupes });
                e.target.value = '';
              }}
            />
          </div>
          <label className="inline-flex items-center gap-2 text-xs text-slate-600 font-medium">
            <input
              type="checkbox"
              checked={skipDupes}
              onChange={(e) => setSkipDupes(e.target.checked)}
              className="rounded border-slate-300"
            />
            Skip if already in collection (same PriceCharting URL or product ID)
          </label>
          {importProgress ? (
            <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                  {importProgress.running ? 'Collection import running' : 'Collection import complete'}
                </p>
                <p className="text-[11px] text-slate-500 tabular-nums">
                  {importProgress.processed}/{importProgress.total}
                </p>
              </div>
              <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full bg-slate-900 transition-all"
                  style={{
                    width:
                      importProgress.total > 0
                        ? `${Math.min(100, (importProgress.processed / importProgress.total) * 100)}%`
                        : '0%',
                  }}
                />
              </div>
              <div className="grid grid-cols-3 gap-2 text-[11px] tabular-nums">
                <div className="rounded bg-emerald-50 text-emerald-700 px-2 py-1">Imported {importProgress.imported}</div>
                <div className="rounded bg-amber-50 text-amber-700 px-2 py-1">Skipped {importProgress.skipped}</div>
                <div className="rounded bg-rose-50 text-rose-700 px-2 py-1">Failed {importProgress.failed}</div>
              </div>
              {importProgress.current ? (
                <p className="text-xs text-slate-500 truncate" title={importProgress.current}>
                  Current: {importProgress.current}
                </p>
              ) : null}
            </div>
          ) : null}
          {importIssues.length > 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-800">
                  Import Issues ({importIssues.length})
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => onRetryFailedImport({ skipIfAlreadyInCollection: skipDupes })}
                    className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-[11px] font-semibold uppercase tracking-[0.1em] hover:bg-slate-800"
                  >
                    Retry failed rows
                  </button>
                  <button
                    type="button"
                    onClick={onExportImportIssues}
                    className="px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-700 hover:bg-slate-100"
                  >
                    Export issue report
                  </button>
                  <button
                    type="button"
                    onClick={onExportRetryFile}
                    className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-[11px] font-semibold uppercase tracking-[0.1em] hover:bg-blue-500"
                  >
                    Create retry file
                  </button>
                </div>
              </div>
              <div className="max-h-44 overflow-auto rounded border border-amber-100 bg-white">
                {importIssues.slice(0, 80).map((issue, idx) => (
                  <div key={`${issue.row.productId}-${idx}`} className="px-2 py-1.5 text-[11px] border-b border-slate-100 last:border-b-0">
                    <span
                      className={`inline-block mr-2 font-bold ${issue.status === 'failed' ? 'text-rose-700' : 'text-amber-700'}`}
                    >
                      {issue.status.toUpperCase()}
                    </span>
                    <span className="font-semibold text-slate-700">{issue.row.productName}</span>
                    <span className="text-slate-500"> ({issue.row.consoleName || 'Unknown set'})</span>
                    <div className="text-slate-500">{issue.reason}</div>
                  </div>
                ))}
              </div>
              {importIssues.length > 80 ? (
                <p className="text-[11px] text-slate-500">Showing first 80 issues. Export report for full list.</p>
              ) : null}
            </div>
          ) : null}
        </div>
        {lastSavedAt && (
          <p className="text-[11px] text-slate-400 font-medium mt-3">Last saved to disk: {new Date(lastSavedAt).toLocaleString()}</p>
        )}
      </div>

      {isElectronUi && rawEngineRt.osPlatform === 'win32' && importChromiumCookies ? (
        <div className="border-t border-slate-200 pt-6 mt-2 rounded-xl border border-indigo-100 bg-indigo-50/40 p-4 space-y-2">
          <h3 className="font-black uppercase tracking-widest text-sm flex items-center gap-2 text-indigo-900">
            <Cloud size={16} /> Import Edge / Chrome marketplace cookies
          </h3>
          <p className="text-xs text-indigo-900/85 font-medium leading-relaxed">
            Copies HTTP cookies for eBay, TCGplayer, and PriceCharting from your default Edge and Chrome profiles into the
            in-app browser (same as the optional Windows installer step). Close Edge and Chrome first to avoid SQLite locks.
            Saved passwords are not imported.
          </p>
          {chromiumCookieImportMessage ? (
            <p className="text-xs font-semibold text-indigo-800">{chromiumCookieImportMessage}</p>
          ) : null}
          <button
            type="button"
            disabled={chromiumCookieImportBusy}
            onClick={async () => {
              if (!importChromiumCookies) return;
              setChromiumCookieImportMessage(null);
              setChromiumCookieImportBusy(true);
              try {
                const r = await importChromiumCookies({ edge: true, chrome: true });
                const tail = r.details?.length ? ` — ${r.details.join(' ')}` : '';
                setChromiumCookieImportMessage(
                  `Imported ${r.imported} cookie(s), skipped ${r.skipped}, errors ${r.errors}.${tail}`
                );
              } catch (e) {
                setChromiumCookieImportMessage(e instanceof Error ? e.message : String(e));
              } finally {
                setChromiumCookieImportBusy(false);
              }
            }}
            className="flex items-center gap-2 bg-indigo-700 hover:bg-indigo-800 disabled:opacity-60 text-white px-4 py-2 rounded-xl font-bold text-xs uppercase tracking-wider"
          >
            {chromiumCookieImportBusy ? <Loader2 className="animate-spin" size={14} /> : <Download size={14} />}
            {chromiumCookieImportBusy ? 'Importing…' : 'Import now'}
          </button>
        </div>
      ) : null}

      {!factoryReset ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-4">
          <p className="text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1">Desktop EXE · factory reset</p>
          <p className="text-xs text-slate-600 leading-relaxed">
            Full wipe of bundled runtime data (including SQLite DBs under runtime-data) is available only in the{' '}
            <span className="font-semibold">Windows desktop app</span>. Install or launch the EXE, open{' '}
            <span className="font-semibold">Admin → Configuration</span> here, and use <span className="font-semibold">Factory reset…</span> at the
            bottom of this section. Browser-only sessions should rely on <span className="font-semibold">Export portfolio</span> + clearing site storage
            if needed.
          </p>
        </div>
      ) : null}

      {factoryReset ? (
        <div className="border-t border-rose-200 pt-6 mt-2 rounded-2xl border border-rose-100 bg-rose-50/50 p-4 space-y-3">
          <h3 className="font-black uppercase tracking-widest text-sm flex items-center gap-2 text-rose-900">
            <Trash2 size={16} /> Factory reset (desktop app)
          </h3>
          <p className="text-xs text-rose-800/90 font-medium leading-relaxed">
            Erases the <span className="font-semibold">runtime-data</span> tree for this install (SQLite portfolio DB, cached images, extension DBs,
            etc.). Your <span className="font-semibold">dated JSON backups</span> in the separate backup vault folder above are{' '}
            <span className="font-semibold">not</span> removed — copy those files out first if you want an extra offline archive. Options below control
            embedded-browser cleanup.
          </p>
          <div className="space-y-2 mb-4">
            <label className="flex items-start gap-2 text-xs text-slate-800 font-semibold">
              <input
                type="checkbox"
                checked={preserveLoginSessions}
                onChange={(e) => setPreserveLoginSessions(e.target.checked)}
                className="rounded border-slate-300 mt-0.5"
              />
              <span>
                Preserve login sessions (keep site cookies; still clears cache/storage when enabled below unless you turn that off)
              </span>
            </label>
            <label className="flex items-start gap-2 text-xs text-slate-800 font-semibold">
              <input
                type="checkbox"
                checked={clearCacheAndBrowsingHistory}
                onChange={(e) => setClearCacheAndBrowsingHistory(e.target.checked)}
                className="rounded border-slate-300 mt-0.5"
              />
              <span>Clear cache, site storage, and browsing-related data (recommended)</span>
            </label>
            <label className="flex items-start gap-2 text-xs text-slate-800 font-semibold">
              <input
                type="checkbox"
                checked={clearPasswordAndUsernameHistory}
                onChange={(e) => setClearPasswordAndUsernameHistory(e.target.checked)}
                className="rounded border-slate-300 mt-0.5"
              />
              <span>Also remove saved passwords and autofill / username history for the embedded browser</span>
            </label>
          </div>
          {factoryResetMessage ? <p className="text-xs font-semibold text-rose-700 mb-2">{factoryResetMessage}</p> : null}
          <button
            type="button"
            disabled={factoryResetBusy || !factoryReset}
            onClick={async () => {
              if (!factoryReset) return;
              setFactoryResetMessage(null);
              setFactoryResetBusy(true);
              try {
                const res = await factoryReset({
                  preserveLoginSessions,
                  clearCacheAndBrowsingHistory,
                  clearPasswordAndUsernameHistory,
                });
                if (!res.ok && res.cancelled) {
                  setFactoryResetMessage('Cancelled.');
                } else if (!res.ok) {
                  setFactoryResetMessage(res.error || 'Factory reset failed.');
                }
              } finally {
                setFactoryResetBusy(false);
              }
            }}
            className="flex items-center gap-2 bg-rose-700 hover:bg-rose-800 disabled:opacity-60 text-white px-4 py-2 rounded-xl font-bold text-xs uppercase tracking-wider"
          >
            {factoryResetBusy ? <Loader2 className="animate-spin" size={14} /> : <Trash2 size={14} />}
            {factoryResetBusy ? 'Resetting…' : 'Factory reset…'}
          </button>
        </div>
      ) : null}

      {extInstallGuideOpen ? (
        <div
          className="fixed inset-0 z-[250] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Set up browser extension"
        >
          <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-600/80 bg-slate-900 text-slate-100 shadow-2xl p-6">
            <button
              type="button"
              onClick={() => setExtInstallGuideOpen(false)}
              className="absolute top-3 right-3 text-slate-400 hover:text-white text-sm font-bold"
            >
              Close
            </button>
            <h3 className="text-lg font-black text-white mb-1 pr-16">Set up browser extension</h3>
            <p className="text-xs text-slate-400 mb-4">Four steps — copy path, open browser, load unpacked, pin.</p>
            <ExtensionInstallGuide
              variant="settings"
              onComplete={() => setExtInstallGuideOpen(false)}
            />
          </div>
        </div>
      ) : null}
    </>
  );

  if (embedded) {
    return <div className="space-y-6">{inner}</div>;
  }

  return (
    <div className="bg-white rounded-3xl border-2 border-slate-200 shadow-lg overflow-hidden">
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 px-6 py-4 text-white">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-75">Configuration</p>
            <h2 className="text-lg font-black tracking-tight">Settings</h2>
          </div>
          <div className="flex flex-wrap gap-2 justify-end">
            <span
              className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border border-white/10 ${
                isElectronUi ? 'bg-emerald-500/25 text-emerald-50' : 'bg-amber-500/30 text-amber-50'
              }`}
            >
              {isElectronUi ? 'Desktop app' : 'Browser'}
            </span>
            {rawEngineRt.isPackaged ? (
              <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-white/10 border border-white/10">
                Packaged EXE
              </span>
            ) : isElectronUi ? (
              <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-white/10 border border-white/10">
                Dev / unpack
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6">{inner}</div>
    </div>
  );
};
