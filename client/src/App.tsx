import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Package,
  Info,
  Plus,
  X,
  PlusCircle,
  Link as LinkIcon,
  Loader2,
  Sparkles,
  Settings2,
  TrendingUp,
  Wifi,
  WifiOff,
  ChevronDown,
  BarChart3,
  ArrowUp,
  ArrowDown,
  Minus,
  BookOpen,
} from 'lucide-react';
import type {
  Card,
  CardLanguageTag,
  Collection,
  Hunt,
  Target,
  FuturesSignalResult,
  Fees,
  GemRateSearchResult,
  PriceSnapshot,
  PsaPopulation,
  SalesAnomalyPoint,
  ScrapeResponse,
  TcgplayerSalesSnapshot,
  TcgplayerProductSummary,
  EbayExtensionSnapshot,
  SealedSetGalleryPreviewItem,
} from './types';
import {
  apiUrl,
  buildApiHeaders,
  getRawEngineRuntime,
  isRawEngineShell,
  focusRawEnginePortfolioWindow,
  resolveServerUrl,
  shouldPersistPsaToken,
  type RawEngineBridge,
} from './apiBase';
import { appendTcgplayerSelfSample } from './tcgplayerSelfHistory';
import { buildTcgplayerProductFetchUrl } from './tcgplayerRequest';
import { buildTcgSalesAnomalies } from './tcgSalesAnomalies';
import { buildPortfolioTickerRows } from './portfolioTickerData';
import { PortfolioInsightsTabs } from './portfolioInsightsTabs';
import { EbayExternalLink } from './components/EbayExternalLink';
import { OverviewMarketSalesSection } from './overviewMarketSalesSection';
import {
  ebayListingSaleKey,
  mapEbayExtensionSnapshotTagBulk,
  matchesEbayTitleTagFilters,
  type EbayTitleStampFilter,
  type EbayTitleSealedFilter,
} from './ebayStamp';
import { computeRowSignalIcons, suggestAutoBin } from './rowSignals';
import { EbayVerificationArchivePanel } from './quick/EbayVerificationArchivePanel';
import {
  QuickFetchMarketplacePreflight,
  type QuickFetchPreflightKind,
} from './quick/QuickFetchMarketplacePreflight';
import { runQuickFetch } from './quick/fetch/runQuickFetchCore';
import { publishQuickFetchSession } from './quick/fetch/quickFetchSession';
import { EbayCapturePluginHost } from './plugins/ebay-capture/components/EbayCapturePluginHost';
import { EbayCaptureDiagnosticsStripLazy } from './plugins/ebay-capture/registry';
import type { EbayCaptureDiagnostics } from './plugins/ebay-capture/types';
import { shouldClearEbaySalesOnQueryChange } from './utils/ebayApiIncrementalLane';
import { fetchEbayApiConfigStatus } from './services/ebayApiSold';
import { refreshEbaySalesViaApi, refreshEbaySalesBatchViaApi } from './utils/ebayApiRefresh';
import {
  ebaySoldSearchUrlForCard,
  ebayPurchaseSearchUrlForCard,
  resolveTcgplayerProductUrl,
} from './masterListExternalLinks';
import { BrandLogoImg } from './brandLogos';
import {
  computeSellPriceTargets,
  DEFAULT_SELL_PRICING_POLICY,
} from './pricing';
import { evaluateFuturesSignal } from './futuresSignals';
import {
  applyArsenalPortfolioImport,
  arsenalRehydrateFromServer,
  getArsenalForPortfolioExport,
} from './arsenal/arsenalSyncBridge';
import {
  batchUpsertCardsOnServer,
  buildCardsNdjsonBlob,
  deleteCardOnServer,
  buildExportBlob,
  createEmptySyncBaseline,
  exportCardsNdjsonFilename,
  exportFilename,
  fetchAllCardsPagesFromServer,
  fetchCardsPageFromServer,
  fetchCardByIdFromServer,
  fetchPortfolioSummaryFromServer,
  incrementalPushPortfolioToServer,
  loadFromServer,
  loadPortfolioMetaFromServer,
  mergePortfolioServerPatch,
  patchCardOnServer,
  metaBaselineFromServerDoc,
  metaBaselineString,
  parsePortfolioImportFile,
  saveToServer,
  type PortfolioSnapshot,
  type PortfolioTotalsServer,
  type SyncStatus,
} from './serverSync';
import {
  resolveEbaySnapshotForRefresh,
  resolveTcgSnapshotForRefresh,
} from './utils/quickFetchIncremental';
import {
  applyQuickFetchTimingPatch,
  DEFAULT_QUICK_FETCH_TIMING,
  loadQuickFetchTimingStore,
  saveQuickFetchTimingStore,
  type QuickFetchTiming,
  type QuickFetchTimingStore,
} from './utils/quickFetchTiming';
import {
  saveQuickFetchMarketMode,
  type QuickFetchMarketMode,
} from './utils/quickFetchMarketMode';
import {
  loadQuickCardAdminSettings,
  normalizeQuickCardAdminSettings,
  saveQuickCardAdminSettings,
  shouldFetchGemRateOnQuickRefresh,
  hasAutoQuickRefreshStamp,
  setAutoQuickRefreshStamp,
  type QuickCardAdminSettings,
} from './utils/quickCardAdminSettings';
import { loadStreamerSkinId, saveStreamerSkinId } from './quick/streamer/streamerSkinSettings';
import type { StreamerSkinId } from './quick/streamer/skins/types';
import { hasCompletedFullFetch, type QuickCardFetchMode } from './utils/quickCardFetchState';
import { fetchGemRateEnrichment } from './utils/gemrateEnrichment';
import { QuickFetchCaptureHud } from './QuickFetchCaptureHud';
import { FirstLaunchMarketplaceNotice } from './FirstLaunchMarketplaceNotice';
import {
  parsePriceChartingCollectionFile,
  type PriceChartingCollectionRow,
} from './pricechartingBulkImport';
import {
  snapshotsFromRecentSales,
  startOfUtcDay,
} from './releaseFilter';
import {
  DEFAULT_FEES,
  DEFAULT_PROBS,
  computeMetrics,
  fmtMoney,
  fmtPct,
  probsFromPsaPop,
} from './math';
import {
  SORT_LABELS,
  EMPTY_FILTERS,
  applyFilters,
  applySort,
  normalizeFilterState,
  type FilterState,
  type PortfolioKindScope,
  type ProfitLens,
  type SortPreset,
  type EnrichedCard,
} from './sort';
import {
  normalizePcUrl,
  buildPcUrlFromCollectionRow,
  normalizePricechartingFetchUrl,
} from './utils/pcUrl';
import {
  mergeIntoQuickIndex,
  mergeServerPageWithLocalCache,
  registerNewCardsInPagedCache,
  stageCardUpdate,
} from './pagedPortfolioStaging';
import { buildGemRateQuery, buildEbayQuery } from './utils/searchQueries';
import { formatRelative, toEpochMsLoose } from './utils/time';
import { ebayEffectivePrice } from './utils/ebayEffectivePrice';
import { type GraderCompany } from './utils/grading';
import { championRosterScore, quantileLocal, medianLocal } from './utils/stats';
import { buildSeedHistory, mergeRecentSales } from './utils/recentSales';
import {
  applyExtensionTcgCapture,
  buildEbayExtensionSnapshotFromResponse,
  buildTcgSalesSnapshotFromExtension,
  fetchLatestEbayExtensionCapture,
  fetchLatestTcgExtensionCapture,
} from './services/extensionCapture';
import { Field, NumberInput, INPUT_CLASS as inputCls } from './shared/formFields';
import { HeaderCell } from './shared/tableCells';
import { SellStrategyView } from './portfolio/SellStrategyView';
import { Toolbar } from './portfolio/Toolbar';
import { CollectionManager } from './portfolio/CollectionManager';
import { FragmentRow } from './portfolio/FragmentRow';
/** Expanded card analytics: 4-tab enterprise shell (Overview · Market Signals · Sales Pace · Strategy Math) — see `quick/ExpandedDetail.tsx`. */
import { ExpandedDetail } from './quick/ExpandedDetail';
import { QuickPriceSidebar, type SidebarSummary } from './quick/QuickPriceSidebar';
import {
  StreamerModePanel,
  type StreamerLinkItem,
  type StreamerSalePoint,
} from './quick/StreamerModePanel';
import { NebulaView } from './NebulaView';
import { PortfolioKindScopeTabs } from './sealed/PortfolioKindScopeTabs';
import { PresaleBadgeStrip, SealedQuickPanels } from './sealed/SealedQuickPanels';
import { evaluateSealedOpenVsKeep } from './sealed/sealedOpenEv';
import { SyncBadge } from './SyncBadge';
import { AdminControlPanel, type AdminStatsState } from './admin/AdminControlPanel';
import type { AdminPanelSection, CollectionImportIssue, CollectionImportProgress } from './admin/types';
const ArsenalEntry = lazy(() => import('./arsenal/ArsenalEntry.tsx').then((m) => ({ default: m.ArsenalEntry })));

const PROFIT_LENS_LABELS: Record<ProfitLens, string> = {
  all: 'All (no profit filter)',
  raw_no_grade: 'Profitable: sell raw (no PSA spend)',
  grade_ev: 'Profitable: grade then sell (+EV)',
  psa10_win: 'Profitable: PSA 10 outcome',
};

const STORAGE_KEY_CARDS = 'pcgr:portfolio:v1';
const STORAGE_KEY_FEES = 'pcgr:fees:v1';
const STORAGE_KEY_PSA_TOKEN = 'pcgr:psa_token:v1';
const STORAGE_KEY_COLLECTIONS = 'pcgr:collections:v1';
const STORAGE_KEY_FILTERS = 'pcgr:filters:v1';
const STORAGE_KEY_SORT = 'pcgr:sort:v1';
const STORAGE_KEY_EXTENSION_LATEST_ONLY = 'pcgr:ext:latest_only:v1';
const STORAGE_KEY_QUICK_PRICE_SIDEBAR_HIDDEN_DEFAULT = 'pcgr:quick:price_sidebar_hidden_default:v1';
const STORAGE_KEY_QUICK_FETCH_SKIP_MARKET_PREFLIGHT = 'pcgr:quick:fetch_skip_market_preflight:v1';

/** Master list page size when using SQLite-backed paged grid (bounded client memory). */
const MASTER_GRID_PAGE_SIZE = 80;

type RawEngineBrowserTab = {
  id: number;
  url?: string;
  title?: string;
  active?: boolean;
  locked?: boolean;
  kind?: string;
  siteKey?: string;
};

type RawEngineBrowserApi = {
  newTab?: (url: string) => Promise<{ ok?: boolean; id?: number | null } | boolean>;
  activate?: (id: number) => Promise<boolean>;
  closeTab?: (id: number) => Promise<boolean>;
  listTabs?: () => Promise<RawEngineBrowserTab[]>;
  openOrFocusUrl?: (
    url: string
  ) => Promise<{ ok?: boolean; id?: number | null; reused?: boolean } | null>;
  captureTab?: (
    tabId: number,
    mode?: 'default' | 'deep',
    options?: Record<string, unknown>
  ) => Promise<unknown>;
  /** RawEngine: viewport | fullpage | region | choose — opens annotate window */
  screenshot?: (
    mode?: 'viewport' | 'fullpage' | 'region' | 'choose'
  ) => Promise<{ ok?: boolean; cancelled?: boolean; error?: string }>;
  ebayListingProbe?: (args: { tabId: number }) => Promise<Record<string, unknown>>;
  ebaySessionStatus?: () => Promise<{ status?: string; ok?: boolean; error?: string }>;
  clearEbaySession?: () => Promise<{ ok?: boolean; removedCookies?: number }>;
  ebayOrganicNavigate?: (args: {
    tabId: number;
    targetUrl: string;
    allowDirectFallback?: boolean;
    timeoutMs?: number;
  }) => Promise<{ ok?: boolean; error?: string; fellBack?: boolean; detail?: unknown }>;
};

type RawEngineScrapeGateApi = {
  waitForAck?: (meta: Record<string, unknown>) => Promise<unknown>;
  signal?: () => Promise<{ ok?: boolean; reason?: string }>;
};

type RawEngineCaptureChromeApi = {
  publish?: (state: {
    active?: boolean;
    pct?: number | null;
    phase?: string;
    target?: string;
    stage?: 'capturing' | 'refreshing' | 'idle';
  }) => Promise<unknown>;
};

const getRawEngineBrowser = (): RawEngineBrowserApi | null => {
  if (typeof window === 'undefined') return null;
  const w = window as Window & { rawEngine?: { browser?: RawEngineBrowserApi } };
  return w.rawEngine?.browser ?? null;
};

type RawEngineCaptureLogApi = {
  append?: (entry: {
    level?: string;
    scope?: string;
    message: string;
    detail?: unknown;
  }) => Promise<{ ok?: boolean }>;
  openWindow?: () => Promise<{ ok?: boolean }>;
  getInfo?: () => Promise<{ path?: string }>;
  readTail?: (n?: number) => Promise<string>;
  revealFile?: () => Promise<{ ok?: boolean }>;
};

const getRawEngineCaptureLog = (): RawEngineCaptureLogApi | null => {
  if (typeof window === 'undefined') return null;
  const w = window as Window & { rawEngine?: { captureLog?: RawEngineCaptureLogApi } };
  return w.rawEngine?.captureLog ?? null;
};

const getRawEngineScrapeGate = (): RawEngineScrapeGateApi | null => {
  if (typeof window === 'undefined') return null;
  const w = window as Window & { rawEngine?: { scrapeGate?: RawEngineScrapeGateApi } };
  return w.rawEngine?.scrapeGate ?? null;
};

const getRawEngineCaptureChrome = (): RawEngineCaptureChromeApi | null => {
  if (typeof window === 'undefined') return null;
  const w = window as Window & { rawEngine?: { captureChrome?: RawEngineCaptureChromeApi } };
  return w.rawEngine?.captureChrome ?? null;
};

const subscribeRawEngineQuickFetchCancel = (cb: () => void): (() => void) | null => {
  if (typeof window === 'undefined') return null;
  const w = window as Window & { rawEngine?: { onQuickFetchCancel?: (fn: () => void) => () => void } };
  return w.rawEngine?.onQuickFetchCancel?.(cb) ?? null;
};

/** Small palette for quick color-pick when creating a collection. */
const COLLECTION_PALETTE = [
  '#0ea5e9', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#ec4899', '#14b8a6', '#64748b',
];

const DEFAULT_BIN_COLLECTIONS = {
  sell: { name: 'sell', color: '#ef4444' },
  hold: { name: 'hold', color: '#10b981' },
} as const;


const loadCards = (): Card[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CARDS);
    if (!raw) return SEED_CARDS;
    const parsed = JSON.parse(raw) as Card[];
    return Array.isArray(parsed) ? parsed : SEED_CARDS;
  } catch {
    return SEED_CARDS;
  }
};

const loadFees = (): Fees => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_FEES);
    if (!raw) return DEFAULT_FEES;
    return { ...DEFAULT_FEES, ...(JSON.parse(raw) as Partial<Fees>) };
  } catch {
    return DEFAULT_FEES;
  }
};

const loadPsaToken = (): string => {
  if (!shouldPersistPsaToken()) return '';
  try {
    return localStorage.getItem(STORAGE_KEY_PSA_TOKEN) ?? '';
  } catch {
    return '';
  }
};

const loadCollections = (): Collection[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_COLLECTIONS);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Collection[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const loadFilters = (): FilterState => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_FILTERS);
    if (!raw) return EMPTY_FILTERS;
    const parsed = JSON.parse(raw) as Partial<FilterState>;
    return normalizeFilterState(parsed);
  } catch {
    return EMPTY_FILTERS;
  }
};

const loadSort = (): SortPreset => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SORT);
    if (raw && raw in SORT_LABELS) return raw as SortPreset;
  } catch { /* fallthrough */ }
  return 'ev_desc';
};

const tcgRowScanKey = (row: { at: number; condition: string | null; qty: number; price: number }): string => {
  const day = Math.floor(Number(row.at || 0) / 86_400_000);
  const cond = String(row.condition || '').trim().toLowerCase();
  return `${day}|${cond}|${Number(row.qty || 0)}|${Number(row.price || 0).toFixed(4)}`;
};

const ebayRowScanKey = (row: { soldAt: number; price: number; title: string; itemId: string | null }): string => {
  const itemId = String(row.itemId || '').trim();
  if (itemId) return `item:${itemId}`;
  const day = Math.floor(Number(row.soldAt || 0) / 86_400_000);
  const title = String(row.title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `${day}|${Number(row.price || 0).toFixed(2)}|${title}`;
};

/** Align stored kind with locked Singles/Sealed tab before fetch and filtering. */
const normalizeCardPortfolioKind = (card: Card, scope: PortfolioKindScope): Card => {
  if (scope === 'all') return card;
  const kind = scope === 'sealed' ? 'sealed' : 'single';
  if (card.portfolioKind === kind) return card;
  return { ...card, portfolioKind: kind };
};

const SEED_CARDS: Card[] = [
  { id: '1', name: 'Pikachu ex (238)', set: 'Surging Sparks', rarity: 'SIR', raw: 324.5, psa10: 1250, grade9: 395, p10: 0.3, p9: 0.5 },
  { id: '2', name: 'Meowth (106)', set: 'Phantasmal Flames', rarity: 'IR', raw: 19.27, psa10: 192.56, grade9: 34.54, p10: 0.35, p9: 0.5 },
];

const emptyDraft = (): Omit<Card, 'id'> => ({
  name: '',
  set: '',
  rarity: '',
  cardNumber: '',
  url: '',
  localImage: null,
  raw: 0,
  grade9: 0,
  psa10: 0,
  actualCost: undefined,
  shippingCost: undefined,
  freeShipping: false,
  allPrices: [],
  estimatedGradeKey: '',
  potentialValue: undefined,
  psaSpecId: '',
  psaPop: null,
  gemrateCandidates: [],
  gemrateId: '',
  tcgplayerUrl: '',
  portfolioKind: 'single',
  p10: DEFAULT_PROBS.p10,
  p9: DEFAULT_PROBS.p9,
});

/** Build a high-signal GemRate query from the scraped fields. */

type BackendStatus = 'checking' | 'online' | 'offline';
type ListingLanguageFilter = 'all' | CardLanguageTag;
const App = () => {
  const [cards, setCards] = useState<Card[]>(() => loadCards());
  const [fees, setFees] = useState<Fees>(() => loadFees());
  const [psaToken, setPsaToken] = useState<string>(() => loadPsaToken());
  const [googleCseKey, setGoogleCseKey] = useState('');
  const [googleCseCx, setGoogleCseCx] = useState('');
  const [collections, setCollections] = useState<Collection[]>(() => loadCollections());
  const [filters, setFilters] = useState<FilterState>(() => loadFilters());
  const [sort, setSort] = useState<SortPreset>(() => loadSort());
  const [isAdding, setIsAdding] = useState(false);
  const [adminSection, setAdminSection] = useState<AdminPanelSection>('configuration');
  const [showCollections, setShowCollections] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [draft, setDraft] = useState(emptyDraft);
  const [backendStatus, setBackendStatus] = useState<BackendStatus>('checking');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [refreshingIds, setRefreshingIds] = useState<Set<string>>(new Set());
  const [refreshingEbayIds, setRefreshingEbayIds] = useState<Set<string>>(new Set());
  const [refreshAppliedById, setRefreshAppliedById] = useState<
    Record<string, { tcg: number; ebay: number; at: number }>
  >({});
  const [bulkRefresh, setBulkRefresh] = useState<{
    done: number;
    total: number;
    errors: number;
  } | null>(null);
  const [bulkEbayRefresh, setBulkEbayRefresh] = useState<{
    done: number;
    total: number;
    errors: number;
  } | null>(null);
  const [showNebula, setShowNebula] = useState<boolean>(() => {
    try {
      return localStorage.getItem('pcgr:nebula:open') === '1';
    } catch {
      return false;
    }
  });
  const [extensionLatestOnlyMode, setExtensionLatestOnlyMode] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_EXTENSION_LATEST_ONLY);
      if (raw == null) return true;
      return raw === '1';
    } catch {
      return true;
    }
  });
  // Server-sync bookkeeping:
  //   hydrated -> initial GET /api/store has resolved (or failed). Saves are
  //               blocked until this is true so we can't overwrite the
  //               server's durable copy with our empty boot state.
  //   syncStatus -> UI badge ('syncing' / 'saved' / 'offline' / 'idle').
  const [hydrated, setHydrated] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const lastSavedAtRef = useRef<number>(0);
  const syncStatusRef = useRef<SyncStatus>('idle');
  const incrementalSyncEnabledRef = useRef(false);
  const syncBaselineRef = useRef(createEmptySyncBaseline());
  /** Full-card cache for SQLite-primary mode: dirty sync + quick picker outside the visible grid page. */
  const cardCacheRef = useRef<Map<string, Card>>(new Map());
  const dirtyCardIdsRef = useRef(new Set<string>());
  const gridOffsetRef = useRef(0);
  const [serverPagedPortfolio, setServerPagedPortfolio] = useState(false);
  const serverPagedPortfolioRef = useRef(false);
  useEffect(() => {
    serverPagedPortfolioRef.current = serverPagedPortfolio;
  }, [serverPagedPortfolio]);
  const [gridOffset, setGridOffset] = useState(0);
  const [gridTotal, setGridTotal] = useState(0);
  /** Name-sorted slice for Quick picker when the grid is server-paged (not the full portfolio). */
  const [quickIndexCards, setQuickIndexCards] = useState<Card[] | null>(null);
  /** Bumped when cardCacheRef is updated off-page so quickCard memos re-resolve. */
  const [portfolioRevision, setPortfolioRevision] = useState(0);
  /** Full portfolio snapshot for Star Chart / Strategies when using server paging (loaded on demand). */
  const [vizCards, setVizCards] = useState<Card[] | null>(null);
  /** Loaded when Collection Manager opens under SQLite-primary paging (accurate per-collection counts). */
  const [collectionCountCards, setCollectionCountCards] = useState<Card[] | null>(null);
  const [collectionImportProgress, setCollectionImportProgress] = useState<CollectionImportProgress | null>(null);
  const [collectionImportIssues, setCollectionImportIssues] = useState<CollectionImportIssue[]>([]);
  const [collectionImportFailedRows, setCollectionImportFailedRows] = useState<PriceChartingCollectionRow[]>([]);
  const [workspacePage, setWorkspacePage] = useState<
    | 'quick'
    | 'streamer'
    | 'master'
    | 'strategies'
    | 'insights'
    | 'starChart'
    | 'admin'
    | 'arsenal'
    | 'guide'
  >('quick');
  const [guideIframeKey, setGuideIframeKey] = useState(0);
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [adminStats, setAdminStats] = useState<AdminStatsState | null>(null);
  const [autoPopulateMode, setAutoPopulateMode] = useState<'unassigned' | 'force'>('unassigned');
  const [quickCardId, setQuickCardId] = useState<string>('');
  const [quickExpanded, setQuickExpanded] = useState(false);
  const [quickBusy, setQuickBusy] = useState(false);
  const [quickError, setQuickError] = useState<string | null>(null);
  const [quickCardAdminSettings, setQuickCardAdminSettings] = useState<QuickCardAdminSettings>(() =>
    loadQuickCardAdminSettings()
  );
  const [streamerSkinId, setStreamerSkinId] = useState<StreamerSkinId>(() => loadStreamerSkinId());
  const [quickFetchActiveMode, setQuickFetchActiveMode] = useState<QuickCardFetchMode | null>(null);
  const autoQuickRefreshInFlightRef = useRef<string | null>(null);
  const [quickFetchPhase, setQuickFetchPhase] = useState<string | null>(null);
  const [quickEbayCaptureDiagnostics, setQuickEbayCaptureDiagnostics] =
    useState<EbayCaptureDiagnostics | null>(null);
  /** 0–100 while RawEngine Quick Fetch runs; null when idle. */
  const [quickFetchProgressPct, setQuickFetchProgressPct] = useState<number | null>(null);
  /** Whole-window capture UI while RawEngine Quick Fetch is in flight (survives strict sub-states). */
  const [rawEngineQuickFetchActive, setRawEngineQuickFetchActive] = useState(false);
  /** Card name/set shown on capture bar so the target matches what you clicked. */
  const [quickFetchTargetSummary, setQuickFetchTargetSummary] = useState<string | null>(null);
  const quickFetchAbortRef = useRef<AbortController | null>(null);
  const quickFetchSessionRef = useRef<{
    cardId: string;
    portfolioKindScope: FilterState['portfolioKindScope'];
  } | null>(null);
  const [quickFetchCaptureStage, setQuickFetchCaptureStage] = useState<
    'capturing' | 'refreshing' | 'idle'
  >('idle');
  const quickFetchPreflightResolveRef = useRef<((v: 'continue' | 'stop') => void) | null>(null);
  const [quickFetchMarketPreflight, setQuickFetchMarketPreflight] = useState<{
    kind: QuickFetchPreflightKind;
  } | null>(null);
  const [quickFetchTimingStore, setQuickFetchTimingStore] = useState<QuickFetchTimingStore>(() =>
    loadQuickFetchTimingStore()
  );
  const [quickTab, setQuickTab] = useState<'grand' | 'pc' | 'tcg' | 'ebay' | 'archived' | 'math'>(
    'ebay'
  );
  const [quickSearch, setQuickSearch] = useState('');
  const [quickPickerOpen, setQuickPickerOpen] = useState(false);
  const [quickWindow, setQuickWindow] = useState<'1d' | '7d' | '30d' | '90d' | 'all'>('30d');
  const [quickEbayTitleStampFilter, setQuickEbayTitleStampFilter] = useState<EbayTitleStampFilter>('all');
  const [quickEbayTitleSealedFilter, setQuickEbayTitleSealedFilter] = useState<EbayTitleSealedFilter>('all');
  const [quickListingLanguageFilter, setQuickListingLanguageFilter] = useState<ListingLanguageFilter>('all');
  const [quickPhotosOnly, setQuickPhotosOnly] = useState(false);
  const [quickHideSuspiciousLanguageRows, setQuickHideSuspiciousLanguageRows] = useState(false);
  const [quickSignalScopeMode, setQuickSignalScopeMode] = useState<'raw' | 'graded'>('raw');
  const [quickSignalCompany, setQuickSignalCompany] = useState<GraderCompany>('PSA');
  const [quickSignalGradeTag, setQuickSignalGradeTag] = useState<string>('ALL');
  const [quickSidebarHiddenDefault, setQuickSidebarHiddenDefault] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_QUICK_PRICE_SIDEBAR_HIDDEN_DEFAULT) === '1';
    } catch {
      return false;
    }
  });
  const [quickSidebarOpen, setQuickSidebarOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_QUICK_PRICE_SIDEBAR_HIDDEN_DEFAULT) !== '1';
    } catch {
      return true;
    }
  });
  const quickPickerRef = useRef<HTMLDivElement | null>(null);
  /** Master list: multi-select for bulk eBay tag & archive actions. */
  const [bulkSelectedCardIds, setBulkSelectedCardIds] = useState<string[]>([]);

  useEffect(() => {
    lastSavedAtRef.current = Number.isFinite(lastSavedAt) ? Number(lastSavedAt) : 0;
  }, [lastSavedAt]);

  useEffect(() => {
    syncStatusRef.current = syncStatus;
  }, [syncStatus]);

  const [serverTotals, setServerTotals] = useState<PortfolioTotalsServer | null>(null);

  const applyMetaFromDoc = useCallback((doc: Partial<import('./serverSync').ServerDoc>) => {
    if (doc.fees) setFees({ ...DEFAULT_FEES, ...doc.fees });
    if (Array.isArray(doc.collections)) setCollections(doc.collections);
    if (doc.filters) setFilters(normalizeFilterState(doc.filters));
    if (typeof doc.sort === 'string' && doc.sort in SORT_LABELS) {
      setSort(doc.sort as SortPreset);
    }
    if (typeof doc.psaToken === 'string') setPsaToken(doc.psaToken);
    if (typeof doc.googleCseKey === 'string') setGoogleCseKey(doc.googleCseKey);
    if (typeof doc.googleCseCx === 'string') setGoogleCseCx(doc.googleCseCx);
    if (typeof doc.nebulaOpen === 'boolean') setShowNebula(doc.nebulaOpen);
    if (typeof doc.extensionLatestOnlyMode === 'boolean') {
      setExtensionLatestOnlyMode(doc.extensionLatestOnlyMode);
    }
    if (doc.quickCardAdminSettings && typeof doc.quickCardAdminSettings === 'object') {
      setQuickCardAdminSettings(
        normalizeQuickCardAdminSettings(
          doc.quickCardAdminSettings as Partial<QuickCardAdminSettings>
        )
      );
    }
    if (typeof doc.updatedAt === 'number' && doc.updatedAt > 0) {
      setLastSavedAt(doc.updatedAt);
      setSyncStatus('saved');
    }
  }, []);

  const applyServerSnapshot = useCallback(
    (doc: Awaited<ReturnType<typeof loadFromServer>>) => {
      if (!doc || doc.updatedAt <= 0) return false;
      if (Array.isArray(doc.cards) && doc.cards.length > 0) setCards(doc.cards);
      applyMetaFromDoc(doc);
      return true;
    },
    [applyMetaFromDoc]
  );

  useEffect(() => {
    try {
      localStorage.setItem('pcgr:nebula:open', showNebula ? '1' : '0');
    } catch {
      /* noop - localStorage may be unavailable (private mode / quota) */
    }
  }, [showNebula]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_EXTENSION_LATEST_ONLY, extensionLatestOnlyMode ? '1' : '0');
    } catch {
      /* noop */
    }
  }, [extensionLatestOnlyMode]);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY_QUICK_PRICE_SIDEBAR_HIDDEN_DEFAULT,
        quickSidebarHiddenDefault ? '1' : '0'
      );
    } catch {
      /* noop */
    }
  }, [quickSidebarHiddenDefault]);

  useEffect(() => {
    saveQuickCardAdminSettings(quickCardAdminSettings);
    saveQuickFetchMarketMode(quickCardAdminSettings.quickFetchMarketMode);
  }, [quickCardAdminSettings]);

  useEffect(() => {
    saveStreamerSkinId(streamerSkinId);
  }, [streamerSkinId]);

  const handleStreamerSkinChange = useCallback((id: StreamerSkinId) => {
    setStreamerSkinId(id);
  }, []);

  const patchQuickCardAdminSettings = useCallback((patch: Partial<QuickCardAdminSettings>) => {
    setQuickCardAdminSettings((prev) => normalizeQuickCardAdminSettings({ ...prev, ...patch }));
  }, []);

  useEffect(() => {
    saveQuickFetchTimingStore(quickFetchTimingStore);
  }, [quickFetchTimingStore]);

  const setQuickFetchTimingField = useCallback(
    <K extends keyof QuickFetchTiming>(k: K, v: QuickFetchTiming[K]) => {
      setQuickFetchTimingStore((prev) => ({
        customized: true,
        timing: applyQuickFetchTimingPatch(prev.timing, { [k]: v } as Partial<QuickFetchTiming>),
      }));
    },
    []
  );

  const resetQuickFetchTimingDefaults = useCallback(() => {
    setQuickFetchTimingStore({ timing: { ...DEFAULT_QUICK_FETCH_TIMING }, customized: false });
  }, []);

  const onGoogleCseKeysSaved = useCallback(
    (updatedAt: number) => {
      setLastSavedAt(updatedAt);
      setSyncStatus('saved');
      syncBaselineRef.current.lastMetaJson = metaBaselineString({
        cards,
        fees,
        collections,
        filters,
        sort,
        psaToken,
        nebulaOpen: showNebula,
        extensionLatestOnlyMode,
        quickCardAdminSettings,
        googleCseKey,
        googleCseCx,
      });
    },
    [
      cards,
      fees,
      collections,
      filters,
      sort,
      psaToken,
      showNebula,
      extensionLatestOnlyMode,
      googleCseKey,
      googleCseCx,
    ]
  );

  useEffect(() => {
    if (!isRawEngineShell()) return;
    const pub = getRawEngineCaptureChrome()?.publish;
    if (!pub) return;
    void pub({
      active: rawEngineQuickFetchActive,
      pct: quickFetchProgressPct ?? 0,
      phase: quickFetchPhase ?? '',
      target: quickFetchTargetSummary ?? '',
      stage: quickFetchCaptureStage,
    });
  }, [
    rawEngineQuickFetchActive,
    quickFetchProgressPct,
    quickFetchPhase,
    quickFetchTargetSummary,
    quickFetchCaptureStage,
  ]);

  useEffect(() => {
    if (!isRawEngineShell()) return;
    const pub = getRawEngineCaptureChrome()?.publish;
    return () => {
      void pub?.({ active: false, pct: 0, phase: '', target: '' });
    };
  }, []);

  useEffect(() => {
    if (!isRawEngineShell()) return;
    const off = subscribeRawEngineQuickFetchCancel(() => {
      quickFetchAbortRef.current?.abort();
    });
    return () => {
      off?.();
    };
  }, []);

  useEffect(() => {
    if (incrementalSyncEnabledRef.current) return;
    localStorage.setItem(STORAGE_KEY_CARDS, JSON.stringify(cards));
  }, [cards]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_FEES, JSON.stringify(fees));
  }, [fees]);

  useEffect(() => {
    if (!shouldPersistPsaToken()) {
      try {
        localStorage.removeItem(STORAGE_KEY_PSA_TOKEN);
      } catch {
        /* noop */
      }
      return;
    }
    if (psaToken) localStorage.setItem(STORAGE_KEY_PSA_TOKEN, psaToken);
    else localStorage.removeItem(STORAGE_KEY_PSA_TOKEN);
  }, [psaToken]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_COLLECTIONS, JSON.stringify(collections));
  }, [collections]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_FILTERS, JSON.stringify(filters));
  }, [filters]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_SORT, sort);
  }, [sort]);

  /** Initial hydrate: app-portfolio v2 meta + paginated cards; fallback legacy GET /api/store. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const meta = await loadPortfolioMetaFromServer();
      if (cancelled) return;
      if (meta && typeof meta.updatedAt === 'number' && meta.updatedAt > 0) {
        incrementalSyncEnabledRef.current = true;
        setServerPagedPortfolio(true);
        dirtyCardIdsRef.current.clear();
        cardCacheRef.current = new Map();
        applyMetaFromDoc(meta);
        const f = normalizeFilterState(meta.filters as Partial<FilterState>);
        const s =
          typeof meta.sort === 'string' && meta.sort in SORT_LABELS
            ? (meta.sort as SortPreset)
            : 'ev_desc';
        const sum = await fetchPortfolioSummaryFromServer(f);
        if (!cancelled && sum) setServerTotals(sum);
        const page = await fetchCardsPageFromServer(f, s, 0, MASTER_GRID_PAGE_SIZE, true);
        if (cancelled) return;
        if (page) {
          for (const c of page.items) cardCacheRef.current.set(c.id, c);
          setCards(page.items);
          setGridTotal(page.total);
          setGridOffset(0);
          gridOffsetRef.current = 0;
          syncBaselineRef.current.lastMetaJson = metaBaselineFromServerDoc(meta);
          syncBaselineRef.current.lastCardJson = new Map(
            page.items.map((c) => [c.id, JSON.stringify(c)])
          );
        }
        setHydrated(true);
        return;
      }
      incrementalSyncEnabledRef.current = false;
      setServerPagedPortfolio(false);
      const doc = await loadFromServer();
      if (cancelled) return;
      if (doc && doc.updatedAt > 0) {
        applyServerSnapshot(doc);
      } else if (doc === null) {
        setSyncStatus('offline');
      }
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyMetaFromDoc, applyServerSnapshot]);

  const skipFiltersRefetchRef = useRef(true);

  useEffect(() => {
    if (!hydrated) return;
    if (skipFiltersRefetchRef.current) {
      skipFiltersRefetchRef.current = false;
      return;
    }
    let cancelled = false;
    (async () => {
      const sum = await fetchPortfolioSummaryFromServer(filters);
      if (!cancelled && sum) setServerTotals(sum);
      if (serverPagedPortfolio) {
        const page = await fetchCardsPageFromServer(filters, sort, 0, MASTER_GRID_PAGE_SIZE, true);
        if (cancelled || !page) return;
        for (const c of page.items) cardCacheRef.current.set(c.id, c);
        setCards(page.items);
        setGridTotal(page.total);
        setGridOffset(0);
        gridOffsetRef.current = 0;
        for (const c of page.items) {
          syncBaselineRef.current.lastCardJson.set(c.id, JSON.stringify(c));
        }
        syncBaselineRef.current.lastMetaJson = metaBaselineString({
          cards: page.items,
          fees,
          collections,
          filters,
          sort,
          psaToken,
          nebulaOpen: showNebula,
          extensionLatestOnlyMode,
          quickCardAdminSettings,
          googleCseKey,
          googleCseCx,
        });
        return;
      }
      const all = await fetchAllCardsPagesFromServer(filters, sort);
      if (cancelled || !all) return;
      setCards(all);
      syncBaselineRef.current.lastMetaJson = metaBaselineString({
        cards: all,
        fees,
        collections,
        filters,
        sort,
        psaToken,
        nebulaOpen: showNebula,
        extensionLatestOnlyMode,
        quickCardAdminSettings,
        googleCseKey,
        googleCseCx,
      });
      syncBaselineRef.current.lastCardJson = new Map(all.map((c) => [c.id, JSON.stringify(c)]));
    })();
    return () => {
      cancelled = true;
    };
  }, [
    hydrated,
    filters,
    sort,
    fees,
    collections,
    psaToken,
    showNebula,
    extensionLatestOnlyMode,
    quickCardAdminSettings,
    googleCseKey,
    googleCseCx,
    serverPagedPortfolio,
  ]);

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    const poll = async () => {
      if (syncStatusRef.current === 'syncing') return;
      if (quickFetchSessionRef.current?.cardId) return;
      const meta = await loadPortfolioMetaFromServer();
      if (cancelled || !meta || !(meta.updatedAt > lastSavedAtRef.current)) return;
      applyMetaFromDoc(meta);
      const sum = await fetchPortfolioSummaryFromServer(filters);
      if (!cancelled && sum) setServerTotals(sum);
      if (serverPagedPortfolio) {
        if (dirtyCardIdsRef.current.size > 0) {
          setLastSavedAt(meta.updatedAt);
          return;
        }
        const off = gridOffsetRef.current;
        const page = await fetchCardsPageFromServer(filters, sort, off, MASTER_GRID_PAGE_SIZE, true);
        if (cancelled || !page) return;
        const mergedItems = mergeServerPageWithLocalCache(
          page.items,
          cardCacheRef.current,
          dirtyCardIdsRef.current
        );
        for (const c of mergedItems) cardCacheRef.current.set(c.id, c);
        setCards(mergedItems);
        setGridTotal(page.total);
        for (const c of page.items) {
          syncBaselineRef.current.lastCardJson.set(c.id, JSON.stringify(c));
        }
        syncBaselineRef.current.lastMetaJson = metaBaselineString({
          cards: page.items,
          fees,
          collections,
          filters,
          sort,
          psaToken,
          nebulaOpen: showNebula,
          extensionLatestOnlyMode,
          googleCseKey,
          googleCseCx,
        });
        setLastSavedAt(meta.updatedAt);
        return;
      }
      const all = await fetchAllCardsPagesFromServer(filters, sort);
      if (cancelled || !all) return;
      setCards(all);
      syncBaselineRef.current.lastMetaJson = metaBaselineString({
        cards: all,
        fees,
        collections,
        filters,
        sort,
        psaToken,
        nebulaOpen: showNebula,
        extensionLatestOnlyMode,
        quickCardAdminSettings,
        googleCseKey,
        googleCseCx,
      });
      syncBaselineRef.current.lastCardJson = new Map(all.map((c) => [c.id, JSON.stringify(c)]));
      setLastSavedAt(meta.updatedAt);
    };
    const id = window.setInterval(poll, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [
    hydrated,
    applyMetaFromDoc,
    filters,
    sort,
    fees,
    collections,
    psaToken,
    showNebula,
    extensionLatestOnlyMode,
    googleCseKey,
    googleCseCx,
    serverPagedPortfolio,
  ]);

  useEffect(() => {
    gridOffsetRef.current = gridOffset;
  }, [gridOffset]);

  useEffect(() => {
    if (!showCollections || !serverPagedPortfolio) {
      setCollectionCountCards(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const all = await fetchAllCardsPagesFromServer(EMPTY_FILTERS, 'name_asc', 500, true);
      if (!cancelled && all) setCollectionCountCards(all);
    })();
    return () => {
      cancelled = true;
    };
  }, [showCollections, serverPagedPortfolio]);

  /** Quick picker list: one name-sorted page (server-filtered) when the master grid is paged. */
  useEffect(() => {
    if (!serverPagedPortfolio || !hydrated) {
      setQuickIndexCards(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const mergedFilters: FilterState = {
        ...filters,
        search: [filters.search.trim(), quickSearch.trim()].filter(Boolean).join(' ').trim(),
      };
      const page = await fetchCardsPageFromServer(mergedFilters, 'name_asc', 0, 200, true);
      if (!cancelled && page) setQuickIndexCards(page.items);
    })();
    return () => {
      cancelled = true;
    };
  }, [serverPagedPortfolio, hydrated, filters, quickSearch]);

  /** Star chart / sell strategies need the full filtered deck — load on demand when using server paging. */
  useEffect(() => {
    if (!serverPagedPortfolio) {
      setVizCards(null);
      return;
    }
    if (workspacePage !== 'starChart' && workspacePage !== 'strategies') {
      setVizCards(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const all = await fetchAllCardsPagesFromServer(filters, sort);
      if (!cancelled && all) setVizCards(all);
    })();
    return () => {
      cancelled = true;
    };
  }, [serverPagedPortfolio, workspacePage, filters, sort]);

  useEffect(() => {
    setCollections((prev) => {
      const byName = new Set(prev.map((c) => c.name.trim().toLowerCase()));
      const next = [...prev];
      if (!byName.has(DEFAULT_BIN_COLLECTIONS.sell.name)) {
        next.push({
          id: crypto.randomUUID(),
          name: DEFAULT_BIN_COLLECTIONS.sell.name,
          color: DEFAULT_BIN_COLLECTIONS.sell.color,
          createdAt: Date.now(),
        });
      }
      if (!byName.has(DEFAULT_BIN_COLLECTIONS.hold.name)) {
        next.push({
          id: crypto.randomUUID(),
          name: DEFAULT_BIN_COLLECTIONS.hold.name,
          color: DEFAULT_BIN_COLLECTIONS.hold.color,
          createdAt: Date.now(),
        });
      }
      return next;
    });
  }, []);

  // Debounced sync: row store uses PATCH meta + per-card PUT; legacy hydrate uses full PUT /api/store.
  useEffect(() => {
    if (!hydrated) return;
    const dirtyCards = Array.from(dirtyCardIdsRef.current)
      .map((id) => cardCacheRef.current.get(id))
      .filter((c): c is Card => c != null);
    const snapshot: PortfolioSnapshot = {
      cards: serverPagedPortfolio ? dirtyCards : cards,
      fees,
      collections,
      hunts: undefined,
      targets: undefined,
      filters,
      sort,
      psaToken,
      nebulaOpen: showNebula,
      extensionLatestOnlyMode,
      quickCardAdminSettings,
      googleCseKey,
      googleCseCx,
    };
    setSyncStatus((s) => (s === 'offline' ? s : 'syncing'));
    const id = window.setTimeout(async () => {
      if (incrementalSyncEnabledRef.current) {
        const updatedAt = await incrementalPushPortfolioToServer(
          snapshot,
          syncBaselineRef.current,
          serverPagedPortfolio ? { dirtyOnly: true } : undefined
        );
        if (updatedAt == null) {
          setSyncStatus('offline');
        } else {
          if (serverPagedPortfolio) {
            dirtyCardIdsRef.current.clear();
          }
          setLastSavedAt(updatedAt);
          setSyncStatus('saved');
        }
        return;
      }
      const fullSnapshot: PortfolioSnapshot = { ...snapshot, cards };
      const updatedAt = await saveToServer(fullSnapshot);
      if (updatedAt == null) {
        setSyncStatus('offline');
      } else {
        setLastSavedAt(updatedAt);
        setSyncStatus('saved');
      }
    }, 750);
    return () => window.clearTimeout(id);
  }, [
    hydrated,
    cards,
    fees,
    collections,
    filters,
    sort,
    psaToken,
    showNebula,
    extensionLatestOnlyMode,
    googleCseKey,
    googleCseCx,
    serverPagedPortfolio,
  ]);

  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 2500);
        const r = await fetch(apiUrl('/api/health'), { signal: ctrl.signal });
        clearTimeout(t);
        if (!cancelled) setBackendStatus(r.ok ? 'online' : 'offline');
      } catch {
        if (!cancelled) setBackendStatus('offline');
      }
    };
    probe();
    const id = window.setInterval(probe, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const enriched = useMemo<EnrichedCard[]>(
    () =>
      cards.map((c) => {
        const metrics = computeMetrics(c, fees);
        const base: EnrichedCard = { ...c, metrics };
        return { ...base, rowSignalIcons: computeRowSignalIcons(base) };
      }),
    [cards, fees]
  );

  const stageCardInPortfolio = useCallback(
    (card: Card) => {
      stageCardUpdate(card, {
        setCards,
        setQuickIndexCards,
        cardCache: cardCacheRef.current,
        dirtyIds: dirtyCardIdsRef.current,
        serverPaged: serverPagedPortfolio,
      });
      setPortfolioRevision((n) => n + 1);
    },
    [serverPagedPortfolio]
  );

  /** Full-deck projection for Star Chart / Strategies when SQLite-primary paging loads cards on demand. */
  const enrichedViz = useMemo<EnrichedCard[]>(() => {
    const src =
      serverPagedPortfolio && (workspacePage === 'starChart' || workspacePage === 'strategies')
        ? vizCards ?? []
        : cards;
    return src.map((c) => {
      const metrics = computeMetrics(c, fees);
      const base: EnrichedCard = { ...c, metrics };
      return { ...base, rowSignalIcons: computeRowSignalIcons(base) };
    });
  }, [cards, fees, serverPagedPortfolio, workspacePage, vizCards]);

  /** Master list: server applies filters/sort when using GET /api/cards pages. */
  const visible = useMemo<EnrichedCard[]>(() => {
    if (serverPagedPortfolio) return enriched;
    return applySort(applyFilters(enriched, filters), sort);
  }, [serverPagedPortfolio, enriched, filters, sort]);

  const strategiesVisible = useMemo<EnrichedCard[]>(
    () => applySort(applyFilters(enrichedViz, filters), sort),
    [enrichedViz, filters, sort]
  );
  const bulkSelectedSet = useMemo(() => new Set(bulkSelectedCardIds), [bulkSelectedCardIds]);
  const allVisibleSelected = useMemo(
    () => visible.length > 0 && visible.every((c) => bulkSelectedSet.has(c.id)),
    [visible, bulkSelectedSet]
  );

  const quickCards = useMemo(() => {
    const sortQuick = (rows: EnrichedCard[]) =>
      [...rows].sort((a, b) => {
        const n = a.name.localeCompare(b.name);
        if (n !== 0) return n;
        return (a.set || '').localeCompare(b.set || '');
      });
    if (serverPagedPortfolio) {
      const rawList = quickIndexCards ?? [];
      const mapped: EnrichedCard[] = rawList.map((c) => {
        const metrics = computeMetrics(c, fees);
        const base: EnrichedCard = { ...c, metrics };
        return { ...base, rowSignalIcons: computeRowSignalIcons(base) };
      });
      return sortQuick(applyFilters(mapped, filters));
    }
    return sortQuick(applyFilters(enriched, filters));
  }, [serverPagedPortfolio, quickIndexCards, enriched, filters, fees]);

  /** Resolved from full portfolio — never fall back to another card when filters hide the selection. */
  const quickCard = useMemo(() => {
    if (!quickCardId) return null;
    const fromMaster = enriched.find((c) => c.id === quickCardId);
    if (fromMaster) return fromMaster;
    const raw: Card | undefined =
      cardCacheRef.current.get(quickCardId) ??
      quickIndexCards?.find((c) => c.id === quickCardId) ??
      cards.find((c) => c.id === quickCardId);
    if (!raw) return null;
    const metrics = computeMetrics(raw, fees);
    const base: EnrichedCard = { ...raw, metrics };
    return { ...base, rowSignalIcons: computeRowSignalIcons(base) };
  }, [enriched, quickCardId, serverPagedPortfolio, quickIndexCards, cards, fees, portfolioRevision]);

  const filteredQuickCards = useMemo(() => {
    const q = quickSearch.trim().toLowerCase();
    if (!q) return quickCards;
    return quickCards.filter((c) =>
      `${c.name} ${c.set || ''} ${c.cardNumber || ''}`.toLowerCase().includes(q)
    );
  }, [quickCards, quickSearch]);

  /** Toolbar refine dropdowns: full portfolio when local-only; name-index slice when SQLite-primary paged. */
  const toolbarCards = useMemo<EnrichedCard[]>(() => {
    if (!serverPagedPortfolio) return enriched;
    const rawList = quickIndexCards ?? [];
    if (rawList.length === 0) return enriched;
    return rawList.map((c) => {
      const metrics = computeMetrics(c, fees);
      const base: EnrichedCard = { ...c, metrics };
      return { ...base, rowSignalIcons: computeRowSignalIcons(base) };
    });
  }, [serverPagedPortfolio, enriched, quickIndexCards, fees]);

  const quickPcUrl = quickCard?.url?.trim() || null;
  const quickEbayUrl = quickCard ? ebaySoldSearchUrlForCard(quickCard) : null;
  const quickEbayPurchaseUrl = quickCard ? ebayPurchaseSearchUrlForCard(quickCard) : null;
  const quickTcgUrl = quickCard ? resolveTcgplayerProductUrl(quickCard) : null;
  const quickGemCandidate =
    (quickCard?.gemrateCandidates ?? []).find((x) => x.gemrateId === quickCard?.gemrateId) ??
    (quickCard?.gemrateCandidates ?? [])[0] ??
    null;
  const quickGemrateUrl =
    quickGemCandidate?.detailUrl ||
    (quickCard?.gemrateId ? `https://www.gemrate.com/card/${encodeURIComponent(quickCard.gemrateId)}` : null);

  const quickEbayRowsBase = useMemo(() => {
    if (!quickCard) return [] as Array<{
      soldAt: number;
      price: number;
      title: string;
      itemId: string | null;
      languageTag?: CardLanguageTag;
      hasPhoto?: boolean | null;
      suspiciousLanguagePump?: boolean;
      suspiciousReason?: string | null;
      isGraded?: boolean;
      grader?: 'PSA' | 'CGC' | 'BGS' | 'SGC' | 'TAG' | 'ACE' | 'AI' | null;
      gradeTag?: string | null;
    }>;
    const ebayArchived = new Set(quickCard.ebayArchivedSaleKeys ?? []);
    const ebayDisbanded = new Set(quickCard.ebayDisbandedSaleKeys ?? []);
    const ebayRestoredFiltered = new Set(quickCard.ebayRestoredFilteredSaleKeys ?? []);
    const ebaySaleKey = (r: { soldAt: number; price: number; title: string; itemId?: string | null }) =>
      r.itemId && String(r.itemId).trim()
        ? `itm:${String(r.itemId).trim()}`
        : `${startOfUtcDay(toEpochMsLoose(r.soldAt) ?? 0)}|${Number(r.price).toFixed(4)}|${r.title.trim().toLowerCase()}`;
    const ebayActive = quickCard.ebayExtensionSnapshot?.listings ?? [];
    const ebayRestored = (quickCard.ebayExtensionSnapshot?.rejectedListings ?? []).filter((r) =>
      ebayRestoredFiltered.has(ebaySaleKey(r))
    );
    const dedup = new Map<string, (typeof ebayActive)[number]>();
    for (const r of [...ebayActive, ...ebayRestored]) {
      const k = ebaySaleKey(r);
      if (!dedup.has(k)) dedup.set(k, r);
    }
    return Array.from(dedup.values())
      .filter((r) => !ebayDisbanded.has(ebaySaleKey(r)) && !ebayArchived.has(ebaySaleKey(r)))
      .map((r) => {
        const soldAt = toEpochMsLoose(r.soldAt);
        const price = Number(r.price);
        if (soldAt == null || !Number.isFinite(price)) return null;
        return { ...r, soldAt, price };
      })
      .filter((r): r is NonNullable<typeof r> => Boolean(r));
  }, [quickCard]);

  /** Same PC stamp + sealed-in-title filter as the overview / Grand eBay line (drives quick KPIs). */
  const listingMatchesQuickFilters = useCallback(
    (row: {
      title: string;
      languageTag?: CardLanguageTag;
      hasPhoto?: boolean | null;
      suspiciousLanguagePump?: boolean;
      suspiciousReason?: string | null;
      pokemonCenterStamp?: boolean;
      sealedInTitle?: boolean;
    }): boolean => {
      if (!matchesEbayTitleTagFilters(row, quickEbayTitleStampFilter, quickEbayTitleSealedFilter)) return false;
      const lang = row.languageTag ?? 'UNKNOWN';
      if (quickListingLanguageFilter !== 'all' && lang !== quickListingLanguageFilter) return false;
      if (quickPhotosOnly && row.hasPhoto !== true) return false;
      if (quickHideSuspiciousLanguageRows && row.suspiciousLanguagePump === true) return false;
      return true;
    },
    [
      quickEbayTitleStampFilter,
      quickEbayTitleSealedFilter,
      quickListingLanguageFilter,
      quickPhotosOnly,
      quickHideSuspiciousLanguageRows,
    ]
  );

  const quickEbayRowsTitleFiltered = useMemo(
    () => quickEbayRowsBase.filter((r) => listingMatchesQuickFilters(r)),
    [quickEbayRowsBase, listingMatchesQuickFilters]
  );

  const streamerScatterToMs = (t: number): number => {
    if (!Number.isFinite(t) || t <= 0) return NaN;
    return t < 1_000_000_000_000 ? t * 1000 : t;
  };

  /** Raw-only eBay comps: same title/listing filters as Quick; Y uses unit price when present. */
  const streamerEbayScatterPoints = useMemo((): StreamerSalePoint[] => {
    const pts: StreamerSalePoint[] = [];
    for (const r of quickEbayRowsTitleFiltered) {
      if (r.isGraded) continue;
      const t = streamerScatterToMs(Number(r.soldAt));
      const price = ebayEffectivePrice(r);
      if (!Number.isFinite(t) || !Number.isFinite(price) || price <= 0 || price >= 100_000) continue;
      const itemId = r.itemId && String(r.itemId).trim() ? String(r.itemId).trim() : null;
      pts.push({ t, price, platform: 'ebay', itemId });
    }
    pts.sort((a, b) => a.t - b.t);
    return pts;
  }, [quickEbayRowsTitleFiltered]);

  /** TCG sales rows: same filters as quickMarketMoves tcg series. */
  const streamerTcgScatterPoints = useMemo((): StreamerSalePoint[] => {
    if (!quickCard) return [];
    const tcgArchived = new Set(quickCard.tcgplayerArchivedSaleKeys ?? []);
    const tcgSaleKey = (r: { at: number; condition: string | null; qty: number; price: number }) =>
      `${startOfUtcDay(r.at)}|${(r.condition || '').trim().toLowerCase()}|${r.qty}|${r.price.toFixed(4)}`;
    const rows = (quickCard.tcgplayerSalesSnapshot?.latestSalesRows ?? [])
      .filter((r) => !tcgArchived.has(tcgSaleKey(r)))
      .filter((r) => {
        const lang = r.languageTag ?? 'UNKNOWN';
        if (quickListingLanguageFilter !== 'all' && lang !== quickListingLanguageFilter) return false;
        if (quickPhotosOnly && r.hasPhoto !== true) return false;
        if (quickHideSuspiciousLanguageRows && r.suspiciousLanguagePump === true) return false;
        return true;
      });
    const pts: StreamerSalePoint[] = [];
    for (const r of rows) {
      const t = streamerScatterToMs(r.at);
      const price = r.price;
      if (!Number.isFinite(t) || !Number.isFinite(price) || price <= 0 || price >= 100_000) continue;
      pts.push({ t, price, platform: 'tcg', itemId: null });
    }
    pts.sort((a, b) => a.t - b.t);
    return pts;
  }, [quickCard, quickListingLanguageFilter, quickPhotosOnly, quickHideSuspiciousLanguageRows]);

  const quickAvailableGradeTagsByCompany = useMemo(() => {
    const by = new Map<GraderCompany, string[]>();
    for (const r of quickEbayRowsTitleFiltered) {
      if (!r.isGraded || !r.grader) continue;
      const company = r.grader as GraderCompany;
      const label = String(r.gradeTag || '').trim() || `${company} ?`;
      const arr = by.get(company) ?? [];
      if (!arr.includes(label)) arr.push(label);
      by.set(company, arr);
    }
    for (const [k, arr] of by.entries()) {
      arr.sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }));
      by.set(k, arr);
    }
    return by;
  }, [quickEbayRowsTitleFiltered]);

  const quickAvailableCompanies = useMemo(
    () => Array.from(quickAvailableGradeTagsByCompany.keys()).sort(),
    [quickAvailableGradeTagsByCompany]
  );

  useEffect(() => {
    if (quickSignalScopeMode !== 'graded') return;
    if (!quickAvailableCompanies.length) return;
    if (!quickAvailableCompanies.includes(quickSignalCompany)) {
      setQuickSignalCompany(quickAvailableCompanies[0]);
    }
  }, [quickSignalScopeMode, quickAvailableCompanies, quickSignalCompany]);

  useEffect(() => {
    if (quickSignalScopeMode !== 'graded') return;
    const tags = quickAvailableGradeTagsByCompany.get(quickSignalCompany) ?? [];
    if (!tags.length) return;
    if (quickSignalGradeTag !== 'ALL' && !tags.includes(quickSignalGradeTag)) {
      setQuickSignalGradeTag('ALL');
    }
  }, [quickSignalScopeMode, quickAvailableGradeTagsByCompany, quickSignalCompany, quickSignalGradeTag]);

  const quickEbayRowsForSignalScope = useMemo(() => {
    if (quickSignalScopeMode === 'raw') {
      return quickEbayRowsTitleFiltered.filter((r) => !r.isGraded);
    }
    return quickEbayRowsTitleFiltered.filter((r) => {
      if (!r.isGraded || !r.grader) return false;
      if (r.grader !== quickSignalCompany) return false;
      if (quickSignalGradeTag === 'ALL') return true;
      return String(r.gradeTag || '').trim() === quickSignalGradeTag;
    });
  }, [quickEbayRowsTitleFiltered, quickSignalScopeMode, quickSignalCompany, quickSignalGradeTag]);

  const quickEbayTitleFilterLabel = (() => {
    const p =
      quickEbayTitleStampFilter === 'all'
        ? 'All'
        : quickEbayTitleStampFilter === 'stamp'
          ? 'PC stamp only'
          : 'No PC stamp';
    const q =
      quickEbayTitleSealedFilter === 'all'
        ? 'All'
        : quickEbayTitleSealedFilter === 'sealed'
          ? 'Sealed in title'
          : 'Not sealed in title';
    const lang = quickListingLanguageFilter === 'all' ? 'All languages' : quickListingLanguageFilter;
    const photos = quickPhotosOnly ? 'Photos only' : 'Photos all';
    const suspicious = quickHideSuspiciousLanguageRows ? 'Hide suspicious non-English' : 'Show suspicious non-English';
    return `${p} / ${q} / ${lang} / ${photos} / ${suspicious}`;
  })();

  const quickMarketMoves = useMemo(() => {
    if (!quickCard) return null;
    const toMs = (t: number): number => {
      if (!Number.isFinite(t) || t <= 0) return NaN;
      return t < 1_000_000_000_000 ? t * 1000 : t;
    };
    const buildMeta = (
      rows: Array<{ at: number; price: number }>,
      anchorAt: number,
      fallbackPrices: number[] = []
    ) => {
      let normalized = rows
        .map((r) => ({ at: toMs(r.at), price: r.price }))
        .filter((r) => Number.isFinite(r.at) && Number.isFinite(r.price))
        .sort((a, b) => b.at - a.at);
      // Fallback for malformed/absent timestamps: keep price math alive using synthetic recency.
      if (!normalized.length && fallbackPrices.length) {
        normalized = fallbackPrices
          .filter((p) => Number.isFinite(p) && p > 0)
          .map((price, idx) => ({ at: anchorAt - idx * 60_000, price }));
      }
      const windowDays =
        quickWindow === '1d' ? 1 : quickWindow === '7d' ? 7 : quickWindow === '30d' ? 30 : quickWindow === '90d' ? 90 : null;
      const cutoff = windowDays != null ? anchorAt - windowDays * 86_400_000 : null;
      const strictScoped =
        cutoff != null ? normalized.filter((r) => r.at >= cutoff && r.at <= anchorAt) : normalized;
      // Fallback: if rows exist but selected window has none (stale capture), use available rows so KPI area is not blank.
      const scoped = strictScoped.length > 0 ? strictScoped : normalized;
      const currentRow = scoped[0] ?? null;
      const previousRow = scoped.length >= 2 ? scoped[scoped.length - 1] : null;
      const pct =
        currentRow && previousRow && previousRow.price > 0
          ? ((currentRow.price - previousRow.price) / previousRow.price) * 100
          : null;
      const rangeStart = scoped.length ? scoped[scoped.length - 1].at : null;
      const rangeEnd = scoped.length ? scoped[0].at : null;
      const sortedPrices = scoped.map((r) => r.price).filter((p) => Number.isFinite(p) && p > 0).sort((a, b) => a - b);
      return {
        pct,
        current: currentRow ? currentRow.price : null,
        previous: previousRow ? previousRow.price : null,
        points: scoped.length,
        scopedSeries: scoped,
        rangeStart,
        rangeEnd,
        q25: quantileLocal(sortedPrices, 0.25),
        median: quantileLocal(sortedPrices, 0.5),
        q75: quantileLocal(sortedPrices, 0.75),
        windowLabel:
          quickWindow === '1d' ? '1D'
          : quickWindow === '7d' ? '7D'
          : quickWindow === '30d' ? '30D'
          : quickWindow === '90d' ? '90D'
          : 'All',
        basisLabel:
          quickWindow === 'all'
            ? 'latest vs oldest available'
            : 'latest vs window start',
      };
    };
    const lastTwoPc = (quickCard.priceHistory ?? [])
      .map((p) => ({ at: p.at, price: typeof p.raw === 'number' ? p.raw : null }))
      .filter((x): x is { at: number; price: number } => x.price != null && Number.isFinite(x.at))
      .sort((a, b) => b.at - a.at);
    const latestPcAt = lastTwoPc.length ? toMs(lastTwoPc[0].at) : NaN;

    const tcgArchived = new Set(quickCard.tcgplayerArchivedSaleKeys ?? []);
    const tcgSaleKey = (r: { at: number; condition: string | null; qty: number; price: number }) =>
      `${startOfUtcDay(r.at)}|${(r.condition || '').trim().toLowerCase()}|${r.qty}|${r.price.toFixed(4)}`;
    const tcgRowsAll = (quickCard.tcgplayerSalesSnapshot?.latestSalesRows ?? [])
      .filter((r) => !tcgArchived.has(tcgSaleKey(r)))
      .filter((r) => {
        const lang = r.languageTag ?? 'UNKNOWN';
        if (quickListingLanguageFilter !== 'all' && lang !== quickListingLanguageFilter) return false;
        if (quickPhotosOnly && r.hasPhoto !== true) return false;
        if (quickHideSuspiciousLanguageRows && r.suspiciousLanguagePump === true) return false;
        return true;
      })
      .map((r) => ({ at: r.at, price: r.price }))
      .filter((x) => Number.isFinite(x.at) && Number.isFinite(x.price))
      .sort((a, b) => b.at - a.at);
    const latestTcgAt = tcgRowsAll.length ? toMs(tcgRowsAll[0].at) : NaN;

    const ebayRowsAll = quickEbayRowsForSignalScope
      .map((r) => ({ at: Number(r.soldAt), price: Number(r.price), isGraded: Boolean(r.isGraded) }))
      .filter((x) => Number.isFinite(x.at) && Number.isFinite(x.price))
      .sort((a, b) => b.at - a.at);
    const ebayRawRowsAll = quickEbayRowsTitleFiltered
      .filter((r) => !r.isGraded)
      .map((r) => ({ at: Number(r.soldAt), price: Number(r.price) }))
      .filter((x) => Number.isFinite(x.at) && Number.isFinite(x.price))
      .sort((a, b) => b.at - a.at);
    const latestEbayAt = ebayRowsAll.length ? toMs(ebayRowsAll[0].at) : NaN;
    const anchorAt = Math.max(
      Number.isFinite(latestPcAt) ? latestPcAt : 0,
      Number.isFinite(latestTcgAt) ? latestTcgAt : 0,
      Number.isFinite(latestEbayAt) ? latestEbayAt : 0
    ) || Date.now();
    // Per-platform window end so "Data points" matches Sales pace / rolling counts (global anchor
    // skewed eBay & TCG when another marketplace had a more recent observation).
    const pcMeta = buildMeta(lastTwoPc, Number.isFinite(latestPcAt) ? latestPcAt : anchorAt);
    const tcgMeta = buildMeta(tcgRowsAll, Number.isFinite(latestTcgAt) ? latestTcgAt : anchorAt);
    const tcgSummaryMarket =
      typeof quickCard.tcgplayerSummary?.marketPrice === 'number' &&
      Number.isFinite(quickCard.tcgplayerSummary.marketPrice)
        ? quickCard.tcgplayerSummary.marketPrice
        : null;
    const ebayMeta = buildMeta(
      ebayRowsAll,
      Number.isFinite(latestEbayAt) ? latestEbayAt : anchorAt,
      quickEbayRowsForSignalScope.map((r) => Number(r.price))
    );
    const latestEbayRawAt = ebayRawRowsAll.length ? toMs(ebayRawRowsAll[0].at) : NaN;
    const ebayRawMeta = buildMeta(
      ebayRawRowsAll,
      Number.isFinite(latestEbayRawAt) ? latestEbayRawAt : anchorAt,
      quickEbayRowsTitleFiltered.filter((r) => !r.isGraded).map((r) => Number(r.price))
    );

    return {
      pc: { ...pcMeta, label: 'PriceCharting', brand: 'pricecharting' as const },
      tcg: {
        ...tcgMeta,
        current: tcgMeta.current ?? tcgSummaryMarket,
        median: tcgMeta.median ?? tcgSummaryMarket,
        label: 'TCGPlayer',
        brand: 'tcgplayer' as const,
      },
      ebay: {
        ...ebayMeta,
        label: 'eBay',
        brand: 'ebay' as const,
        dataQuality: ebayRowsAll.length > 0 ? ('parsed' as const) : ('fallback' as const),
      },
      ebayRaw: ebayRawMeta,
      anchorAt,
    };
  }, [
    quickCard,
    quickWindow,
    quickEbayRowsForSignalScope,
    quickEbayRowsTitleFiltered,
    quickListingLanguageFilter,
    quickPhotosOnly,
    quickHideSuspiciousLanguageRows,
  ]);

  /** Rolling-window sales counts: PC = price history samples, TCG = sales rows, eBay = current scope (incl. stamp/sealed). */
  const quickPlatformSalesPace = useMemo(() => {
    if (!quickCard || !quickMarketMoves) return null;
    const anchorAt = quickMarketMoves.anchorAt;
    const toMs = (t: number): number => {
      if (!Number.isFinite(t) || t <= 0) return NaN;
      return t < 1_000_000_000_000 ? t * 1000 : t;
    };
    const windows = [1, 3, 7, 14, 30] as const;
    const pcAts = (quickCard.priceHistory ?? [])
      .filter((p) => typeof p.raw === 'number' && Number.isFinite(p.raw) && Number.isFinite(p.at))
      .map((p) => p.at);
    const tcgArchived = new Set(quickCard.tcgplayerArchivedSaleKeys ?? []);
    const tcgSaleKeyPace = (r: { at: number; condition: string | null; qty: number; price: number }) =>
      `${startOfUtcDay(r.at)}|${(r.condition || '').trim().toLowerCase()}|${r.qty}|${r.price.toFixed(4)}`;
    const tcgAts = (quickCard.tcgplayerSalesSnapshot?.latestSalesRows ?? [])
      .filter((r) => !tcgArchived.has(tcgSaleKeyPace(r)))
      .filter((r) => {
        const lang = r.languageTag ?? 'UNKNOWN';
        if (quickListingLanguageFilter !== 'all' && lang !== quickListingLanguageFilter) return false;
        if (quickPhotosOnly && r.hasPhoto !== true) return false;
        if (quickHideSuspiciousLanguageRows && r.suspiciousLanguagePump === true) return false;
        return true;
      })
      .map((r) => r.at)
      .filter((a) => Number.isFinite(a));
    const ebayAtsRaw = quickEbayRowsForSignalScope.map((r) => Number(r.soldAt));
    const ebayAts = ebayAtsRaw.filter((t) => Number.isFinite(toMs(t)));
    const latestMsOf = (ats: number[]): number => {
      let mx = Number.NEGATIVE_INFINITY;
      for (const t of ats) {
        const ms = toMs(t);
        if (Number.isFinite(ms) && ms > mx) mx = ms;
      }
      return Number.isFinite(mx) ? mx : anchorAt;
    };
    const countInWindow = (ats: number[], dayW: number, localAnchorAt: number): number => {
      const lo = localAnchorAt - dayW * 86_400_000;
      let n = 0;
      for (const t of ats) {
        const ms = toMs(t);
        if (!Number.isFinite(ms) || ms < lo || ms > localAnchorAt) continue;
        n += 1;
      }
      return n;
    };
    const pcAnchor = latestMsOf(pcAts);
    const tcgAnchor = latestMsOf(tcgAts);
    const ebayAnchor = latestMsOf(ebayAts);
    const syntheticEbayAts =
      !ebayAts.length && quickEbayRowsForSignalScope.length
        ? quickEbayRowsForSignalScope.map((_, idx) => ebayAnchor - idx * 86_400_000)
        : ebayAts;
    return windows.map((d) => ({
      days: d,
      pc: countInWindow(pcAts, d, pcAnchor),
      tcg: countInWindow(tcgAts, d, tcgAnchor),
      ebay: countInWindow(syntheticEbayAts, d, ebayAnchor),
    }));
  }, [
    quickCard,
    quickMarketMoves,
    quickEbayRowsForSignalScope,
    quickListingLanguageFilter,
    quickPhotosOnly,
    quickHideSuspiciousLanguageRows,
  ]);

  const quickFutures = useMemo<FuturesSignalResult | null>(() => {
    if (!quickMarketMoves) return null;
    const eBayTimingFallback = quickMarketMoves.ebay.dataQuality === 'fallback';
    const toUtcDay = (t: number) => {
      const d = new Date(t);
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    };
    const buildDailyBlend = (
      seriesSets: Array<Array<{ at: number; price: number }>>
    ): Array<{ at: number; price: number }> => {
      const byDay = new Map<number, { sum: number; n: number }>();
      for (const series of seriesSets) {
        const local = new Map<number, number[]>();
        for (const p of series) {
          const day = toUtcDay(p.at);
          const arr = local.get(day) ?? [];
          arr.push(p.price);
          local.set(day, arr);
        }
        for (const [day, arr] of local.entries()) {
          if (!arr.length) continue;
          const s = [...arr].sort((a, b) => a - b);
          const med = s[Math.floor((s.length - 1) / 2)];
          const cur = byDay.get(day) ?? { sum: 0, n: 0 };
          cur.sum += med;
          cur.n += 1;
          byDay.set(day, cur);
        }
      }
      return Array.from(byDay.entries())
        .map(([at, v]) => ({ at, price: v.n ? v.sum / v.n : 0 }))
        .filter((p) => Number.isFinite(p.price) && p.price > 0)
        .sort((a, b) => a.at - b.at);
    };

    const series =
      quickSignalScopeMode === 'graded'
        ? quickMarketMoves.ebay.scopedSeries
        : buildDailyBlend([
            quickMarketMoves.pc.scopedSeries,
            quickMarketMoves.tcg.scopedSeries,
            quickMarketMoves.ebayRaw.scopedSeries,
          ]);
    const anomalyCount = (quickCard?.tcgplayerSalesAnomalies ?? []).length;
    const base = evaluateFuturesSignal({
      points: series,
      windowLabel: quickMarketMoves.tcg.windowLabel,
      additionalAnomalyCount: anomalyCount,
      baselineLowPrice: quickMarketMoves.ebay.q25,
      baselineHighPrice: quickMarketMoves.ebay.q75,
    });
    if (!eBayTimingFallback) return base;
    // Conservative mode when eBay timing quality is degraded.
    const damp = (v: number) => Math.max(0, Math.min(100, Math.round(v * 0.75)));
    return {
      ...base,
      directionConfidencePct: damp(base.directionConfidencePct),
      likelihoodUpPct: damp(base.likelihoodUpPct),
      likelihoodDownPct: damp(base.likelihoodDownPct),
      likelihoodFlatPct: Math.max(0, 100 - damp(base.likelihoodUpPct) - damp(base.likelihoodDownPct)),
      explainers: [
        `Data quality limited: eBay timing fallback active; forecast confidence reduced.`,
        ...base.explainers,
      ],
    };
  }, [quickMarketMoves, quickSignalScopeMode, quickCard?.tcgplayerSalesAnomalies]);

  const quickSignalTags = useMemo(() => {
    type QuickTag = { label: string; tone: 'neutral' | 'good' | 'bad'; detail?: string; kpi: string };
    if (!quickCard) return [] as QuickTag[];
    const eBayTimingFallback = quickMarketMoves?.ebay?.dataQuality === 'fallback';
    const eBayCompFilterNote =
      quickEbayTitleStampFilter === 'all' && quickEbayTitleSealedFilter === 'all'
        ? ''
        : ` · eBay sold comps: ${quickEbayTitleFilterLabel}`;
    const out: QuickTag[] = [];
    const raw = Number(quickCard.raw) || 0;
    const tcg = quickMarketMoves?.tcg.median ?? quickMarketMoves?.tcg.current ?? null;
    const ebayScopedMedian = quickMarketMoves?.ebay.median ?? quickMarketMoves?.ebay.current ?? null;
    const ebayRawMedian = quickMarketMoves?.ebayRaw.median ?? null;
    const baselineCandidates = (
      quickSignalScopeMode === 'graded'
        ? [ebayScopedMedian]
        : [tcg, ebayRawMedian]
    ).filter(
      (v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0
    );
    const marketAnchor = medianLocal(baselineCandidates);
    const marketAnchorScopeCore =
      quickSignalScopeMode === 'graded'
        ? `Selected graded scope median (${quickMarketMoves?.ebay.windowLabel || 'window'})`
        : baselineCandidates.length >= 2
          ? `Blended median (${quickMarketMoves?.tcg.windowLabel || 'window'}): TCG + eBay raw`
          : typeof tcg === 'number' && tcg > 0
            ? 'TCG-only median vs Raw'
            : typeof ebayRawMedian === 'number' && ebayRawMedian > 0
              ? 'eBay raw-only median vs Raw'
              : 'No spread baseline';
    const marketAnchorScope = `${marketAnchorScopeCore} | eBay comps: ${quickEbayTitleFilterLabel}`;
    if (marketAnchor != null && raw > 0) {
      const spreadPct = ((marketAnchor - raw) / raw) * 100;
      if (spreadPct >= 8) {
        out.push({
          label: `Sell (${spreadPct >= 0 ? '+' : ''}${spreadPct.toFixed(1)}%)`,
          tone: 'good',
          detail: marketAnchorScope,
          kpi: 'Market Bias',
        });
      } else if (spreadPct <= -8) {
        out.push({
          label: `Buy (${spreadPct.toFixed(1)}%)`,
          tone: 'good',
          detail: marketAnchorScope,
          kpi: 'Market Bias',
        });
      } else {
        out.push({ label: 'Hold', tone: 'neutral', detail: marketAnchorScope, kpi: 'Market Bias' });
      }
    } else {
      out.push({ label: 'Hold', tone: 'neutral', detail: marketAnchorScope, kpi: 'Market Bias' });
    }
    const moveInputs: Array<{ name: string; value: number | null }> =
      quickSignalScopeMode === 'graded'
        ? [{ name: 'eBay', value: quickMarketMoves?.ebay.pct ?? null }]
        : [
            { name: 'PC', value: quickMarketMoves?.pc.pct ?? null },
            { name: 'TCG', value: quickMarketMoves?.tcg.pct ?? null },
            { name: 'eBay', value: quickMarketMoves?.ebay.pct ?? null },
          ];
    const moveActive = moveInputs.filter(
      (m): m is { name: string; value: number } =>
        typeof m.value === 'number' && Number.isFinite(m.value)
    );
    const avgMove =
      moveActive.length > 0
        ? moveActive.reduce((s, m) => s + m.value, 0) / moveActive.length
        : null;
    if (avgMove != null) {
      const scope =
        `Scope: ${moveActive.map((m) => m.name).join(' + ')} (${quickMarketMoves?.tcg.windowLabel || 'window'})` +
        eBayCompFilterNote;
      if (eBayTimingFallback) {
        out.push({
          label: 'Trend (low confidence)',
          tone: 'neutral',
          detail: `${scope} | eBay timing fallback active`,
          kpi: 'Trend',
        });
      } else if (avgMove >= 1.5) out.push({ label: 'Climbing', tone: 'good', detail: scope, kpi: 'Trend' });
      else if (avgMove <= -1.5) out.push({ label: 'Dropping', tone: 'bad', detail: scope, kpi: 'Trend' });
      else out.push({ label: 'Flat', tone: 'neutral', detail: scope, kpi: 'Trend' });
    }
    const keepRawNet = quickCard.metrics.netRawNoGrade;
    const gradeEvNet = quickCard.metrics.ev;
    if (quickCard.portfolioKind === 'sealed') {
      out.push(evaluateSealedOpenVsKeep(keepRawNet, quickCard.sealedPullSlots ?? null, fees));
    } else if (Number.isFinite(keepRawNet) && Number.isFinite(gradeEvNet)) {
      out.push(
        gradeEvNet > keepRawNet
          ? { label: 'Gradable', tone: 'good', detail: 'EV (graded) > net raw no-grade', kpi: 'Grade Edge' }
          : { label: 'Keep Raw', tone: 'neutral', detail: 'Net raw no-grade >= graded EV', kpi: 'Grade Edge' }
      );
    }
    const marketPriceForSell =
      (typeof marketAnchor === 'number' && marketAnchor > 0 ? marketAnchor : null) ??
      (raw > 0 ? raw : null);
    if (marketPriceForSell != null) {
      const pricing = computeSellPriceTargets(marketPriceForSell, DEFAULT_SELL_PRICING_POLICY);
      const basisPaid =
        typeof quickCard.actualCost === 'number' && quickCard.actualCost > 0
          ? quickCard.actualCost
          : quickCard.raw;
      const inboundShip = quickCard.freeShipping ? 0 : Number(quickCard.shippingCost) || 0;
      const costBasis = basisPaid + inboundShip;
      const ebayNet = pricing.optimalEbayPrice * (1 - DEFAULT_SELL_PRICING_POLICY.ebayFeeRate) - costBasis;
      const whatnotNet = pricing.optimalWhatnotPrice * (1 - DEFAULT_SELL_PRICING_POLICY.whatnotFeeRate) - costBasis;
      const cashAppNet = pricing.directCashAppOffer - costBasis;
      const bestChannel =
        ebayNet >= whatnotNet && ebayNet >= cashAppNet
          ? 'eBay'
          : whatnotNet >= cashAppNet
            ? 'Whatnot'
            : 'CashApp';
      const bestListAt =
        bestChannel === 'eBay'
          ? pricing.optimalEbayPrice
          : bestChannel === 'Whatnot'
            ? pricing.optimalWhatnotPrice
            : pricing.directCashAppOffer;
      const bestNet = Math.max(ebayNet, whatnotNet, cashAppNet);
      const roiPct = costBasis > 0 ? (bestNet / costBasis) * 100 : null;
      out.push({
        label: `${bestChannel} @ ${fmtMoney(bestListAt)} · ROI ${roiPct != null ? fmtPct(roiPct) : '—'}`,
        tone: bestNet >= 0 ? 'good' : 'bad',
        detail: `Net ${fmtMoney(bestNet)} | Sell strategy baseline: ${marketAnchorScope}`,
        kpi: 'Sales Strategy',
      });
    }
    if (quickFutures) {
      const anomalyExplainer =
        quickFutures.explainers.find((x) => /anomaly flag|spike signal/i.test(String(x))) ||
        quickFutures.explainers[2] ||
        'Abnormal spike detection vs historical distribution.';
      out.push({
        label: `Futures: ${quickFutures.direction.toUpperCase()} (${quickFutures.directionConfidencePct}%)${eBayTimingFallback ? ' *' : ''}`,
        tone:
          quickFutures.direction === 'up'
            ? 'good'
            : quickFutures.direction === 'down'
              ? 'bad'
              : 'neutral',
        detail:
          (quickFutures.explainers[0] || 'Forecast direction from trend + pace + volatility.') +
          (eBayTimingFallback ? ' (timing fallback)' : ''),
        kpi: 'Direction Forecast',
      });
      out.push({
        label: `Spike: ${quickFutures.anomalySpikeFlag.toUpperCase()}`,
        tone:
          quickFutures.anomalySpikeFlag === 'high'
            ? 'bad'
            : quickFutures.anomalySpikeFlag === 'watch'
              ? 'neutral'
              : 'good',
        detail: anomalyExplainer,
        kpi: 'Anomaly Spike Flag',
      });
      out.push({
        label: `Infl ${quickFutures.inflationRiskPct}% / Defl ${quickFutures.deflationRiskPct}%`,
        tone:
          quickFutures.inflationRiskPct > quickFutures.deflationRiskPct + 12
            ? 'bad'
            : quickFutures.deflationRiskPct > quickFutures.inflationRiskPct + 12
              ? 'good'
              : 'neutral',
        detail: `Likelihood up/down/flat: ${quickFutures.likelihoodUpPct}% / ${quickFutures.likelihoodDownPct}% / ${quickFutures.likelihoodFlatPct}% | Drivers: trend ${(quickFutures.stats.trendRaw * 100).toFixed(0)}%, pace ${(quickFutures.stats.paceAccel * 100).toFixed(0)}%, volatility ${(quickFutures.stats.volRatio * 100).toFixed(0)}%`,
        kpi: 'Inflation/Deflation Risk',
      });
    }
    return out;
  }, [
    quickCard,
    fees,
    quickMarketMoves,
    quickSignalScopeMode,
    quickFutures,
    quickEbayTitleStampFilter,
    quickEbayTitleSealedFilter,
    quickEbayTitleFilterLabel,
  ]);

  const quickTopCards = useMemo(
    () =>
      quickSignalScopeMode === 'graded'
        ? [quickMarketMoves?.ebay]
        : [quickMarketMoves?.pc, quickMarketMoves?.tcg, quickMarketMoves?.ebay],
    [quickSignalScopeMode, quickMarketMoves]
  );
  const quickSidebarCards = useMemo(
    () =>
      quickTopCards.map((m) => {
        if (!m) return m;
        const tcgMarketDisplay =
          m.brand === 'tcgplayer' &&
          typeof quickCard?.tcgplayerSummary?.marketPrice === 'number' &&
          Number.isFinite(quickCard.tcgplayerSummary.marketPrice)
            ? quickCard.tcgplayerSummary.marketPrice
            : null;
        const ebayAcceptedAvg =
          m.brand === 'ebay' && quickMarketMoves?.ebay?.scopedSeries?.length
            ? quickMarketMoves.ebay.scopedSeries.reduce((sum, p) => sum + p.price, 0) /
              quickMarketMoves.ebay.scopedSeries.length
            : null;
        const nextCurrent = ebayAcceptedAvg ?? tcgMarketDisplay ?? m.current;
        const basisLabel =
          m.brand === 'ebay'
            ? ebayAcceptedAvg != null
              ? 'window avg'
              : 'last sale'
            : m.brand === 'tcgplayer'
              ? tcgMarketDisplay != null
                ? 'market'
                : 'last sale'
              : 'last sale';
        return {
          ...m,
          current: nextCurrent,
          basisLabel,
        };
      }),
    [quickTopCards, quickCard?.tcgplayerSummary?.marketPrice, quickMarketMoves]
  );

  /** Streamer layout: always PC + TCG + eBay (same value math as price sidebar, independent of graded scope). */
  const streamerTopCards = useMemo(() => {
    if (!quickMarketMoves) return [null, null, null];
    const trio = [quickMarketMoves.pc, quickMarketMoves.tcg, quickMarketMoves.ebay];
    return trio.map((m) => {
      if (!m) return null;
      const tcgMarketDisplay =
        m.brand === 'tcgplayer' &&
        typeof quickCard?.tcgplayerSummary?.marketPrice === 'number' &&
        Number.isFinite(quickCard.tcgplayerSummary.marketPrice)
          ? quickCard.tcgplayerSummary.marketPrice
          : null;
      const ebayAcceptedAvg =
        m.brand === 'ebay' && quickMarketMoves.ebay.scopedSeries?.length
          ? quickMarketMoves.ebay.scopedSeries.reduce((sum, p) => sum + p.price, 0) /
            quickMarketMoves.ebay.scopedSeries.length
          : null;
      const nextCurrent = ebayAcceptedAvg ?? tcgMarketDisplay ?? m.current;
      const basisLabel =
        m.brand === 'ebay'
          ? ebayAcceptedAvg != null
            ? 'window avg'
            : 'last sale'
          : m.brand === 'tcgplayer'
            ? tcgMarketDisplay != null
              ? 'market'
              : 'last sale'
            : 'last sale';
      return {
        label: m.label,
        brand: m.brand,
        pct: m.pct,
        current: nextCurrent,
        basisLabel,
      };
    });
  }, [quickMarketMoves, quickCard?.tcgplayerSummary?.marketPrice]);

  const streamerGoPrev = useCallback(() => {
    if (quickCards.length === 0) return;
    const idx = quickCards.findIndex((c) => c.id === quickCardId);
    if (idx < 0) return;
    const prevIdx = idx === 0 ? quickCards.length - 1 : idx - 1;
    setQuickCardId(quickCards[prevIdx]!.id);
  }, [quickCards, quickCardId]);

  const streamerGoNext = useCallback(() => {
    if (quickCards.length === 0) return;
    const idx = quickCards.findIndex((c) => c.id === quickCardId);
    if (idx < 0) return;
    const nextIdx = idx >= quickCards.length - 1 ? 0 : idx + 1;
    setQuickCardId(quickCards[nextIdx]!.id);
  }, [quickCards, quickCardId]);

  const streamerLinks = useMemo((): StreamerLinkItem[] => {
    if (!quickCard) return [];
    const out: StreamerLinkItem[] = [];
    if (quickPcUrl)
      out.push({
        brand: 'pricecharting',
        href: quickPcUrl,
        linkTitle: 'Open PriceCharting',
        label: 'PriceCharting',
        caption: null,
      });
    if (quickEbayUrl)
      out.push({
        brand: 'ebay',
        href: quickEbayUrl,
        linkTitle: 'Sold / completed listings (comps)',
        label: 'eBay',
        caption: null,
      });
    if (quickEbayPurchaseUrl)
      out.push({
        brand: 'ebay',
        href: quickEbayPurchaseUrl,
        linkTitle: 'Search active listings to buy (lowest price + shipping first)',
        label: 'eBay',
        caption: 'Buy',
      });
    if (quickTcgUrl)
      out.push({
        brand: 'tcgplayer',
        href: quickTcgUrl,
        linkTitle: 'Open TCGPlayer',
        label: 'TCGPlayer',
        caption: null,
      });
    if (quickGemrateUrl)
      out.push({
        brand: 'gemrate',
        href: quickGemrateUrl,
        linkTitle: 'Open GemRate',
        label: 'GemRate',
        caption: null,
      });
    return out;
  }, [quickCard, quickPcUrl, quickEbayUrl, quickEbayPurchaseUrl, quickTcgUrl, quickGemrateUrl]);

  const quickIsCompact = quickTab !== 'math' && !quickExpanded;

  const quickSidebarSummary = useMemo<SidebarSummary>(() => {
    const salesToday = quickPlatformSalesPace?.find((x) => x.days === 1) ?? null;
    const marketBias = quickSignalTags.find((t) => t.kpi === 'Market Bias');
    const trendTag = quickSignalTags.find((t) => t.kpi === 'Trend');
    const spikeFlag = quickFutures?.anomalySpikeFlag ?? 'none';
    const biasKey: SidebarSummary['biasKey'] = /\bbuy\b/i.test(String(marketBias?.label || ''))
      ? 'buy'
      : /\bhold\b/i.test(String(marketBias?.label || ''))
        ? 'hold'
        : /\bsell\b/i.test(String(marketBias?.label || ''))
          ? 'sell'
          : 'neutral';
    const trendKey: SidebarSummary['trendKey'] = /\bclimbing\b/i.test(String(trendTag?.label || ''))
      ? 'up'
      : /\bdropping\b/i.test(String(trendTag?.label || ''))
        ? 'down'
        : 'flat';
    return { salesToday, biasKey, trendKey, spikeFlag };
  }, [quickPlatformSalesPace, quickSignalTags, quickFutures]);

  const loadAdminStats = useCallback(async () => {
    setAdminBusy(true);
    setAdminError(null);
    try {
      const r = await fetch(apiUrl('/api/admin/database-center'), {
        cache: 'no-store',
        headers: buildApiHeaders(),
      });
      const j = (await r.json()) as
        | {
            ok: true;
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
          }
        | { error: string };
      if (!r.ok || 'error' in j) throw new Error('error' in j ? j.error : `HTTP ${r.status}`);
      setAdminStats({
        captureStats: j.captureStats,
        portfolio: j.portfolio,
        portfolioSqlite: j.portfolioSqlite,
        appPortfolio: j.appPortfolio,
        rotatingBackups: j.rotatingBackups,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setAdminError(msg);
    } finally {
      setAdminBusy(false);
    }
  }, []);

  const runRotatingPortfolioBackup = useCallback(async () => {
    setAdminBusy(true);
    setAdminError(null);
    try {
      const r = await fetch(apiUrl('/api/admin/portfolio-rotating-backups/run'), {
        method: 'POST',
        headers: buildApiHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ force: true }),
      });
      const j = (await r.json()) as { error?: string };
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
      await loadAdminStats();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setAdminError(msg);
    } finally {
      setAdminBusy(false);
    }
  }, [loadAdminStats]);

  const runEbayTitleBackfill = useCallback(
    async (dryRun: boolean) => {
      setAdminBusy(true);
      setAdminError(null);
      try {
        const r = await fetch(apiUrl('/api/maintenance/extension-captures/ebay-title-backfill'), {
          method: 'POST',
          headers: buildApiHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ dryRun }),
        });
        const j = (await r.json()) as { error?: string };
        if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
        await loadAdminStats();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setAdminError(msg);
      } finally {
        setAdminBusy(false);
      }
    },
    [loadAdminStats]
  );

  const runRepairPricechartingLinks = useCallback(
    async (dryRun: boolean) => {
      setAdminBusy(true);
      setAdminError(null);
      try {
        const r = await fetch(apiUrl('/api/maintenance/portfolio/repair-pricecharting-links'), {
          method: 'POST',
          headers: buildApiHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ dryRun, force: false }),
        });
        const j = (await r.json()) as {
          error?: string;
          scanned?: number;
          candidates?: number;
          updated?: number;
          fetchFailed?: number;
          dryRun?: boolean;
        };
        if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
        await loadAdminStats();
        alert(
          `${j.dryRun ? 'Dry run' : 'Repair'} complete.\nScanned: ${j.scanned ?? 0}\nCandidates: ${j.candidates ?? 0}\nUpdated: ${j.updated ?? 0}\nFetch failed: ${j.fetchFailed ?? 0}`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setAdminError(msg);
      } finally {
        setAdminBusy(false);
      }
    },
    [loadAdminStats]
  );

  const runRebuildPricechartingStats = useCallback(
    async (dryRun: boolean) => {
      setAdminBusy(true);
      setAdminError(null);
      try {
        const r = await fetch(apiUrl('/api/maintenance/portfolio/rebuild-pricecharting-stats'), {
          method: 'POST',
          headers: buildApiHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ dryRun }),
        });
        const j = (await r.json()) as {
          error?: string;
          scanned?: number;
          candidates?: number;
          updated?: number;
          fetchFailed?: number;
          dryRun?: boolean;
        };
        if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
        await loadAdminStats();
        alert(
          `${j.dryRun ? 'Dry run' : 'Rebuild'} complete.\nScanned: ${j.scanned ?? 0}\nCandidates: ${j.candidates ?? 0}\nUpdated: ${j.updated ?? 0}\nFetch failed: ${j.fetchFailed ?? 0}`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setAdminError(msg);
      } finally {
        setAdminBusy(false);
      }
    },
    [loadAdminStats]
  );

  useEffect(() => {
    const inPortfolio = (id: string) => {
      if (!serverPagedPortfolio) return enriched.some((c) => c.id === id);
      return (
        enriched.some((c) => c.id === id) ||
        (quickIndexCards?.some((c) => c.id === id) ?? false) ||
        cardCacheRef.current.has(id)
      );
    };

    const session = quickFetchSessionRef.current;
    if (rawEngineQuickFetchActive && session?.cardId && inPortfolio(session.cardId)) {
      if (quickCardId !== session.cardId) {
        setQuickCardId(session.cardId);
      }
      return;
    }

    if (filters.portfolioKindScope !== 'all') {
      if (quickCards.length === 0) {
        if (quickCardId && !inPortfolio(quickCardId)) {
          setQuickCardId('');
        }
        return;
      }
      if (quickCardId && !quickCards.some((c) => c.id === quickCardId)) {
        if (!inPortfolio(quickCardId)) {
          setQuickCardId(quickCards[0].id);
        }
        return;
      }
    }

    if (!quickCards.length) {
      if (quickCardId && !inPortfolio(quickCardId)) {
        setQuickCardId('');
      }
      return;
    }
    if (!quickCardId) {
      setQuickCardId(quickCards[0].id);
      return;
    }
    // Only reset when the card no longer exists in the portfolio — not when filters hide it.
    if (!inPortfolio(quickCardId)) {
      setQuickCardId(quickCards[0].id);
    }
  }, [
    quickCards,
    quickCardId,
    enriched,
    serverPagedPortfolio,
    quickIndexCards,
    filters.portfolioKindScope,
    rawEngineQuickFetchActive,
  ]);

  useEffect(() => {
    if (!isAdding) return;
    if (filters.portfolioKindScope === 'sealed') {
      setDraft((d) => ({ ...d, portfolioKind: 'sealed' }));
    } else if (filters.portfolioKindScope === 'single') {
      setDraft((d) => ({ ...d, portfolioKind: 'single' }));
    }
  }, [isAdding, filters.portfolioKindScope]);

  useEffect(() => {
    if (workspacePage !== 'admin') return;
    if (adminStats) return;
    void loadAdminStats();
  }, [workspacePage, adminStats, loadAdminStats]);

  useEffect(() => {
    const el = window as Window & { rawEngine?: RawEngineBridge };
    const unsub = el.rawEngine?.onOpenUserGuide?.(() => {
      setWorkspacePage('guide');
      setGuideIframeKey((k) => k + 1);
    });
    return () => {
      unsub?.();
    };
  }, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!quickPickerRef.current) return;
      if (!quickPickerRef.current.contains(e.target as Node)) setQuickPickerOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, []);

  // Totals scope to the visible (filtered) subset so you can watch specific
  // collections: "how much have I sunk into my Surging Sparks binder?" etc.
  //
  // Two-stage breakdown matches real cash flow:
  //   preGradeSpend   - dollars already out of pocket (card + inbound ship)
  //   gradingSpend    - dollars committed iff you actually submit to PSA
  //   invested        - preGrade + grading, what all the ROI math is against
  const totals = useMemo(() => {
    if (serverTotals) {
      return {
        count: serverTotals.count,
        preGradeSpend: serverTotals.preGradeSpend,
        gradingSpend: serverTotals.gradingSpend,
        gradingPerCard: serverTotals.gradingPerCard,
        invested: serverTotals.invested,
        expectedRevenue: serverTotals.expectedRevenue,
        ev: serverTotals.ev,
        roi: serverTotals.roi,
        bestCaseNet: serverTotals.bestCaseNet,
        worstCaseNet: serverTotals.worstCaseNet,
        perDollarReturn: serverTotals.perDollarReturn,
      };
    }
    const count = visible.length;
    const preGradeSpend = visible.reduce((s, c) => {
      const paid =
        typeof c.actualCost === 'number' && c.actualCost > 0 ? c.actualCost : c.raw;
      const ship = c.freeShipping ? 0 : Number(c.shippingCost) || 0;
      return s + paid + ship;
    }, 0);
    const gradingPerCard =
      fees.gradingFee + fees.shipToGrader + fees.shipFromGrader;
    const gradingSpend = gradingPerCard * count;

    const invested = visible.reduce((s, c) => s + c.metrics.totalInvested, 0);
    const ev = visible.reduce((s, c) => s + c.metrics.ev, 0);
    const expectedRevenue = invested + ev; // revenue after sale fees, probability-weighted
    const roi = invested > 0 ? (ev / invested) * 100 : 0;

    const bestCaseNet = visible.reduce((s, c) => s + c.metrics.net10, 0);
    const worstCaseNet = visible.reduce((s, c) => s + c.metrics.netFail, 0);

    const perDollarReturn = invested > 0 ? expectedRevenue / invested : 0;

    return {
      count,
      preGradeSpend,
      gradingSpend,
      gradingPerCard,
      invested,
      expectedRevenue,
      ev,
      roi,
      bestCaseNet,
      worstCaseNet,
      perDollarReturn,
    };
  }, [serverTotals, visible, fees]);

  const filterActive =
    filters.search !== '' ||
    filters.collectionIds.length > 0 ||
    filters.evSign !== 'all' ||
    filters.sets.length > 0 ||
    filters.releaseYears.length > 0 ||
    filters.pokemonName.trim() !== '' ||
    filters.profitLens !== 'all' ||
    filters.portfolioKindScope !== 'all';

  const defaultBinIds = useMemo(() => {
    const byName = new Map(collections.map((c) => [c.name.trim().toLowerCase(), c.id]));
    return {
      sellId: byName.get(DEFAULT_BIN_COLLECTIONS.sell.name) ?? null,
      holdId: byName.get(DEFAULT_BIN_COLLECTIONS.hold.name) ?? null,
    };
  }, [collections]);

  const getAutoCollectionIdForCard = useCallback(
    (card: EnrichedCard): string | undefined => {
      const suggested = suggestAutoBin(card);
      if (suggested === 'sell') return defaultBinIds.sellId ?? undefined;
      if (suggested === 'hold') return defaultBinIds.holdId ?? undefined;
      return undefined;
    },
    [defaultBinIds.holdId, defaultBinIds.sellId]
  );

  const autoPopulateBins = useCallback(
    (mode: 'unassigned' | 'force') => {
      setCards((prev) =>
        prev.map((card) => {
          const metrics = computeMetrics(card, fees);
          const enrichedCard = {
            ...card,
            metrics,
            rowSignalIcons: computeRowSignalIcons({ ...card, metrics } as EnrichedCard),
          } as EnrichedCard;
          const targetCollectionId = getAutoCollectionIdForCard(enrichedCard);
          if (!targetCollectionId) return card;
          if (mode === 'unassigned' && card.collectionId) return card;
          if (card.collectionId === targetCollectionId) return card;
          return { ...card, collectionId: targetCollectionId };
        })
      );
    },
    [fees, getAutoCollectionIdForCard]
  );

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const fetchCardDetails = async () => {
    setFetchError(null);
    if (/\s/.test(url.trim())) {
      setFetchError('URL contains spaces. Copy the full URL from your browser\u2019s address bar.');
      return;
    }
    const cleanUrl = normalizePricechartingFetchUrl(url);
    if (!cleanUrl) {
      setFetchError(
        'Paste a full pricecharting.com URL (https://www.pricecharting.com/… or https://m.pricecharting.com/…).'
      );
      return;
    }
    setFetching(true);
    try {
      const res = await fetch(apiUrl(`/api/scrape?url=${encodeURIComponent(cleanUrl)}`));
      const data = (await res.json()) as ScrapeResponse | { error: string };
      if (!res.ok || 'error' in data) {
        throw new Error('error' in data ? data.error : `HTTP ${res.status}`);
      }
      setDraft((d) => {
        const scope = filters.portfolioKindScope;
        /** When portfolio tab is "all", derive listing type from this scrape only — do not inherit a stale draft (e.g. sealed → single). */
        const portfolioKind: Card['portfolioKind'] =
          scope === 'sealed'
            ? 'sealed'
            : scope === 'single'
              ? 'single'
              : data.suggestedPortfolioKind === 'sealed'
                ? 'sealed'
                : 'single';
        return {
          ...d,
          name: data.name || d.name,
          set: data.set || d.set,
          cardNumber: data.cardNumber || d.cardNumber,
          url: data.url,
          localImage: data.localImage ?? d.localImage,
          raw: data.raw || d.raw,
          grade9: data.grade9 || d.grade9,
          psa10: data.psa10 || d.psa10,
          allPrices: data.allPrices ?? d.allPrices,
          tcgplayerUrl: data.tcgplayerUrl ?? d.tcgplayerUrl ?? '',
          releaseDateMs: data.releaseDateMs ?? d.releaseDateMs,
          priceHistory: buildSeedHistory(data),
          recentSales: data.recentSales ?? [],
          salesVolume: data.salesVolume ?? {},
          portfolioKind,
        };
      });

      // Auto-load TCG snapshot from the scraped TCGPlayer URL (best effort).
      const scrapedTcgUrl = (data.tcgplayerUrl ?? '').trim();
      if (/^https?:\/\/(www\.)?tcgplayer\.com\/product\/\d+/i.test(scrapedTcgUrl)) {
        try {
          const tr = await fetch(buildTcgplayerProductFetchUrl(scrapedTcgUrl), { cache: 'no-store' });
          const tj = (await tr.json()) as TcgplayerProductSummary | { error: string };
          if (tr.ok && !('error' in tj)) {
            setDraft((d) => ({
              ...d,
              tcgplayerUrl: scrapedTcgUrl,
              tcgplayerSummary: tj,
              tcgplayerSelfHistory: appendTcgplayerSelfSample(
                d.tcgplayerSelfHistory,
                tj.marketPrice,
                Date.now()
              ),
            }));
          }
        } catch {
          // Keep scrape success even if TCG enrichment fails.
        }
      }

      // Best-effort GemRate auto-lookup. Non-blocking; failures are silent â€”
      // the user can still save the card without pop data.
      const skipGemrate = data.suggestedPortfolioKind === 'sealed' || filters.portfolioKindScope === 'sealed';
      const q = skipGemrate
        ? ''
        : buildGemRateQuery({
            name: data.name,
            set: data.set,
            cardNumber: data.cardNumber,
          });
      if (q) {
        try {
          const gr = await fetch(apiUrl(`/api/gemrate/search?q=${encodeURIComponent(q)}`));
          if (gr.ok) {
            const payload = (await gr.json()) as GemRateSearchResult;
            const candidates = payload.candidates || [];
            const universal = candidates.find((c) => c.populationType === 'Universal');
            setDraft((d) => ({
              ...d,
              gemrateCandidates: candidates,
              gemrateId: universal?.gemrateId || candidates[0]?.gemrateId || '',
            }));
          }
        } catch {
          // swallow â€” GemRate is optional
        }
      }
    } catch (err) {
      const isNetworkError = err instanceof TypeError;
      if (isNetworkError) {
        setBackendStatus('offline');
        setFetchError(
          isRawEngineShell()
            ? 'Raw Investor is not running. Wait for startup to finish, or restart the app from the Start Menu.'
            : 'Backend unreachable. Make sure LAUNCH.bat is running (you should see "[pcgr-server] listening" in its console).'
        );
      } else {
        setFetchError(err instanceof Error ? err.message : 'Fetch failed');
      }
    } finally {
      setFetching(false);
    }
  };

  const handleAddCard = (e: React.FormEvent) => {
    e.preventDefault();
    if (!String(draft.name || '').trim()) {
      window.alert('Enter a card name before saving.');
      return;
    }
    if (typeof draft.raw !== 'number' || !Number.isFinite(draft.raw) || draft.raw < 0) {
      window.alert('Enter a valid raw (market) price (USD), including 0 if needed.');
      return;
    }
    const scopeKind: Card['portfolioKind'] =
      filters.portfolioKindScope === 'sealed'
        ? 'sealed'
        : filters.portfolioKindScope === 'single'
          ? 'single'
          : draft.portfolioKind ?? 'single';
    const nextCard: Card = { ...draft, id: crypto.randomUUID(), portfolioKind: scopeKind };
    const metrics = computeMetrics(nextCard, fees);
    const autoCollectionId = getAutoCollectionIdForCard({
      ...nextCard,
      metrics,
      rowSignalIcons: computeRowSignalIcons({ ...nextCard, metrics } as EnrichedCard),
    } as EnrichedCard);
    if (autoCollectionId && !nextCard.collectionId) nextCard.collectionId = autoCollectionId;
    if (serverPagedPortfolio) {
      cardCacheRef.current.set(nextCard.id, nextCard);
      dirtyCardIdsRef.current.add(nextCard.id);
      setGridTotal((n) => n + 1);
      setQuickIndexCards((prev) => {
        const merged = prev == null ? [nextCard] : [nextCard, ...prev.filter((c) => c.id !== nextCard.id)];
        return merged.slice(0, 200);
      });
    }
    setCards([nextCard, ...cards]);
    setQuickCardId(nextCard.id);
    setWorkspacePage('quick');
    setDraft(emptyDraft());
    setUrl('');
    setIsAdding(false);
  };

  /** Download the current portfolio as a JSON file the user can stash in
   *  cloud storage / version control. Shape matches `/api/store` exactly. */
  const handleExportPortfolio = () => {
    void (async () => {
      const base: PortfolioSnapshot = {
        cards,
        fees,
        collections,
        filters,
        sort,
        psaToken,
        nebulaOpen: showNebula,
        extensionLatestOnlyMode,
        quickCardAdminSettings,
        googleCseKey,
        googleCseCx,
      };
      let hunts: Hunt[] | undefined;
      let targets: Target[] | undefined;
      const live = getArsenalForPortfolioExport();
      if (live) {
        hunts = live.hunts;
        targets = live.targets;
      } else {
        const doc = await loadFromServer();
        if (doc && doc.updatedAt > 0) {
          if (Array.isArray(doc.hunts)) hunts = doc.hunts as Hunt[];
          if (Array.isArray(doc.targets)) targets = doc.targets as Target[];
        }
      }
      const blob = buildExportBlob({
        ...base,
        ...(hunts && hunts.length > 0 ? { hunts } : {}),
        ...(targets && targets.length > 0 ? { targets } : {}),
      });
      const url_ = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url_;
      a.download = exportFilename();
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url_);
    })();
  };

  /** One JSON object per line — cards only; use for very large portfolios. */
  const handleExportCardsNdjson = () => {
    const blob = buildCardsNdjsonBlob(cards);
    const url_ = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url_;
    a.download = exportCardsNdjsonFilename();
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url_);
  };

  /** Restore from a portfolio JSON file. Only fields present in the file
   *  are replaced; everything else stays as-is so an old backup with just
   *  cards won't wipe the user's current fees. */
  const handleImportPortfolio = async (file: File) => {
    try {
      const raw = await file.text();
      const incoming = parsePortfolioImportFile(raw);
      const cardList = incoming.cards;
      const bulkCards = Boolean(cardList && cardList.length >= 200);
      if (incoming.fees) setFees({ ...DEFAULT_FEES, ...incoming.fees });
      if (incoming.collections) setCollections(incoming.collections);
      if (incoming.filters) setFilters(normalizeFilterState(incoming.filters));
      if (incoming.sort && incoming.sort in SORT_LABELS) setSort(incoming.sort as SortPreset);
      if (typeof incoming.psaToken === 'string') setPsaToken(incoming.psaToken);
      if (typeof incoming.nebulaOpen === 'boolean') setShowNebula(incoming.nebulaOpen);
      if (typeof incoming.extensionLatestOnlyMode === 'boolean') {
        setExtensionLatestOnlyMode(incoming.extensionLatestOnlyMode);
      }
      if (incoming.quickCardAdminSettings && typeof incoming.quickCardAdminSettings === 'object') {
        setQuickCardAdminSettings(
          normalizeQuickCardAdminSettings(
            incoming.quickCardAdminSettings as Partial<QuickCardAdminSettings>
          )
        );
      }
      if (typeof incoming.googleCseKey === 'string') setGoogleCseKey(incoming.googleCseKey);
      if (typeof incoming.googleCseCx === 'string') setGoogleCseCx(incoming.googleCseCx);
      if (bulkCards && cardList) {
        const chunk = 200;
        for (let i = 0; i < cardList.length; i += chunk) {
          const ok = await batchUpsertCardsOnServer(cardList.slice(i, i + chunk));
          if (!ok) {
            window.alert('Import failed: server rejected a batch upsert.');
            return;
          }
        }
        const refetchFilters = incoming.filters
          ? normalizeFilterState(incoming.filters)
          : EMPTY_FILTERS;
        const refetchSort =
          incoming.sort && incoming.sort in SORT_LABELS ? (incoming.sort as SortPreset) : sort;
        const all = await fetchAllCardsPagesFromServer(refetchFilters, refetchSort);
        if (all) {
          setCards(all);
          const baselineSnap: PortfolioSnapshot = {
            cards: all,
            fees: incoming.fees ? { ...DEFAULT_FEES, ...incoming.fees } : fees,
            collections: incoming.collections ?? collections,
            filters: refetchFilters,
            sort: refetchSort,
            psaToken: typeof incoming.psaToken === 'string' ? incoming.psaToken : psaToken,
            nebulaOpen: incoming.nebulaOpen === true ? true : showNebula,
            extensionLatestOnlyMode:
              incoming.extensionLatestOnlyMode === true ? true : extensionLatestOnlyMode,
            quickCardAdminSettings:
              incoming.quickCardAdminSettings && typeof incoming.quickCardAdminSettings === 'object'
                ? normalizeQuickCardAdminSettings(
                    incoming.quickCardAdminSettings as Partial<QuickCardAdminSettings>
                  )
                : quickCardAdminSettings,
            googleCseKey: typeof incoming.googleCseKey === 'string' ? incoming.googleCseKey : googleCseKey,
            googleCseCx: typeof incoming.googleCseCx === 'string' ? incoming.googleCseCx : googleCseCx,
          };
          syncBaselineRef.current.lastMetaJson = metaBaselineString(baselineSnap);
          syncBaselineRef.current.lastCardJson = new Map(all.map((c) => [c.id, JSON.stringify(c)]));
        }
      } else if (cardList) {
        setCards(cardList);
      }
      if (incoming.hunts || incoming.targets) {
        const patch: Record<string, unknown> = {};
        if (incoming.hunts) patch.hunts = incoming.hunts;
        if (incoming.targets) patch.targets = incoming.targets;
        const at = await mergePortfolioServerPatch(patch);
        if (at != null) {
          applyArsenalPortfolioImport({
            hunts: incoming.hunts,
            targets: incoming.targets,
          });
          await arsenalRehydrateFromServer();
          setLastSavedAt(at);
        }
      }
      window.alert(
        bulkCards
          ? 'Portfolio imported (large batch written to the server).'
          : 'Portfolio imported. Changes will sync to the server in a moment.'
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      window.alert(`Import failed: ${msg}`);
    }
  };

  const buildImportedCard = (
    row: PriceChartingCollectionRow,
    data: ScrapeResponse
  ): Card => {
    const costBasis = row.costBasisInPennies > 0 ? row.costBasisInPennies / 100 : undefined;
    const card: Card = {
      id: crypto.randomUUID(),
      name: data.name,
      set: data.set,
      cardNumber: data.cardNumber || undefined,
      url: data.url,
      priceChartingProductId: row.productId,
      localImage: data.localImage,
      raw: data.raw || 0,
      grade9: data.grade9 || 0,
      psa10: data.psa10 || 0,
      allPrices: data.allPrices ?? [],
      tcgplayerUrl: data.tcgplayerUrl ?? undefined,
      p10: DEFAULT_PROBS.p10,
      p9: DEFAULT_PROBS.p9,
      actualCost: costBasis,
      priceHistory: buildSeedHistory(data),
      recentSales: data.recentSales ?? [],
      salesVolume: data.salesVolume ?? {},
      releaseDateMs: data.releaseDateMs ?? null,
    };
    const metrics = computeMetrics(card, fees);
    const autoCollectionId = getAutoCollectionIdForCard({
      ...card,
      metrics,
      rowSignalIcons: computeRowSignalIcons({ ...card, metrics } as EnrichedCard),
    } as EnrichedCard);
    if (autoCollectionId) card.collectionId = autoCollectionId;
    return card;
  };

  const importGalleryItemsAsSingles = useCallback(
    async (items: SealedSetGalleryPreviewItem[]) => {
      if (items.length === 0) return;
      if (
        !window.confirm(
          `Import ${items.length} single(s) via PriceCharting search + scrape? Matches are best-effort; this may take a while.`
        )
      ) {
        return;
      }
      const byPc = new Set(
        cards.map((c) => normalizePcUrl(c.url)).filter((v): v is string => !!v)
      );
      const byTcgProduct = new Set(
        cards
          .map((c) => {
            const u = c.tcgplayerUrl || '';
            const m = u.match(/tcgplayer\.com\/product\/(\d+)/i);
            return m ? m[1] : '';
          })
          .filter(Boolean)
      );
      const newCards: Card[] = [];
      const errors: string[] = [];
      for (const it of items) {
        const pid = String(it.productId);
        if (byTcgProduct.has(pid)) {
          errors.push(`${it.productName}: already in portfolio (TCG #${pid}).`);
          continue;
        }
        const q = `${it.productName} ${it.setName}`.replace(/\s+/g, ' ').trim();
        try {
          const sr = await fetch(apiUrl(`/api/pricecharting/search?q=${encodeURIComponent(q)}`));
          const sj = (await sr.json()) as { url?: string | null };
          const pcUrl = sj.url;
          if (!pcUrl) {
            errors.push(`${it.productName}: no PriceCharting search match.`);
            continue;
          }
          const norm = normalizePcUrl(pcUrl);
          if (norm && byPc.has(norm)) {
            errors.push(`${it.productName}: that PriceCharting URL is already in the portfolio.`);
            continue;
          }
          await new Promise((r) => setTimeout(r, 400 + Math.floor(Math.random() * 350)));
          const rr = await fetch(apiUrl(`/api/scrape?url=${encodeURIComponent(pcUrl)}`));
          const rj = (await rr.json()) as ScrapeResponse | { error: string };
          if (!rr.ok || 'error' in rj) {
            errors.push(
              `${it.productName}: scrape failed${'error' in rj ? ` (${String((rj as { error: string }).error).slice(0, 80)})` : ''}.`
            );
            continue;
          }
          const scraped = rj as ScrapeResponse;
          const pcPid = scraped.pcProductIds?.[0];
          const nextCard: Card = {
            id: crypto.randomUUID(),
            name: scraped.name,
            set: scraped.set,
            cardNumber: scraped.cardNumber || undefined,
            url: scraped.url,
            portfolioKind: 'single',
            priceChartingProductId: pcPid ? String(pcPid) : undefined,
            localImage: scraped.localImage,
            raw: scraped.raw || 0,
            grade9: scraped.grade9 || 0,
            psa10: scraped.psa10 || 0,
            allPrices: scraped.allPrices ?? [],
            tcgplayerUrl:
              scraped.tcgplayerUrl ?? `https://www.tcgplayer.com/product/${it.productId}`,
            p10: DEFAULT_PROBS.p10,
            p9: DEFAULT_PROBS.p9,
            priceHistory: buildSeedHistory(scraped),
            recentSales: scraped.recentSales ?? [],
            salesVolume: scraped.salesVolume ?? {},
            releaseDateMs: scraped.releaseDateMs ?? null,
          };
          const metrics = computeMetrics(nextCard, fees);
          const autoCollectionId = getAutoCollectionIdForCard({
            ...nextCard,
            metrics,
            rowSignalIcons: computeRowSignalIcons({ ...nextCard, metrics } as EnrichedCard),
          } as EnrichedCard);
          if (autoCollectionId) nextCard.collectionId = autoCollectionId;
          newCards.push(nextCard);
          const n = normalizePcUrl(scraped.url);
          if (n) byPc.add(n);
          byTcgProduct.add(pid);
        } catch (err) {
          errors.push(`${it.productName}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (newCards.length > 0) {
        if (serverPagedPortfolioRef.current) {
          registerNewCardsInPagedCache(newCards, cardCacheRef.current, dirtyCardIdsRef.current);
          setGridTotal((n) => n + newCards.length);
          setQuickIndexCards((prev) => mergeIntoQuickIndex(prev, newCards));
          const sum = await fetchPortfolioSummaryFromServer(filters);
          if (sum) setServerTotals(sum);
        }
        setCards((prev) => [...newCards, ...prev]);
      }
      window.alert(
        `Imported ${newCards.length} card(s).${errors.length ? `\n\nNotes:\n${errors.slice(0, 15).join('\n')}${errors.length > 15 ? '\n…' : ''}` : ''}`
      );
    },
    [cards, fees, filters]
  );

  const runCollectionImportRows = async (
    rows: PriceChartingCollectionRow[],
    opts: { skipIfAlreadyInCollection: boolean }
  ) => {
    setCollectionImportProgress({
      running: true,
      total: rows.length,
      processed: 0,
      imported: 0,
      skipped: 0,
      failed: 0,
      current: '',
    });
    const byExistingUrl = new Set(
      cards
        .map((c) => normalizePcUrl(c.url))
        .filter((v): v is string => !!v)
    );
    const byExistingProductId = new Set(
      cards
        .map((c) => (c.priceChartingProductId || '').trim())
        .filter(Boolean)
    );

    const issues: CollectionImportIssue[] = [];
    const newCards: Card[] = [];
    let skipped = 0;
    let failed = 0;
    let imported = 0;

    let consecutiveFailures = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const markProgress = (patch: Partial<CollectionImportProgress>) => {
        setCollectionImportProgress((prev) =>
          prev
            ? {
                ...prev,
                ...patch,
              }
            : prev
        );
      };
      markProgress({
        current: `${row.productName} (${row.consoleName})`,
        processed: i,
        imported,
        skipped,
        failed,
      });
      if (opts.skipIfAlreadyInCollection && row.productId && byExistingProductId.has(row.productId)) {
        skipped += 1;
        issues.push({
          status: 'skipped',
          reason: `Product ID ${row.productId} already exists in portfolio.`,
          row,
          candidates: [],
        });
        markProgress({ skipped, processed: i + 1 });
        continue;
      }
      const query = row.productName.trim();
      const candidates: string[] = [];
      const deterministicUrl = buildPcUrlFromCollectionRow(row);
      if (deterministicUrl) candidates.push(deterministicUrl);
      try {
        const hr = await fetch(apiUrl(`/api/pricecharting/url-hint?q=${encodeURIComponent(query)}`));
        const hj = (await hr.json()) as { url?: string | null };
        if (hj.url && !candidates.includes(hj.url)) candidates.push(hj.url);
      } catch {
        // hint lookup is optional
      }
      if (candidates.length === 0) {
        try {
          const sr = await fetch(apiUrl(`/api/pricecharting/search?q=${encodeURIComponent(query)}`));
          const sj = (await sr.json()) as { url?: string | null };
          if (sj.url && !candidates.includes(sj.url)) candidates.push(sj.url);
        } catch {
          // handled as failed below
        }
      }

      let handled = false;
      let lastError = '';
      for (const resolvedUrl of candidates) {
        const norm = normalizePcUrl(resolvedUrl);
        if (!norm) continue;
        if (opts.skipIfAlreadyInCollection && byExistingUrl.has(norm)) {
          skipped += 1;
          issues.push({
            status: 'skipped',
            reason: `PriceCharting URL already exists in portfolio (${resolvedUrl}).`,
            row,
            candidates,
          });
          markProgress({ skipped, processed: i + 1 });
          handled = true;
          break;
        }
        try {
          // Small pre-request pause + jitter to avoid bursty scrape traffic.
          await new Promise((resolve) =>
            setTimeout(resolve, 420 + Math.floor(Math.random() * 260))
          );
          const rr = await fetch(apiUrl(`/api/scrape?url=${encodeURIComponent(resolvedUrl)}`));
          const rj = (await rr.json()) as ScrapeResponse | { error: string };
          if (!rr.ok || 'error' in rj) {
            lastError = 'error' in rj ? String(rj.error || '') : `HTTP ${rr.status}`;
            if (rr.status === 429 || rr.status === 403) {
              // Heavier pause on explicit anti-flood/rate-limit signals.
              await new Promise((resolve) => setTimeout(resolve, 2400));
            }
            continue;
          }

          const scraped = rj as ScrapeResponse;
          const rowPid = row.productId.trim();
          const scrapedIds = scraped.pcProductIds ?? [];
          if (rowPid && scrapedIds.length > 0 && !scrapedIds.includes(rowPid)) {
            lastError = `Catalog id mismatch (page has ${scrapedIds.join(', ')}, export row is ${rowPid}).`;
            continue;
          }

          const qty = Math.max(1, row.quantity);
          for (let q = 0; q < qty; q++) {
            newCards.push(buildImportedCard(row, scraped));
            imported += 1;
          }
          if (opts.skipIfAlreadyInCollection) {
            byExistingUrl.add(norm);
            byExistingProductId.add(row.productId);
          }
          markProgress({ imported, processed: i + 1 });
          handled = true;
          consecutiveFailures = 0;
          break;
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
        }
      }
      if (!handled) {
        failed += 1;
        consecutiveFailures += 1;
        const reason =
          candidates.length === 0
            ? 'No PriceCharting URL could be resolved from this row.'
            : `All candidate URLs failed scrape${lastError ? ` (${lastError})` : ''}.`;
        issues.push({
          status: 'failed',
          reason,
          row,
          candidates,
        });
        markProgress({ failed, processed: i + 1 });
      }
      if (i < rows.length - 1) {
        // Baseline cadence + adaptive backoff if we hit repeated failures.
        const baselineMs = 950 + Math.floor(Math.random() * 450);
        const backoffMs = Math.min(4000, consecutiveFailures * 700);
        await new Promise((resolve) => setTimeout(resolve, baselineMs + backoffMs));
      }
    }

    if (newCards.length > 0) {
      if (serverPagedPortfolioRef.current) {
        registerNewCardsInPagedCache(newCards, cardCacheRef.current, dirtyCardIdsRef.current);
        setGridTotal((n) => n + newCards.length);
        setQuickIndexCards((prev) => mergeIntoQuickIndex(prev, newCards));
        const sum = await fetchPortfolioSummaryFromServer(filters);
        if (sum) setServerTotals(sum);
      }
      setCards((prev) => [...newCards, ...prev]);
    }
    setCollectionImportIssues(issues);
    setCollectionImportFailedRows(issues.filter((x) => x.status === 'failed').map((x) => x.row));
    setCollectionImportProgress((prev) =>
      prev
        ? {
            ...prev,
            running: false,
            processed: prev.total,
            imported,
            skipped,
            failed,
          }
        : prev
    );
    window.alert(
      `Collection import complete. Imported: ${imported}, skipped: ${skipped}, failed: ${failed}. Review Import Issues below for fix details.`
    );
  };

  const handleImportCollectionFile = async (
    file: File,
    opts: { skipIfAlreadyInCollection: boolean }
  ) => {
    try {
      const rows = await parsePriceChartingCollectionFile(file);
      await runCollectionImportRows(rows, opts);
    } catch (err) {
      setCollectionImportProgress((prev) =>
        prev ? { ...prev, running: false } : prev
      );
      const msg = err instanceof Error ? err.message : String(err);
      window.alert(`Collection import failed: ${msg}`);
    }
  };

  const retryFailedCollectionImport = async (opts: { skipIfAlreadyInCollection: boolean }) => {
    if (collectionImportFailedRows.length === 0) {
      window.alert('No failed import rows available to retry.');
      return;
    }
    await runCollectionImportRows(collectionImportFailedRows, opts);
  };

  const exportCollectionImportIssues = () => {
    if (collectionImportIssues.length === 0) {
      window.alert('No import issues to export.');
      return;
    }
    const esc = (v: string) => `"${String(v || '').replace(/"/g, '""')}"`;
    const header = [
      'status',
      'reason',
      'productId',
      'productName',
      'consoleName',
      'quantity',
      'candidates',
    ];
    const lines = [
      header.map(esc).join(','),
      ...collectionImportIssues.map((i) =>
        [
          i.status,
          i.reason,
          i.row.productId,
          i.row.productName,
          i.row.consoleName,
          String(i.row.quantity),
          i.candidates.join(' | '),
        ]
          .map(esc)
          .join(',')
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = `collection-import-issues-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
  };

  const exportRetryCollectionCsv = () => {
    const failedRows = collectionImportIssues.filter((x) => x.status === 'failed').map((x) => x.row);
    if (failedRows.length === 0) {
      window.alert('No failed rows available for retry export.');
      return;
    }
    const esc = (v: string) => `"${String(v || '').replace(/"/g, '""')}"`;
    const header = [
      'id',
      'product-name',
      'console-name',
      'price-in-pennies',
      'cost-basis-in-pennies',
      'quantity',
    ];
    const lines = [
      header.map(esc).join(','),
      ...failedRows.map((r) =>
        [
          r.productId,
          r.productName,
          r.consoleName,
          String(Number.isFinite(r.priceInPennies) ? r.priceInPennies : 0),
          String(Number.isFinite(r.costBasisInPennies) ? r.costBasisInPennies : 0),
          String(Math.max(1, Number.isFinite(r.quantity) ? r.quantity : 1)),
        ]
          .map(esc)
          .join(',')
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = `collection-retry-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
  };

  const deleteCard = (id: string) => {
    setBulkSelectedCardIds((prev) => prev.filter((x) => x !== id));
    setCards(cards.filter((c) => c.id !== id));
    if (incrementalSyncEnabledRef.current) {
      syncBaselineRef.current.lastCardJson.delete(id);
      void deleteCardOnServer(id);
    }
  };

  const updateCardField = useCallback(
    <K extends keyof Card>(id: string, key: K, value: Card[K]) => {
      const base =
        cards.find((c) => c.id === id) ??
        cardCacheRef.current.get(id) ??
        quickIndexCards?.find((c) => c.id === id);
      if (!base) return;
      stageCardInPortfolio({ ...base, [key]: value } as Card);
    },
    [cards, quickIndexCards, stageCardInPortfolio]
  );

  const toggleBulkSelectCard = useCallback((id: string) => {
    setBulkSelectedCardIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }, []);

  const selectAllVisibleInMaster = useCallback(() => {
    setBulkSelectedCardIds((prev) => {
      const vids = visible.map((c) => c.id);
      if (vids.length === 0) return prev;
      const allOn = vids.every((id) => prev.includes(id));
      if (allOn) return prev.filter((id) => !vids.includes(id));
      return [...new Set([...prev, ...vids])];
    });
  }, [visible]);

  const clearBulkSelect = useCallback(() => setBulkSelectedCardIds([]), []);

  const bulkSetEbayTagFields = useCallback(
    (patch: { pokemonCenterStamp?: boolean; sealedInTitle?: boolean }) => {
      setCards((prev) => {
        const sel = new Set(bulkSelectedCardIds);
        return prev.map((c) => {
          if (!sel.has(c.id) || !c.ebayExtensionSnapshot) return c;
          if (serverPagedPortfolio) dirtyCardIdsRef.current.add(c.id);
          const next = {
            ...c,
            ebayExtensionSnapshot: mapEbayExtensionSnapshotTagBulk(c.ebayExtensionSnapshot, patch),
          };
          cardCacheRef.current.set(c.id, next);
          return next;
        });
      });
    },
    [bulkSelectedCardIds, serverPagedPortfolio]
  );

  const bulkArchiveEbayComps = useCallback(() => {
    setCards((prev) => {
      const sel = new Set(bulkSelectedCardIds);
      return prev.map((c) => {
        if (!sel.has(c.id)) return c;
        const snap = c.ebayExtensionSnapshot;
        if (!snap) return c;
        if (serverPagedPortfolio) dirtyCardIdsRef.current.add(c.id);
        const keys = new Set(c.ebayArchivedSaleKeys ?? []);
        for (const r of snap.listings ?? []) keys.add(ebayListingSaleKey(r));
        for (const r of snap.rejectedListings ?? []) keys.add(ebayListingSaleKey(r));
        const next = { ...c, ebayArchivedSaleKeys: Array.from(keys) };
        cardCacheRef.current.set(c.id, next);
        return next;
      });
    });
  }, [bulkSelectedCardIds, serverPagedPortfolio]);

  /**
   * Re-scrape a card's PriceCharting URL and merge fresh prices into the saved
   * card. User-set fields (p10, p9, collectionId, psaSpecId, psaPop, gemrate
   * selection, etc.) are preserved. TCGplayer data auto-syncs on every refresh:
   * we prefer the freshly-scraped `tcgplayerUrl`, then immediately re-fetch
   * TCGplayer metrics so no manual "Load TCG" click is required.
   */
  const refreshCard = async (id: string, baseCard?: Card | null): Promise<void> => {
    const card =
      baseCard ??
      cards.find((c) => c.id === id) ??
      cardCacheRef.current.get(id) ??
      quickIndexCards?.find((c) => c.id === id);
    if (!card) throw new Error('card not found');
    if (!card.url) throw new Error('no URL stored for this card');

    const res = await fetch(apiUrl(`/api/scrape?url=${encodeURIComponent(card.url)}`));
    const data = (await res.json()) as ScrapeResponse | { error: string };
    if (!res.ok || 'error' in data) {
      const msg = 'error' in data ? data.error : `HTTP ${res.status}`;
      let dataDir: string | undefined;
      try {
        const lr = await fetch(apiUrl('/api/portfolio/storage-locations'));
        const lj = (await lr.json()) as { dataDir?: string };
        dataDir = typeof lj?.dataDir === 'string' ? lj.dataDir : undefined;
      } catch {
        /* ignore */
      }
      void getRawEngineCaptureLog()?.append?.({
        level: 'error',
        scope: 'pcScrape',
        message: msg,
        detail: {
          cardId: id,
          url: card.url,
          status: res.status,
          dataDir,
        },
      });
      throw new Error(msg);
    }

    const scrapedTcgUrl = (data.tcgplayerUrl ?? '').trim();
    const soldUrl = ebaySoldSearchUrlForCard(card);
    const tcgUrl = scrapedTcgUrl || (card.tcgplayerUrl ?? '').trim();
    const shouldRefetchTcg = /^https?:\/\/(www\.)?tcgplayer\.com\/product\/\d+/i.test(tcgUrl);
    let newTcgplayerSummary: TcgplayerProductSummary | undefined;
    let newTcgSalesSnapshot: TcgplayerSalesSnapshot | null | undefined;
    let newTcgSalesAnomalies: SalesAnomalyPoint[] | undefined;
    let newEbayExtensionSnapshot: EbayExtensionSnapshot | null | undefined;
    if (shouldRefetchTcg) {
      try {
        const tr = await fetch(buildTcgplayerProductFetchUrl(tcgUrl), { cache: 'no-store' });
        const tj = (await tr.json()) as TcgplayerProductSummary | { error: string };
        if (tr.ok && !('error' in tj)) {
          const ext = await fetchLatestTcgExtensionCapture(tcgUrl);
          newTcgplayerSummary = applyExtensionTcgCapture(tj, ext?.capture ?? null);
          newTcgSalesSnapshot = ext ? buildTcgSalesSnapshotFromExtension(tcgUrl, ext) : null;
          if (newTcgSalesSnapshot?.latestSalesRows?.length) {
            newTcgSalesAnomalies = buildTcgSalesAnomalies(newTcgSalesSnapshot.latestSalesRows);
          }
        }
      } catch {
        /* keep existing tcgplayerSummary */
      }
      newTcgSalesSnapshot = resolveTcgSnapshotForRefresh(
        newTcgSalesSnapshot ?? null,
        card.tcgplayerSalesSnapshot ?? null
      );
    }
    try {
      const ex = await fetchLatestEbayExtensionCapture(soldUrl, {
        relaxedEbayMatch: card.portfolioKind === 'sealed',
      });
      newEbayExtensionSnapshot = ex ? buildEbayExtensionSnapshotFromResponse(soldUrl, ex, card) : null;
    } catch {
      /* keep existing ebayExtensionSnapshot */
    }

    newEbayExtensionSnapshot = resolveEbaySnapshotForRefresh(
      newEbayExtensionSnapshot ?? null,
      card.ebayExtensionSnapshot ?? null
    );

    const tcgNewAppliedCount = (() => {
      if (!newTcgSalesSnapshot) return 0;
      if (!extensionLatestOnlyMode) return newTcgSalesSnapshot.latestSalesRows.length;
      const known = new Set(card.tcgplayerLastScannedSaleKeys ?? []);
      return (newTcgSalesSnapshot.latestSalesRows ?? []).filter((row) => !known.has(tcgRowScanKey(row))).length;
    })();
    const ebayNewAppliedCount = (() => {
      if (!newEbayExtensionSnapshot) return 0;
      if (!extensionLatestOnlyMode) return newEbayExtensionSnapshot.listings.length;
      const known = new Set(card.ebayLastScannedSaleKeys ?? []);
      return (newEbayExtensionSnapshot.listings ?? []).filter((row) => !known.has(ebayRowScanKey(row))).length;
    })();
    const applyPcRefreshMerge = (c: Card): Card => {
        const now = Date.now();
        const snapshot: PriceSnapshot = {
          at: now,
          source: 'refresh',
          raw: data.raw || undefined,
          grade9: data.grade9 || undefined,
          psa10: data.psa10 || undefined,
        };
        const mergedSales = mergeRecentSales(c.recentSales, data.recentSales);
        const cut =
          data.releaseDateMs != null &&
          Number.isFinite(data.releaseDateMs) &&
          data.releaseDateMs > 0
            ? startOfUtcDay(data.releaseDateMs)
            : null;

        let history = c.priceHistory;
        if (!history || history.length === 0) {
          history = buildSeedHistory({
            ...data,
            recentSales: mergedSales,
            raw: c.raw,
            grade9: c.grade9,
            psa10: c.psa10,
          } as ScrapeResponse);
        } else {
          const saleSnaps = snapshotsFromRecentSales(mergedSales, cut);
          let base = history.filter((h) => h.source !== 'pc_sale');
          if (cut != null) base = base.filter((h) => h.at >= cut);
          history = [...base, ...saleSnaps].sort((a, b) => a.at - b.at);
        }
        history = [...history, snapshot].slice(-650);
        const mergedTcg =
          newTcgplayerSummary !== undefined ? newTcgplayerSummary : (c.tcgplayerSummary ?? null);
        const prevTcgSource = (c.tcgplayerSalesSnapshot?.sourceUrl || '').split('?')[0].toLowerCase();
        const nextTcgSource = (
          newTcgSalesSnapshot?.sourceUrl ||
          (scrapedTcgUrl || c.tcgplayerUrl || '')
        )
          .split('?')[0]
          .toLowerCase();
        const tcgUrlChanged = Boolean(prevTcgSource && nextTcgSource && prevTcgSource !== nextTcgSource);
        const prevTcgHead = c.tcgplayerSalesSnapshot?.latestSalesRows?.[0]?.price;
        const nextTcgHead = newTcgSalesSnapshot?.latestSalesRows?.[0]?.price;
        const tcgPricePointChanged =
          typeof prevTcgHead === 'number' &&
          typeof nextTcgHead === 'number' &&
          Math.abs(prevTcgHead - nextTcgHead) > 0.0001;
        const nextScannedTcgKeys = (() => {
          const prevKeys = new Set(c.tcgplayerLastScannedSaleKeys ?? []);
          const incoming = newTcgSalesSnapshot?.latestSalesRows ?? [];
          for (const row of incoming) prevKeys.add(tcgRowScanKey(row));
          return Array.from(prevKeys).slice(-1500);
        })();
        const filteredTcgSnapshot = (() => {
          if (!extensionLatestOnlyMode || !newTcgSalesSnapshot) return newTcgSalesSnapshot;
          const known = new Set(c.tcgplayerLastScannedSaleKeys ?? []);
          const rows = (newTcgSalesSnapshot.latestSalesRows ?? []).filter((row) => !known.has(tcgRowScanKey(row)));
          if (rows.length === 0) return undefined;
          return {
            ...newTcgSalesSnapshot,
            latestSalesRows: rows,
            rowCount: rows.length,
          };
        })();
        const resetTcgArchived = tcgUrlChanged || (extensionLatestOnlyMode ? false : tcgPricePointChanged);
        const clearTcgSnapshot = tcgUrlChanged && (newTcgSalesSnapshot == null);
        const nextScannedEbayKeys = (() => {
          const prevKeys = new Set(c.ebayLastScannedSaleKeys ?? []);
          for (const row of newEbayExtensionSnapshot?.listings ?? []) prevKeys.add(ebayRowScanKey(row));
          return Array.from(prevKeys).slice(-2000);
        })();
        const filteredEbayExtensionSnapshot = (() => {
          if (!extensionLatestOnlyMode || newEbayExtensionSnapshot == null) return newEbayExtensionSnapshot;
          const known = new Set(c.ebayLastScannedSaleKeys ?? []);
          const listings = (newEbayExtensionSnapshot.listings ?? []).filter(
            (row) => !known.has(ebayRowScanKey(row))
          );
          if (listings.length > 0) {
            return {
              ...newEbayExtensionSnapshot,
              listings,
              rowCount: listings.length,
            };
          }
          const prevAt = c.ebayExtensionSnapshot?.capturedAt ?? 0;
          const nextAt = newEbayExtensionSnapshot.capturedAt ?? 0;
          if (nextAt > prevAt && (newEbayExtensionSnapshot.listings?.length ?? 0) > 0) {
            return newEbayExtensionSnapshot;
          }
          return undefined;
        })();
        const tcgSelfPatch =
          mergedTcg != null &&
          typeof mergedTcg.marketPrice === 'number' &&
          Number.isFinite(mergedTcg.marketPrice)
            ? {
                tcgplayerSelfHistory: appendTcgplayerSelfSample(
                  c.tcgplayerSelfHistory,
                  mergedTcg.marketPrice,
                  now
                ),
              }
            : {};
        return {
          ...c,
          previousPrices: {
            raw: c.raw,
            grade9: c.grade9,
            psa10: c.psa10,
            at: c.lastRefreshedAt ?? now,
          },
          raw: data.raw || c.raw,
          grade9: data.grade9 || c.grade9,
          psa10: data.psa10 || c.psa10,
          allPrices: data.allPrices ?? c.allPrices,
          tcgplayerUrl: scrapedTcgUrl || (c.tcgplayerUrl ?? '').trim(),
          cardNumber: data.cardNumber || c.cardNumber,
          localImage: data.localImage ?? c.localImage,
          releaseDateMs: data.releaseDateMs ?? c.releaseDateMs,
          lastRefreshedAt: now,
          priceHistory: history,
          // Union of previously-known sales and freshly-scraped ones, deduped
          // by (at + grade + price). Keeps historical context across refreshes
          // while letting new sales in.
          recentSales: mergedSales,
          salesVolume: data.salesVolume ?? c.salesVolume ?? {},
          ...(newTcgplayerSummary !== undefined ? { tcgplayerSummary: newTcgplayerSummary } : {}),
          ...(filteredTcgSnapshot != null
            ? { tcgplayerSalesSnapshot: filteredTcgSnapshot }
            : clearTcgSnapshot
              ? { tcgplayerSalesSnapshot: null }
              : {}),
          ...(filteredTcgSnapshot != null
            ? {
                tcgplayerSalesAnomalies:
                  filteredTcgSnapshot.latestSalesRows.length > 0
                    ? buildTcgSalesAnomalies(filteredTcgSnapshot.latestSalesRows)
                    : [],
              }
            : newTcgSalesAnomalies !== undefined
            ? { tcgplayerSalesAnomalies: newTcgSalesAnomalies }
            : clearTcgSnapshot
              ? { tcgplayerSalesAnomalies: [] }
              : {}),
          ...(nextScannedTcgKeys.length > 0 ? { tcgplayerLastScannedSaleKeys: nextScannedTcgKeys } : {}),
          ...(resetTcgArchived ? { tcgplayerArchivedSaleKeys: [] } : {}),
          ...(filteredEbayExtensionSnapshot !== undefined
            ? { ebayExtensionSnapshot: filteredEbayExtensionSnapshot }
            : {}),
          ...(nextScannedEbayKeys.length > 0 ? { ebayLastScannedSaleKeys: nextScannedEbayKeys } : {}),
          ...tcgSelfPatch,
        };
    };
    stageCardInPortfolio(applyPcRefreshMerge(card));
    setRefreshAppliedById((prev) => ({
      ...prev,
      [id]: { tcg: tcgNewAppliedCount, ebay: ebayNewAppliedCount, at: Date.now() },
    }));
  };

  const handleRefreshCard = async (id: string) => {
    if (refreshingIds.has(id)) return;
    setRefreshingIds((prev) => new Set(prev).add(id));
    try {
      await refreshCard(id);
      setWorkspacePage('quick');
      setQuickCardId(id);
      setQuickTab('pc');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'refresh failed';
      alert(`Refresh failed: ${msg}`);
    } finally {
      setRefreshingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const refreshEbayForCard = async (id: string): Promise<void> => {
    const card =
      cards.find((c) => c.id === id) ??
      cardCacheRef.current.get(id) ??
      quickIndexCards?.find((c) => c.id === id);
    if (!card) throw new Error('card not found');
    const soldUrl = ebaySoldSearchUrlForCard(card);
    const apiRes = await refreshEbaySalesViaApi(card, { windowDays: 30, limit: 60 });
    let extSnap: EbayExtensionSnapshot | null = null;
    try {
      const ex = await fetchLatestEbayExtensionCapture(soldUrl, {
        relaxedEbayMatch: card.portfolioKind === 'sealed',
      });
      extSnap = ex ? buildEbayExtensionSnapshotFromResponse(soldUrl, ex, card) : null;
    } catch {
      /* keep previous snapshot */
    }
    extSnap = resolveEbaySnapshotForRefresh(extSnap, card.ebayExtensionSnapshot ?? null);
    const ebayNewAppliedCount = (() => {
      if (!extSnap) return 0;
      if (!extensionLatestOnlyMode) return extSnap.listings.length;
      const known = new Set(card.ebayLastScannedSaleKeys ?? []);
      return (extSnap.listings ?? []).filter((row) => !known.has(ebayRowScanKey(row))).length;
    })();
    const applyEbayRefreshMerge = (c: Card): Card => {
      const prevUrl = (c.ebayExtensionSnapshot?.sourceUrl || '').toLowerCase();
      const nextUrl = (extSnap?.sourceUrl || soldUrl || '').toLowerCase();
      const ebayUrlChanged = Boolean(prevUrl && nextUrl && prevUrl !== nextUrl);
      const prevHead = c.ebayExtensionSnapshot?.listings?.[0]?.price;
      const nextHead = extSnap?.listings?.[0]?.price;
      const ebayPricePointChanged =
        typeof prevHead === 'number' &&
        typeof nextHead === 'number' &&
        Math.abs(prevHead - nextHead) > 0.0001;
      const nextScannedEbayKeys = (() => {
        const prevKeys = new Set(c.ebayLastScannedSaleKeys ?? []);
        for (const row of extSnap?.listings ?? []) prevKeys.add(ebayRowScanKey(row));
        return Array.from(prevKeys).slice(-2000);
      })();
      const filteredExtSnap = (() => {
        if (!extensionLatestOnlyMode || !extSnap) return extSnap;
        const known = new Set(c.ebayLastScannedSaleKeys ?? []);
        const listings = (extSnap.listings ?? []).filter((row) => !known.has(ebayRowScanKey(row)));
        if (listings.length > 0) {
          return {
            ...extSnap,
            listings,
            rowCount: listings.length,
          };
        }
        const prevAt = c.ebayExtensionSnapshot?.capturedAt ?? 0;
        const nextAt = extSnap.capturedAt ?? 0;
        if (nextAt > prevAt && (extSnap.listings?.length ?? 0) > 0) {
          return extSnap;
        }
        return undefined;
      })();
      const resetArchived = ebayUrlChanged || (extensionLatestOnlyMode ? false : ebayPricePointChanged);
      const clearSnapshot = ebayUrlChanged && !extSnap;
      const clearSales = shouldClearEbaySalesOnQueryChange(c);
      return {
        ...c,
        ebaySales: clearSales ? null : apiRes.apiSummary ?? c.ebaySales ?? null,
        ...(apiRes.apiSummary && !clearSales
          ? { ebayLastApiFetchedAt: Date.now() }
          : clearSales
            ? { ebayLastApiFetchedAt: undefined }
            : {}),
        ebayExtensionSnapshot: clearSnapshot ? null : filteredExtSnap ?? c.ebayExtensionSnapshot ?? null,
        ...(nextScannedEbayKeys.length > 0 ? { ebayLastScannedSaleKeys: nextScannedEbayKeys } : {}),
        ...(resetArchived ? { ebayArchivedSaleKeys: [] } : {}),
      };
    };
    stageCardInPortfolio(applyEbayRefreshMerge(card));
    setRefreshAppliedById((prev) => ({
      ...prev,
      [id]: { tcg: 0, ebay: ebayNewAppliedCount, at: Date.now() },
    }));
  };

  const handleRefreshEbayCard = async (id: string) => {
    if (refreshingEbayIds.has(id)) return;
    setRefreshingEbayIds((prev) => new Set(prev).add(id));
    try {
      await refreshEbayForCard(id);
      setWorkspacePage('quick');
      setQuickCardId(id);
      setQuickTab('ebay');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'eBay refresh failed';
      alert(`eBay refresh failed: ${msg}`);
    } finally {
      setRefreshingEbayIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const resolveQuickFetchMarketPreflight = useCallback((choice: 'continue' | 'stop') => {
    const r = quickFetchPreflightResolveRef.current;
    quickFetchPreflightResolveRef.current = null;
    setQuickFetchMarketPreflight(null);
    r?.(choice);
  }, []);

  const onQuickFetchMarketPreflightDontShowAgain = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY_QUICK_FETCH_SKIP_MARKET_PREFLIGHT, '1');
    } catch {
      /* ignore */
    }
    resolveQuickFetchMarketPreflight('continue');
  }, [resolveQuickFetchMarketPreflight]);

  type QuickFetchRunParams = {
    incremental: boolean;
    tcgDeep: boolean;
    marketMode: QuickFetchMarketMode;
  };

  const runRawEngineQuickFetch = async (
    card: Card,
    signal?: AbortSignal,
    options?: { stopAfterTcgPhase?: boolean; params: QuickFetchRunParams }
  ): Promise<{
    tcgWarning?: string;
    captureDiagnostics?: string;
    updatedCard?: Card | null;
    patchErrors: string[];
  }> => {
    const p = options?.params ?? {
      incremental: false,
      tcgDeep: true,
      marketMode: quickCardAdminSettings.quickFetchMarketMode,
    };
    let marketMode = p.marketMode;
    if (p.incremental && marketMode === 'edge_backup') marketMode = 'hybrid';
    return runQuickFetch(
      {
        quickFetchIncremental: p.incremental,
        quickFetchTimingStore,
        quickFetchMarketMode: marketMode,
        quickFetchTcgDeep: p.tcgDeep,
        portfolioKindScope: filters.portfolioKindScope,
        quickFetchReuseTab: true,
        quickFetchRequireDeckReady: false,
        setQuickFetchPhase,
        setQuickFetchProgressPct,
        setQuickEbayCaptureDiagnostics,
        requestMarketPreflight: (kind) =>
          new Promise<'continue' | 'stop'>((resolve) => {
            quickFetchPreflightResolveRef.current = resolve;
            setQuickFetchMarketPreflight({ kind });
          }),
        rawEngine: {
          getBrowser: getRawEngineBrowser,
          getCaptureLog: getRawEngineCaptureLog,
          getScrapeGate: getRawEngineScrapeGate,
          isShell: isRawEngineShell,
          getRuntime: getRawEngineRuntime,
        },
      },
      card,
      signal,
      options?.stopAfterTcgPhase != null ? { stopAfterTcgPhase: options.stopAfterTcgPhase } : undefined
    );
  };

  const resolveCardForQuickActions = useCallback(
    (id: string, baseCard?: Card | null): Card | null => {
      if (baseCard) return baseCard;
      return (
        cards.find((x) => x.id === id) ??
        cardCacheRef.current.get(id) ??
        quickIndexCards?.find((x) => x.id === id) ??
        enriched.find((x) => x.id === id) ??
        null
      );
    },
    [cards, quickIndexCards, enriched]
  );

  const runQuickCardFetch = async (
    id: string,
    mode: QuickCardFetchMode,
    baseCard?: Card | null
  ): Promise<void> => {
    const isQuick = mode === 'quick';
    let c = resolveCardForQuickActions(id, baseCard);
    if (!c) {
      c = (await fetchCardByIdFromServer(id)) ?? null;
      if (c) cardCacheRef.current.set(id, c);
    }
    if (!c) {
      setQuickError('Could not load this card. Pick it again from Card lookup or reload the portfolio.');
      return;
    }
    c = normalizeCardPortfolioKind(c, filters.portfolioKindScope);
    if (filters.portfolioKindScope !== 'all') {
      stageCardInPortfolio(c);
    }

    const fetchParams: QuickFetchRunParams = {
      incremental: isQuick,
      tcgDeep: !isQuick,
      marketMode: quickCardAdminSettings.quickFetchMarketMode,
    };

    setQuickFetchActiveMode(mode);
    setQuickBusy(true);
    setQuickError(null);
    let captureOk = false;
    try {
      if (isRawEngineShell()) {
        quickFetchAbortRef.current?.abort();
        const ac = new AbortController();
        quickFetchAbortRef.current = ac;
        quickFetchSessionRef.current = {
          cardId: id,
          portfolioKindScope: filters.portfolioKindScope,
        };
        setRawEngineQuickFetchActive(true);
        setQuickFetchCaptureStage('capturing');
        setQuickFetchTargetSummary(`${c.name} · ${(c.set || '').trim() || 'Unknown set'}`);
        setQuickFetchProgressPct(0);
        setQuickFetchPhase(isQuick ? 'Quick refresh…' : 'Full fetch…');
        try {
          const { tcgWarning, captureDiagnostics, updatedCard, patchErrors } = await runRawEngineQuickFetch(
            c,
            ac.signal,
            { params: fetchParams }
          );
          setQuickFetchCaptureStage('refreshing');
          setQuickFetchPhase('Refreshing charts…');
          setQuickFetchProgressPct(100);
          await focusRawEnginePortfolioWindow();
          setQuickCardId(id);
          const fresh = await fetchCardByIdFromServer(id);
          const stagedFresh = fresh
            ? normalizeCardPortfolioKind(fresh, filters.portfolioKindScope)
            : null;
          const stagedUpdated = updatedCard
            ? normalizeCardPortfolioKind(updatedCard, filters.portfolioKindScope)
            : null;
          if (stagedFresh) {
            stageCardInPortfolio(stagedFresh);
            setQuickCardId(id);
            await refreshQuickCardCharts(id, stagedFresh);
          } else if (stagedUpdated) {
            stageCardInPortfolio(stagedUpdated);
            setQuickCardId(stagedUpdated.id);
            await refreshQuickCardCharts(id, stagedUpdated);
          } else {
            await refreshQuickCardCharts(id);
          }
          captureOk = true;
          const ebayRows =
            fresh?.ebayExtensionSnapshot?.listings?.length ??
            updatedCard?.ebayExtensionSnapshot?.listings?.length ??
            0;
          const parts = [
            ...(patchErrors ?? []).filter((x) => x.trim().length > 0),
            tcgWarning,
            captureDiagnostics,
          ].filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
          if (ebayRows < 1 && !isQuick) {
            parts.push(
              'eBay sold data did not land on this card. In Edge, capture the sold-search tab opened by Quick Fetch (More history for Full fetch). Check extension token (Admin → capture diagnostics) and that the tab URL matches the card.'
            );
          } else if (
            captureDiagnostics &&
            /eBay.*\b0 merged rows\b/i.test(captureDiagnostics) &&
            ebayRows < 1
          ) {
            parts.push('eBay capture reported 0 merged rows — retry capture or check sold-tab URL.');
          }
          if (parts.length) setQuickError(parts.join(' | '));
        } finally {
          quickFetchAbortRef.current = null;
          quickFetchSessionRef.current = null;
          void publishQuickFetchSession(null);
        }
      } else {
        const missingPcHistory = !Array.isArray(c.priceHistory) || c.priceHistory.length < 2;
        const missingTcgSales =
          !c.tcgplayerSalesSnapshot ||
          !Array.isArray(c.tcgplayerSalesSnapshot.latestSalesRows) ||
          c.tcgplayerSalesSnapshot.latestSalesRows.length < 5;
        const missingEbayExt =
          !c.ebayExtensionSnapshot ||
          !Array.isArray(c.ebayExtensionSnapshot.listings) ||
          c.ebayExtensionSnapshot.listings.length < 5;

        if ((missingPcHistory || missingTcgSales) && c.url) {
          await refreshCard(id, c);
        }
        if (missingEbayExt) {
          await refreshEbayForCard(id);
        }
        const didLightRefresh =
          ((missingPcHistory || missingTcgSales) && Boolean(c.url)) || missingEbayExt;
        if (didLightRefresh) {
          captureOk = true;
        } else if (!isQuick) {
          setQuickError(
            'Full fetch needs the Raw Investor desktop app for Hybrid Edge capture. Quick refresh can still update charts when data is missing.'
          );
        } else {
          setQuickError(
            'Nothing to refresh — card already has chart data. Use the Raw Investor desktop app for full market capture.'
          );
        }
      }

      if (captureOk) {
        const stampKey = isQuick ? 'lastQuickRefreshAt' : 'lastFullFetchAt';
        updateCardField(id, stampKey, Date.now());
        const afterCard = resolveCardForQuickActions(id) ?? c;
        const runGem =
          !isQuick ||
          shouldFetchGemRateOnQuickRefresh(quickCardAdminSettings, afterCard);
        if (runGem) {
          const patch = await fetchGemRateEnrichment(afterCard, filters.portfolioKindScope);
          if (patch) {
            if (patch.gemrateCandidates != null) {
              updateCardField(id, 'gemrateCandidates', patch.gemrateCandidates);
            }
            if (patch.gemrateId != null) {
              updateCardField(id, 'gemrateId', patch.gemrateId);
            }
            if (patch.gemRateStats !== undefined) {
              updateCardField(id, 'gemRateStats', patch.gemRateStats ?? null);
            }
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setQuickError('Capture cancelled.');
        void getRawEngineCaptureLog()?.append?.({
          scope: 'quickFetch',
          message: 'Quick Fetch cancelled by user',
          detail: { cardId: id },
        });
      } else {
        setQuickError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setRawEngineQuickFetchActive(false);
      setQuickFetchCaptureStage('idle');
      setQuickFetchTargetSummary(null);
      setQuickFetchPhase(null);
      setQuickEbayCaptureDiagnostics(null);
      setQuickFetchProgressPct(null);
      setQuickBusy(false);
      setQuickFetchActiveMode(null);
      quickFetchPreflightResolveRef.current = null;
      setQuickFetchMarketPreflight(null);
    }
  };

  const refreshQuickCardCharts = async (id: string, baseCard?: Card | null): Promise<void> => {
    let c = resolveCardForQuickActions(id, baseCard);
    if (!c) {
      c = (await fetchCardByIdFromServer(id)) ?? null;
      if (c) cardCacheRef.current.set(id, c);
    }
    if (!c) {
      setQuickError('Could not load this card for refresh.');
      return;
    }
    setQuickBusy(true);
    setQuickError(null);
    try {
      if (c.url) {
        await refreshCard(id, c);
        setQuickCardId(id);
        setQuickTab('pc');
      } else {
        // If no PriceCharting URL exists, still refresh eBay so chart data can update.
        await refreshEbayForCard(id);
        setQuickCardId(id);
        setQuickTab('ebay');
      }
    } catch (err) {
      setQuickError(err instanceof Error ? err.message : String(err));
    } finally {
      setQuickBusy(false);
    }
  };

  useEffect(() => {
    if (!hydrated || workspacePage !== 'quick' || !quickCard?.id) return;
    if (!quickCardAdminSettings.autoQuickRefreshOnLoad) return;
    if (quickBusy || rawEngineQuickFetchActive) return;
    if (quickFetchSessionRef.current?.cardId) return;
    const cardId = quickCard.id;
    if (hasAutoQuickRefreshStamp(cardId)) return;
    if (autoQuickRefreshInFlightRef.current === cardId) return;
    autoQuickRefreshInFlightRef.current = cardId;
    setAutoQuickRefreshStamp(cardId);
    void runQuickCardFetch(cardId, 'quick', quickCard).finally(() => {
      if (autoQuickRefreshInFlightRef.current === cardId) {
        autoQuickRefreshInFlightRef.current = null;
      }
    });
    // Only re-run when the selected card or auto setting changes — not when quickBusy clears (avoids duplicate run after manual Quick Refresh).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, workspacePage, quickCard?.id, quickCardAdminSettings.autoQuickRefreshOnLoad]);

  /**
   * Refresh every card with a stored URL, sequentially. Sequential on purpose:
   * PriceCharting is a shared site with no official API, so hammering it in
   * parallel risks rate-limiting and is unfriendly. 250 ms between calls gives
   * a gentle cadence. Errors are counted, not thrown, so one bad URL does not
   * abort the batch.
   */
  const refreshAll = async () => {
    let targets: Card[];
    if (serverPagedPortfolio) {
      const all = await fetchAllCardsPagesFromServer(filters, sort, 500, true);
      targets = (all ?? []).filter((c) => c.url);
    } else {
      targets = cards.filter((c) => c.url);
    }
    if (targets.length === 0) {
      alert('No cards have PriceCharting URLs stored. Add a card via its URL to enable refresh.');
      return;
    }
    setBulkRefresh({ done: 0, total: targets.length, errors: 0 });
    let errors = 0;
    for (let i = 0; i < targets.length; i++) {
      const card = targets[i];
      try {
        await refreshCard(card.id);
      } catch {
        errors += 1;
      }
      setBulkRefresh({ done: i + 1, total: targets.length, errors });
      if (i < targets.length - 1) await new Promise((r) => setTimeout(r, 250));
    }
    // Leave the summary visible briefly so the user sees the final count.
    setTimeout(() => setBulkRefresh(null), 2500);
  };

  const refreshAllEbay = async () => {
    let targets: Card[];
    if (serverPagedPortfolio) {
      const all = await fetchAllCardsPagesFromServer(filters, sort, 500, true);
      targets = (all ?? []).filter((c) => buildEbayQuery({ name: c.name, set: c.set, cardNumber: c.cardNumber }));
    } else {
      targets = cards.filter((c) => buildEbayQuery({ name: c.name, set: c.set, cardNumber: c.cardNumber }));
    }
    if (targets.length === 0) {
      alert('No cards have enough metadata for eBay query yet.');
      return;
    }
    setBulkEbayRefresh({ done: 0, total: targets.length, errors: 0 });
    let errors = 0;
    const apiStatus = await fetchEbayApiConfigStatus();
    if (apiStatus.configured) {
      const batchMap = await refreshEbaySalesBatchViaApi(targets, {
        windowDays: 30,
        limit: 60,
        concurrency: 3,
      });
      for (let i = 0; i < targets.length; i++) {
        const c = targets[i];
        try {
          const br = batchMap.get(c.id);
          if (br?.apiError) errors += 1;
          await refreshEbayForCard(c.id);
        } catch {
          errors += 1;
        }
        setBulkEbayRefresh({ done: i + 1, total: targets.length, errors });
        if (i < targets.length - 1) await new Promise((r) => setTimeout(r, 250));
      }
    } else {
      for (let i = 0; i < targets.length; i++) {
        const c = targets[i];
        try {
          await refreshEbayForCard(c.id);
        } catch {
          errors += 1;
        }
        setBulkEbayRefresh({ done: i + 1, total: targets.length, errors });
        if (i < targets.length - 1) await new Promise((r) => setTimeout(r, 250));
      }
    }
    setTimeout(() => setBulkEbayRefresh(null), 2500);
  };

  const loadMasterGridAtOffset = useCallback(
    async (nextOffset: number) => {
      if (!serverPagedPortfolio) return;
      const page = await fetchCardsPageFromServer(filters, sort, nextOffset, MASTER_GRID_PAGE_SIZE, true);
      if (!page) return;
      for (const c of page.items) cardCacheRef.current.set(c.id, c);
      setCards(page.items);
      setGridTotal(page.total);
      setGridOffset(nextOffset);
      for (const c of page.items) {
        syncBaselineRef.current.lastCardJson.set(c.id, JSON.stringify(c));
      }
    },
    [serverPagedPortfolio, filters, sort]
  );

  const createCollection = (name: string, color: string): string => {
    const id = crypto.randomUUID();
    setCollections((prev) => [
      ...prev,
      { id, name: name.trim() || 'Untitled', color, createdAt: Date.now() },
    ]);
    return id;
  };

  const updateCollection = (id: string, patch: Partial<Collection>) => {
    setCollections((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  const deleteCollection = (id: string) => {
    // Orphan the cards (set collectionId to undefined) rather than deleting them.
    setCards((prev) =>
      prev.map((c) => (c.collectionId === id ? { ...c, collectionId: undefined } : c))
    );
    setCollections((prev) => prev.filter((c) => c.id !== id));
    setFilters((f) => ({ ...f, collectionIds: f.collectionIds.filter((x) => x !== id) }));
    if (incrementalSyncEnabledRef.current) {
      void (async () => {
        const colCards = await fetchAllCardsPagesFromServer(
          { ...EMPTY_FILTERS, collectionIds: [id] },
          'name_asc',
          500,
          true
        );
        for (const c of colCards ?? []) {
          const out = await patchCardOnServer(c.id, { collectionId: undefined });
          if (out.ok) cardCacheRef.current.set(c.id, out.card);
        }
      })();
    }
  };

  const toggleCollectionFilter = (id: string) => {
    setFilters((f) => {
      const has = f.collectionIds.includes(id);
      return {
        ...f,
        collectionIds: has
          ? f.collectionIds.filter((x) => x !== id)
          : [...f.collectionIds, id],
      };
    });
  };

  /** Fetch PSA population for a specific card. Requires a saved PSA token. */
  const fetchPsaPop = async (cardId: string) => {
    const card = cards.find((c) => c.id === cardId);
    if (!card?.psaSpecId) return;
    if (!psaToken) {
      setFetchError('Set your PSA API token in Admin → Configuration first.');
      setWorkspacePage('admin');
      setAdminSection('configuration');
      return;
    }
    try {
      const res = await fetch(
        apiUrl(`/api/psa/pop?specId=${encodeURIComponent(card.psaSpecId)}`),
        { headers: { Authorization: `Bearer ${psaToken}` } }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      const pop: PsaPopulation = { ...data, fetchedAt: Date.now() };
      updateCardField(cardId, 'psaPop', pop);
    } catch (err) {
      alert(`PSA lookup failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  /** Push PSA-pop-derived probabilities into p10 / p9 on the card. */
  const applyPsaProbs = (cardId: string) => {
    const card = cards.find((c) => c.id === cardId);
    if (!card?.psaPop) return;
    const { p10, p9 } = probsFromPsaPop(card.psaPop.grades);
    setCards((prev) =>
      prev.map((c) => (c.id === cardId ? { ...c, p10, p9 } : c))
    );
  };

  const chartData = visible.map((c) => ({
    id: c.id,
    name: c.name,
    ev: c.metrics.ev,
    net10: c.metrics.net10,
    net9: c.metrics.net9,
    totalInvested: c.metrics.totalInvested,
  }));

  const tickerRows = useMemo(() => buildPortfolioTickerRows(visible, 5), [visible]);
  const topFiveCards = useMemo(
    () => [...visible].sort((a, b) => championRosterScore(b) - championRosterScore(a)).slice(0, 5),
    [visible]
  );

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8 text-slate-900 antialiased">
      <div className="max-w-[96rem] mx-auto space-y-6">
        <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm flex flex-col gap-6">
          <div className="flex flex-col md:flex-row justify-between items-center gap-6">
            <div className="space-y-2 text-center md:text-left">
              <h1 className="text-4xl font-semibold tracking-tight uppercase text-slate-900 leading-tight">
                Raw Investor
              </h1>
              <p className="text-slate-500 font-medium text-sm">
                EV = p10&middot;net10 + p9&middot;net9 + pFail&middot;netFail &middot; ROI% = EV / Invested
              </p>
              <div className="flex flex-wrap items-center justify-center md:justify-start gap-2 pt-2">
                <BrandLogoImg
                  brand="pokemon"
                  className="h-8 w-auto max-w-[min(200px,45vw)] object-contain object-left"
                  title="Pokémon"
                />
                <BrandLogoImg brand="pokeball" className="h-8 w-8 object-contain shrink-0" title="Poké Ball" />
              </div>
            </div>
            <div className="flex flex-wrap justify-center gap-3 items-center">
              <BackendBadge status={backendStatus} />
              <SyncBadge status={syncStatus} lastSavedAt={lastSavedAt} />
              <button
                type="button"
                onClick={() => {
                  setWorkspacePage('admin');
                  setAdminSection('configuration');
                }}
                className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 px-5 py-3 rounded-2xl font-bold transition-all active:scale-95"
              >
                <Settings2 size={18} /> Admin
              </button>
              <button
                onClick={() => setIsAdding((s) => !s)}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-2xl font-bold transition-all shadow-lg active:scale-95"
              >
                {isAdding ? <X size={20} /> : <Plus size={20} />}
                {isAdding ? 'Close' : 'Add Card'}
              </button>
            </div>
          </div>
          <nav
            className="flex flex-wrap items-center gap-2 pt-4 border-t border-slate-100"
            aria-label="Workspace"
          >
            <button
              type="button"
              onClick={() => setWorkspacePage('quick')}
              className={`px-3 py-2 rounded-lg text-xs font-black uppercase tracking-widest border ${
                workspacePage === 'quick'
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              Quick Card Dashboard
            </button>
            <button
              type="button"
              onClick={() => setWorkspacePage('streamer')}
              className={`px-3 py-2 rounded-lg text-xs font-black uppercase tracking-widest border ${
                workspacePage === 'streamer'
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              Streamer Mode
            </button>
            <button
              type="button"
              onClick={() => setWorkspacePage('master')}
              className={`px-3 py-2 rounded-lg text-xs font-black uppercase tracking-widest border ${
                workspacePage === 'master'
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              Master List
            </button>
            <button
              type="button"
              onClick={() => setWorkspacePage('strategies')}
              className={`px-3 py-2 rounded-lg text-xs font-black uppercase tracking-widest border ${
                workspacePage === 'strategies'
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              Strategies
            </button>
            <button
              type="button"
              onClick={() => setWorkspacePage('insights')}
              className={`px-3 py-2 rounded-lg text-xs font-black uppercase tracking-widest border ${
                workspacePage === 'insights'
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              Insights
            </button>
            <button
              type="button"
              onClick={() => setWorkspacePage('starChart')}
              className={`px-3 py-2 rounded-lg text-xs font-black uppercase tracking-widest border ${
                workspacePage === 'starChart'
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              Star Chart
            </button>
            <button
              type="button"
              onClick={() => setWorkspacePage('arsenal')}
              className={`px-3 py-2 rounded-lg text-xs font-black uppercase tracking-widest border ${
                workspacePage === 'arsenal'
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              Arsenal
            </button>
            <button
              type="button"
              onClick={() => setWorkspacePage('guide')}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-black uppercase tracking-widest border ${
                workspacePage === 'guide'
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <BookOpen size={14} aria-hidden />
              User Guide
            </button>
            <button
              type="button"
              onClick={() => setWorkspacePage('admin')}
              className={`px-3 py-2 rounded-lg text-xs font-black uppercase tracking-widest border ${
                workspacePage === 'admin'
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              Admin
            </button>
          </nav>
        </div>

        {backendStatus === 'offline' && (
          <div className="bg-rose-50 border-2 border-rose-200 text-rose-800 px-6 py-4 rounded-2xl flex items-start gap-3 shadow-sm">
            <WifiOff size={20} className="mt-0.5 flex-shrink-0" />
            <div className="text-sm">
              <div className="font-black uppercase tracking-wider text-xs mb-1">
                Backend offline
              </div>
              <div className="font-medium">
                {isRawEngineShell()
                  ? 'Raw Investor is not running on this PC. Restart the app from the Start Menu and wait until the dashboard loads.'
                  : 'Cannot reach the local service. Double-click LAUNCH.bat and wait for "[pcgr-server] listening" before retrying.'}
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 mb-4">
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Portfolio</span>
          <PortfolioKindScopeTabs
            value={filters.portfolioKindScope}
            disabled={rawEngineQuickFetchActive}
            onChange={(portfolioKindScope) => setFilters((f) => ({ ...f, portfolioKindScope }))}
          />
        </div>

        {isAdding && (
          <div className="bg-white p-8 rounded-3xl border-2 border-blue-100 shadow-xl">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
              <h3 className="text-lg font-black uppercase flex items-center gap-2 text-blue-600">
                <PlusCircle size={20} /> Card Listing Form
              </h3>
              <div className="flex gap-2 flex-grow max-w-xl">
                <div className="relative flex-grow">
                  <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <input
                    placeholder="Paste PriceCharting Link..."
                    className="w-full bg-slate-50 pl-10 pr-4 py-3 rounded-xl border border-slate-200 focus:outline-blue-500 text-sm font-medium"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                  />
                </div>
                <button
                  onClick={fetchCardDetails}
                  disabled={fetching || !url}
                  className="bg-blue-50 text-blue-600 px-4 py-3 rounded-xl font-bold text-sm flex items-center gap-2 hover:bg-blue-100 disabled:opacity-50"
                >
                  {fetching ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />}
                  {fetching ? 'Scraping...' : 'Fetch'}
                </button>
              </div>
            </div>

            {fetchError && (
              <div className="mb-4 text-sm font-semibold text-rose-700 bg-rose-50 border border-rose-200 px-4 py-2 rounded-xl">
                {fetchError}
              </div>
            )}

            {draft.localImage && (
              <div className="mb-6 flex items-center gap-4 bg-slate-50 p-3 rounded-xl border border-slate-200">
                <img
                  src={resolveServerUrl(draft.localImage)}
                  alt={draft.name}
                  className="h-24 w-auto rounded-lg shadow-md border border-slate-200"
                />
                <div className="text-xs text-slate-500">
                  <div className="font-bold text-slate-700 uppercase tracking-widest text-[10px] mb-1">
                    Image captured
                  </div>
                  <div className="font-mono break-all">{draft.localImage}</div>
                  {draft.allPrices && draft.allPrices.length > 0 && (
                    <div className="mt-1 text-slate-400">
                      {draft.allPrices.length} grade prices captured
                    </div>
                  )}
                </div>
              </div>
            )}

            <form onSubmit={handleAddCard} className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label="Card Name">
                <input className={inputCls} placeholder="e.g. Pikachu ex"
                  value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </Field>
              <Field label="Set">
                <input className={inputCls} placeholder="e.g. Surging Sparks"
                  value={draft.set} onChange={(e) => setDraft({ ...draft, set: e.target.value })} />
              </Field>
              <Field label="Rarity (optional)">
                <input className={inputCls} placeholder="SIR / IR / RR"
                  value={draft.rarity ?? ''} onChange={(e) => setDraft({ ...draft, rarity: e.target.value })} />
              </Field>
              <Field label="Listing type">
                <select
                  className={inputCls}
                  disabled={filters.portfolioKindScope !== 'all'}
                  value={draft.portfolioKind ?? 'single'}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      portfolioKind: e.target.value === 'sealed' ? 'sealed' : 'single',
                    })
                  }
                >
                  <option value="single">Single (grading EV)</option>
                  <option value="sealed">Sealed product</option>
                </select>
                {filters.portfolioKindScope !== 'all' && (
                  <p className="text-[10px] text-slate-500 mt-1">
                    Set by portfolio tab ({filters.portfolioKindScope === 'sealed' ? 'Sealed' : 'Singles'}).
                  </p>
                )}
              </Field>
              <Field label="Raw ($, market)">
                <NumberInput value={draft.raw} onChange={(v) => setDraft({ ...draft, raw: v })} />
              </Field>
              <Field label="Paid ($, what you actually paid)">
                <NumberInput
                  value={draft.actualCost ?? 0}
                  onChange={(v) => setDraft({ ...draft, actualCost: v > 0 ? v : undefined })}
                />
              </Field>
              <Field label="Shipping ($, inbound)">
                <div className="flex items-center gap-2">
                  <NumberInput
                    value={draft.shippingCost ?? 0}
                    onChange={(v) => setDraft({ ...draft, shippingCost: v > 0 ? v : undefined })}
                  />
                  <label className="flex items-center gap-1 text-xs font-bold text-slate-600 whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={!!draft.freeShipping}
                      onChange={(e) => setDraft({ ...draft, freeShipping: e.target.checked })}
                      className="rounded border-slate-300"
                    />
                    FREE
                  </label>
                </div>
              </Field>
              <Field label="Grade 9 ($)">
                <NumberInput value={draft.grade9} onChange={(v) => setDraft({ ...draft, grade9: v })} />
              </Field>
              <Field label="PSA 10 ($)">
                <NumberInput value={draft.psa10} onChange={(v) => setDraft({ ...draft, psa10: v })} />
              </Field>
              <Field label="P(PSA 10)">
                <NumberInput step={0.01} value={draft.p10} onChange={(v) => setDraft({ ...draft, p10: v })} />
              </Field>
              <Field label="P(PSA 9)">
                <NumberInput step={0.01} value={draft.p9} onChange={(v) => setDraft({ ...draft, p9: v })} />
              </Field>
              <Field label="PSA SpecID (optional)">
                <input className={inputCls} placeholder="e.g. 12345"
                  value={draft.psaSpecId ?? ''} onChange={(e) => setDraft({ ...draft, psaSpecId: e.target.value })} />
              </Field>
              <div className="md:col-span-3 flex justify-end">
                <button type="submit" className="bg-slate-900 text-white px-8 py-4 rounded-xl font-black uppercase tracking-widest hover:bg-slate-800 transition-colors">
                  Save Card
                </button>
              </div>
            </form>
          </div>
        )}

        {workspacePage === 'insights' && (
          <div className="space-y-6">
            <PortfolioSummary totals={totals} filterActive={filterActive} />
            <PortfolioInsightsTabs
              topFive={topFiveCards}
              chartData={chartData}
              tickerRows={tickerRows}
              visible={visible}
            />
          </div>
        )}

        {workspacePage === 'guide' && (
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col min-h-[70vh]">
            <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-black uppercase tracking-[0.12em] text-slate-800">
                  User Guide
                </h3>
                <p className="text-xs text-slate-500 font-medium">
                  Raw Investor by RawGraded — how to import, export, back up, and use each workspace.
                </p>
              </div>
            </div>
            <iframe
              key={guideIframeKey}
              title="Raw Investor user guide"
              className="w-full flex-1 min-h-[65vh] border-0 bg-slate-50"
              src={`${import.meta.env.BASE_URL}guides/raw-investor-user-guide.html`}
            />
          </div>
        )}

        {workspacePage === 'arsenal' && (
          <Suspense fallback={<div className="text-xs text-slate-500 p-3">Loading Arsenal…</div>}>
            <ArsenalEntry cards={cards} fees={fees} />
          </Suspense>
        )}

        {workspacePage === 'quick' && quickCard && (
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-4 md:p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-black uppercase tracking-[0.12em] text-slate-700">
                  Quick Card Module
                </h3>
                <p className="text-xs text-slate-500 font-medium">
                  Pick a card, render instant cross-market chart, and expand full math/details.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void runQuickCardFetch(quickCard.id, 'quick', quickCard)}
                  disabled={quickBusy}
                  className="px-3 py-2 rounded-lg text-xs font-black uppercase tracking-widest border border-blue-600 bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {quickBusy && quickFetchActiveMode === 'quick' ? 'Quick Refresh…' : 'Quick Refresh'}
                </button>
                {hasCompletedFullFetch(quickCard) ? (
                  <details className="inline-block">
                    <summary className="list-none cursor-pointer px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100">
                      Full Fetch (optional)
                    </summary>
                    <button
                      type="button"
                      onClick={() => void runQuickCardFetch(quickCard.id, 'full', quickCard)}
                      disabled={quickBusy}
                      className="mt-1 block px-3 py-2 rounded-lg text-xs font-black uppercase tracking-widest border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50"
                    >
                      {quickBusy && quickFetchActiveMode === 'full' ? 'Full Fetch…' : 'Full Fetch'}
                    </button>
                  </details>
                ) : (
                  <button
                    type="button"
                    onClick={() => void runQuickCardFetch(quickCard.id, 'full', quickCard)}
                    disabled={quickBusy}
                    className="px-3 py-2 rounded-lg text-xs font-black uppercase tracking-widest border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50"
                  >
                    {quickBusy && quickFetchActiveMode === 'full' ? 'Full Fetch…' : 'Full Fetch'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void refreshQuickCardCharts(quickCard.id, quickCard)}
                  disabled={quickBusy}
                  className="px-3 py-2 rounded-lg text-xs font-black uppercase tracking-widest border border-slate-200 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                >
                  Refresh Charts
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const nextMath = quickTab !== 'math';
                    setQuickTab(nextMath ? 'math' : 'ebay');
                    setQuickExpanded(nextMath);
                  }}
                  className="px-3 py-2 rounded-lg text-xs font-black uppercase tracking-widest border border-slate-200 bg-white hover:bg-slate-50"
                >
                  {quickTab === 'math' ? 'Hide Full Math' : 'Expand Full Math'}
                </button>
                {quickFetchPhase || quickEbayCaptureDiagnostics ? (
                  <EbayCapturePluginHost pluginId="diagnostics" label="eBay capture diagnostics">
                    <EbayCaptureDiagnosticsStripLazy
                      phase={quickFetchPhase}
                      busy={quickBusy}
                      stats={quickEbayCaptureDiagnostics}
                    />
                  </EbayCapturePluginHost>
                ) : null}
              </div>
            </div>

            <PresaleBadgeStrip card={quickCard} />

            <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1">
              {([
                ['pc', 'PriceCharting'],
                ['tcg', 'TCG Player'],
                ['ebay', 'eBay'],
                ['grand', 'Grand Overview'],
                ['archived', 'Archived'],
                ['math', 'Math'],
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setQuickTab(id);
                    if (id === 'math') setQuickExpanded(true);
                  }}
                  className={`px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.11em] rounded-lg ${
                    quickTab === id
                      ? 'bg-white border border-slate-200 text-slate-900'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(300px,420px),1fr]">
              <div className="space-y-3">
                <label className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                  Card lookup
                </label>
                <div ref={quickPickerRef} className="relative">
                  <button
                    type="button"
                    onClick={() => setQuickPickerOpen((v) => !v)}
                    className="w-full bg-slate-50 px-3 py-2 rounded-lg border border-slate-200 text-left flex items-center gap-3 hover:bg-slate-100"
                  >
                    {quickCard.localImage ? (
                      <img
                        src={resolveServerUrl(quickCard.localImage)}
                        alt={quickCard.name}
                        className="h-10 w-10 rounded-md object-cover border border-slate-200"
                        loading="lazy"
                      />
                    ) : (
                      <div className="h-10 w-10 rounded-md bg-slate-100 border border-slate-200" />
                    )}
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-800 truncate">{quickCard.name}</div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {quickCard.set || 'Unknown set'}{quickCard.cardNumber ? ` · ${quickCard.cardNumber}` : ''}
                      </div>
                    </div>
                    <ChevronDown size={14} className="ml-auto text-slate-400" />
                  </button>
                  {quickPickerOpen && (
                    <div className="absolute z-30 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-xl p-2 space-y-2">
                      <input
                        value={quickSearch}
                        onChange={(e) => setQuickSearch(e.target.value)}
                        placeholder="Type card name, set, or number..."
                        className="w-full bg-slate-50 px-3 py-2 rounded-md border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                      />
                      <div className="max-h-64 overflow-auto divide-y divide-slate-100">
                        {filteredQuickCards.slice(0, 120).map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => {
                              setQuickCardId(c.id);
                              setQuickExpanded(false);
                              setQuickPickerOpen(false);
                            }}
                            className={`w-full text-left px-2 py-2 flex items-center gap-2 hover:bg-slate-50 ${
                              c.id === quickCard.id ? 'bg-blue-50' : ''
                            }`}
                          >
                            {c.localImage ? (
                              <img
                                src={resolveServerUrl(c.localImage)}
                                alt={c.name}
                                className="h-9 w-9 rounded object-cover border border-slate-200"
                                loading="lazy"
                              />
                            ) : (
                              <div className="h-9 w-9 rounded bg-slate-100 border border-slate-200" />
                            )}
                            <div className="min-w-0">
                              <div className="text-[13px] font-semibold text-slate-800 truncate">{c.name}</div>
                              <div className="text-[11px] text-slate-500 truncate">
                                {c.set || 'Unknown set'}{c.cardNumber ? ` · ${c.cardNumber}` : ''}
                              </div>
                            </div>
                          </button>
                        ))}
                        {filteredQuickCards.length === 0 && (
                          <div className="px-2 py-3 text-xs text-slate-500">
                            {quickSearch.trim()
                              ? 'No cards match your search.'
                              : quickCards.length === 0 && filters.portfolioKindScope !== 'all'
                                ? `No ${filters.portfolioKindScope === 'single' ? 'singles' : 'sealed products'} in the current index. Switch to All or adjust filters.`
                                : 'No cards match your search.'}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {(
                    [
                      ['pricecharting', quickPcUrl, 'Open PriceCharting', 'PriceCharting', null],
                      ['ebay', quickEbayUrl, 'Sold / completed listings (comps)', 'eBay', null],
                      [
                        'ebay',
                        quickEbayPurchaseUrl,
                        'Search active listings to buy (lowest price + shipping first)',
                        'eBay',
                        'Buy',
                      ],
                      ['tcgplayer', quickTcgUrl, 'Open TCGPlayer', 'TCGPlayer', null],
                      ['gemrate', quickGemrateUrl, 'Open GemRate', 'GemRate', null],
                    ] as const
                  ).map(([brand, href, linkTitle, label, caption]) => {
                    const linkClass =
                      'inline-flex flex-col items-center justify-center gap-0.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 hover:bg-slate-50';
                    const linkBody = (
                      <>
                        {brand === 'gemrate' ? (
                          <span className="text-[11px] font-semibold text-slate-700">{label}</span>
                        ) : (
                          <BrandLogoImg
                            brand={brand}
                            className="h-[16px] w-auto max-w-[4.2rem] object-contain"
                            title={linkTitle}
                          />
                        )}
                        {caption ? (
                          <span className="text-[9px] font-bold uppercase tracking-wide text-slate-600">
                            {caption}
                          </span>
                        ) : null}
                      </>
                    );
                    return href ? (
                      brand === 'ebay' ? (
                        <EbayExternalLink
                          key={`${label}-${caption ?? 'default'}`}
                          href={String(href)}
                          className={linkClass}
                          title={linkTitle}
                        >
                          {linkBody}
                        </EbayExternalLink>
                      ) : (
                        <a
                          key={`${label}-${caption ?? 'default'}`}
                          href={String(href)}
                          target="_blank"
                          rel="noreferrer"
                          className={linkClass}
                          title={linkTitle}
                        >
                          {linkBody}
                        </a>
                      )
                    ) : (
                      <span
                        key={`${label}-${caption ?? 'default'}`}
                        className="inline-flex flex-col items-center justify-center gap-0.5 rounded-md border border-slate-100 bg-slate-50 px-2.5 py-1.5 text-[11px] font-semibold text-slate-300"
                      >
                        {label}
                        {caption ? (
                          <span className="text-[9px] font-bold uppercase tracking-wide">{caption}</span>
                        ) : null}
                      </span>
                    );
                  })}
                </div>
                <section className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <h4 className="font-black uppercase tracking-widest text-xs text-slate-700 flex items-center gap-2">
                      <BarChart3 size={13} />
                      Market Signals
                    </h4>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="inline-flex items-center gap-1 rounded-xl border border-slate-200/90 bg-gradient-to-b from-white to-slate-50 px-1 py-1 shadow-sm">
                        <span className="px-1 text-[9px] font-bold uppercase tracking-[0.11em] text-slate-500">Mode</span>
                        {([
                          ['raw', 'Raw'],
                          ['graded', 'Graded'],
                        ] as const).map(([id, label]) => (
                          <button
                            key={id}
                            type="button"
                            onClick={() => setQuickSignalScopeMode(id)}
                            className={`px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.11em] rounded-md ${
                              quickSignalScopeMode === id
                                ? 'bg-slate-900 text-white shadow-sm'
                                : 'text-slate-600 hover:text-slate-800 hover:bg-slate-100/70'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      {quickSignalScopeMode === 'graded' && (
                        <>
                          <select
                            value={quickSignalCompany}
                            onChange={(e) => setQuickSignalCompany(e.target.value as GraderCompany)}
                            className="text-[10px] font-semibold uppercase tracking-[0.1em] border border-slate-200 rounded-md px-2 py-1 bg-white"
                          >
                            {quickAvailableCompanies.length ? (
                              quickAvailableCompanies.map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))
                            ) : (
                              <option value={quickSignalCompany}>{quickSignalCompany}</option>
                            )}
                          </select>
                          <select
                            value={quickSignalGradeTag}
                            onChange={(e) => setQuickSignalGradeTag(e.target.value)}
                            className="text-[10px] font-semibold border border-slate-200 rounded-md px-2 py-1 bg-white"
                          >
                            <option value="ALL">All grades</option>
                            {(quickAvailableGradeTagsByCompany.get(quickSignalCompany) ?? []).map((g) => (
                              <option key={g} value={g}>
                                {g}
                              </option>
                            ))}
                          </select>
                        </>
                      )}
                      <div className="inline-flex items-center gap-1 rounded-xl border border-slate-200/90 bg-gradient-to-b from-white to-slate-50 px-1 py-1 shadow-sm">
                        <span className="px-1 text-[9px] font-bold uppercase tracking-[0.11em] text-slate-500">Window</span>
                        {([
                          ['1d', '1D'],
                          ['7d', '7D'],
                          ['30d', '30D'],
                          ['90d', '90D'],
                          ['all', 'All'],
                        ] as const).map(([id, label]) => (
                          <button
                            key={id}
                            type="button"
                            onClick={() => setQuickWindow(id)}
                            className={`px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.11em] rounded-md ${
                              quickWindow === id
                                ? 'bg-slate-900 text-white shadow-sm'
                                : 'text-slate-600 hover:text-slate-800 hover:bg-slate-100/70'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <div
                        className="inline-flex flex-wrap items-center gap-1.5 rounded-xl border border-amber-200/90 bg-gradient-to-b from-amber-50/90 to-amber-100/40 px-2 py-1 shadow-sm"
                        title="eBay sold comps: same filters as chart &amp; eBay view"
                      >
                        <BrandLogoImg
                          brand="ebay"
                          className="h-[12px] w-auto max-w-[2.4rem] object-contain"
                          title="eBay"
                        />
                        <select
                          value={quickEbayTitleStampFilter}
                          onChange={(e) =>
                            setQuickEbayTitleStampFilter(e.target.value as EbayTitleStampFilter)
                          }
                          className="max-w-[6rem] rounded-md border border-amber-200/80 bg-white px-1.5 py-0.5 text-[9px] font-semibold text-amber-950"
                        >
                          <option value="all">All PC</option>
                          <option value="stamp">PC only</option>
                          <option value="no_stamp">No PC</option>
                        </select>
                        <select
                          value={quickEbayTitleSealedFilter}
                          onChange={(e) =>
                            setQuickEbayTitleSealedFilter(e.target.value as EbayTitleSealedFilter)
                          }
                          className="max-w-[6rem] rounded-md border border-amber-200/80 bg-white px-1.5 py-0.5 text-[9px] font-semibold text-amber-950"
                        >
                          <option value="all">Sealed: all</option>
                          <option value="sealed">Sealed</option>
                          <option value="not_sealed">Not seal.</option>
                        </select>
                      </div>
                      <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white/80 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.11em] text-slate-500">
                        {quickSignalScopeMode === 'graded'
                          ? `Scope: ${quickSignalCompany}${quickSignalGradeTag !== 'ALL' ? ` ${quickSignalGradeTag}` : ''}`
                          : 'Scope: Raw'}
                        <span className="text-amber-900/85 font-bold"> · eBay comps: {quickEbayTitleFilterLabel}</span>
                      </span>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                    {quickSignalTags.map((t, idx) => {
                      const good = t.tone === 'good';
                      const bad = t.tone === 'bad';
                      const isSpikeCard = /anomaly spike flag/i.test(String(t.kpi || ''));
                      const spikeAlert = isSpikeCard && /\b(HIGH|WATCH)\b/i.test(String(t.label || ''));
                      const directionIcon = spikeAlert ? (
                        <ArrowUp size={15} />
                      ) : good ? (
                        <ArrowUp size={14} />
                      ) : bad ? (
                        <ArrowDown size={14} />
                      ) : (
                        <Minus size={14} />
                      );
                      const directionPillCls = spikeAlert
                        ? 'border-rose-300 bg-rose-100/90 text-rose-800'
                        : good
                          ? 'border-emerald-300 bg-emerald-100/90 text-emerald-800'
                          : bad
                            ? 'border-rose-300 bg-rose-100/90 text-rose-800'
                            : 'border-slate-300 bg-slate-100/90 text-slate-700';
                      const parts = String(t.label || '')
                        .split('·')
                        .map((p) => p.trim())
                        .filter(Boolean);
                      const headline = parts[0] || t.label;
                      const minor = parts.slice(1).join(' · ');
                      const detailRows = String(t.detail || 'Signal derived from current scope')
                        .split('|')
                        .map((x) => x.trim())
                        .filter(Boolean);
                      const toInlineChips = (text: string): string[] => {
                        const chips: string[] = [];
                        const scope = text.match(/Scope:\s*([^·]+)/i);
                        if (scope?.[1]) chips.push(`Scope ${scope[1].trim()}`);
                        const window = text.match(/\((\d+D|All)\)/i);
                        if (window?.[1]) chips.push(`Window ${window[1].toUpperCase()}`);
                        const comps = text.match(/eBay comps:\s*(.+)$/i);
                        if (comps?.[1]) chips.push(`eBay ${comps[1].trim()}`);
                        const baseline = text.match(/(?:median|baseline):\s*([^·]+)/i);
                        if (baseline?.[1]) chips.push(`Basis ${baseline[1].trim()}`);
                        if (!chips.length) {
                          const toks = text
                            .split(/[\u00b7,:]/)
                            .map((x) => x.trim())
                            .filter((x) => x.length >= 4)
                            .slice(0, 3);
                          return toks;
                        }
                        return chips.slice(0, 4);
                      };
                      return (
                        <div
                          key={`${t.label}-${idx}`}
                          title={t.detail || t.label}
                          className={`rounded-2xl border px-5 py-4.5 shadow-sm transition-all min-h-[170px] ${
                            spikeAlert
                              ? 'border-rose-300 ring-1 ring-rose-200 bg-gradient-to-b from-rose-50/90 to-rose-50/35'
                              : good
                                ? 'border-emerald-200 bg-gradient-to-b from-emerald-50/75 to-emerald-50/35'
                                : bad
                                  ? 'border-rose-200 bg-gradient-to-b from-rose-50/75 to-rose-50/35'
                                  : 'border-slate-200 bg-gradient-to-b from-slate-50/80 to-white'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-200/70">
                            <div className="inline-flex items-center gap-1">
                              <div className="inline-flex items-center rounded-full border border-slate-200/90 bg-white/70 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-600">
                                {t.kpi}
                              </div>
                              {spikeAlert && (
                                <div className="inline-flex items-center rounded-full border border-rose-300 bg-rose-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] text-rose-800">
                                  Alert
                                </div>
                              )}
                            </div>
                            <div className={`inline-flex items-center ${spikeAlert ? 'text-rose-700' : good ? 'text-emerald-700' : bad ? 'text-rose-700' : 'text-slate-500'}`}>
                              {directionIcon}
                            </div>
                          </div>
                          <div
                            className={`mt-3 text-[30px] leading-[1.02] font-black tracking-tight ${
                              spikeAlert
                                ? 'text-rose-900'
                                : good
                                  ? 'text-emerald-900'
                                  : bad
                                    ? 'text-rose-900'
                                    : 'text-slate-900'
                            }`}
                          >
                            {headline}
                          </div>
                          {minor && (
                            <div className="mt-2 inline-flex items-center rounded-md bg-white/85 px-2.5 py-0.5 text-[12px] font-semibold text-slate-700">
                              {minor}
                            </div>
                          )}
                          <div className={`mt-3 rounded-xl border px-3 py-2.5 ${spikeAlert ? 'border-rose-200 bg-white/90' : 'border-slate-200 bg-white/85'}`}>
                            <div className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.11em] ${directionPillCls}`}>
                              {directionIcon}
                              <span>{spikeAlert ? 'High attention' : good ? 'Positive signal' : bad ? 'Risk signal' : 'Neutral signal'}</span>
                            </div>
                            <div className="mt-2 grid grid-cols-[auto,1fr] gap-x-2 gap-y-1 text-[12px] leading-snug text-slate-700">
                              {detailRows.map((row, i) => {
                                const like = row.match(
                                  /Likelihood up\/down\/flat:\s*(\d+)%\s*\/\s*(\d+)%\s*\/\s*(\d+)%/i
                                );
                                return (
                                  <div key={`${t.kpi}-${i}`} className="contents">
                                    <span className="font-bold text-slate-500 uppercase tracking-[0.08em]">
                                      {i === 0 ? 'Context' : i === 1 ? 'Drivers' : 'Notes'}
                                    </span>
                                    {!like ? (
                                      <span className="inline-flex flex-wrap items-center gap-1.5">
                                        {toInlineChips(row).map((chip, ci) => (
                                          <span
                                            key={`${t.kpi}-${i}-chip-${ci}`}
                                            className="inline-flex items-center rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-700"
                                          >
                                            {chip}
                                          </span>
                                        ))}
                                      </span>
                                    ) : (
                                      <span className="inline-flex flex-wrap items-center gap-1.5">
                                        <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                                          Up {like[1]}%
                                        </span>
                                        <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-800">
                                          Down {like[2]}%
                                        </span>
                                        <span className="inline-flex items-center rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                                          Flat {like[3]}%
                                        </span>
                                      </span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {!quickIsCompact && quickPlatformSalesPace && quickPlatformSalesPace.length > 0 && (
                    <div className="mt-3 rounded-2xl border border-slate-200/90 bg-gradient-to-b from-white via-slate-50/60 to-slate-100/35 px-3 py-2.5 shadow-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="inline-flex items-center rounded-full border border-slate-200 bg-white/85 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-slate-700">
                          Sales pace
                        </div>
                        <div className="inline-flex items-center rounded-full border border-slate-200/80 bg-white/80 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.11em] text-slate-500">
                          Rolling windows (1/3/7/14/30d)
                        </div>
                      </div>
                      <p className="mt-1 text-[10px] leading-tight text-slate-600">
                        Anchored to the latest timestamp across PC / TCG / eBay. eBay uses the same stamp/sealed filters
                        and Raw vs Graded scope.
                      </p>
                      <div className="mt-2 overflow-x-auto">
                        <table className="w-full min-w-[320px] text-[11px] text-slate-800">
                          <thead>
                            <tr className="text-left border-b border-slate-200">
                              <th className="py-1.5 pr-2">
                                <span className="inline-flex rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-600">
                                  Window
                                </span>
                              </th>
                              <th className="py-1.5 pr-2">
                                <span className="inline-flex items-center rounded-md bg-cyan-50 px-1.5 py-0.5 ring-1 ring-cyan-100">
                                  <BrandLogoImg
                                    brand="pricecharting"
                                    className="h-[14px] w-auto max-w-[3.4rem] object-contain"
                                    title="PriceCharting"
                                  />
                                </span>
                              </th>
                              <th className="py-1.5 pr-2">
                                <span className="inline-flex items-center rounded-md bg-blue-50 px-1.5 py-0.5 ring-1 ring-blue-100">
                                  <BrandLogoImg
                                    brand="tcgplayer"
                                    className="h-[14px] w-auto max-w-[3.4rem] object-contain"
                                    title="TCGPlayer"
                                  />
                                </span>
                              </th>
                              <th className="py-1.5 pr-2">
                                <span className="inline-flex items-center rounded-md bg-amber-50 px-1.5 py-0.5 ring-1 ring-amber-100">
                                  <BrandLogoImg
                                    brand="ebay"
                                    className="h-[14px] w-auto max-w-[2.8rem] object-contain"
                                    title="eBay"
                                  />
                                </span>
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {quickPlatformSalesPace.map((row, idx) => (
                              <tr
                                key={row.days}
                                className={`border-b border-slate-100/90 last:border-0 ${
                                  idx % 2 === 0 ? 'bg-white/45' : 'bg-slate-50/35'
                                }`}
                              >
                                <td className="py-1.5 pr-2">
                                  <span className="inline-flex min-w-[2.5rem] justify-center rounded-md border border-slate-200 bg-white px-1.5 py-0.5 font-mono font-semibold text-slate-700">
                                    {row.days}d
                                  </span>
                                </td>
                                <td className="py-1.5 pr-2 font-black tabular-nums text-cyan-900">{row.pc}</td>
                                <td className="py-1.5 pr-2 font-black tabular-nums text-blue-900">{row.tcg}</td>
                                <td className="py-1.5 pr-2 font-black tabular-nums text-amber-900">{row.ebay}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </section>
                {quickIsCompact && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[11px] text-slate-600">
                      Compact view: core pricing only. Expand to drill into the full signal grid, pacing windows, and math details.
                    </p>
                    <button
                      type="button"
                      onClick={() => setQuickExpanded(true)}
                      className="px-2.5 py-1.5 rounded-md text-[10px] font-black uppercase tracking-[0.11em] border border-slate-300 bg-white hover:bg-slate-100"
                    >
                      Show More Detail
                    </button>
                  </div>
                )}
                <div className={`grid gap-3 ${quickSignalScopeMode === 'graded' ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-3'}`}>
                  {(quickIsCompact ? quickTopCards.slice(0, 1) : quickTopCards).map((m) => {
                    if (!m) return null;
                    const tcgMarketDisplay =
                      m.brand === 'tcgplayer' &&
                      typeof quickCard?.tcgplayerSummary?.marketPrice === 'number' &&
                      Number.isFinite(quickCard.tcgplayerSummary.marketPrice)
                        ? quickCard.tcgplayerSummary.marketPrice
                        : null;
                    const ebayAcceptedAvg =
                      m.brand === 'ebay' && quickMarketMoves?.ebay?.scopedSeries?.length
                        ? quickMarketMoves.ebay.scopedSeries.reduce((sum, p) => sum + p.price, 0) /
                          quickMarketMoves.ebay.scopedSeries.length
                        : null;
                    const ebayLastSale =
                      m.brand === 'ebay' &&
                      typeof quickMarketMoves?.ebay?.current === 'number' &&
                      Number.isFinite(quickMarketMoves.ebay.current)
                        ? quickMarketMoves.ebay.current
                        : null;
                    const ebayLast5Prices =
                      m.brand === 'ebay'
                        ? quickEbayRowsForSignalScope
                            .slice(0, 5)
                            .map((r) => r.price)
                            .filter((p): p is number => Number.isFinite(p) && p > 0)
                        : [];
                    const cardMainValue = ebayAcceptedAvg ?? tcgMarketDisplay ?? m.current;
                    const tcgQty =
                      m.brand === 'tcgplayer'
                        ? (quickCard?.tcgplayerSalesSnapshot?.pricePoints.currentQuantity ??
                          quickCard?.tcgplayerSummary?.listings ??
                          null)
                        : null;
                    const tcgSellers =
                      m.brand === 'tcgplayer'
                        ? (quickCard?.tcgplayerSalesSnapshot?.pricePoints.currentSellers ??
                          quickCard?.tcgplayerSummary?.sellers ??
                          null)
                        : null;
                    const up = typeof m.pct === 'number' && m.pct > 0.2;
                    const down = typeof m.pct === 'number' && m.pct < -0.2;
                    const deltaText =
                      typeof m.pct === 'number' ? `${m.pct >= 0 ? '+' : ''}${m.pct.toFixed(2)}%` : 'No recent delta';
                    const dateRange =
                      m.rangeStart && m.rangeEnd
                        ? `${new Date(m.rangeStart).toLocaleDateString()} - ${new Date(m.rangeEnd).toLocaleDateString()}`
                        : 'No range';
                    const pace30 = quickPlatformSalesPace?.find((p) => p.days === 30);
                    return (
                      <div
                        key={m.label}
                        className="rounded-xl border border-slate-200 bg-gradient-to-b from-white to-slate-50 px-3.5 py-3 shadow-sm"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="inline-flex items-center gap-2 min-w-0">
                            <BrandLogoImg
                              brand={m.brand}
                              className="h-[24px] w-auto max-w-[5.8rem] object-contain shrink-0"
                              title={m.label}
                            />
                            <span className="text-[10px] uppercase tracking-[0.11em] text-slate-500 font-semibold truncate">
                              {m.label}
                            </span>
                          </div>
                          <div
                            className={`inline-flex items-center gap-1 text-[12px] font-semibold ${
                              up ? 'text-emerald-700' : down ? 'text-rose-700' : 'text-slate-500'
                            }`}
                            title="2-point delta using latest two observations"
                          >
                            {up ? <ArrowUp size={13} /> : down ? <ArrowDown size={13} /> : <Minus size={13} />}
                            {deltaText}
                          </div>
                        </div>
                        <div className="mt-2 text-2xl font-black tracking-tight text-slate-900 tabular-nums">
                          {typeof cardMainValue === 'number' ? fmtMoney(cardMainValue) : '—'}
                        </div>
                        <div className="mt-1 text-[11px] text-slate-500 tabular-nums">
                          {m.brand === 'ebay'
                            ? `Last sale: ${typeof ebayLastSale === 'number' ? fmtMoney(ebayLastSale) : '—'}`
                            : `Prev: ${typeof m.previous === 'number' ? fmtMoney(m.previous) : '—'}`}
                        </div>
                        <div className="mt-2 rounded-lg border border-slate-200 bg-white/80 px-2 py-1.5 text-[10px] text-slate-600">
                          <div className="font-semibold uppercase tracking-[0.11em] text-slate-500">Math scope</div>
                          {m.brand === 'ebay' && (
                            <div className="text-amber-900/90 mb-0.5">
                              eBay comps: <span className="font-semibold">{quickEbayTitleFilterLabel}</span>
                              {' · '}
                              <span
                                className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.11em] ${
                                  (m as { dataQuality?: 'parsed' | 'fallback' }).dataQuality === 'fallback'
                                    ? 'border-amber-300 bg-amber-100 text-amber-900'
                                    : 'border-emerald-300 bg-emerald-100 text-emerald-900'
                                }`}
                                title="Timestamp quality used for eBay market-signal math"
                              >
                                timing:{' '}
                                {(m as { dataQuality?: 'parsed' | 'fallback' }).dataQuality === 'fallback'
                                  ? 'fallback'
                                  : 'parsed'}
                              </span>
                            </div>
                          )}
                          {m.brand === 'ebay' && (
                            <>
                              <div>
                                Accepted avg ({m.windowLabel}):{' '}
                                <span className="font-semibold tabular-nums">
                                  {typeof ebayAcceptedAvg === 'number' ? fmtMoney(ebayAcceptedAvg) : '—'}
                                </span>
                              </div>
                              <div>
                                Last sale:{' '}
                                <span className="font-semibold tabular-nums">
                                  {typeof ebayLastSale === 'number' ? fmtMoney(ebayLastSale) : '—'}
                                </span>
                              </div>
                              <div className="text-slate-700">
                                Last 5 sold:{' '}
                                <span className="font-semibold tabular-nums">
                                  {ebayLast5Prices.length
                                    ? ebayLast5Prices.map((p) => fmtMoney(p)).join(' · ')
                                    : '—'}
                                </span>
                              </div>
                            </>
                          )}
                          <div>Data points: <span className="font-semibold text-slate-800">{m.points}</span></div>
                          {m.brand === 'ebay' &&
                            (quickCard?.ebayExtensionSnapshot?.rowCount ?? 0) > m.points + 2 && (
                              <div className="text-[9px] text-slate-400 leading-tight">
                                {quickCard?.ebayExtensionSnapshot?.rowCount ?? 0} rows captured · {m.points} in{' '}
                                {quickWindow} window
                              </div>
                            )}
                          <div>Date range: <span className="font-medium text-slate-700">{dateRange}</span></div>
                          {pace30 && (
                            <div className="text-slate-700">
                              Pace (30d):{' '}
                              <span className="font-mono font-bold">
                                {m.brand === 'pricecharting'
                                  ? pace30.pc
                                  : m.brand === 'tcgplayer'
                                    ? pace30.tcg
                                    : pace30.ebay}
                              </span>{' '}
                              <span className="text-slate-500">points</span>
                            </div>
                          )}
                          {m.brand === 'tcgplayer' &&
                            ((typeof tcgQty === 'number' && Number.isFinite(tcgQty)) ||
                              (typeof tcgSellers === 'number' && Number.isFinite(tcgSellers))) && (
                              <div>
                                Current qty/sellers:{' '}
                                <span className="font-medium text-slate-700">
                                  {typeof tcgQty === 'number' && Number.isFinite(tcgQty)
                                    ? Math.round(tcgQty).toLocaleString()
                                    : '—'}
                                  {' / '}
                                  {typeof tcgSellers === 'number' && Number.isFinite(tcgSellers)
                                    ? Math.round(tcgSellers).toLocaleString()
                                    : '—'}
                                </span>
                              </div>
                            )}
                          <div className="text-slate-500">Delta basis: {m.basisLabel} ({m.windowLabel})</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {quickError && (
                  <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-2 py-1">
                    {quickError}
                  </p>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 overflow-hidden">
                {quickTab === 'math' ? (
                  <div className="p-3 bg-slate-50/60">
                    <ExpandedDetail
                      card={quickCard}
                      fees={fees}
                      psaToken={psaToken}
                      collections={collections}
                      onFieldChange={updateCardField}
                      onFetchPsaPop={() => fetchPsaPop(quickCard.id)}
                      onApplyPsaProbs={() => applyPsaProbs(quickCard.id)}
                    />
                  </div>
                ) : quickTab === 'archived' ? (
                  <div className="p-4 bg-white">
                    <EbayVerificationArchivePanel card={quickCard} onFieldChange={updateCardField} />
                  </div>
                ) : (
                  <OverviewMarketSalesSection
                    card={quickCard}
                    formatRelative={formatRelative}
                    onFieldChange={updateCardField}
                    viewMode={quickTab}
                    hidePcRawHistoryChart
                    grandScopeMode={quickSignalScopeMode}
                    grandScopeGrader={quickSignalScopeMode === 'graded' ? quickSignalCompany : null}
                    grandScopeGradeTag={quickSignalScopeMode === 'graded' ? quickSignalGradeTag : 'ALL'}
                    ebayTitleFiltersControl={{
                      stamp: quickEbayTitleStampFilter,
                      sealed: quickEbayTitleSealedFilter,
                      onStampChange: setQuickEbayTitleStampFilter,
                      onSealedChange: setQuickEbayTitleSealedFilter,
                      language: quickListingLanguageFilter,
                      photosOnly: quickPhotosOnly,
                      hideSuspicious: quickHideSuspiciousLanguageRows,
                      onLanguageChange: setQuickListingLanguageFilter,
                      onPhotosOnlyChange: setQuickPhotosOnly,
                      onHideSuspiciousChange: setQuickHideSuspiciousLanguageRows,
                    }}
                  />
                )}
              </div>
            </div>

            <SealedQuickPanels
              card={quickCard}
              fees={fees}
              onFieldChange={updateCardField}
              onImportGalleryItemsAsSingles={importGalleryItemsAsSingles}
            />

            <QuickPriceSidebar
              open={quickSidebarOpen}
              hiddenDefault={quickSidebarHiddenDefault}
              onToggleOpen={setQuickSidebarOpen}
              onChangeHiddenDefault={setQuickSidebarHiddenDefault}
              quickTopCards={quickSidebarCards}
              summary={quickSidebarSummary}
              formatMoney={fmtMoney}
            />

            {quickExpanded && quickTab !== 'math' && quickTab !== 'archived' && (
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                <ExpandedDetail
                  card={quickCard}
                  fees={fees}
                  psaToken={psaToken}
                  collections={collections}
                  onFieldChange={updateCardField}
                  onFetchPsaPop={() => fetchPsaPop(quickCard.id)}
                  onApplyPsaProbs={() => applyPsaProbs(quickCard.id)}
                />
              </div>
            )}
          </div>
        )}

        {workspacePage === 'streamer' && !quickCard && (
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-8 md:p-10 text-center space-y-3">
            <h3 className="text-sm font-black uppercase tracking-[0.12em] text-slate-700">Streamer Mode</h3>
            <p className="text-sm text-slate-600 font-medium max-w-lg mx-auto">
              {quickCards.length === 0 && filters.portfolioKindScope !== 'all'
                ? `No ${filters.portfolioKindScope === 'single' ? 'singles' : 'sealed products'} in the current index. Switch portfolio scope to All or adjust filters, then pick a card from Quick Card.`
                : quickCards.length === 0
                  ? 'No cards match the current filters. Add a card or widen filters to use Streamer Mode.'
                  : 'Select a card from your portfolio (open Quick Card and pick one) to show the streamer layout.'}
            </p>
          </div>
        )}

        {workspacePage === 'streamer' && quickCard && (
          <StreamerModePanel
            card={quickCard}
            topCards={[...streamerTopCards]}
            ebayScatter={streamerEbayScatterPoints}
            tcgScatter={streamerTcgScatterPoints}
            formatMoney={fmtMoney}
            links={streamerLinks}
            quickCards={quickCards}
            filteredQuickCards={filteredQuickCards}
            quickSearch={quickSearch}
            onQuickSearchChange={setQuickSearch}
            onSelectCard={(id) => {
              setQuickCardId(id);
              setQuickExpanded(false);
            }}
            onPrev={streamerGoPrev}
            onNext={streamerGoNext}
            skinId={streamerSkinId}
            onSkinIdChange={handleStreamerSkinChange}
          />
        )}

        {workspacePage === 'admin' && (
          <AdminControlPanel
            adminSection={adminSection}
            onAdminSectionChange={setAdminSection}
            settingsProps={{
              fees,
              setFees,
              onResetFees: () => setFees(DEFAULT_FEES),
              psaToken,
              setPsaToken,
              googleCseKey,
              setGoogleCseKey,
              googleCseCx,
              setGoogleCseCx,
              syncStatus,
              lastSavedAt,
              onExport: handleExportPortfolio,
              onExportCardsNdjson: handleExportCardsNdjson,
              onImport: handleImportPortfolio,
              onImportCollection: handleImportCollectionFile,
              importProgress: collectionImportProgress,
              importIssues: collectionImportIssues,
              onRetryFailedImport: retryFailedCollectionImport,
              onExportImportIssues: exportCollectionImportIssues,
              onExportRetryFile: exportRetryCollectionCsv,
              extensionLatestOnlyMode,
              onExtensionLatestOnlyModeChange: setExtensionLatestOnlyMode,
              portfolioKindScope: filters.portfolioKindScope,
              onPortfolioKindScopeChange: (v) =>
                setFilters((f) => ({ ...f, portfolioKindScope: v })),
              quickFetchTiming: quickFetchTimingStore.timing,
              onQuickFetchTimingFieldChange: setQuickFetchTimingField,
              onResetQuickFetchTimingDefaults: resetQuickFetchTimingDefaults,
              quickCardAdminSettings,
              onQuickCardAdminSettingsChange: patchQuickCardAdminSettings,
              streamerSkinId,
              onStreamerSkinIdChange: handleStreamerSkinChange,
              onGoogleCseKeysSaved,
            }}
            adminBusy={adminBusy}
            adminError={adminError}
            adminStats={adminStats}
            onRefreshStats={loadAdminStats}
            onEbayTitleBackfill={runEbayTitleBackfill}
            onRepairPricechartingLinks={runRepairPricechartingLinks}
            onRebuildPricechartingStats={runRebuildPricechartingStats}
            onRunRotatingBackup={runRotatingPortfolioBackup}
          />
        )}

        {workspacePage === 'master' && (
          <Toolbar
            filters={filters}
            setFilters={setFilters}
            sort={sort}
            setSort={setSort}
            collections={collections}
            portfolioCards={toolbarCards}
            onToggleCollection={toggleCollectionFilter}
            onManageCollections={() => setShowCollections((v) => !v)}
            showCollections={showCollections}
            visibleCount={visible.length}
            totalCount={
              serverPagedPortfolio ? serverTotals?.count ?? gridTotal : enriched.length
            }
            onRefreshAll={refreshAll}
            bulkRefresh={bulkRefresh}
            onRefreshAllEbay={refreshAllEbay}
            bulkEbayRefresh={bulkEbayRefresh}
            refreshableCount={cards.filter((c) => c.url).length}
            ebayRefreshableCount={cards.length}
            profitLensLabels={PROFIT_LENS_LABELS}
          />
        )}

        {workspacePage === 'master' && showCollections && (
          <CollectionManager
            collections={collections}
            cards={serverPagedPortfolio ? collectionCountCards ?? cards : cards}
            onCreate={createCollection}
            onUpdate={updateCollection}
            onDelete={deleteCollection}
            onClose={() => setShowCollections(false)}
            palette={COLLECTION_PALETTE}
          />
        )}
      </div>

      {workspacePage === 'master' && (
        <div className="w-full max-w-none mt-6 mb-12">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-6 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
            <h3 className="font-black text-slate-800 uppercase tracking-widest text-sm flex items-center gap-2 flex-wrap">
              <Info size={16} /> Master List &middot; {visible.length}
              {serverPagedPortfolio ? (
                <span className="text-slate-400 font-semibold normal-case tracking-normal">
                  {' '}
                  (rows{' '}
                  {gridTotal === 0 ? 0 : gridOffset + 1}
                  –
                  {Math.min(gridOffset + visible.length, gridTotal)} of {gridTotal})
                </span>
              ) : (
                filterActive && (
                  <span className="text-slate-400 font-semibold normal-case tracking-normal">
                    {' '}of {enriched.length}
                  </span>
                )
              )}{' '}
              cards
            </h3>
            <span className="text-xs text-slate-400 font-semibold">Click a row to expand details</span>
          </div>
          {bulkSelectedCardIds.length > 0 && (
            <div className="px-6 py-2.5 bg-amber-50/90 border-b border-amber-200/80 flex flex-wrap items-center gap-2 text-[11px]">
              <span className="font-black text-amber-950/90">
                {bulkSelectedCardIds.length} card{bulkSelectedCardIds.length === 1 ? '' : 's'}
              </span>
              <span className="text-amber-900/80">eBay on selection:</span>
              <button
                type="button"
                onClick={() => bulkSetEbayTagFields({ pokemonCenterStamp: true })}
                className="font-bold uppercase tracking-wide px-2.5 py-1 rounded-md border border-amber-300 bg-white text-amber-900 hover:bg-amber-100/80"
              >
                PC on
              </button>
              <button
                type="button"
                onClick={() => bulkSetEbayTagFields({ pokemonCenterStamp: false })}
                className="font-bold uppercase tracking-wide px-2.5 py-1 rounded-md border border-amber-300 bg-white text-amber-900 hover:bg-amber-100/80"
              >
                PC off
              </button>
              <button
                type="button"
                onClick={() => bulkSetEbayTagFields({ sealedInTitle: true })}
                className="font-bold uppercase tracking-wide px-2.5 py-1 rounded-md border border-amber-300 bg-white text-amber-900 hover:bg-amber-100/80"
              >
                Sealed on
              </button>
              <button
                type="button"
                onClick={() => bulkSetEbayTagFields({ sealedInTitle: false })}
                className="font-bold uppercase tracking-wide px-2.5 py-1 rounded-md border border-amber-300 bg-white text-amber-900 hover:bg-amber-100/80"
              >
                Sealed off
              </button>
              <button
                type="button"
                onClick={bulkArchiveEbayComps}
                className="font-bold uppercase tracking-wide px-2.5 py-1 rounded-md border border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
                title="Pushes every captured eBay comp row (active + restored queue) into Archived for each selected card with extension data"
              >
                Archive eBay comps
              </button>
              <button
                type="button"
                onClick={clearBulkSelect}
                className="ml-auto text-[10px] font-bold text-amber-800/90 underline-offset-2 hover:underline"
              >
                Clear selection
              </button>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[86rem] text-left text-[13px]">
              <thead>
                <tr className="text-[10px] uppercase font-black tracking-[0.14em] text-slate-500 border-b border-slate-100 bg-white">
                  <th className="w-7 px-0.5 py-4" title="Select rows for bulk eBay actions">
                    <input
                      type="checkbox"
                      className="rounded border-slate-300"
                      checked={allVisibleSelected}
                      onChange={selectAllVisibleInMaster}
                      disabled={visible.length === 0}
                      aria-label="Select all visible cards"
                    />
                  </th>
                  <th className="px-2 py-4 w-10"></th>
                  <th className="px-2 py-4 w-[6.75rem] min-w-[6.75rem]"></th>
                  <HeaderCell
                    label="Card"
                    align="left"
                    tip="Name, set, release dates (from PriceCharting when scraped). The colored dot marks its monitored collection."
                  />
                  <HeaderCell
                    label="Links"
                    align="center"
                    tip="PriceCharting product (when URL is stored), eBay search from name/set/number, and TCGplayer product when you have saved a product URL."
                  />
                  <HeaderCell
                    label="Sig"
                    align="center"
                    tip="Custom signals: must grade (clipboard), good catch (Pokéball = paid under raw), hold (diamond), must sell (Pokéball + $). Aligned with Nebula classify + simple deal heuristics."
                  />
                  <HeaderCell
                    label="Raw"
                    align="right"
                    tip="PC ungraded (green) / TCGplayer market (blue) when you have loaded a product URL. Arrow + % uses prior UTC day baseline first; then falls back to history/sales/refresh comparisons if needed."
                  />
                  <HeaderCell label="Paid" align="right" tip="What YOU actually paid for this copy. Drives the invested calculation; defaults to Raw when unset. Click to edit." />
                  <HeaderCell label="Ship" align="right" tip="Inbound shipping paid to receive the card. Click to edit, or toggle FREE with the button." />
                  <HeaderCell label="G9" align="right" tip="PSA 9 market price. Used as the sale price in the PSA 9 outcome branch." />
                  <HeaderCell label="PSA 10" align="right" tip="PSA 10 market price. Used as the sale price in the PSA 10 outcome branch." />
                  <HeaderCell label="Potential" align="right" tip="Your estimated grade target value. Set from the expanded card's Estimated Grade selector (pulls from PriceCharting grade matrix)." />
                  <HeaderCell
                    label="GR P10"
                    align="center"
                    tip={
                      'GemRate PSA 10 share: % of PSA-graded copies that are PSA 10 (population). When PSA totals are missing, shows Universal Gems+ % with a U marker. Fetched from GemRate via the server.'
                    }
                  />
                  <HeaderCell label="P10" align="center" tip={"Your estimated probability the card grades PSA 10. Editable per row. PSA fail probability = 1 \u2212 P10 \u2212 P9."} />
                  <HeaderCell label="P9" align="center" tip="Your estimated probability the card grades PSA 9. Editable per row." />
                  <HeaderCell label="Inv." align="right" tip="Total cost basis per card: Paid + inbound shipping + grading fee + outbound shipping to the grader. Set global fees under Admin → Configuration." highlight />
                  <HeaderCell label="EV" align="right" tip={"Expected Value: P10 \u00b7 net(PSA 10) + P9 \u00b7 net(PSA 9) + Pfail \u00b7 net(fail). Positive = profitable on average, negative = loses money on average."} />
                  <HeaderCell label="ROI" align="right" tip="Return on investment: EV divided by total invested, as a percent. Lets you compare cards of different cost basis fairly." />
                  <th className="px-3 py-4 text-right w-12"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 font-medium">
                {visible.map((c) => {
                  const isOpen = expanded.has(c.id);
                  return (
                    <FragmentRow
                      key={c.id}
                      card={c}
                      fees={fees}
                      collections={collections}
                      isOpen={isOpen}
                      psaToken={psaToken}
                      isRefreshing={refreshingIds.has(c.id)}
                      isRefreshingEbay={refreshingEbayIds.has(c.id)}
                      refreshApplied={refreshAppliedById[c.id] ?? null}
                      bulkSelected={bulkSelectedSet.has(c.id)}
                      onToggle={() => toggleExpanded(c.id)}
                      onToggleBulk={() => toggleBulkSelectCard(c.id)}
                      onDelete={() => deleteCard(c.id)}
                      onRefresh={() => handleRefreshCard(c.id)}
                      onRefreshEbay={() => handleRefreshEbayCard(c.id)}
                      onFieldChange={updateCardField}
                      onFetchPsaPop={() => fetchPsaPop(c.id)}
                      onApplyPsaProbs={() => applyPsaProbs(c.id)}
                      renderPaidCell={() => <PaidCell card={c} onFieldChange={updateCardField} />}
                      renderShipCell={() => <ShipCell card={c} onFieldChange={updateCardField} />}
                      renderGemRateCell={() => (
                        <td className="px-2 py-4 text-center">
                          <GemRateP10TableCell card={c} onFieldChange={updateCardField} />
                        </td>
                      )}
                      ExpandedDetailComponent={ExpandedDetail}
                    />
                  );
                })}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={19} className="px-4 py-12 text-center text-slate-400">
                      {(serverPagedPortfolio ? gridTotal === 0 : enriched.length === 0) ? (
                        <>No cards yet. Click <strong>Add Card</strong> to start.</>
                      ) : (
                        <>
                          No cards match the current filters.{' '}
                          <button
                            className="font-bold text-blue-600 hover:underline"
                            onClick={() => setFilters(EMPTY_FILTERS)}
                          >
                            Clear filters
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {serverPagedPortfolio && gridTotal > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 bg-white border-t border-slate-100">
              <span className="text-xs text-slate-500 font-medium">
                Page size {MASTER_GRID_PAGE_SIZE}. Rows with unsaved edits pause remote refresh polling until sync completes.
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={gridOffset <= 0}
                  onClick={() => void loadMasterGridAtOffset(Math.max(0, gridOffset - MASTER_GRID_PAGE_SIZE))}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 bg-slate-50 hover:bg-slate-100 disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={gridOffset + MASTER_GRID_PAGE_SIZE >= gridTotal}
                  onClick={() => void loadMasterGridAtOffset(gridOffset + MASTER_GRID_PAGE_SIZE)}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 bg-slate-50 hover:bg-slate-100 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}
          </div>
        </div>
      )}

      {workspacePage === 'strategies' && (
        <SellStrategyView
          cards={strategiesVisible}
          collections={collections}
          sellCollectionId={defaultBinIds.sellId}
          holdCollectionId={defaultBinIds.holdId}
          autoPopulateMode={autoPopulateMode}
          onAutoPopulateModeChange={setAutoPopulateMode}
          onRunAutoPopulate={autoPopulateBins}
          onAssignCollection={(cardId, collectionId) =>
            updateCardField(cardId, 'collectionId', collectionId as Card['collectionId'])
          }
        />
      )}

      {workspacePage === 'starChart' && (
        <div className="w-full max-w-none mt-6 mb-12">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden p-4">
            <div className="mb-3">
              <h3 className="font-black text-slate-800 uppercase tracking-widest text-sm">Star Chart</h3>
              <p className="text-xs text-slate-500 font-medium">
                Visual constellation map of your portfolio signals.
              </p>
            </div>
            <div className="overflow-auto">
              <NebulaView
                cards={strategiesVisible}
                onSelect={(cardId) => {
                  setQuickCardId(cardId);
                  setWorkspacePage('quick');
                }}
              />
            </div>
          </div>
        </div>
      )}

      <footer className="mt-10 pt-6 pb-2 border-t border-slate-200 text-center">
        <p className="text-[11px] font-semibold text-slate-400 tracking-wide">
          Powered by{' '}
          <span className="text-slate-700 font-black tracking-tight">RawGraded</span>
          {' · '}
          <a
            href="https://rawgraded.com/privacy-policy.html#raw-investor"
            target="_blank"
            rel="noopener noreferrer"
            className="text-slate-500 hover:text-slate-700 underline underline-offset-2"
          >
            Privacy Policy
          </a>
        </p>
      </footer>
      <FirstLaunchMarketplaceNotice hydrated={hydrated} />
      <QuickFetchMarketplacePreflight
        open={quickFetchMarketPreflight != null}
        kind={quickFetchMarketPreflight?.kind ?? 'generic'}
        onContinue={() => resolveQuickFetchMarketPreflight('continue')}
        onStop={() => resolveQuickFetchMarketPreflight('stop')}
        onDontShowAgain={onQuickFetchMarketPreflightDontShowAgain}
      />
      <QuickFetchCaptureHud
        active={rawEngineQuickFetchActive}
        phase={quickFetchPhase ?? ''}
        progressPct={quickFetchProgressPct}
        targetSummary={quickFetchTargetSummary}
        stage={quickFetchCaptureStage}
      />
    </div>
  );
};


/** Master-list column: GemRate PSA 10 population share (or Universal Gems+ %). */
const GemRateP10TableCell = ({
  card,
  onFieldChange,
}: {
  card: EnrichedCard;
  onFieldChange: <K extends keyof Card>(id: string, key: K, value: Card[K]) => void;
}) => {
  const [phase, setPhase] = useState<'idle' | 'loading' | 'err'>('idle');

  useEffect(() => {
    const gid = (card.gemrateId ?? '').trim();
    if (!gid) {
      setPhase('idle');
      return;
    }
    if (card.gemRateStats?.gemrateId === gid) {
      setPhase('idle');
      return;
    }
    let cancelled = false;
    setPhase('loading');
    fetch(apiUrl(`/api/gemrate/card-details?gemrate_id=${encodeURIComponent(gid)}`))
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((raw) => {
        if (cancelled) return;
        const d = raw as { psa10Pct: number | null; universalGemsPct: number | null };
        onFieldChange(card.id, 'gemRateStats', {
          gemrateId: gid,
          psa10Pct: d.psa10Pct ?? null,
          universalGemsPct: d.universalGemsPct ?? null,
          fetchedAt: Date.now(),
        });
        setPhase('idle');
      })
      .catch(() => {
        if (!cancelled) setPhase('err');
      });
    return () => {
      cancelled = true;
    };
  }, [card.id, card.gemrateId, card.gemRateStats?.gemrateId, onFieldChange]);

  const gid = (card.gemrateId ?? '').trim();
  if (!gid) {
    return <span className="text-[10px] text-slate-300 font-mono">—</span>;
  }
  const stats = card.gemRateStats?.gemrateId === gid ? card.gemRateStats : null;
  if (phase === 'loading' && !stats) {
    return <span className="text-[10px] text-slate-400 font-mono">…</span>;
  }
  if (phase === 'err' && !stats) {
    return (
      <span
        className="text-[10px] text-rose-500 font-mono font-bold"
        title="GemRate card-details request failed"
      >
        !
      </span>
    );
  }
  if (!stats) return <span className="text-[10px] text-slate-300 font-mono">—</span>;
  const pct = stats.psa10Pct ?? stats.universalGemsPct;
  const universalOnly = stats.psa10Pct == null && stats.universalGemsPct != null;
  const title =
    stats.psa10Pct != null
      ? `GemRate PSA 10: ${stats.psa10Pct.toFixed(1)}% of PSA-graded copies are 10. Universal Gems+: ${stats.universalGemsPct?.toFixed(1) ?? '—'}%.`
      : stats.universalGemsPct != null
        ? `GemRate Universal Gems+ rate: ${stats.universalGemsPct.toFixed(1)}%.`
        : 'GemRate';
  return (
    <span className="text-[11px] font-mono font-bold text-violet-700 tabular-nums" title={title}>
      {pct == null ? '—' : `${pct.toFixed(1)}%`}
      {universalOnly ? <sup className="text-[7px] ml-px">U</sup> : null}
    </span>
  );
};

const BackendBadge = ({ status }: { status: BackendStatus }) => {
  const cfg = {
    checking: {
      cls: 'bg-slate-100 text-slate-500 border-slate-200',
      icon: <Wifi size={14} className="animate-pulse" />,
      label: 'Checking backend',
    },
    online: {
      cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      icon: <Wifi size={14} />,
      label: 'Backend online',
    },
    offline: {
      cls: 'bg-rose-50 text-rose-700 border-rose-200',
      icon: <WifiOff size={14} />,
      label: 'Backend offline',
    },
  }[status];
  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-bold uppercase tracking-widest ${cfg.cls}`}
      title={status === 'offline' ? (isRawEngineShell() ? 'Restart Raw Investor' : 'Start LAUNCH.bat') : ''}
    >
      {cfg.icon}
      {cfg.label}
    </div>
  );
};

const StatCard = ({
  icon, label, value, accent,
}: {
  icon: React.ReactNode; label: string; value: string; accent: string;
}) => (
  <div className={`${accent} px-6 py-5 rounded-2xl flex items-center gap-4 shadow-xl`}>
    {icon}
    <div>
      <p className="text-[9px] font-bold uppercase opacity-70 tracking-widest">{label}</p>
      <p className="text-2xl font-black leading-none mt-1">{value}</p>
    </div>
  </div>
);



type PortfolioTotals = {
  count: number;
  preGradeSpend: number;
  gradingSpend: number;
  gradingPerCard: number;
  invested: number;
  expectedRevenue: number;
  ev: number;
  roi: number;
  bestCaseNet: number;
  worstCaseNet: number;
  perDollarReturn: number;
};

/**
 * Rich portfolio summary: headline ROI / EV, cash-flow breakdown
 * (pre-grade spent vs. grading commit vs. total invested), dollar-for-dollar
 * expected return, and a risk corridor (best / worst case spread).
 */
const PortfolioSummary = ({
  totals, filterActive,
}: {
  totals: PortfolioTotals;
  filterActive: boolean;
}) => {
  const [insightTab, setInsightTab] = useState<'headline' | 'cashflow'>('headline');
  const {
    count,
    preGradeSpend,
    gradingSpend,
    gradingPerCard,
    invested,
    expectedRevenue,
    ev,
    roi,
    bestCaseNet,
    worstCaseNet,
    perDollarReturn,
  } = totals;

  const preGradePct = invested > 0 ? (preGradeSpend / invested) * 100 : 0;
  const gradingPct = invested > 0 ? (gradingSpend / invested) * 100 : 0;
  const evColor = ev >= 0 ? 'text-emerald-600' : 'text-rose-600';
  const roiColor = roi >= 0 ? 'bg-emerald-700' : 'bg-rose-700';

  if (count === 0) {
    return (
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-8 text-center text-slate-400 font-semibold">
        Portfolio totals will appear here once you add cards
        {filterActive ? ' (or clear your filters).' : '.'}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold text-slate-800 uppercase tracking-[0.14em] text-xs flex items-center gap-2 mb-2">
          <BarChart3 size={14} className="text-blue-600" />
          Investment insights
        </h3>
        <div
          role="tablist"
          className="flex flex-wrap gap-2 border-b border-slate-200 pb-3"
          aria-label="Investment insight views"
        >
          <button
            type="button"
            role="tab"
            aria-selected={insightTab === 'headline'}
            onClick={() => setInsightTab('headline')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold uppercase tracking-[0.12em] transition-colors ${
              insightTab === 'headline'
                ? 'bg-slate-900 text-white shadow-md'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <TrendingUp size={14} className={insightTab === 'headline' ? 'text-amber-300' : 'text-slate-500'} />
            Headline
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={insightTab === 'cashflow'}
            onClick={() => setInsightTab('cashflow')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold uppercase tracking-[0.12em] transition-colors ${
              insightTab === 'cashflow'
                ? 'bg-slate-900 text-white shadow-md'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <BarChart3 size={14} className={insightTab === 'cashflow' ? 'text-amber-300' : 'text-slate-500'} />
            Cash flow &amp; risk
          </button>
        </div>
      </div>

      {insightTab === 'headline' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4" role="tabpanel">
          <StatCard
            icon={<Package className="text-blue-400" size={20} />}
            label="Total Invested"
            value={fmtMoney(invested)}
            accent="bg-slate-900 text-white"
          />
          <StatCard
            icon={<TrendingUp className="text-emerald-400" size={20} />}
            label="Expected Value (Portfolio)"
            value={fmtMoney(ev)}
            accent={ev >= 0 ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'}
          />
          <StatCard
            icon={<Info className="text-yellow-300" size={20} />}
            label="Portfolio ROI"
            value={fmtPct(roi)}
            accent={`${roiColor} text-white`}
          />
        </div>
      )}

      {insightTab === 'cashflow' && (
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6" role="tabpanel">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-black text-slate-800 uppercase tracking-widest text-xs flex items-center gap-2">
            <BarChart3 size={14} /> Portfolio Cash Flow &amp; Dollar-for-Dollar
          </h3>
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
            {count} card{count === 1 ? '' : 's'}{filterActive ? ' (filtered)' : ''}
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
          <BreakdownStat
            title="Pre-grade Spent"
            value={fmtMoney(preGradeSpend)}
            sub={`${preGradePct.toFixed(0)}% of invested \u2014 already out of pocket`}
            tone="neutral"
          />
          <BreakdownStat
            title="Grading Investment"
            value={fmtMoney(gradingSpend)}
            sub={`${gradingPct.toFixed(0)}% of invested \u2014 ${fmtMoney(gradingPerCard)} \u00d7 ${count} card${count === 1 ? '' : 's'}`}
            tone="blue"
          />
          <BreakdownStat
            title="Expected Revenue"
            value={fmtMoney(expectedRevenue)}
            sub="After sale fees, probability-weighted across outcomes"
            tone={ev >= 0 ? 'emerald' : 'rose'}
          />
        </div>

        {/* Proportional cash-flow bar: pre-grade | grading */}
        {invested > 0 && (
          <div className="mb-6">
            <div className="flex h-3 rounded-full overflow-hidden border border-slate-200">
              <div
                className="bg-slate-900"
                style={{ width: `${preGradePct}%` }}
                title={`Pre-grade: ${fmtMoney(preGradeSpend)} (${preGradePct.toFixed(1)}%)`}
              />
              <div
                className="bg-blue-400"
                style={{ width: `${gradingPct}%` }}
                title={`Grading: ${fmtMoney(gradingSpend)} (${gradingPct.toFixed(1)}%)`}
              />
            </div>
            <div className="flex justify-between mt-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400">
              <span>Pre-grade ({fmtMoney(preGradeSpend)})</span>
              <span>Grading ({fmtMoney(gradingSpend)})</span>
              <span>Total {fmtMoney(invested)}</span>
            </div>
          </div>
        )}

        {/* Dollar-for-dollar takeaway */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-2xl border border-slate-200 p-4 text-center">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">
              Dollar for Dollar
            </div>
            <div className="text-xl font-black text-slate-800 tabular-nums">
              $1.00 <span className="text-slate-400">&rarr;</span>{' '}
              <span className={perDollarReturn >= 1 ? 'text-emerald-600' : 'text-rose-600'}>
                ${perDollarReturn.toFixed(2)}
              </span>
            </div>
            <div className="text-[11px] font-semibold text-slate-500 mt-1">
              Expected return for every dollar invested
            </div>
          </div>

          <div className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-4 text-center">
            <div className="text-[10px] font-black uppercase tracking-widest text-emerald-700 mb-1">
              Best Case (All PSA 10)
            </div>
            <div className="text-xl font-black text-emerald-700 tabular-nums">
              {fmtMoney(bestCaseNet)}
            </div>
            <div className="text-[11px] font-semibold text-emerald-800/70 mt-1">
              Net profit if every card grades PSA 10
            </div>
          </div>

          <div className="rounded-2xl border border-rose-100 bg-rose-50/40 p-4 text-center">
            <div className="text-[10px] font-black uppercase tracking-widest text-rose-700 mb-1">
              Worst Case (All Fail)
            </div>
            <div className="text-xl font-black text-rose-700 tabular-nums">
              {fmtMoney(worstCaseNet)}
            </div>
            <div className="text-[11px] font-semibold text-rose-800/70 mt-1">
              Net loss if every card fails grading (sell raw)
            </div>
          </div>
        </div>

        <div className="mt-5 pt-4 border-t border-slate-100 grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
          <MiniStat label="Avg invested / card" value={fmtMoney(invested / count)} />
          <MiniStat label="Avg EV / card" value={fmtMoney(ev / count)} color={evColor} />
          <MiniStat label="Risk spread" value={fmtMoney(bestCaseNet - worstCaseNet)} />
          <MiniStat
            label="Break-even rev"
            value={fmtMoney(invested)}
            sub={expectedRevenue >= invested ? 'covered' : `short ${fmtMoney(invested - expectedRevenue)}`}
          />
        </div>
      </div>
      )}
    </div>
  );
};

const BreakdownStat = ({
  title, value, sub, tone,
}: {
  title: string;
  value: string;
  sub: string;
  tone: 'neutral' | 'blue' | 'emerald' | 'rose';
}) => {
  const toneCls: Record<typeof tone, string> = {
    neutral: 'border-slate-200 bg-slate-50/50',
    blue: 'border-blue-200 bg-blue-50/50',
    emerald: 'border-emerald-200 bg-emerald-50/50',
    rose: 'border-rose-200 bg-rose-50/50',
  };
  return (
    <div className={`rounded-2xl border p-4 ${toneCls[tone]}`}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 mb-1">
        {title}
      </div>
      <div className="text-2xl font-semibold text-slate-900 tabular-nums">{value}</div>
      <div className="text-[11px] font-semibold text-slate-500 mt-1 leading-snug">
        {sub}
      </div>
    </div>
  );
};

const MiniStat = ({
  label, value, sub, color,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) => (
  <div>
    <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</div>
    <div className={`text-[17px] font-semibold tabular-nums ${color ?? 'text-slate-900'}`}>{value}</div>
    {sub && <div className="text-[10px] font-semibold text-slate-400 mt-0.5">{sub}</div>}
  </div>
);

/**
 * Editable "what you paid" cell. Stored as Card.actualCost; when unset (or 0)
 * the cell shows the raw market price in muted text as a placeholder so users
 * understand the fallback behavior. Also renders a small delta vs market raw
 * when the two differ meaningfully (good-deal / bad-deal at a glance).
 */
const PaidCell = ({
  card, onFieldChange,
}: {
  card: Card;
  onFieldChange: <K extends keyof Card>(id: string, key: K, value: Card[K]) => void;
}) => {
  const paid = card.actualCost;
  const hasValue = typeof paid === 'number' && paid > 0;
  const rawRef = card.raw;
  const pct =
    hasValue && rawRef > 0 ? ((paid! - rawRef) / rawRef) * 100 : 0;
  const showDelta = hasValue && rawRef > 0 && Math.abs(pct) >= 1;
  const deltaColor =
    pct < 0 ? 'text-emerald-600' : pct > 0 ? 'text-rose-600' : 'text-slate-400';

  return (
    <td className="px-2 py-4 text-right align-middle">
      <div className="flex flex-col items-end">
        <input
          type="number"
          inputMode="decimal"
          step="0.01"
          min={0}
          value={hasValue ? paid : ''}
          placeholder={rawRef ? rawRef.toFixed(2) : '0.00'}
          onChange={(e) => {
            const v = e.target.value;
            onFieldChange(
              card.id,
              'actualCost',
              v === '' ? undefined : Number(v),
            );
          }}
          className={`w-20 text-right tabular-nums bg-transparent border border-transparent rounded px-1.5 py-0.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-300 focus:bg-white focus:border-slate-200 hover:border-slate-200 transition-colors ${
            hasValue ? 'text-slate-800' : 'text-slate-300'
          }`}
          title={hasValue ? undefined : 'Defaults to market raw when empty'}
        />
        {showDelta && (
          <span className={`text-[10px] font-bold tabular-nums ${deltaColor}`}>
            {pct >= 0 ? '+' : ''}{pct.toFixed(0)}% vs raw
          </span>
        )}
      </div>
    </td>
  );
};

/**
 * Editable shipping cell. Either shows a number input, or a "FREE" pill when
 * Card.freeShipping is on. Clicking FREE toggles it back off. Clicking the
 * tiny ship-free button inside the input turns FREE on.
 */
const ShipCell = ({
  card, onFieldChange,
}: {
  card: Card;
  onFieldChange: <K extends keyof Card>(id: string, key: K, value: Card[K]) => void;
}) => {
  const free = !!card.freeShipping;
  const ship = Number(card.shippingCost) || 0;

  if (free) {
    return (
      <td className="px-2 py-4 text-right align-middle">
        <button
          onClick={() => onFieldChange(card.id, 'freeShipping', false)}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-black uppercase tracking-wider hover:bg-emerald-100 transition-colors"
          title="Click to enter a shipping amount"
        >
          FREE
        </button>
      </td>
    );
  }

  return (
    <td className="px-2 py-4 text-right align-middle">
      <div className="flex items-center justify-end gap-1">
        <input
          type="number"
          inputMode="decimal"
          step="0.01"
          min={0}
          value={ship > 0 ? ship : ''}
          placeholder="0.00"
          onChange={(e) => {
            const v = e.target.value;
            onFieldChange(
              card.id,
              'shippingCost',
              v === '' ? undefined : Number(v),
            );
          }}
          className={`w-16 text-right tabular-nums bg-transparent border border-transparent rounded px-1.5 py-0.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-300 focus:bg-white focus:border-slate-200 hover:border-slate-200 transition-colors ${
            ship > 0 ? 'text-slate-800' : 'text-slate-300'
          }`}
        />
        <button
          onClick={() => onFieldChange(card.id, 'freeShipping', true)}
          className="text-[9px] font-black uppercase tracking-wider text-slate-300 hover:text-emerald-600 transition-colors px-1"
          title="Mark shipping as free"
        >
          FREE?
        </button>
      </div>
    </td>
  );
};


export default App;

