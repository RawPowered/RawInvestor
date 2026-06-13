import { useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ExternalLink } from 'lucide-react';
import { BrandLogoImg } from './brandLogos';
import { fmtMoney } from './math';
import { formatMarketSaleInstant } from './utils/time';
import { startOfUtcDay } from './releaseFilter';
import { ebayEffectivePrice } from './utils/ebayEffectivePrice';
import { EbayExternalLink } from './components/EbayExternalLink';
import {
  ebayListingUrlForRow,
  ebaySoldSearchUrlForCard,
  ebaySoldSearchUrlForItemId,
  resolveEbayListingItemId,
} from './masterListExternalLinks';
import { resolveEbaySoldDisplay } from './utils/ebayApiToExtension';
import { apiUrl } from './apiBase';
import { entCardFrame } from './quick/enterpriseDashboardUi';
import { updateCanonicalEbayListingTags } from './serverSync';
import {
  effectivePokemonCenterStamp,
  effectiveSealedInTitle,
  ebayListingSaleKey,
  matchesEbayTitleTagFilters,
  type EbayTitleStampFilter,
  type EbayTitleSealedFilter,
} from './ebayStamp';
import {
  resolveTcgCapturedMarketPrice,
  resolveTcgDisplayMarketPrice,
  tcgCapturedDiffersFromDisplay,
} from './tcgDisplayPrice';
import { inferLanguageTag } from './plugins/cardLanguageDetect';
import type {
  CardLanguageTag,
  SalesAnomalyPoint,
  TcgplayerLatestSaleRow,
  EbayExtensionListing,
  EbayFilteredListing,
  PriceSnapshot,
  Card,
} from './types';
import type { EnrichedCard } from './sort';

const bucketTcg = (at: number) => startOfUtcDay(at);

const bucketEbay = (at: number) => startOfUtcDay(at);

type DayRow = { t: number; dayLabel: string; avgPrice: number; salesCount: number };
type RawPointPlatform = 'pc' | 'tcg' | 'ebay';
type RawPoint = {
  t: number;
  dayLabel: string;
  price: number;
  rawPrice: number;
  platform: RawPointPlatform;
  saleKey: string;
};
type DayDrilldownSelection = {
  platform: RawPointPlatform;
  day: number;
  points: RawPoint[];
};

const dayLabel = (t: number) =>
  new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/** Robust daily estimator: trims extremes so one noisy comp doesn't skew a day. */
const robustDayPrice = (pricesIn: number[]): number => {
  const prices = pricesIn.filter((p) => Number.isFinite(p) && p > 0 && p < 100000).sort((a, b) => a - b);
  if (!prices.length) return 0;
  if (prices.length <= 3) {
    return prices.reduce((s, p) => s + p, 0) / prices.length;
  }
  const trim = Math.max(1, Math.floor(prices.length * 0.1));
  const core = prices.slice(trim, prices.length - trim);
  const use = core.length ? core : prices;
  return use.reduce((s, p) => s + p, 0) / use.length;
};

const buildTcgDaySeries = (
  rows: { at: number; price: number; qty: number }[]
): DayRow[] => {
  const byDay = new Map<number, { prices: number[]; n: number }>();
  for (const r of rows) {
    if (!Number.isFinite(r.at) || !Number.isFinite(r.price)) continue;
    if (r.price <= 0 || r.price >= 100000) continue;
    const t = bucketTcg(r.at);
    const q = Number.isFinite(r.qty) && r.qty > 0 ? Math.min(12, Math.floor(r.qty)) : 1;
    const cur = byDay.get(t) || { prices: [], n: 0 };
    for (let i = 0; i < q; i += 1) cur.prices.push(r.price);
    cur.n += 1;
    byDay.set(t, cur);
  }
  return Array.from(byDay.entries())
    .map(([t, v]) => ({
      t,
      dayLabel: dayLabel(t),
      avgPrice: robustDayPrice(v.prices),
      salesCount: v.n,
    }))
    .sort((a, b) => a.t - b.t);
};

const buildEbayDaySeries = (rows: { soldAt: number; price: number }[]): DayRow[] => {
  const byDay = new Map<number, { prices: number[]; n: number }>();
  for (const r of rows) {
    const soldAt = Number(r.soldAt);
    const price = Number(r.price);
    if (!Number.isFinite(soldAt) || !Number.isFinite(price)) continue;
    if (price <= 0 || price >= 100000) continue;
    const t = bucketEbay(soldAt);
    const cur = byDay.get(t) || { prices: [], n: 0 };
    cur.prices.push(price);
    cur.n += 1;
    byDay.set(t, cur);
  }
  return Array.from(byDay.entries())
    .map(([t, v]) => ({
      t,
      dayLabel: dayLabel(t),
      avgPrice: robustDayPrice(v.prices),
      salesCount: v.n,
    }))
    .sort((a, b) => a.t - b.t);
};

const buildPcDaySeries = (rows: { at: number; price: number }[]): DayRow[] => {
  const byDay = new Map<number, { prices: number[]; n: number }>();
  for (const r of rows) {
    if (!Number.isFinite(r.at) || !Number.isFinite(r.price) || r.price <= 0) continue;
    if (r.price >= 100000) continue;
    const t = startOfUtcDay(r.at);
    const cur = byDay.get(t) || { prices: [], n: 0 };
    cur.prices.push(r.price);
    cur.n += 1;
    byDay.set(t, cur);
  }
  return Array.from(byDay.entries())
    .map(([t, v]) => ({
      t,
      dayLabel: dayLabel(t),
      avgPrice: robustDayPrice(v.prices),
      salesCount: v.n,
    }))
    .sort((a, b) => a.t - b.t);
};

type EbayDrilldownScope = 'all' | 'raw' | 'PSA' | 'CGC' | 'BGS' | 'SGC' | 'TAG' | 'ACE' | 'AI';
type EbayRawConditionFilter = 'all' | 'NM' | 'LP' | 'MP' | 'HP' | 'DMG';
type EbayStampFilter = EbayTitleStampFilter;
type EbaySealedFilter = EbayTitleSealedFilter;
type ListingLanguageFilter = 'all' | CardLanguageTag;
type GrandOverviewScopeMode = 'all' | 'raw' | 'graded';
type EbayTableSortBy = 'soldAt' | 'price' | 'title';
type SortDir = 'asc' | 'desc';
type CaptureHistorySortBy = 'capturedAt' | 'title' | 'url';
type EbayHistoryResponse = {
  captures?: Array<{ capturedAt?: number; title?: string; url?: string; source?: string }>;
  normalized?: Array<{
    captureMode?: 'default' | 'deep';
    hasMore?: boolean;
    rowCount?: number;
    query?: string;
    listings?: EbayExtensionListing[];
  }>;
  total?: number;
  limit?: number;
  offset?: number;
  hasMore?: boolean;
  nextOffset?: number | null;
};


const ebayListingMatchesScope = (
  r: EbayExtensionListing,
  scope: EbayDrilldownScope,
  rawCondition: EbayRawConditionFilter,
  includeAiInRaw: boolean
): boolean => {
  if (scope === 'raw') {
    if (r.isGraded && !(includeAiInRaw && r.grader === 'AI')) return false;
  } else if (scope !== 'all') {
    if (!r.isGraded || r.grader !== scope) return false;
  }
  const treatedAsRaw = !r.isGraded || (includeAiInRaw && r.grader === 'AI');
  if (rawCondition !== 'all' && treatedAsRaw) {
    return r.conditionTag === rawCondition;
  }
  return true;
};

const ebaySpectrumParts = (
  r: EbayExtensionListing
): { label: string; kind: 'graded' | 'raw' } => {
  const stamp = effectivePokemonCenterStamp(r) ? ' · PC stamp' : '';
  const sealed = effectiveSealedInTitle(r) ? ' · Sealed' : '';
  const lot = r.isLot && (r.lotQuantity ?? 1) > 1 ? ` · Lot x${r.lotQuantity}` : '';
  if (r.isGraded) {
    const label =
      ((r.gradeTag && String(r.gradeTag).trim()) ||
        (r.grader ? `Graded · ${r.grader}` : 'Graded')) +
      stamp +
      sealed +
      lot;
    return { label, kind: 'graded' };
  }
  const tail = r.conditionTag ? ` · ${r.conditionTag}` : '';
  return { label: `Raw${tail}${stamp}${sealed}${lot}`, kind: 'raw' };
};

const ebaySoldShipLabel = (r: EbayExtensionListing): string => {
  if (r.freeShipping === true) return 'Free';
  const c = r.shippingCost;
  if (typeof c === 'number' && Number.isFinite(c) && c >= 0) return fmtMoney(c);
  return '—';
};

const ebaySoldFormatLabel = (r: EbayExtensionListing): string => {
  if (r.listingKind === 'auction') return 'Auction';
  if (r.listingKind === 'bin') return 'BIN';
  return '?';
};

export const OverviewMarketSalesSection = ({
  card,
  formatRelative,
  onFieldChange,
  viewMode = 'all',
  grandScopeMode = 'all',
  grandScopeGrader = null,
  grandScopeGradeTag = 'ALL',
  /** When set (e.g. Quick card), stamp/sealed UI and filters are controlled by the parent so KPIs can match. */
  ebayTitleFiltersControl,
  hidePcRawHistoryChart = false,
}: {
  card: EnrichedCard;
  formatRelative: (ts: number) => string;
  onFieldChange: <K extends keyof Card>(id: string, key: K, value: Card[K]) => void;
  viewMode?: 'all' | 'grand' | 'pc' | 'tcg' | 'ebay';
  grandScopeMode?: GrandOverviewScopeMode;
  grandScopeGrader?: 'PSA' | 'CGC' | 'BGS' | 'SGC' | 'TAG' | 'ACE' | 'AI' | null;
  grandScopeGradeTag?: string;
  hidePcRawHistoryChart?: boolean;
  ebayTitleFiltersControl?: {
    stamp: EbayStampFilter;
    sealed: EbaySealedFilter;
    language: ListingLanguageFilter;
    photosOnly: boolean;
    hideSuspicious: boolean;
    onStampChange: (v: EbayStampFilter) => void;
    onSealedChange: (v: EbaySealedFilter) => void;
    onLanguageChange: (v: ListingLanguageFilter) => void;
    onPhotosOnlyChange: (v: boolean) => void;
    onHideSuspiciousChange: (v: boolean) => void;
  };
}) => {
  const [grandGranularity, setGrandGranularity] = useState<'daily' | 'raw'>('daily');
  const [grandValueMode, setGrandValueMode] = useState<'price' | 'normalized'>('price');
  const [ebayPriceMode, setEbayPriceMode] = useState<'exact' | 'rounded1' | 'rounded05'>('exact');
  const [ebayScope, setEbayScope] = useState<EbayDrilldownScope>('all');
  const [rawConditionFilter, setRawConditionFilter] = useState<EbayRawConditionFilter>('all');
  const [includeAiInRaw, setIncludeAiInRaw] = useState<boolean>(true);
  const [internalStampFilter, setInternalStampFilter] = useState<EbayStampFilter>('all');
  const [internalSealedFilter, setInternalSealedFilter] = useState<EbaySealedFilter>('all');
  const [internalLanguageFilter, setInternalLanguageFilter] = useState<ListingLanguageFilter>('all');
  const [internalPhotosOnly, setInternalPhotosOnly] = useState(false);
  const [internalHideSuspicious, setInternalHideSuspicious] = useState(false);
  const ebayStampFilter = ebayTitleFiltersControl?.stamp ?? internalStampFilter;
  const ebaySealedFilter = ebayTitleFiltersControl?.sealed ?? internalSealedFilter;
  const listingLanguageFilter = ebayTitleFiltersControl?.language ?? internalLanguageFilter;
  const listingPhotosOnly = ebayTitleFiltersControl?.photosOnly ?? internalPhotosOnly;
  const listingHideSuspicious = ebayTitleFiltersControl?.hideSuspicious ?? internalHideSuspicious;
  const setEbayStampFilter = ebayTitleFiltersControl?.onStampChange ?? setInternalStampFilter;
  const setEbaySealedFilter = ebayTitleFiltersControl?.onSealedChange ?? setInternalSealedFilter;
  const setListingLanguageFilter = ebayTitleFiltersControl?.onLanguageChange ?? setInternalLanguageFilter;
  const setListingPhotosOnly = ebayTitleFiltersControl?.onPhotosOnlyChange ?? setInternalPhotosOnly;
  const setListingHideSuspicious =
    ebayTitleFiltersControl?.onHideSuspiciousChange ?? setInternalHideSuspicious;
  const [ebayDataTab, setEbayDataTab] = useState<'market' | 'filtered' | 'excluded' | 'history'>('market');
  const [filteredSourceView, setFilteredSourceView] = useState<'all' | 'clarity' | 'manual'>('all');
  const [ebayTableSearch, setEbayTableSearch] = useState('');
  const [ebayTableStartDate, setEbayTableStartDate] = useState('');
  const [ebayTableEndDate, setEbayTableEndDate] = useState('');
  const [ebayTableSortBy, setEbayTableSortBy] = useState<EbayTableSortBy>('soldAt');
  const [ebayTableSortDir, setEbayTableSortDir] = useState<SortDir>('desc');
  const [ebayTablePage, setEbayTablePage] = useState(1);
  const [ebayTablePageSize, setEbayTablePageSize] = useState(50);
  const [historyRows, setHistoryRows] = useState<EbayExtensionListing[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [captureHistoryRows, setCaptureHistoryRows] = useState<
    Array<{ capturedAt: number; title: string; url: string; query: string; rowCount: number; captureMode: string }>
  >([]);
  const [captureHistoryTotal, setCaptureHistoryTotal] = useState(0);
  const [captureHistoryOffset, setCaptureHistoryOffset] = useState(0);
  const [captureHistoryLimit, setCaptureHistoryLimit] = useState(30);
  const [captureHistorySearch, setCaptureHistorySearch] = useState('');
  const [captureHistoryStartDate, setCaptureHistoryStartDate] = useState('');
  const [captureHistoryEndDate, setCaptureHistoryEndDate] = useState('');
  const [captureHistorySortBy, setCaptureHistorySortBy] = useState<CaptureHistorySortBy>('capturedAt');
  const [captureHistorySortDir, setCaptureHistorySortDir] = useState<SortDir>('desc');
  const [captureHistoryLoading, setCaptureHistoryLoading] = useState(false);
  const [captureHistoryError, setCaptureHistoryError] = useState<string | null>(null);
  /** When true, sold listing table uses the same Drilldown scope + Raw condition filters as the chart/KPIs. */
  const [ebayTableMatchScope, setEbayTableMatchScope] = useState(true);
  const [editingEbayListing, setEditingEbayListing] = useState<EbayExtensionListing | null>(null);
  const editingEbayLinks = useMemo(() => {
    if (!editingEbayListing) return null;
    const resolvedItemId = resolveEbayListingItemId(editingEbayListing);
    return {
      listingUrl: ebayListingUrlForRow(editingEbayListing),
      resolvedItemId,
      itemSoldSearchUrl: resolvedItemId ? ebaySoldSearchUrlForItemId(resolvedItemId) : null,
    };
  }, [editingEbayListing]);
  const [editIsGraded, setEditIsGraded] = useState(false);
  const [editGrader, setEditGrader] = useState<'PSA' | 'CGC' | 'BGS' | 'SGC' | 'TAG' | 'ACE' | 'AI'>('PSA');
  const [editGradeTag, setEditGradeTag] = useState('');
  const [editConditionTag, setEditConditionTag] = useState<'NM' | 'LP' | 'MP' | 'HP' | 'DMG'>('NM');
  const [editPrice, setEditPrice] = useState('');
  const [editIsLot, setEditIsLot] = useState(false);
  const [editLotQty, setEditLotQty] = useState('1');
  const [editPcStamp, setEditPcStamp] = useState(false);
  const [editSealed, setEditSealed] = useState(false);
  const [saveTagBusy, setSaveTagBusy] = useState(false);
  const [saveTagError, setSaveTagError] = useState<string | null>(null);
  const [listingTagPortfolioOnlyNotice, setListingTagPortfolioOnlyNotice] = useState<string | null>(null);
  const [selectedRawPoint, setSelectedRawPoint] = useState<RawPoint | null>(null);
  const [selectedDayDrilldown, setSelectedDayDrilldown] = useState<DayDrilldownSelection | null>(null);
  const tcg = card.tcgplayerSalesSnapshot;
  const rows = tcg?.latestSalesRows ?? [];
  const anomalies = (card.tcgplayerSalesAnomalies ?? []) as SalesAnomalyPoint[];
  const ebay = card.ebayExtensionSnapshot;
  const ebayDisplay = useMemo(() => resolveEbaySoldDisplay(card), [card]);
  const ebayList = ebayDisplay.listings;
  const ebayDataSourceLabel =
    ebayDisplay.source === 'api'
      ? 'API comps'
      : ebayDisplay.source === 'merged'
        ? 'Extension + API'
        : ebayDisplay.source === 'extension'
          ? 'Extension'
          : null;
  const soldUrl = useMemo(() => {
    try {
      return ebaySoldSearchUrlForCard(card);
    } catch {
      return null;
    }
  }, [card.name, card.set, card.cardNumber]);

  useEffect(() => {
    setEbayTablePage(1);
  }, [ebayTableSearch, ebayTableStartDate, ebayTableEndDate, ebayTableSortBy, ebayTableSortDir, ebayTablePageSize, card.id]);

  useEffect(() => {
    let cancelled = false;
    const sourceUrl = String(card.ebayExtensionSnapshot?.sourceUrl || '').trim();
    if (!sourceUrl) {
      setHistoryRows([]);
      setHistoryError(null);
      setHistoryLoading(false);
      return;
    }
    const run = async () => {
      setHistoryLoading(true);
      setHistoryError(null);
      try {
        const merged = new Map<string, EbayExtensionListing>();
        let offset = 0;
        const limit = 250;
        let loops = 0;
        while (!cancelled && loops < 20) {
          loops += 1;
          const qs = new URLSearchParams({
            source: 'ebay',
            url: sourceUrl,
            limit: String(limit),
            offset: String(offset),
            sortBy: 'capturedAt',
            sortDir: 'desc',
          });
          const r = await fetch(apiUrl(`/api/ext/capture/history?${qs.toString()}`));
          const payload = (await r.json().catch(() => ({}))) as EbayHistoryResponse;
          if (!r.ok) throw new Error((payload as { error?: string }).error || `HTTP ${r.status}`);
          const normalized = Array.isArray(payload.normalized) ? payload.normalized : [];
          for (const cap of normalized) {
            const listings = Array.isArray(cap.listings) ? cap.listings : [];
            for (const row of listings) {
              const k = ebayListingSaleKey(row);
              if (!merged.has(k)) merged.set(k, row);
            }
          }
          if (!payload.hasMore) break;
          offset = Number(payload.nextOffset ?? offset + limit);
          if (!Number.isFinite(offset) || offset < 0) break;
        }
        if (!cancelled) {
          setHistoryRows(Array.from(merged.values()));
        }
      } catch (err) {
        if (!cancelled) {
          setHistoryError(err instanceof Error ? err.message : String(err));
          setHistoryRows([]);
        }
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [card.id, card.ebayExtensionSnapshot?.sourceUrl]);

  useEffect(() => {
    if (ebayDataTab !== 'history') return;
    let cancelled = false;
    const sourceUrl = String(card.ebayExtensionSnapshot?.sourceUrl || '').trim();
    if (!sourceUrl) {
      setCaptureHistoryRows([]);
      setCaptureHistoryTotal(0);
      return;
    }
    const run = async () => {
      setCaptureHistoryLoading(true);
      setCaptureHistoryError(null);
      try {
        const qs = new URLSearchParams({
          source: 'ebay',
          url: sourceUrl,
          limit: String(captureHistoryLimit),
          offset: String(captureHistoryOffset),
          sortBy: captureHistorySortBy,
          sortDir: captureHistorySortDir,
        });
        if (captureHistorySearch.trim()) qs.set('search', captureHistorySearch.trim());
        if (captureHistoryStartDate) qs.set('startDate', captureHistoryStartDate);
        if (captureHistoryEndDate) qs.set('endDate', captureHistoryEndDate);
        const r = await fetch(apiUrl(`/api/ext/capture/history?${qs.toString()}`));
        const payload = (await r.json().catch(() => ({}))) as EbayHistoryResponse;
        if (!r.ok) throw new Error((payload as { error?: string }).error || `HTTP ${r.status}`);
        const captures = Array.isArray(payload.captures) ? payload.captures : [];
        const normalized = Array.isArray(payload.normalized) ? payload.normalized : [];
        const rows = captures.map((cap, idx) => {
          const n = normalized[idx];
          return {
            capturedAt: Number(cap.capturedAt || 0),
            title: String(cap.title || ''),
            url: String(cap.url || ''),
            query: String(n?.query || ''),
            rowCount: Number(n?.rowCount || 0),
            captureMode: String(n?.captureMode || 'default'),
          };
        });
        if (!cancelled) {
          setCaptureHistoryRows(rows);
          setCaptureHistoryTotal(Number(payload.total || 0));
        }
      } catch (err) {
        if (!cancelled) {
          setCaptureHistoryError(err instanceof Error ? err.message : String(err));
          setCaptureHistoryRows([]);
          setCaptureHistoryTotal(0);
        }
      } finally {
        if (!cancelled) setCaptureHistoryLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [
    ebayDataTab,
    card.id,
    card.ebayExtensionSnapshot?.sourceUrl,
    captureHistoryOffset,
    captureHistoryLimit,
    captureHistorySearch,
    captureHistoryStartDate,
    captureHistoryEndDate,
    captureHistorySortBy,
    captureHistorySortDir,
  ]);

  useEffect(() => {
    setCaptureHistoryOffset(0);
  }, [
    card.id,
    captureHistorySearch,
    captureHistoryStartDate,
    captureHistoryEndDate,
    captureHistorySortBy,
    captureHistorySortDir,
    captureHistoryLimit,
  ]);

  const tcgSaleKey = (r: TcgplayerLatestSaleRow): string =>
    `${startOfUtcDay(r.at)}|${(r.condition || '').trim().toLowerCase()}|${r.qty}|${r.price.toFixed(4)}`;

  const pcSaleKey = (at: number, rawPrice: number): string =>
    `${Math.round(at)}|${rawPrice.toFixed(4)}`;

  const beginEditSpectrum = (r: EbayExtensionListing) => {
    setEditingEbayListing(r);
    setEditIsGraded(r.isGraded === true);
    setEditGrader(r.grader ?? 'PSA');
    setEditGradeTag(String(r.gradeTag || '').trim());
    setEditConditionTag((r.conditionTag ?? 'NM') as 'NM' | 'LP' | 'MP' | 'HP' | 'DMG');
    setEditPrice(Number.isFinite(r.price) ? String(r.price.toFixed(2)) : '');
    setEditIsLot(r.isLot === true || (typeof r.lotQuantity === 'number' && r.lotQuantity > 1));
    setEditLotQty(
      String(
        typeof r.lotQuantity === 'number' && Number.isFinite(r.lotQuantity) && r.lotQuantity > 1
          ? Math.round(r.lotQuantity)
          : 1
      )
    );
    setEditPcStamp(effectivePokemonCenterStamp(r));
    setEditSealed(effectiveSealedInTitle(r));
    setSaveTagError(null);
    setListingTagPortfolioOnlyNotice(null);
  };

  const cancelEditSpectrum = () => {
    setEditingEbayListing(null);
    setSaveTagError(null);
    setListingTagPortfolioOnlyNotice(null);
  };

  useEffect(() => {
    if (!editingEbayListing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setEditingEbayListing(null);
        setSaveTagError(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editingEbayListing]);

  const patchListingTagLocally = (
    listing: EbayExtensionListing
  ): EbayExtensionListing => {
    const parsedPrice = Number.parseFloat(editPrice);
    const safePrice =
      Number.isFinite(parsedPrice) && parsedPrice >= 0 ? Number(parsedPrice.toFixed(2)) : listing.price;
    const parsedQty = Number.parseInt(editLotQty, 10);
    const safeQty = editIsLot ? Math.max(2, Number.isFinite(parsedQty) ? parsedQty : 2) : 1;
    return {
      ...listing,
      price: safePrice,
      isLot: editIsLot,
      lotQuantity: safeQty,
      unitPrice: Number((safePrice / safeQty).toFixed(2)),
      pokemonCenterStamp: editPcStamp,
      sealedInTitle: editSealed,
      isGraded: editIsGraded,
      grader: editIsGraded ? editGrader : null,
      gradeTag: editIsGraded ? editGradeTag.trim() || null : null,
      conditionTag: editIsGraded ? null : editConditionTag,
    };
  };

  const saveEditedSpectrum = async () => {
    const r = editingEbayListing;
    if (!r || !card.ebayExtensionSnapshot) return;
    const nextGradeTag = editGradeTag.trim();
    if (editIsGraded && !nextGradeTag) {
      setSaveTagError('Grade tag is required for graded listings.');
      return;
    }
    const parsedPrice = Number.parseFloat(editPrice);
    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      setSaveTagError('Price must be a valid non-negative number.');
      return;
    }
    const parsedQty = Number.parseInt(editLotQty, 10);
    if (editIsLot && (!Number.isFinite(parsedQty) || parsedQty < 2)) {
      setSaveTagError('Lot quantity must be at least 2 when lot is enabled.');
      return;
    }
    const correctedPrice = Number(parsedPrice.toFixed(2));
    const snapshotUrl = (card.ebayExtensionSnapshot.sourceUrl || '').trim();
    if (!snapshotUrl) {
      setSaveTagError('Snapshot URL missing; refresh eBay data first.');
      return;
    }
    try {
      setSaveTagBusy(true);
      setSaveTagError(null);
      await updateCanonicalEbayListingTags({
        url: snapshotUrl,
        itemId: r.itemId ?? null,
        soldAt: r.soldAt,
        price: r.price,
        correctedPrice,
        title: r.title,
        isGraded: editIsGraded,
        grader: editIsGraded ? editGrader : null,
        gradeTag: editIsGraded ? nextGradeTag : null,
        conditionTag: editIsGraded ? null : editConditionTag,
        isLot: editIsLot,
        lotQuantity: editIsLot ? Math.max(2, Number.parseInt(editLotQty, 10) || 2) : 1,
        pokemonCenterStamp: editPcStamp,
        sealedInTitle: editSealed,
      });
      const targetKey = ebayListingSaleKey(r);
      const nextSnapshot = {
        ...card.ebayExtensionSnapshot,
        listings: (card.ebayExtensionSnapshot.listings ?? []).map((row) =>
          ebayListingSaleKey(row) === targetKey ? patchListingTagLocally(row) : row
        ),
        rejectedListings: (card.ebayExtensionSnapshot.rejectedListings ?? []).map((row) =>
          ebayListingSaleKey(row) === targetKey ? { ...patchListingTagLocally(row), filterReason: row.filterReason } : row
        ),
      };
      onFieldChange(card.id, 'ebayExtensionSnapshot', nextSnapshot);
      setEditingEbayListing(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const localOnly =
        /not found/i.test(msg) ||
        /Matching ebay capture\/listing not found/i.test(msg);
      if (localOnly) {
        const targetKey = ebayListingSaleKey(r);
        const nextSnapshot = {
          ...card.ebayExtensionSnapshot,
          listings: (card.ebayExtensionSnapshot.listings ?? []).map((row) =>
            ebayListingSaleKey(row) === targetKey ? patchListingTagLocally(row) : row
          ),
          rejectedListings: (card.ebayExtensionSnapshot.rejectedListings ?? []).map((row) =>
            ebayListingSaleKey(row) === targetKey ? { ...patchListingTagLocally(row), filterReason: row.filterReason } : row
          ),
        };
        onFieldChange(card.id, 'ebayExtensionSnapshot', nextSnapshot);
        setEditingEbayListing(null);
        setSaveTagError(null);
        setListingTagPortfolioOnlyNotice(
          'Listing tags saved to your portfolio only — no matching row in server capture DB yet. Run Quick Fetch or capture upload so canonical edits sync.'
        );
        const capLog = (
          typeof window !== 'undefined'
            ? (window as Window & { rawEngine?: { captureLog?: { append?: (e: unknown) => void } } }).rawEngine
                ?.captureLog
            : undefined
        )?.append;
        void capLog?.({
          level: 'warn',
          scope: 'listingTagPatch',
          message: 'Portfolio-only listing tag save (no server capture row)',
          detail: {
            cardId: card.id,
            sourceUrl: snapshotUrl,
            itemId: r.itemId,
            soldAt: r.soldAt,
            price: r.price,
          },
        });
      } else {
        setSaveTagError(msg);
        void (async () => {
          let dataDir: string | undefined;
          try {
            const lr = await fetch(apiUrl('/api/portfolio/storage-locations'));
            const lj = (await lr.json()) as { dataDir?: string };
            dataDir = typeof lj?.dataDir === 'string' ? lj.dataDir : undefined;
          } catch {
            /* ignore */
          }
          const capLog = (
            typeof window !== 'undefined'
              ? (window as Window & { rawEngine?: { captureLog?: { append?: (e: unknown) => void } } }).rawEngine
                  ?.captureLog
              : undefined
          )?.append;
          void capLog?.({
            level: 'error',
            scope: 'listingTagPatch',
            message: msg,
            detail: {
              cardId: card.id,
              sourceUrl: snapshotUrl,
              itemId: r.itemId,
              soldAt: r.soldAt,
              price: r.price,
              dataDir,
            },
          });
        })();
      }
    } finally {
      setSaveTagBusy(false);
    }
  };

  const archivedTcg = useMemo(() => new Set(card.tcgplayerArchivedSaleKeys ?? []), [card.tcgplayerArchivedSaleKeys]);
  const archivedEbay = useMemo(() => new Set(card.ebayArchivedSaleKeys ?? []), [card.ebayArchivedSaleKeys]);
  const restoredFilteredEbay = useMemo(
    () => new Set(card.ebayRestoredFilteredSaleKeys ?? []),
    [card.ebayRestoredFilteredSaleKeys]
  );
  const disbandedEbay = useMemo(
    () => new Set(card.ebayDisbandedSaleKeys ?? []),
    [card.ebayDisbandedSaleKeys]
  );
  const rejectedEbayRows = useMemo(
    () => (ebay?.rejectedListings ?? []).filter((r) => !disbandedEbay.has(ebayListingSaleKey(r))),
    [ebay?.rejectedListings, disbandedEbay]
  );
  const excludedMismatchRows = useMemo(
    () =>
      rejectedEbayRows.filter((r) => (r as EbayFilteredListing).filterReason === 'listing_mismatch'),
    [rejectedEbayRows]
  );
  const ebayListBase = useMemo(
    () => ebayList.filter((r) => !disbandedEbay.has(ebayListingSaleKey(r))),
    [ebayList, disbandedEbay]
  );
  const restoredRejectedRows = useMemo(
    () => rejectedEbayRows.filter((r) => restoredFilteredEbay.has(ebayListingSaleKey(r))),
    [rejectedEbayRows, restoredFilteredEbay]
  );
  const ebayListWithRestored = useMemo(() => {
    const m = new Map<string, EbayExtensionListing>();
    for (const r of [...ebayListBase, ...restoredRejectedRows]) {
      const k = ebayListingSaleKey(r);
      if (!m.has(k)) m.set(k, r);
    }
    return Array.from(m.values());
  }, [ebayListBase, restoredRejectedRows]);

  const visibleTcgRows = useMemo(
    () =>
      rows.filter((r) => {
        if (archivedTcg.has(tcgSaleKey(r))) return false;
        const lang = r.languageTag ?? inferLanguageTag(tcg?.context?.language);
        if (listingLanguageFilter !== 'all' && lang !== listingLanguageFilter) return false;
        if (listingPhotosOnly && r.hasPhoto !== true) return false;
        if (listingHideSuspicious && r.suspiciousLanguagePump === true) return false;
        return true;
      }),
    [rows, archivedTcg, listingLanguageFilter, listingPhotosOnly, listingHideSuspicious, tcg?.context?.language]
  );
  const visibleEbayRows = useMemo(
    () =>
      ebayListWithRestored.filter((r) => {
        if (archivedEbay.has(ebayListingSaleKey(r))) return false;
        const lang = r.languageTag ?? inferLanguageTag(r.title);
        if (listingLanguageFilter !== 'all' && lang !== listingLanguageFilter) return false;
        if (listingPhotosOnly && r.hasPhoto !== true) return false;
        if (listingHideSuspicious && r.suspiciousLanguagePump === true) return false;
        return true;
      }),
    [
      ebayListWithRestored,
      archivedEbay,
      listingLanguageFilter,
      listingPhotosOnly,
      listingHideSuspicious,
    ]
  );
  const tcgRowsFilteredOutCount = Math.max(0, rows.length - visibleTcgRows.length);
  const ebayRowsFilteredOutCount = Math.max(0, ebayListWithRestored.length - visibleEbayRows.length);

  const stampFilteredEbayRows = useMemo(
    () => visibleEbayRows.filter((r) => matchesEbayTitleTagFilters(r, ebayStampFilter, ebaySealedFilter)),
    [visibleEbayRows, ebayStampFilter, ebaySealedFilter]
  );

  const toggleTcgArchive = (r: TcgplayerLatestSaleRow) => {
    const k = tcgSaleKey(r);
    const prev = card.tcgplayerArchivedSaleKeys ?? [];
    const next = prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k];
    onFieldChange(card.id, 'tcgplayerArchivedSaleKeys', next);
  };

  const toggleEbayArchive = (r: EbayExtensionListing) => {
    const k = ebayListingSaleKey(r);
    const prev = card.ebayArchivedSaleKeys ?? [];
    const next = prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k];
    onFieldChange(card.id, 'ebayArchivedSaleKeys', next);
  };
  const restoreFilteredEbay = (r: EbayExtensionListing) => {
    const k = ebayListingSaleKey(r);
    const prev = card.ebayRestoredFilteredSaleKeys ?? [];
    if (!prev.includes(k)) onFieldChange(card.id, 'ebayRestoredFilteredSaleKeys', [...prev, k]);
    const disPrev = card.ebayDisbandedSaleKeys ?? [];
    if (disPrev.includes(k)) onFieldChange(card.id, 'ebayDisbandedSaleKeys', disPrev.filter((x) => x !== k));
  };
  const disbandEbay = (r: EbayExtensionListing) => {
    const k = ebayListingSaleKey(r);
    const prev = card.ebayDisbandedSaleKeys ?? [];
    if (!prev.includes(k)) onFieldChange(card.id, 'ebayDisbandedSaleKeys', [...prev, k]);
    const archPrev = card.ebayArchivedSaleKeys ?? [];
    if (archPrev.includes(k)) onFieldChange(card.id, 'ebayArchivedSaleKeys', archPrev.filter((x) => x !== k));
    const resPrev = card.ebayRestoredFilteredSaleKeys ?? [];
    if (resPrev.includes(k)) onFieldChange(card.id, 'ebayRestoredFilteredSaleKeys', resPrev.filter((x) => x !== k));
  };
  const filteredQueueRows = useMemo(() => {
    const clarity = rejectedEbayRows
      .filter((r) => (r as EbayFilteredListing).filterReason !== 'listing_mismatch')
      .filter((r) => !restoredFilteredEbay.has(ebayListingSaleKey(r)))
      .map((r) => ({ row: r, source: 'clarity' as const }));
    const manual = ebayListWithRestored
      .filter((r) => archivedEbay.has(ebayListingSaleKey(r)))
      .map((r) => ({ row: r, source: 'manual' as const }));
    const all = [...clarity, ...manual].sort((a, b) => b.row.soldAt - a.row.soldAt);
    if (filteredSourceView === 'all') return all;
    return all.filter((x) => x.source === filteredSourceView);
  }, [rejectedEbayRows, restoredFilteredEbay, ebayListWithRestored, archivedEbay, filteredSourceView]);

  const tcgDaySeries = useMemo(() => {
    return buildTcgDaySeries(
      visibleTcgRows.map((r: TcgplayerLatestSaleRow) => ({ at: r.at, price: r.price, qty: r.qty }))
    );
  }, [visibleTcgRows]);

  const grandScopedEbayRows = useMemo(() => {
    if (grandScopeMode === 'raw') {
      return stampFilteredEbayRows.filter((r) => !r.isGraded || (includeAiInRaw && r.grader === 'AI'));
    }
    if (grandScopeMode === 'graded') {
      return stampFilteredEbayRows.filter((r) => {
        if (!r.isGraded) return false;
        if (!grandScopeGrader || r.grader !== grandScopeGrader) return false;
        if (grandScopeGradeTag === 'ALL') return true;
        return String(r.gradeTag || '').trim() === String(grandScopeGradeTag || '').trim();
      });
    }
    return stampFilteredEbayRows;
  }, [stampFilteredEbayRows, grandScopeMode, grandScopeGrader, grandScopeGradeTag, includeAiInRaw]);

  /** Grand overview scatter + day drilldown: respect Drilldown scope (matches eBay market chart / table when scoped). */
  const ebayRowsForChartAndDrilldown = useMemo(
    () =>
      grandScopedEbayRows.filter((r) =>
        ebayListingMatchesScope(r, ebayScope, rawConditionFilter, includeAiInRaw)
      ),
    [grandScopedEbayRows, ebayScope, rawConditionFilter, includeAiInRaw]
  );

  const ebayDaySeries = useMemo(() => {
    return buildEbayDaySeries(
      grandScopedEbayRows.map((r: EbayExtensionListing) => ({
        soldAt: r.soldAt,
        price: ebayEffectivePrice(r),
      }))
    );
  }, [grandScopedEbayRows]);
  const ebayDaySeriesRaw = useMemo(() => {
    return buildEbayDaySeries(
      grandScopedEbayRows
        .filter((r) => !r.isGraded || (includeAiInRaw && r.grader === 'AI'))
        .map((r: EbayExtensionListing) => ({
          soldAt: r.soldAt,
          price: ebayEffectivePrice(r),
        }))
    );
  }, [grandScopedEbayRows, includeAiInRaw]);
  const ebayDaySeriesGraded = useMemo(() => {
    return buildEbayDaySeries(
      grandScopedEbayRows
        .filter((r) => r.isGraded && r.grader !== 'AI')
        .map((r: EbayExtensionListing) => ({
          soldAt: r.soldAt,
          price: ebayEffectivePrice(r),
        }))
    );
  }, [grandScopedEbayRows]);

  const ebayBreakdown = useMemo(() => {
    const out = {
      graded: 0,
      raw: 0,
      pcStamp: 0,
      sealed: 0,
      withPhoto: 0,
      suspicious: 0,
      condition: { NM: 0, LP: 0, MP: 0, HP: 0, DMG: 0 } as Record<'NM' | 'LP' | 'MP' | 'HP' | 'DMG', number>,
      gradeTags: new Map<string, number>(),
    };
    for (const r of stampFilteredEbayRows) {
      if (r.isGraded) out.graded += 1;
      else out.raw += 1;
      if (effectivePokemonCenterStamp(r)) out.pcStamp += 1;
      if (effectiveSealedInTitle(r)) out.sealed += 1;
      if (r.hasPhoto === true) out.withPhoto += 1;
      if (r.suspiciousLanguagePump === true) out.suspicious += 1;
      if (r.conditionTag && r.conditionTag in out.condition) out.condition[r.conditionTag] += 1;
      if (r.gradeTag) out.gradeTags.set(r.gradeTag, (out.gradeTags.get(r.gradeTag) || 0) + 1);
    }
    const topGradeTags = Array.from(out.gradeTags.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    return { ...out, topGradeTags };
  }, [stampFilteredEbayRows]);

  const applyEbayPriceMode = (price: number): number => {
    if (!Number.isFinite(price)) return price;
    if (ebayPriceMode === 'rounded1') return Math.round(price);
    if (ebayPriceMode === 'rounded05') return Math.round(price * 2) / 2;
    return Number(price.toFixed(2));
  };

  const visibleEbayRowsSorted = useMemo(
    () => [...stampFilteredEbayRows].sort((a, b) => b.soldAt - a.soldAt),
    [stampFilteredEbayRows]
  );

  const ebayRowsForScope = useMemo(
    () =>
      visibleEbayRowsSorted.filter((r) =>
        ebayListingMatchesScope(r, ebayScope, rawConditionFilter, includeAiInRaw)
      ),
    [visibleEbayRowsSorted, ebayScope, rawConditionFilter, includeAiInRaw]
  );

  const ebayTableRowsDisplay = useMemo(() => {
    const merged = new Map<string, EbayExtensionListing>();
    for (const row of [...ebayListWithRestored, ...historyRows]) {
      const k = ebayListingSaleKey(row);
      if (!merged.has(k)) merged.set(k, row);
    }
    const sorted = Array.from(merged.values());
    const byTitleTags = (r: EbayExtensionListing) =>
      matchesEbayTitleTagFilters(r, ebayStampFilter, ebaySealedFilter);
    let rows = ebayTableMatchScope
      ? sorted.filter(
          (r) => byTitleTags(r) && ebayListingMatchesScope(r, ebayScope, rawConditionFilter, includeAiInRaw)
        )
      : sorted.filter(byTitleTags);
    const q = ebayTableSearch.trim().toLowerCase();
    if (q) {
      rows = rows.filter((r) =>
        [r.title, r.itemId || '', r.itemUrl || ''].some((v) => String(v).toLowerCase().includes(q))
      );
    }
    const toDateMs = (v: string, isEnd: boolean): number | null => {
      if (!v) return null;
      const ts = Date.parse(v);
      if (!Number.isFinite(ts)) return null;
      if (!isEnd) return ts;
      return ts + 86_399_999;
    };
    const startMs = toDateMs(ebayTableStartDate, false);
    const endMs = toDateMs(ebayTableEndDate, true);
    if (startMs != null) rows = rows.filter((r) => Number(r.soldAt) >= startMs);
    if (endMs != null) rows = rows.filter((r) => Number(r.soldAt) <= endMs);
    rows.sort((a, b) => {
      const dir = ebayTableSortDir === 'asc' ? 1 : -1;
      if (ebayTableSortBy === 'price') return (ebayEffectivePrice(a) - ebayEffectivePrice(b)) * dir;
      if (ebayTableSortBy === 'title') return a.title.localeCompare(b.title) * dir;
      return (Number(a.soldAt) - Number(b.soldAt)) * dir;
    });
    return rows;
  }, [
    ebayListWithRestored,
    historyRows,
    ebayTableMatchScope,
    ebayScope,
    rawConditionFilter,
    includeAiInRaw,
    ebayStampFilter,
    ebaySealedFilter,
    ebayTableSearch,
    ebayTableStartDate,
    ebayTableEndDate,
    ebayTableSortBy,
    ebayTableSortDir,
  ]);
  const ebayTableTotal = ebayTableRowsDisplay.length;
  const ebayTablePages = Math.max(1, Math.ceil(ebayTableTotal / ebayTablePageSize));
  const safeEbayTablePage = Math.min(ebayTablePage, ebayTablePages);
  const ebayTablePageRows = useMemo(() => {
    const start = (safeEbayTablePage - 1) * ebayTablePageSize;
    return ebayTableRowsDisplay.slice(start, start + ebayTablePageSize);
  }, [ebayTableRowsDisplay, safeEbayTablePage, ebayTablePageSize]);

  const ebayAcceptedMetrics = useMemo(() => {
    const recent10 = ebayRowsForScope.slice(0, 10);
    const recent30 = ebayRowsForScope.slice(0, 30);
    const modeMap = new Map<number, number>();
    for (const r of recent10) {
      const k = applyEbayPriceMode(ebayEffectivePrice(r));
      modeMap.set(k, (modeMap.get(k) || 0) + 1);
    }
    const modeEntries = Array.from(modeMap.entries()).sort((a, b) => b[1] - a[1] || b[0] - a[0]);
    const acceptedTrending = modeEntries.length ? modeEntries[0][0] : null;
    const monthAvg =
      recent30.length > 0 ? recent30.reduce((sum, r) => sum + ebayEffectivePrice(r), 0) / recent30.length : null;
    return {
      acceptedTrending,
      acceptedTrendingCount: modeEntries.length ? modeEntries[0][1] : 0,
      monthAvg,
      n10: recent10.length,
      n30: recent30.length,
    };
  }, [ebayRowsForScope, ebayPriceMode]);

  const ebaySeriesByScope = useMemo(() => {
    const byDay = new Map<
      number,
      {
        t: number;
        dayLabel: string;
        rawSum?: number;
        rawCount?: number;
        PSASum?: number;
        PSACount?: number;
        CGCSum?: number;
        CGCCount?: number;
        BGSSum?: number;
        BGSCount?: number;
        SGCSum?: number;
        SGCCount?: number;
        TAGSum?: number;
        TAGCount?: number;
        ACESum?: number;
        ACECount?: number;
        AISum?: number;
        AICount?: number;
      }
    >();
    const push = (
      soldAt: number,
      bucket: 'raw' | 'PSA' | 'CGC' | 'BGS' | 'SGC' | 'TAG' | 'ACE' | 'AI',
      price: number
    ) => {
      const t = startOfUtcDay(soldAt);
      const cur = byDay.get(t) || { t, dayLabel: dayLabel(t) };
      const sumKey = `${bucket}Sum` as const;
      const countKey = `${bucket}Count` as const;
      cur[sumKey] = ((cur[sumKey] as number | undefined) ?? 0) + price;
      cur[countKey] = ((cur[countKey] as number | undefined) ?? 0) + 1;
      byDay.set(t, cur);
    };
    for (const r of ebayRowsForScope) {
      const soldAt = Number(r.soldAt);
      const rawPrice = Number(ebayEffectivePrice(r));
      if (!Number.isFinite(soldAt) || !Number.isFinite(rawPrice)) continue;
      const px = applyEbayPriceMode(rawPrice);
      if (!r.isGraded) {
        push(soldAt, 'raw', px);
      } else if (r.grader) {
        push(soldAt, r.grader, px);
      }
    }
    return Array.from(byDay.values())
      .sort((a, b) => a.t - b.t)
      .map((d) => ({
        t: d.t,
        dayLabel: d.dayLabel,
        raw: d.rawCount ? (d.rawSum ?? 0) / d.rawCount : undefined,
        PSA: d.PSACount ? (d.PSASum ?? 0) / d.PSACount : undefined,
        CGC: d.CGCCount ? (d.CGCSum ?? 0) / d.CGCCount : undefined,
        BGS: d.BGSCount ? (d.BGSSum ?? 0) / d.BGSCount : undefined,
        SGC: d.SGCCount ? (d.SGCSum ?? 0) / d.SGCCount : undefined,
        TAG: d.TAGCount ? (d.TAGSum ?? 0) / d.TAGCount : undefined,
        ACE: d.ACECount ? (d.ACESum ?? 0) / d.ACECount : undefined,
        AI: d.AICount ? (d.AISum ?? 0) / d.AICount : undefined,
      }));
  }, [ebayRowsForScope, ebayPriceMode]);

  const ebayPeriodStats = useMemo(() => {
    const toMs = (t: number): number => {
      if (!Number.isFinite(t) || t <= 0) return NaN;
      return t < 1_000_000_000_000 ? t * 1000 : t;
    };
    const rowsWithTs = ebayRowsForScope
      .map((r) => ({ ...r, soldAtMs: toMs(r.soldAt) }))
      .filter((r) => Number.isFinite(r.soldAtMs));
    const now = rowsWithTs.length
      ? Math.max(...rowsWithTs.map((r) => r.soldAtMs))
      : Date.now();
    const nowDate = new Date(now);
    const utcWeekday = (nowDate.getUTCDay() + 6) % 7; // Mon=0..Sun=6
    const startOfThisWeek = startOfUtcDay(now - utcWeekday * 86_400_000);
    const startOfLastWeek = startOfThisWeek - 7 * 86_400_000;
    const startOfThisMonth = Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), 1);
    const startOfLastMonth = Date.UTC(
      nowDate.getUTCMonth() === 0 ? nowDate.getUTCFullYear() - 1 : nowDate.getUTCFullYear(),
      nowDate.getUTCMonth() === 0 ? 11 : nowDate.getUTCMonth() - 1,
      1
    );
    const endOfLastMonth = startOfThisMonth - 1;
    const endOfLastWeek = startOfThisWeek - 1;
    const calc = (label: string, startAt: number, endAt: number) => {
      const rows = rowsWithTs.filter((r) => r.soldAtMs >= startAt && r.soldAtMs <= endAt);
      const modeMap = new Map<number, number>();
      let min = Number.POSITIVE_INFINITY;
      let max = Number.NEGATIVE_INFINITY;
      let sum = 0;
      for (const r of rows) {
        const p = Number(ebayEffectivePrice(r));
        if (!Number.isFinite(p)) continue;
        sum += p;
        if (p < min) min = p;
        if (p > max) max = p;
        const bucket = applyEbayPriceMode(p);
        modeMap.set(bucket, (modeMap.get(bucket) || 0) + 1);
      }
      const modeEntries = Array.from(modeMap.entries()).sort((a, b) => b[1] - a[1] || b[0] - a[0]);
      const mode = modeEntries.length ? modeEntries[0][0] : null;
      const avg = rows.length ? sum / rows.length : null;
      return {
        label,
        count: rows.length,
        mode,
        avg,
        rangeMin: Number.isFinite(min) ? min : null,
        rangeMax: Number.isFinite(max) ? max : null,
      };
    };
    const thisWeek = calc('Current week', startOfThisWeek, now);
    const lastWeek = calc('Last week', startOfLastWeek, endOfLastWeek);
    const thisMonth = calc('This month', startOfThisMonth, now);
    const lastMonth = calc('Last month', startOfLastMonth, endOfLastMonth);
    const pct = (cur: number | null, prev: number | null): number | null =>
      cur != null && prev != null && prev > 0 ? ((cur - prev) / prev) * 100 : null;
    const periods = [
      { ...thisWeek, pctVsPrior: pct(thisWeek.mode, lastWeek.mode) },
      { ...lastWeek, pctVsPrior: null },
      { ...thisMonth, pctVsPrior: pct(thisMonth.mode, lastMonth.mode) },
      { ...lastMonth, pctVsPrior: null },
    ];
    return { anchorAt: now, periods };
  }, [ebayRowsForScope, ebayPriceMode]);

  const pcDaySeries = useMemo(() => {
    const priceRows = (card.priceHistory ?? [])
      .map((p: PriceSnapshot) => ({
        at: p.at,
        price: typeof p.raw === 'number' && Number.isFinite(p.raw) ? p.raw : NaN,
      }))
      .filter((x) => Number.isFinite(x.price));
    return buildPcDaySeries(priceRows as { at: number; price: number }[]);
  }, [card.priceHistory]);

  const dedupeRawPoints = (points: RawPoint[], keyOf: (p: RawPoint) => string): RawPoint[] => {
    const dedup = new Map<string, RawPoint>();
    for (const p of points) {
      const k = keyOf(p);
      if (!dedup.has(k)) dedup.set(k, p);
    }
    return Array.from(dedup.values()).sort((a, b) => a.t - b.t);
  };

  const pcRawSeries = useMemo(
    () =>
      (card.priceHistory ?? [])
        .map((p: PriceSnapshot): RawPoint | null => {
          const price = typeof p.raw === 'number' && Number.isFinite(p.raw) ? p.raw : null;
          if (price == null || !Number.isFinite(p.at)) return null;
          return {
            t: p.at,
            dayLabel: dayLabel(startOfUtcDay(p.at)),
            price,
            rawPrice: price,
            platform: 'pc',
            saleKey: pcSaleKey(p.at, price),
          };
        })
        .filter((x): x is RawPoint => Boolean(x))
        .sort((a, b) => a.t - b.t),
    [card.priceHistory]
  );

  const tcgRawSeries = useMemo(
    () => {
      const points = visibleTcgRows
        .map((r: TcgplayerLatestSaleRow): RawPoint | null =>
          Number.isFinite(r.at) && Number.isFinite(r.price)
            ? {
                t: r.at,
                dayLabel: dayLabel(startOfUtcDay(r.at)),
                price: r.price,
                rawPrice: r.price,
                platform: 'tcg',
                saleKey: tcgSaleKey(r),
              }
            : null
        )
        .filter((x): x is RawPoint => Boolean(x))
        .sort((a, b) => a.t - b.t);
      return dedupeRawPoints(points, (p) => `${startOfUtcDay(p.t)}|${p.rawPrice.toFixed(2)}|${p.saleKey}`);
    },
    [visibleTcgRows]
  );

  const ebayRawSeries = useMemo(
    () => {
      const points = ebayRowsForChartAndDrilldown
        .map((r: EbayExtensionListing): RawPoint | null =>
          Number.isFinite(Number(r.soldAt)) && Number.isFinite(Number(ebayEffectivePrice(r)))
            ? (() => {
                const pointPrice = Number(ebayEffectivePrice(r));
                return {
                  t: Number(r.soldAt),
                  dayLabel: dayLabel(startOfUtcDay(Number(r.soldAt))),
                  price: pointPrice,
                  rawPrice: pointPrice,
                  platform: 'ebay' as const,
                  saleKey: ebayListingSaleKey(r),
                };
              })()
            : null
        )
        .filter((x): x is RawPoint => Boolean(x))
        .sort((a, b) => a.t - b.t);
      return dedupeRawPoints(
        points,
        (p) => `${startOfUtcDay(p.t)}|${p.rawPrice.toFixed(2)}|${String(p.saleKey).slice(0, 40)}`
      );
    },
    [ebayRowsForChartAndDrilldown]
  );

  const grandSeries = useMemo(() => {
    const byDay = new Map<
      number,
      {
        t: number;
        dayLabel: string;
        tcg?: number;
        ebay?: number;
        ebayRaw?: number;
        ebayGraded?: number;
        pc?: number;
      }
    >();
    for (const d of pcDaySeries) byDay.set(d.t, { t: d.t, dayLabel: d.dayLabel, pc: d.avgPrice });
    for (const d of tcgDaySeries) {
      const cur = byDay.get(d.t) || { t: d.t, dayLabel: d.dayLabel };
      cur.tcg = d.avgPrice;
      byDay.set(d.t, cur);
    }
    for (const d of ebayDaySeries) {
      const cur = byDay.get(d.t) || { t: d.t, dayLabel: d.dayLabel };
      cur.ebay = d.avgPrice;
      byDay.set(d.t, cur);
    }
    for (const d of ebayDaySeriesRaw) {
      const cur = byDay.get(d.t) || { t: d.t, dayLabel: d.dayLabel };
      cur.ebayRaw = d.avgPrice;
      byDay.set(d.t, cur);
    }
    for (const d of ebayDaySeriesGraded) {
      const cur = byDay.get(d.t) || { t: d.t, dayLabel: d.dayLabel };
      cur.ebayGraded = d.avgPrice;
      byDay.set(d.t, cur);
    }
    return Array.from(byDay.values()).sort((a, b) => a.t - b.t);
  }, [pcDaySeries, tcgDaySeries, ebayDaySeries, ebayDaySeriesRaw, ebayDaySeriesGraded]);

  const pctMoveFromPrev = (rows: DayRow[]): number | null => {
    if (rows.length < 2) return null;
    const prev = rows[rows.length - 2].avgPrice;
    const cur = rows[rows.length - 1].avgPrice;
    if (!Number.isFinite(prev) || prev <= 0 || !Number.isFinite(cur)) return null;
    return ((cur - prev) / prev) * 100;
  };

  const latestOf = (rows: DayRow[]): number | null =>
    rows.length ? rows[rows.length - 1].avgPrice : null;

  const latestPc = latestOf(pcDaySeries);
  const latestTcg = latestOf(tcgDaySeries);
  const latestEbay = latestOf(ebayDaySeries);
  const latestEbayRaw = latestOf(ebayDaySeriesRaw);
  const latestEbayGraded = latestOf(ebayDaySeriesGraded);
  const movePc = pctMoveFromPrev(pcDaySeries);
  const moveTcg = pctMoveFromPrev(tcgDaySeries);
  const moveEbay = pctMoveFromPrev(ebayDaySeries);
  const moveEbayRaw = pctMoveFromPrev(ebayDaySeriesRaw);
  const moveEbayGraded = pctMoveFromPrev(ebayDaySeriesGraded);

  const pctDiff = (a: number | null, b: number | null): number | null => {
    if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
    return ((a - b) / b) * 100;
  };

  const normalizeDaySeries = (
    data: Array<{
      t: number;
      dayLabel: string;
      pc?: number;
      tcg?: number;
      ebay?: number;
      ebayRaw?: number;
      ebayGraded?: number;
    }>
  ) => {
    const firstPc = data.find((d) => typeof d.pc === 'number' && d.pc > 0)?.pc ?? null;
    const firstTcg = data.find((d) => typeof d.tcg === 'number' && d.tcg > 0)?.tcg ?? null;
    const firstEbay = data.find((d) => typeof d.ebay === 'number' && d.ebay > 0)?.ebay ?? null;
    const firstEbayRaw = data.find((d) => typeof d.ebayRaw === 'number' && d.ebayRaw > 0)?.ebayRaw ?? null;
    const firstEbayGraded =
      data.find((d) => typeof d.ebayGraded === 'number' && d.ebayGraded > 0)?.ebayGraded ?? null;
    return data.map((d) => ({
      ...d,
      pc: typeof d.pc === 'number' && firstPc ? (d.pc / firstPc) * 100 : undefined,
      tcg: typeof d.tcg === 'number' && firstTcg ? (d.tcg / firstTcg) * 100 : undefined,
      ebay: typeof d.ebay === 'number' && firstEbay ? (d.ebay / firstEbay) * 100 : undefined,
      ebayRaw:
        typeof d.ebayRaw === 'number' && firstEbayRaw ? (d.ebayRaw / firstEbayRaw) * 100 : undefined,
      ebayGraded:
        typeof d.ebayGraded === 'number' && firstEbayGraded
          ? (d.ebayGraded / firstEbayGraded) * 100
          : undefined,
    }));
  };

  const normalizeRaw = (rowsIn: RawPoint[]): RawPoint[] => {
    if (!rowsIn.length) return rowsIn;
    const base = rowsIn.find((r) => r.price > 0)?.price ?? null;
    if (!base) return rowsIn;
    return rowsIn.map((r) => ({ ...r, price: (r.price / base) * 100 }));
  };

  const asRecord = (v: unknown): Record<string, unknown> | null =>
    v && typeof v === 'object' ? (v as Record<string, unknown>) : null;

  const extractRawPointFromClick = (arg: unknown): RawPoint | null => {
    const root = asRecord(arg);
    const payload = root ? asRecord(root.payload) : null;
    const candidate = payload ?? root;
    if (!candidate) return null;
    const point = candidate as Partial<RawPoint>;
    if (!point.saleKey || !point.platform || !Number.isFinite(point.rawPrice ?? NaN)) return null;
    return point as RawPoint;
  };

  const extractPointTimestamp = (arg: unknown): number | null => {
    const queue: unknown[] = [arg];
    while (queue.length) {
      const cur = queue.shift();
      const rec = asRecord(cur);
      if (!rec) continue;
      const t = rec.t;
      if (typeof t === 'number' && Number.isFinite(t)) return t;
      if (typeof t === 'string') {
        const n = Number(t);
        if (Number.isFinite(n)) return n;
      }
      if (Array.isArray(rec.activePayload)) queue.push(...rec.activePayload);
      if (Array.isArray(rec.payload)) queue.push(...rec.payload);
      if (rec.payload) queue.push(rec.payload);
    }
    return null;
  };

  const onRawPointClick = (arg: unknown) => {
    const point = extractRawPointFromClick(arg);
    if (point) {
      setSelectedDayDrilldown(null);
      setSelectedRawPoint(point);
    }
  };

  const openDailyPointFromPlatform = (platform: RawPointPlatform, arg: unknown) => {
    const t = extractPointTimestamp(arg);
    if (!Number.isFinite(t)) return;
    const targetDay = startOfUtcDay(Number(t));
    const source = platform === 'pc' ? pcRawSeries : platform === 'tcg' ? tcgRawSeries : ebayRawSeries;
    const matches = source
      .filter((r) => startOfUtcDay(r.t) === targetDay)
      .sort((a, b) => b.t - a.t);
    if (!matches.length) return;
    if (matches.length === 1) {
      setSelectedDayDrilldown(null);
      setSelectedRawPoint(matches[0]);
      return;
    }
    setSelectedRawPoint(null);
    setSelectedDayDrilldown({
      platform,
      day: targetDay,
      points: matches,
    });
  };

  const openGrandScatterFromClick = (arg: unknown) => {
    const point = extractRawPointFromClick(arg);
    if (point) {
      setSelectedDayDrilldown(null);
      setSelectedRawPoint(point);
    }
  };

  const renderClickableDailyDot =
    (platform: RawPointPlatform, color: string) =>
    (props: unknown): ReactElement => {
      const shape = asRecord(props);
      if (!shape) return <g />;
      const cx = typeof shape.cx === 'number' ? shape.cx : NaN;
      const cy = typeof shape.cy === 'number' ? shape.cy : NaN;
      const payload = shape.payload;
      if (!Number.isFinite(cx) || !Number.isFinite(cy)) return <g />;
      return (
        <circle
          cx={cx}
          cy={cy}
          r={4}
          fill={color}
          stroke="#ffffff"
          strokeWidth={1.25}
          style={{ cursor: 'pointer' }}
          onClick={(e) => {
            e.stopPropagation();
            openDailyPointFromPlatform(platform, payload);
          }}
        />
      );
    };

  const renderClickableRawPoint = (props: unknown): ReactElement => {
    const shape = asRecord(props);
    if (!shape) return <g />;
    const cx = typeof shape.cx === 'number' ? shape.cx : NaN;
    const cy = typeof shape.cy === 'number' ? shape.cy : NaN;
    const fill = typeof shape.fill === 'string' ? shape.fill : '#334155';
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return <g />;
    return (
      <circle
        cx={cx}
        cy={cy}
        r={4}
        fill={fill}
        stroke="#ffffff"
        strokeWidth={1.2}
        style={{ cursor: 'pointer' }}
        onClick={(e) => {
          e.stopPropagation();
          onRawPointClick(shape.payload);
        }}
      />
    );
  };

  useEffect(() => {
    setSelectedDayDrilldown(null);
    setSelectedRawPoint(null);
  }, [card.id, viewMode, grandGranularity]);

  const selectedTcgRow = useMemo(() => {
    if (!selectedRawPoint || selectedRawPoint.platform !== 'tcg') return null;
    return rows.find((r) => tcgSaleKey(r) === selectedRawPoint.saleKey) ?? null;
  }, [rows, selectedRawPoint]);

  const selectedEbayRow = useMemo(() => {
    if (!selectedRawPoint || selectedRawPoint.platform !== 'ebay') return null;
    return ebayListWithRestored.find((r) => ebayListingSaleKey(r) === selectedRawPoint.saleKey) ?? null;
  }, [ebayListWithRestored, selectedRawPoint]);

  const selectedEbayListingUrl = useMemo(
    () => (selectedEbayRow ? ebayListingUrlForRow(selectedEbayRow) : null),
    [selectedEbayRow]
  );

  const selectedPcRow = useMemo(() => {
    if (!selectedRawPoint || selectedRawPoint.platform !== 'pc') return null;
    return (
      (card.priceHistory ?? []).find((p) => {
        const rawPrice = typeof p.raw === 'number' && Number.isFinite(p.raw) ? p.raw : null;
        if (rawPrice == null) return false;
        return pcSaleKey(p.at, rawPrice) === selectedRawPoint.saleKey;
      }) ?? null
    );
  }, [card.priceHistory, selectedRawPoint]);

  const carryForwardGrandSeries = (
    data: Array<{
      t: number;
      dayLabel: string;
      pc?: number;
      tcg?: number;
      ebay?: number;
      ebayRaw?: number;
      ebayGraded?: number;
    }>
  ) => {
    let lastPc: number | undefined;
    let lastTcg: number | undefined;
    let lastEbay: number | undefined;
    let lastEbayRaw: number | undefined;
    let lastEbayGraded: number | undefined;
    return data.map((d) => {
      if (typeof d.pc === 'number') lastPc = d.pc;
      if (typeof d.tcg === 'number') lastTcg = d.tcg;
      if (typeof d.ebay === 'number') lastEbay = d.ebay;
      if (typeof d.ebayRaw === 'number') lastEbayRaw = d.ebayRaw;
      if (typeof d.ebayGraded === 'number') lastEbayGraded = d.ebayGraded;
      return {
        ...d,
        pc: typeof d.pc === 'number' ? d.pc : lastPc,
        tcg: typeof d.tcg === 'number' ? d.tcg : lastTcg,
        ebay: typeof d.ebay === 'number' ? d.ebay : lastEbay,
        ebayRaw: typeof d.ebayRaw === 'number' ? d.ebayRaw : lastEbayRaw,
        ebayGraded: typeof d.ebayGraded === 'number' ? d.ebayGraded : lastEbayGraded,
      };
    });
  };

  const grandSeriesBase = useMemo(() => carryForwardGrandSeries(grandSeries), [grandSeries]);
  const grandSeriesView =
    grandValueMode === 'normalized' ? normalizeDaySeries(grandSeriesBase) : grandSeriesBase;
  const pcRawView = grandValueMode === 'normalized' ? normalizeRaw(pcRawSeries) : pcRawSeries;
  const tcgRawView = grandValueMode === 'normalized' ? normalizeRaw(tcgRawSeries) : tcgRawSeries;
  const ebayRawView = grandValueMode === 'normalized' ? normalizeRaw(ebayRawSeries) : ebayRawSeries;
  const showGrand = viewMode === 'all' || viewMode === 'grand';
  const showPc = viewMode === 'all' || viewMode === 'pc';
  const showPcRawHistory = showPc && !hidePcRawHistoryChart;
  const showTcg = viewMode === 'all' || viewMode === 'tcg';
  const showEbay = viewMode === 'all' || viewMode === 'ebay';

  return (
    <section className="xl:col-span-3 space-y-5">
      {listingTagPortfolioOnlyNotice && (
        <div className="flex items-start justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-950">
          <span>{listingTagPortfolioOnlyNotice}</span>
          <button
            type="button"
            className="shrink-0 font-semibold text-amber-900 hover:underline"
            onClick={() => setListingTagPortfolioOnlyNotice(null)}
          >
            Dismiss
          </button>
        </div>
      )}
      {showEbay && (
      <div className={`${entCardFrame} bg-gradient-to-b from-slate-50/90 to-white p-4`}>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h3 className="text-xs font-black uppercase tracking-[0.14em] text-slate-800 flex items-center gap-2">
            <BrandLogoImg brand="ebay" className="h-5 w-auto max-w-[4rem] object-contain" title="eBay" />
            eBay sold (API + extension)
            {ebayDataSourceLabel ? (
              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-sky-100 text-sky-800 border border-sky-200">
                {ebayDataSourceLabel}
              </span>
            ) : null}
          </h3>
          <div className="flex items-center gap-2">
            {card.ebayLastApiFetchedAt ? (
              <span className="text-[10px] text-slate-500">API {formatRelative(card.ebayLastApiFetchedAt)}</span>
            ) : null}
            {ebay?.capturedAt && (
              <span className="text-[10px] text-slate-500">Extension {formatRelative(ebay.capturedAt)}</span>
            )}
            <button
              type="button"
              onClick={() => {
                onFieldChange(card.id, 'ebaySales', null);
                onFieldChange(card.id, 'ebayLastApiFetchedAt', undefined);
                onFieldChange(card.id, 'ebayExtensionSnapshot', null);
                onFieldChange(card.id, 'ebayArchivedSaleKeys', []);
                onFieldChange(card.id, 'ebayRestoredFilteredSaleKeys', []);
                onFieldChange(card.id, 'ebayDisbandedSaleKeys', []);
              }}
              className="px-2 py-1 rounded-md border border-rose-200 bg-rose-50 text-rose-700 text-[10px] font-bold uppercase tracking-wider hover:bg-rose-100"
            >
              Wipe eBay Data
            </button>
          </div>
        </div>
        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1 mb-2">
          {([
            ['market', 'Market Data'],
            ['history', 'Capture events'],
            ['filtered', 'Filtered Queue'],
            ['excluded', 'Excluded entries'],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setEbayDataTab(id)}
              className={`px-2.5 py-1 text-[10px] font-semibold rounded-md ${
                ebayDataTab === id ? 'bg-white border border-slate-200 text-slate-900' : 'text-slate-500'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {ebayListWithRestored.length > 0 && ebay && (
          <p className="text-sm text-slate-700 mb-2">
            Extension captured <span className="font-semibold">{visibleEbayRows.length}</span> active sold listing
            {visibleEbayRows.length === 1 ? '' : 's'}
            {ebayListWithRestored.length !== visibleEbayRows.length ? ` · ${ebayListWithRestored.length - visibleEbayRows.length} archived` : ''}
            {ebayRowsFilteredOutCount > 0 ? ` · ${ebayRowsFilteredOutCount} filtered by language/photo/suspicious` : ''}
            {ebay.hasMore ? ' (more pages on eBay)' : ''} · {ebay.captureMode === 'deep' ? 'deep' : 'first page(s)'}
          </p>
        )}
        {ebayDataTab === 'market' && visibleEbayRows.length > 0 && (
          <div className="grid md:grid-cols-2 gap-2 mb-2 text-[11px]">
            <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
              <span className="font-semibold text-slate-700">Graded:</span> {ebayBreakdown.graded} ·{' '}
              <span className="font-semibold text-slate-700">Raw:</span> {ebayBreakdown.raw} ·{' '}
              <span className="font-semibold text-amber-800/90">PC stamp:</span> {ebayBreakdown.pcStamp} ·{' '}
              <span className="font-semibold text-slate-700">Sealed (title):</span> {ebayBreakdown.sealed} ·{' '}
              <span className="font-semibold text-slate-700">With photo:</span> {ebayBreakdown.withPhoto} ·{' '}
              <span className="font-semibold text-rose-700">Suspicious non-EN:</span> {ebayBreakdown.suspicious}
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
              {(['NM', 'LP', 'MP', 'HP', 'DMG'] as const)
                .map((k) => `${k} ${ebayBreakdown.condition[k]}`)
                .join(' · ')}
            </div>
          </div>
        )}
        {ebayDataTab === 'market' && ebayRowsForScope.length > 0 && (
          <>
          <div className="mb-1 text-[10px] text-slate-500">
            Period cards anchored to latest in-scope sale date:{' '}
            <span className="font-mono text-slate-700">
              {new Date(ebayPeriodStats.anchorAt).toLocaleDateString()}
            </span>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-2 mb-2 text-[11px]">
            {ebayPeriodStats.periods.map((p) => (
              <div key={p.label} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
                <div className="font-semibold text-slate-700">{p.label}</div>
                <div>Mode: <span className="font-mono text-slate-900">{p.mode != null ? fmtMoney(p.mode) : '—'}</span></div>
                <div>Avg: <span className="font-mono text-slate-900">{p.avg != null ? fmtMoney(p.avg) : '—'}</span></div>
                <div>
                  Range:{' '}
                  <span className="font-mono text-slate-900">
                    {p.rangeMin != null && p.rangeMax != null ? `${fmtMoney(p.rangeMin)} - ${fmtMoney(p.rangeMax)}` : '—'}
                  </span>
                </div>
                <div className="text-slate-500">
                  Rows: {p.count}
                  {p.pctVsPrior != null ? ` · ${p.pctVsPrior >= 0 ? '+' : ''}${p.pctVsPrior.toFixed(2)}% vs prior` : ''}
                </div>
              </div>
            ))}
          </div>
          </>
        )}
        {ebayDataTab === 'market' && ebayBreakdown.topGradeTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {ebayBreakdown.topGradeTags.map(([tag, count]) => (
              <span
                key={tag}
                className="text-[10px] font-semibold rounded-full border border-slate-200 bg-white px-2 py-0.5 text-slate-700"
              >
                {tag} · {count}
              </span>
            ))}
          </div>
        )}
        {ebayDataTab === 'market' && visibleEbayRows.length > 0 && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-8 gap-2 mb-2">
            <label className="text-[11px] text-slate-600">
              Price clustering
              <select
                value={ebayPriceMode}
                onChange={(e) => setEbayPriceMode(e.target.value as 'exact' | 'rounded1' | 'rounded05')}
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px]"
              >
                <option value="exact">Exact sold (default)</option>
                <option value="rounded1">Rounded to $1</option>
                <option value="rounded05">Rounded to $0.50</option>
              </select>
            </label>
            <label className="text-[11px] text-slate-600">
              Drilldown scope
              <select
                value={ebayScope}
                onChange={(e) =>
                  setEbayScope(e.target.value as EbayDrilldownScope)
                }
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px]"
              >
                <option value="all">All series</option>
                <option value="raw">Raw only</option>
                {(['PSA', 'CGC', 'BGS', 'SGC', 'TAG', 'ACE', 'AI'] as const).map((k) => (
                  <option key={k} value={k}>
                    {k} only
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[11px] text-slate-600">
              Raw condition
              <select
                value={rawConditionFilter}
                onChange={(e) => setRawConditionFilter(e.target.value as EbayRawConditionFilter)}
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px]"
              >
                <option value="all">All raw conditions</option>
                {(['NM', 'LP', 'MP', 'HP', 'DMG'] as const).map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[11px] text-slate-600 flex items-end">
              <span className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-2">
                <input
                  type="checkbox"
                  className="rounded border-slate-300"
                  checked={includeAiInRaw}
                  onChange={(e) => setIncludeAiInRaw(e.target.checked)}
                />
                Include AI-graded in Raw report
              </span>
            </label>
            <label className="text-[11px] text-slate-600">
              Poké Center stamp (eBay)
              <select
                value={ebayStampFilter}
                onChange={(e) => setEbayStampFilter(e.target.value as EbayStampFilter)}
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px]"
                title="Filter eBay sold rows only. Applies to raw and graded. Does not affect PriceCharting or TCGplayer."
              >
                <option value="all">All listings</option>
                <option value="stamp">Poké Center stamp only</option>
                <option value="no_stamp">No stamp</option>
              </select>
            </label>
            <label className="text-[11px] text-slate-600">
              &quot;Sealed&quot; in title (eBay)
              <select
                value={ebaySealedFilter}
                onChange={(e) => setEbaySealedFilter(e.target.value as EbaySealedFilter)}
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px]"
                title="Listings whose title includes the word sealed (plastic sleeve promos). Raw and graded."
              >
                <option value="all">All</option>
                <option value="sealed">Sealed in title</option>
                <option value="not_sealed">Not sealed in title</option>
              </select>
            </label>
            <label className="text-[11px] text-slate-600">
              Listing language
              <select
                value={listingLanguageFilter}
                onChange={(e) => setListingLanguageFilter(e.target.value as ListingLanguageFilter)}
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px]"
              >
                <option value="all">All languages</option>
                <option value="EN">English</option>
                <option value="JP">Japanese</option>
                <option value="KR">Korean</option>
                <option value="CN">Chinese</option>
                <option value="ES">Spanish</option>
                <option value="FR">French</option>
                <option value="DE">German</option>
                <option value="PT">Portuguese</option>
                <option value="IT">Italian</option>
                <option value="OTHER">Other</option>
                <option value="UNKNOWN">Unknown</option>
              </select>
            </label>
            <label className="text-[11px] text-slate-600 flex items-end">
              <span className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-2">
                <input
                  type="checkbox"
                  className="rounded border-slate-300"
                  checked={listingPhotosOnly}
                  onChange={(e) => setListingPhotosOnly(e.target.checked)}
                />
                Photos only
              </span>
            </label>
            <label className="text-[11px] text-slate-600 flex items-end">
              <span className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-2">
                <input
                  type="checkbox"
                  className="rounded border-slate-300"
                  checked={listingHideSuspicious}
                  onChange={(e) => setListingHideSuspicious(e.target.checked)}
                />
                Hide suspicious non-English rows
              </span>
            </label>
          </div>
        )}
        {ebayDataTab === 'market' && visibleEbayRows.length > 0 && (
          <div className="grid md:grid-cols-2 gap-2 mb-2 text-[11px]">
            <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
              <span className="font-semibold text-slate-700">Accepted trend (last {ebayAcceptedMetrics.n10}): </span>
              <span className="font-mono text-slate-900">
                {ebayAcceptedMetrics.acceptedTrending != null
                  ? fmtMoney(ebayAcceptedMetrics.acceptedTrending)
                  : '—'}
              </span>
              {ebayAcceptedMetrics.acceptedTrending != null && (
                <span className="text-slate-500"> · mode count {ebayAcceptedMetrics.acceptedTrendingCount}</span>
              )}
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
              <span className="font-semibold text-slate-700">Month accepted avg (last {ebayAcceptedMetrics.n30}): </span>
              <span className="font-mono text-slate-900">
                {ebayAcceptedMetrics.monthAvg != null ? fmtMoney(ebayAcceptedMetrics.monthAvg) : '—'}
              </span>
            </div>
          </div>
        )}
        {ebayDataTab === 'market' && ebayListWithRestored.length === 0 && (
          <p className="text-sm text-slate-600">
            <span className="font-semibold">No eBay extension rows yet.</span> Open the card&apos;s sold search, wait for
            results, capture (Ctrl+Shift+Y), then eBay refresh here so the client merges the latest file.
          </p>
        )}
        {ebayDataTab === 'market' && soldUrl && (
          <a
            href={soldUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:text-blue-800 mb-2"
          >
            Open sold search <ExternalLink size={12} />
          </a>
        )}
        {ebayDataTab === 'market' && ebaySeriesByScope.length > 0 && (
          <div className="h-56 w-full mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={ebaySeriesByScope} onClick={(e) => openDailyPointFromPlatform('ebay', e)}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="dayLabel" tick={{ fontSize: 10 }} />
                <YAxis yAxisId="l" tick={{ fontSize: 10 }} tickFormatter={(v) => (typeof v === 'number' ? `$${v.toFixed(0)}` : v)} />
                <Tooltip formatter={(v: number) => (typeof v === 'number' ? fmtMoney(v) : '—')} />
                <Legend />
                {(ebayScope === 'all' || ebayScope === 'raw') && (
                  <Line
                    yAxisId="l"
                    type="monotone"
                    dataKey="raw"
                    name="Raw"
                    stroke="#16a34a"
                    dot={renderClickableDailyDot('ebay', '#16a34a')}
                    strokeWidth={2}
                    connectNulls
                  />
                )}
                {(ebayScope === 'all' || ebayScope === 'PSA') && (
                  <Line
                    yAxisId="l"
                    type="monotone"
                    dataKey="PSA"
                    name="PSA"
                    stroke="#2563eb"
                    dot={renderClickableDailyDot('ebay', '#2563eb')}
                    strokeWidth={2}
                    connectNulls
                  />
                )}
                {(ebayScope === 'all' || ebayScope === 'CGC') && (
                  <Line
                    yAxisId="l"
                    type="monotone"
                    dataKey="CGC"
                    name="CGC"
                    stroke="#7c3aed"
                    dot={renderClickableDailyDot('ebay', '#7c3aed')}
                    strokeWidth={2}
                    connectNulls
                  />
                )}
                {(ebayScope === 'all' || ebayScope === 'BGS') && (
                  <Line
                    yAxisId="l"
                    type="monotone"
                    dataKey="BGS"
                    name="BGS"
                    stroke="#0f766e"
                    dot={renderClickableDailyDot('ebay', '#0f766e')}
                    strokeWidth={2}
                    connectNulls
                  />
                )}
                {(ebayScope === 'all' || ebayScope === 'SGC') && (
                  <Line
                    yAxisId="l"
                    type="monotone"
                    dataKey="SGC"
                    name="SGC"
                    stroke="#be123c"
                    dot={renderClickableDailyDot('ebay', '#be123c')}
                    strokeWidth={2}
                    connectNulls
                  />
                )}
                {(ebayScope === 'all' || ebayScope === 'TAG') && (
                  <Line
                    yAxisId="l"
                    type="monotone"
                    dataKey="TAG"
                    name="TAG"
                    stroke="#475569"
                    dot={renderClickableDailyDot('ebay', '#475569')}
                    strokeWidth={2}
                    connectNulls
                  />
                )}
                {(ebayScope === 'all' || ebayScope === 'ACE') && (
                  <Line
                    yAxisId="l"
                    type="monotone"
                    dataKey="ACE"
                    name="ACE"
                    stroke="#7c3aed"
                    dot={renderClickableDailyDot('ebay', '#7c3aed')}
                    strokeWidth={2}
                    connectNulls
                  />
                )}
                {(ebayScope === 'all' || ebayScope === 'AI') && (
                  <Line
                    yAxisId="l"
                    type="monotone"
                    dataKey="AI"
                    name="AI"
                    stroke="#0891b2"
                    dot={renderClickableDailyDot('ebay', '#0891b2')}
                    strokeWidth={2}
                    connectNulls
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
        {ebayDataTab === 'market' && (ebayListWithRestored.length > 0 || historyRows.length > 0) && (
          <div className="mt-2">
            <label className="mb-1.5 flex cursor-pointer items-center gap-2 text-[11px] text-slate-600 select-none">
              <input
                type="checkbox"
                className="rounded border-slate-300"
                checked={ebayTableMatchScope}
                onChange={(e) => setEbayTableMatchScope(e.target.checked)}
              />
              <span>
                <span className="font-semibold text-slate-700">Table matches drilldown</span>
                <span className="text-slate-500"> — same scope, stamp/sealed/language/photo/suspicious filters &amp; raw condition as chart/KPIs above</span>
              </span>
            </label>
            <p className="mb-1 text-[10px] text-slate-500 leading-snug max-w-prose">
              Links open canonical{' '}
              <span className="font-mono text-slate-600">ebay.com/itm/&lt;listing id&gt;</span>. eBay often redirects in-tab to a{' '}
              <span className="font-mono text-slate-600">/p/&lt;product id&gt;</span> catalog page for the same card — that does not change stored comps.
              Use the <span className="font-semibold text-slate-600">item #</span> beside each title to verify which sold listing a row came from.
            </p>
            <p className="mb-2 text-[11px] text-slate-600 leading-snug max-w-prose">
              <span className="font-semibold text-slate-800">Where to edit:</span> this table is the sold-listing grid — use{' '}
              <span className="font-semibold">Edit</span> / <span className="font-semibold">Archive</span> per row.
              Scroll inside the table to see every row on the current page (pagination above moves between pages).
            </p>
            <div className="mb-2 grid gap-2 md:grid-cols-6">
              <label className="text-[11px] text-slate-600 md:col-span-2">
                Search listings
                <input
                  value={ebayTableSearch}
                  onChange={(e) => setEbayTableSearch(e.target.value)}
                  placeholder="Title / item # / URL"
                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px]"
                />
              </label>
              <label className="text-[11px] text-slate-600">
                Start date
                <input
                  type="date"
                  value={ebayTableStartDate}
                  onChange={(e) => setEbayTableStartDate(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px]"
                />
              </label>
              <label className="text-[11px] text-slate-600">
                End date
                <input
                  type="date"
                  value={ebayTableEndDate}
                  onChange={(e) => setEbayTableEndDate(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px]"
                />
              </label>
              <label className="text-[11px] text-slate-600">
                Sort
                <select
                  value={ebayTableSortBy}
                  onChange={(e) => setEbayTableSortBy(e.target.value as EbayTableSortBy)}
                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px]"
                >
                  <option value="soldAt">Sold date</option>
                  <option value="price">Price</option>
                  <option value="title">Title</option>
                </select>
              </label>
              <label className="text-[11px] text-slate-600">
                Direction
                <select
                  value={ebayTableSortDir}
                  onChange={(e) => setEbayTableSortDir(e.target.value as SortDir)}
                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px]"
                >
                  <option value="desc">Desc</option>
                  <option value="asc">Asc</option>
                </select>
              </label>
            </div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600">
              <span>
                Showing <span className="font-semibold">{ebayTablePageRows.length}</span> of{' '}
                <span className="font-semibold">{ebayTableTotal}</span> rows
                {historyLoading ? ' · loading history…' : ''}
                {historyError ? ` · history sync error: ${historyError}` : ''}
              </span>
              <div className="inline-flex items-center gap-1">
                <select
                  value={ebayTablePageSize}
                  onChange={(e) => setEbayTablePageSize(Math.max(10, Number.parseInt(e.target.value, 10) || 50))}
                  className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px]"
                >
                  <option value="25">25 / page</option>
                  <option value="50">50 / page</option>
                  <option value="100">100 / page</option>
                </select>
                <button
                  type="button"
                  disabled={safeEbayTablePage <= 1}
                  onClick={() => setEbayTablePage((p) => Math.max(1, p - 1))}
                  className="rounded border border-slate-200 bg-white px-2 py-1 disabled:opacity-50"
                >
                  Prev
                </button>
                <span className="px-1 text-[10px]">
                  Page {safeEbayTablePage} / {ebayTablePages}
                </span>
                <button
                  type="button"
                  disabled={safeEbayTablePage >= ebayTablePages}
                  onClick={() => setEbayTablePage((p) => Math.min(ebayTablePages, p + 1))}
                  className="rounded border border-slate-200 bg-white px-2 py-1 disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
            <div className="overflow-x-auto max-h-[min(72vh,44rem)] overflow-y-auto border border-slate-200 rounded-lg">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-100/95 text-slate-600 text-[10px] uppercase">
                <tr>
                  <th className="text-left px-2 py-1.5">Sold</th>
                  <th className="text-left px-2 py-1.5">Spectrum</th>
                  <th className="text-left px-2 py-1.5">Title / Item #</th>
                  <th className="text-right px-2 py-1.5">$</th>
                  <th className="text-left px-2 py-1.5">Ship</th>
                  <th className="text-left px-2 py-1.5">Fmt</th>
                  <th className="text-left px-2 py-1.5">BO</th>
                  <th className="text-right px-2 py-1.5">Metric</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ebayTablePageRows.map((r: EbayExtensionListing) => {
                  const archived = archivedEbay.has(ebayListingSaleKey(r));
                  const listingUrl = ebayListingUrlForRow(r);
                  const resolvedItemId = resolveEbayListingItemId(r);
                  const itemSoldSearchUrl = resolvedItemId
                    ? ebaySoldSearchUrlForItemId(resolvedItemId)
                    : null;
                  const spec = ebaySpectrumParts(r);
                  return (
                  <tr key={r.itemId ?? `${r.soldAt}-${r.title}`} className={archived ? 'opacity-45 bg-slate-50' : ''}>
                    <td className="px-2 py-1 font-mono whitespace-nowrap text-slate-600">
                      {new Date(r.soldAt).toLocaleDateString()}
                    </td>
                    <td className="px-2 py-1 whitespace-nowrap align-middle">
                      <div className="flex items-center gap-1">
                        <span
                          className={`inline-block max-w-[7.5rem] truncate rounded px-1.5 py-0.5 text-[10px] font-bold ${
                            spec.kind === 'graded'
                              ? 'bg-sky-100 text-sky-900 ring-1 ring-sky-200/80'
                              : 'bg-emerald-100 text-emerald-900 ring-1 ring-emerald-200/80'
                          }`}
                          title={spec.label}
                        >
                          {spec.label}
                        </span>
                        <button
                          type="button"
                          onClick={() => beginEditSpectrum(r)}
                          className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-50"
                        >
                          Edit
                        </button>
                      </div>
                    </td>
                    <td className="px-2 py-1 text-slate-700 max-w-[14rem]" title={r.title}>
                      <div className="truncate">
                        {listingUrl ? (
                          <EbayExternalLink href={listingUrl} className="text-blue-600 hover:underline">
                            {r.title}
                          </EbayExternalLink>
                        ) : (
                          r.title
                        )}
                      </div>
                      {resolvedItemId ? (
                        <div className="mt-0.5 font-mono text-[10px] text-slate-500">
                          Item{' '}
                          {itemSoldSearchUrl ? (
                            <EbayExternalLink
                              href={itemSoldSearchUrl}
                              className="rounded bg-slate-100 px-1 py-px text-slate-700 hover:bg-slate-200"
                              title="Open eBay completed listings search for this item id (verify capture)"
                            >
                              {resolvedItemId}
                            </EbayExternalLink>
                          ) : (
                            <button
                              type="button"
                              className="rounded bg-slate-100 px-1 py-px text-slate-700 hover:bg-slate-200"
                              title="Copy listing id"
                              onClick={() => void navigator.clipboard?.writeText?.(resolvedItemId)}
                            >
                              {resolvedItemId}
                            </button>
                          )}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-2 py-1 text-right font-mono">
                      <div>{fmtMoney(r.price)}</div>
                      {r.isLot && (r.lotQuantity ?? 1) > 1 ? (
                        <div className="text-[10px] text-violet-700 font-semibold">
                          Lot x{r.lotQuantity} · {fmtMoney(ebayEffectivePrice(r))}/ea
                        </div>
                      ) : null}
                    </td>
                    <td className="px-2 py-1 whitespace-nowrap text-slate-600 tabular-nums" title="Shipping from capture">
                      {ebaySoldShipLabel(r)}
                    </td>
                    <td className="px-2 py-1 whitespace-nowrap text-slate-600" title="Auction vs Buy It Now (best-effort)">
                      {ebaySoldFormatLabel(r)}
                    </td>
                    <td className="px-2 py-1 whitespace-nowrap">
                      {r.bestOfferAccepted ? (
                        <span className="rounded bg-amber-50 px-1.5 py-px text-[10px] font-semibold text-amber-900 ring-1 ring-amber-200/80">
                          Best offer
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-right">
                      <button
                        type="button"
                        onClick={() => toggleEbayArchive(r)}
                        className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                          archived
                            ? 'text-emerald-700 border-emerald-300 bg-emerald-50'
                            : 'text-slate-500 border-slate-200 bg-white hover:bg-slate-50'
                        }`}
                      >
                        {archived ? 'Include' : 'Archive'}
                      </button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </div>
        )}
        {ebayDataTab === 'history' && (
          <div className="space-y-2">
            <p className="text-[11px] text-slate-700 leading-relaxed rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <span className="font-semibold">This tab is capture events, not each sold listing.</span> One row here
              means one time the extension saved a snapshot to the server; the <span className="font-semibold">Rows</span>{' '}
              column is how many listings were inside that snapshot (for example 5301 in one deep capture). To search,
              filter by sold date, sort, and use <span className="font-semibold">Edit</span> / <span className="font-semibold">Archive</span>, switch to{' '}
              <button
                type="button"
                onClick={() => setEbayDataTab('market')}
                className="font-semibold text-blue-700 underline decoration-blue-400/70 hover:text-blue-900"
              >
                Market Data
              </button>
              .
            </p>
            <div className="grid gap-2 md:grid-cols-6">
              <label className="text-[11px] text-slate-600 md:col-span-2">
                Search captures
                <input
                  value={captureHistorySearch}
                  onChange={(e) => setCaptureHistorySearch(e.target.value)}
                  placeholder="Title / URL"
                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px]"
                />
              </label>
              <label className="text-[11px] text-slate-600">
                Start
                <input
                  type="date"
                  value={captureHistoryStartDate}
                  onChange={(e) => setCaptureHistoryStartDate(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px]"
                />
              </label>
              <label className="text-[11px] text-slate-600">
                End
                <input
                  type="date"
                  value={captureHistoryEndDate}
                  onChange={(e) => setCaptureHistoryEndDate(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px]"
                />
              </label>
              <label className="text-[11px] text-slate-600">
                Sort
                <select
                  value={captureHistorySortBy}
                  onChange={(e) => setCaptureHistorySortBy(e.target.value as CaptureHistorySortBy)}
                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px]"
                >
                  <option value="capturedAt">Captured at</option>
                  <option value="title">Title</option>
                  <option value="url">URL</option>
                </select>
              </label>
              <label className="text-[11px] text-slate-600">
                Direction
                <select
                  value={captureHistorySortDir}
                  onChange={(e) => setCaptureHistorySortDir(e.target.value as SortDir)}
                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px]"
                >
                  <option value="desc">Desc</option>
                  <option value="asc">Asc</option>
                </select>
              </label>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600">
              <span>
                Capture events: <span className="font-semibold">{captureHistoryTotal}</span>
                {captureHistoryLoading ? ' · loading…' : ''}
                {captureHistoryError ? ` · ${captureHistoryError}` : ''}
              </span>
              <div className="inline-flex items-center gap-1">
                <select
                  value={captureHistoryLimit}
                  onChange={(e) => setCaptureHistoryLimit(Math.max(10, Number.parseInt(e.target.value, 10) || 30))}
                  className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px]"
                >
                  <option value="30">30 / page</option>
                  <option value="60">60 / page</option>
                  <option value="100">100 / page</option>
                </select>
                <button
                  type="button"
                  disabled={captureHistoryOffset <= 0}
                  onClick={() => setCaptureHistoryOffset((o) => Math.max(0, o - captureHistoryLimit))}
                  className="rounded border border-slate-200 bg-white px-2 py-1 disabled:opacity-50"
                >
                  Prev
                </button>
                <button
                  type="button"
                  disabled={captureHistoryOffset + captureHistoryRows.length >= captureHistoryTotal}
                  onClick={() => setCaptureHistoryOffset((o) => o + captureHistoryLimit)}
                  className="rounded border border-slate-200 bg-white px-2 py-1 disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
            <div className="overflow-x-auto max-h-56 overflow-y-auto border border-slate-200 rounded-lg">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-100/95 text-slate-600 text-[10px] uppercase">
                  <tr>
                    <th className="text-left px-2 py-1.5">Captured</th>
                    <th className="text-left px-2 py-1.5" title="Sold listing rows stored inside this snapshot">
                      Rows
                    </th>
                    <th className="text-left px-2 py-1.5">Mode</th>
                    <th className="text-left px-2 py-1.5">Query</th>
                    <th className="text-left px-2 py-1.5">URL</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {captureHistoryRows.map((row) => (
                    <tr key={`${row.capturedAt}-${row.url}`}>
                      <td className="px-2 py-1 whitespace-nowrap text-slate-600">{formatMarketSaleInstant(row.capturedAt)}</td>
                      <td className="px-2 py-1">{row.rowCount}</td>
                      <td className="px-2 py-1 uppercase">{row.captureMode}</td>
                      <td className="px-2 py-1 max-w-[14rem] truncate" title={row.query}>{row.query || '—'}</td>
                      <td className="px-2 py-1 max-w-[22rem] truncate" title={row.url}>
                        <a href={row.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                          {row.url}
                        </a>
                      </td>
                    </tr>
                  ))}
                  {!captureHistoryLoading && captureHistoryRows.length === 0 ? (
                    <tr>
                      <td className="px-2 py-2 text-slate-500" colSpan={5}>
                        No captures found for this card URL and filters.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {ebayDataTab === 'filtered' && (
          <div className="space-y-2">
            <div className="grid md:grid-cols-3 gap-2">
              <label className="text-[11px] text-slate-600">
                Filter source
                <select
                  value={filteredSourceView}
                  onChange={(e) => setFilteredSourceView(e.target.value as 'all' | 'clarity' | 'manual')}
                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px]"
                >
                  <option value="all">All filtered</option>
                  <option value="clarity">Clarity-filtered</option>
                  <option value="manual">Manual-filtered (archived)</option>
                </select>
              </label>
              <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px]">
                Pending filtered rows: <span className="font-semibold">{filteredQueueRows.length}</span>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px]">
                Disbanded rows: <span className="font-semibold">{disbandedEbay.size}</span>
              </div>
            </div>
            {filteredQueueRows.length === 0 ? (
              <p className="text-sm text-slate-500">No filtered rows in queue.</p>
            ) : (
              <div className="overflow-x-auto max-h-56 overflow-y-auto border border-slate-200 rounded-lg">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-slate-100/95 text-slate-600 text-[10px] uppercase">
                    <tr>
                      <th className="text-left px-2 py-1.5">Source</th>
                      <th className="text-left px-2 py-1.5">Sold</th>
                      <th className="text-left px-2 py-1.5">Spectrum</th>
                      <th className="text-left px-2 py-1.5">Title</th>
                      <th className="text-right px-2 py-1.5">$</th>
                      <th className="text-right px-2 py-1.5">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredQueueRows.slice(0, 120).map(({ row, source }) => {
                      const fs = ebaySpectrumParts(row);
                      return (
                      <tr key={`${source}-${ebayListingSaleKey(row)}`}>
                        <td className="px-2 py-1">{source === 'clarity' ? 'clarity' : 'manual'}</td>
                        <td className="px-2 py-1 font-mono whitespace-nowrap text-slate-600">
                          {new Date(row.soldAt).toLocaleDateString()}
                        </td>
                        <td className="px-2 py-1 whitespace-nowrap">
                          <span
                            className={`inline-block max-w-[7rem] truncate rounded px-1.5 py-0.5 text-[10px] font-bold ${
                              fs.kind === 'graded'
                                ? 'bg-sky-100 text-sky-900'
                                : 'bg-emerald-100 text-emerald-900'
                            }`}
                            title={fs.label}
                          >
                            {fs.label}
                          </span>
                        </td>
                        <td className="px-2 py-1 text-slate-700 max-w-[16rem] truncate" title={row.title}>
                          {row.title}
                        </td>
                        <td className="px-2 py-1 text-right font-mono">
                          <div>{fmtMoney(row.price)}</div>
                          {row.isLot && (row.lotQuantity ?? 1) > 1 ? (
                            <div className="text-[10px] text-violet-700 font-semibold">
                              Lot x{row.lotQuantity} · {fmtMoney(ebayEffectivePrice(row))}/ea
                            </div>
                          ) : null}
                        </td>
                        <td className="px-2 py-1 text-right space-x-1">
                          <button
                            type="button"
                            onClick={() =>
                              source === 'manual'
                                ? onFieldChange(
                                    card.id,
                                    'ebayArchivedSaleKeys',
                                    (card.ebayArchivedSaleKeys ?? []).filter((k) => k !== ebayListingSaleKey(row))
                                  )
                                : restoreFilteredEbay(row)
                            }
                            className="text-[10px] font-bold px-2 py-0.5 rounded border text-emerald-700 border-emerald-300 bg-emerald-50"
                          >
                            Restore
                          </button>
                          <button
                            type="button"
                            onClick={() => disbandEbay(row)}
                            className="text-[10px] font-bold px-2 py-0.5 rounded border text-slate-600 border-slate-300 bg-white"
                          >
                            Disband
                          </button>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
        {ebayDataTab === 'excluded' && (
          <div className="space-y-2">
            <p className="text-[11px] text-slate-600 leading-relaxed">
              These rows were removed automatically because the listing link, visible title, or row metadata did not
              agree (for example a raw-looking title paired with a graded listing URL). They are not included in market
              charts or the main sold table.
            </p>
            <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px]">
              Excluded rows: <span className="font-semibold">{excludedMismatchRows.length}</span>
            </div>
            {excludedMismatchRows.length === 0 ? (
              <p className="text-sm text-slate-500">No excluded entries for this snapshot.</p>
            ) : (
              <div className="overflow-x-auto max-h-56 overflow-y-auto border border-slate-200 rounded-lg">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-slate-100/95 text-slate-600 text-[10px] uppercase">
                    <tr>
                      <th className="text-left px-2 py-1.5">Sold</th>
                      <th className="text-left px-2 py-1.5">Spectrum</th>
                      <th className="text-left px-2 py-1.5">Title / Item #</th>
                      <th className="text-right px-2 py-1.5">$</th>
                      <th className="text-right px-2 py-1.5">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {excludedMismatchRows.slice(0, 120).map((row) => {
                      const fs = ebaySpectrumParts(row);
                      const listingUrl = ebayListingUrlForRow(row);
                      const resolvedItemId = resolveEbayListingItemId(row);
                      const itemSoldSearchUrl = resolvedItemId
                        ? ebaySoldSearchUrlForItemId(resolvedItemId)
                        : null;
                      return (
                        <tr key={ebayListingSaleKey(row)}>
                          <td className="px-2 py-1 font-mono whitespace-nowrap text-slate-600">
                            {new Date(row.soldAt).toLocaleDateString()}
                          </td>
                          <td className="px-2 py-1 whitespace-nowrap">
                            <span
                              className={`inline-block max-w-[7rem] truncate rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                fs.kind === 'graded'
                                  ? 'bg-sky-100 text-sky-900'
                                  : 'bg-emerald-100 text-emerald-900'
                              }`}
                              title={fs.label}
                            >
                              {fs.label}
                            </span>
                          </td>
                          <td className="px-2 py-1 text-slate-700 max-w-[16rem]" title={row.title}>
                            <div className="truncate">
                              {listingUrl ? (
                                <EbayExternalLink href={listingUrl} className="text-blue-600 hover:underline">
                                  {row.title}
                                </EbayExternalLink>
                              ) : (
                                row.title
                              )}
                            </div>
                            {resolvedItemId ? (
                              <div className="mt-0.5 font-mono text-[10px] text-slate-500">
                                Item{' '}
                                {itemSoldSearchUrl ? (
                                  <EbayExternalLink
                                    href={itemSoldSearchUrl}
                                    className="rounded bg-slate-100 px-1 py-px text-slate-700 hover:bg-slate-200"
                                    title="Open eBay completed listings search for this item id (verify capture)"
                                  >
                                    {resolvedItemId}
                                  </EbayExternalLink>
                                ) : (
                                  <button
                                    type="button"
                                    className="rounded bg-slate-100 px-1 py-px text-slate-700 hover:bg-slate-200"
                                    title="Copy listing id"
                                    onClick={() => void navigator.clipboard?.writeText?.(resolvedItemId)}
                                  >
                                    {resolvedItemId}
                                  </button>
                                )}
                              </div>
                            ) : null}
                          </td>
                          <td className="px-2 py-1 text-right font-mono">
                            <div>{fmtMoney(row.price)}</div>
                            {row.isLot && (row.lotQuantity ?? 1) > 1 ? (
                              <div className="text-[10px] text-violet-700 font-semibold">
                                Lot x{row.lotQuantity} · {fmtMoney(ebayEffectivePrice(row))}/ea
                              </div>
                            ) : null}
                          </td>
                          <td className="px-2 py-1 text-right space-x-1">
                            <button
                              type="button"
                              onClick={() => restoreFilteredEbay(row)}
                              className="text-[10px] font-bold px-2 py-0.5 rounded border text-emerald-700 border-emerald-300 bg-emerald-50"
                            >
                              Restore
                            </button>
                            <button
                              type="button"
                              onClick={() => disbandEbay(row)}
                              className="text-[10px] font-bold px-2 py-0.5 rounded border text-slate-600 border-slate-300 bg-white"
                            >
                              Disband
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
      )}
      {showGrand && (
      <div className={`${entCardFrame} bg-gradient-to-b from-slate-50/90 to-white p-4`}>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h3 className="text-xs font-black uppercase tracking-[0.14em] text-slate-800">
            Grand overview (PriceCharting vs TCG vs eBay)
          </h3>
          <span className="text-[10px] text-slate-500">
            {grandSeries.length} aligned day point{grandSeries.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
            {([
              ['daily', 'Daily average'],
              ['raw', 'Raw scatter'],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setGrandGranularity(id)}
                className={`px-2.5 py-1 text-[10px] font-semibold rounded-md ${
                  grandGranularity === id ? 'bg-white border border-slate-200 text-slate-900' : 'text-slate-500'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
            {([
              ['price', 'Price ($)'],
              ['normalized', '% normalized'],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setGrandValueMode(id)}
                className={`px-2.5 py-1 text-[10px] font-semibold rounded-md ${
                  grandValueMode === id ? 'bg-white border border-slate-200 text-slate-900' : 'text-slate-500'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid md:grid-cols-3 gap-2.5 mb-3 text-sm">
          {[
            ['PriceCharting', latestPc, movePc],
            ['TCG Player', latestTcg, moveTcg],
            ...(grandScopeMode === 'all'
              ? ([
                  ['eBay raw', latestEbayRaw, moveEbayRaw],
                  ['eBay graded', latestEbayGraded, moveEbayGraded],
                ] as Array<[string, number | null, number | null]>)
              : ([['eBay', latestEbay, moveEbay]] as Array<[string, number | null, number | null]>)),
          ].map(([label, px, mv]) => (
            <div key={String(label)} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <div className="text-[9px] font-bold uppercase tracking-widest text-slate-500">{label}</div>
              <div className="font-mono text-base font-semibold text-slate-900">
                {typeof px === 'number' ? fmtMoney(px) : '—'}
              </div>
              <div
                className={`text-[11px] font-semibold ${
                  typeof mv === 'number' ? (mv >= 0 ? 'text-emerald-600' : 'text-rose-600') : 'text-slate-400'
                }`}
              >
                {typeof mv === 'number' ? `${mv >= 0 ? '+' : ''}${mv.toFixed(2)}% vs previous` : 'No previous point'}
              </div>
            </div>
          ))}
        </div>
        <div className="grid md:grid-cols-3 gap-2.5 mb-3 text-[11px]">
          {[
            ['TCG vs PC', pctDiff(latestTcg, latestPc)],
            ['eBay vs PC', pctDiff(latestEbay, latestPc)],
            ['eBay vs TCG', pctDiff(latestEbay, latestTcg)],
          ].map(([label, v]) => (
            <div key={String(label)} className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5">
              <span className="text-slate-500">{label}: </span>
              <span className={typeof v === 'number' ? (v >= 0 ? 'text-emerald-700' : 'text-rose-700') : 'text-slate-400'}>
                {typeof v === 'number' ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` : '—'}
              </span>
            </div>
          ))}
        </div>
        {(grandGranularity === 'daily' ? grandSeriesView.length > 0 : pcRawView.length + tcgRawView.length + ebayRawView.length > 0) ? (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              {grandGranularity === 'daily' ? (
                <ComposedChart data={grandSeriesView}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="dayLabel" tick={{ fontSize: 10 }} />
                  <YAxis
                    tick={{ fontSize: 10 }}
                    tickFormatter={(v) =>
                      typeof v === 'number'
                        ? grandValueMode === 'normalized'
                          ? `${v.toFixed(0)}`
                          : `$${v.toFixed(0)}`
                        : v
                    }
                  />
                  <Tooltip
                    formatter={(v: number) =>
                      typeof v === 'number'
                        ? grandValueMode === 'normalized'
                          ? `${v.toFixed(2)}`
                          : fmtMoney(v)
                        : '—'
                    }
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="pc"
                    name="PriceCharting (raw)"
                    stroke="#334155"
                    dot={renderClickableDailyDot('pc', '#334155')}
                    strokeWidth={2}
                    connectNulls
                  />
                  <Line
                    type="monotone"
                    dataKey="tcg"
                    name="TCG avg sales"
                    stroke="#2563eb"
                    dot={renderClickableDailyDot('tcg', '#2563eb')}
                    strokeWidth={2}
                    connectNulls
                  />
                  <Line
                    type="monotone"
                    dataKey="ebay"
                    name="eBay avg sold"
                    stroke="#16a34a"
                    dot={renderClickableDailyDot('ebay', '#16a34a')}
                    strokeWidth={2}
                    connectNulls
                  />
                  {grandScopeMode === 'all' && (
                    <Line
                      type="monotone"
                      dataKey="ebayRaw"
                      name="eBay raw sold"
                      stroke="#0f766e"
                      strokeWidth={1.8}
                      connectNulls
                      dot={false}
                    />
                  )}
                  {grandScopeMode === 'all' && (
                    <Line
                      type="monotone"
                      dataKey="ebayGraded"
                      name="eBay graded sold"
                      stroke="#65a30d"
                      strokeWidth={1.8}
                      connectNulls
                      dot={false}
                    />
                  )}
                </ComposedChart>
              ) : (
                <ScatterChart
                  margin={{ top: 10, right: 20, left: 0, bottom: 10 }}
                  onClick={openGrandScatterFromClick}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis
                    dataKey="t"
                    type="number"
                    domain={['dataMin', 'dataMax']}
                    tick={{ fontSize: 10 }}
                    tickFormatter={(v) => dayLabel(startOfUtcDay(Number(v)))}
                  />
                  <YAxis
                    dataKey="price"
                    type="number"
                    tick={{ fontSize: 10 }}
                    tickFormatter={(v) =>
                      typeof v === 'number'
                        ? grandValueMode === 'normalized'
                          ? `${v.toFixed(0)}`
                          : `$${v.toFixed(0)}`
                        : v
                    }
                  />
                  <Tooltip
                    formatter={(v: number) =>
                      typeof v === 'number'
                        ? grandValueMode === 'normalized'
                          ? `${v.toFixed(2)}`
                          : fmtMoney(v)
                        : '—'
                    }
                    labelFormatter={(v) => dayLabel(startOfUtcDay(Number(v)))}
                  />
                  <Legend />
                  <Scatter
                    name="PriceCharting points"
                    data={pcRawView}
                    fill="#334155"
                    onClick={onRawPointClick}
                    shape={renderClickableRawPoint}
                  />
                  <Scatter
                    name="TCG sales points"
                    data={tcgRawView}
                    fill="#2563eb"
                    onClick={onRawPointClick}
                    shape={renderClickableRawPoint}
                  />
                  <Scatter
                    name="eBay sold points"
                    data={ebayRawView}
                    fill="#16a34a"
                    onClick={onRawPointClick}
                    shape={renderClickableRawPoint}
                  />
                </ScatterChart>
              )}
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-sm text-slate-500">Need at least one source series to render the grand overview.</p>
        )}
      </div>
      )}

      {showPcRawHistory && (
      <div className={`${entCardFrame} bg-gradient-to-b from-slate-50/90 to-white p-4`}>
        <div className="flex items-center justify-between gap-2 mb-3">
          <h3 className="text-xs font-black uppercase tracking-[0.14em] text-slate-800">PriceCharting raw history</h3>
          <span className="text-[10px] text-slate-500">{pcDaySeries.length} daily points</span>
        </div>
        {pcDaySeries.length > 0 ? (
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={pcDaySeries} onClick={(e) => openDailyPointFromPlatform('pc', e)}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="dayLabel" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => (typeof v === 'number' ? `$${v.toFixed(0)}` : v)} />
                <Tooltip formatter={(v: number) => (typeof v === 'number' ? fmtMoney(v) : '—')} />
                <Legend />
                <Line
                  dataKey="avgPrice"
                  name="PC raw avg"
                  stroke="#334155"
                  dot={renderClickableDailyDot('pc', '#334155')}
                  strokeWidth={2}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-sm text-slate-500">No PriceCharting history points yet.</p>
        )}
      </div>
      )}

      {showTcg && (
      <div className={`${entCardFrame} bg-gradient-to-b from-slate-50/90 to-white p-4`}>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h3 className="text-xs font-black uppercase tracking-[0.14em] text-slate-800 flex items-center gap-2">
            <BrandLogoImg brand="tcgplayer" className="h-5 w-auto max-w-[5rem] object-contain" title="TCGplayer" />
            Market &amp; latest sales (extension)
          </h3>
          {tcg?.capturedAt && (
            <span className="text-[10px] text-slate-500">Captured {formatRelative(tcg.capturedAt)}</span>
          )}
        </div>
        {tcg ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-sm">
            {(() => {
              const tcgDisplayMarket = resolveTcgDisplayMarketPrice(card);
              const tcgCapturedMarket = resolveTcgCapturedMarketPrice(card);
              const capturedDiff = tcgCapturedDiffersFromDisplay(card);
              const capturedCondition = tcg.context?.condition;
              return [
              ['TCG market (Near Mint)', tcgDisplayMarket, capturedDiff, tcgCapturedMarket, capturedCondition],
              ['Most recent sale', tcg.pricePoints.mostRecentSale],
              ['Listed median', tcg.pricePoints.listedMedian],
              ['Sellers / qty', tcg.pricePoints.currentSellers, tcg.pricePoints.currentQuantity],
            ].map((row) => {
              if (row.length === 5) {
                const [label, v, showCaptured, capturedVal, cond] = row as [
                  string,
                  number | null,
                  boolean,
                  number | null,
                  string | null | undefined,
                ];
                return (
                  <div key={label} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                    <div className="text-[9px] font-bold uppercase tracking-widest text-slate-500">{label}</div>
                    <div className="text-base font-mono font-semibold text-slate-900">
                      {v != null && Number.isFinite(v) ? fmtMoney(v) : '—'}
                    </div>
                    {showCaptured && capturedVal != null && Number.isFinite(capturedVal) ? (
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        Captured on page{cond ? ` (${cond})` : ''}: {fmtMoney(capturedVal)}
                      </div>
                    ) : null}
                  </div>
                );
              }
              if (row.length === 2) {
                const [label, v] = row as [string, number | null];
                return (
                  <div key={label} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                    <div className="text-[9px] font-bold uppercase tracking-widest text-slate-500">{label}</div>
                    <div className="text-base font-mono font-semibold text-slate-900">
                      {v != null && Number.isFinite(v) ? fmtMoney(v) : '—'}
                    </div>
                  </div>
                );
              }
              const [label, sellers, qty] = row as [string, number | null, number | null];
              return (
                <div key={label} className="rounded-lg border border-slate-200 bg-white px-3 py-2 sm:col-span-2">
                  <div className="text-[9px] font-bold uppercase tracking-widest text-slate-500">{label}</div>
                  <div className="text-base font-mono font-semibold text-slate-900">
                    {sellers != null && Number.isFinite(sellers) ? String(Math.round(sellers)) : '—'}
                    <span className="text-slate-400"> / </span>
                    {qty != null && Number.isFinite(qty) ? String(Math.round(qty)) : '—'}
                  </div>
                </div>
              );
            });
            })()}
            <div className="rounded-lg border border-slate-200 bg-amber-50/60 px-3 py-2 sm:col-span-2">
              <div className="text-[9px] font-bold uppercase tracking-widest text-amber-900/80">Sales tape</div>
              <div className="text-sm text-slate-800">
                {visibleTcgRows.length} active row{visibleTcgRows.length === 1 ? '' : 's'}
                {rows.length !== visibleTcgRows.length ? ` · ${rows.length - visibleTcgRows.length} archived` : ''}
                {tcgRowsFilteredOutCount > 0 ? ` · ${tcgRowsFilteredOutCount} filtered by language/photo/suspicious` : ''}
                {tcg.captureMode === 'deep' ? ' (deep load)' : ''}
                {tcg.hasMore ? ' · more on TCG' : ''}
                {visibleTcgRows.length === 0 ? (
                  <span className="block mt-1 text-amber-900/90 text-xs font-medium">
                    No table rows read — on the product page open Latest Sales (&quot;View more data&quot; if needed), then
                    capture (Ctrl+Shift+Y) and refresh this card.
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-600">
            <span className="font-semibold">No TCG extension snapshot on this card.</span> With the TCG product tab
            open, run a capture; then use Load on this card or Refresh so the app pulls{' '}
            <code className="text-xs bg-slate-100 px-1 rounded">/api/ext/capture/latest</code>.
          </p>
        )}

        {anomalies.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {anomalies.map((a, i) => (
              <span
                key={`${a.window}-${a.kind}-${i}`}
                className="text-[10px] font-medium rounded-md border border-violet-200 bg-violet-50 text-violet-900 px-2 py-0.5"
                title={a.label}
              >
                {a.label}
                {a.pct != null && Number.isFinite(a.pct) ? ` (${a.pct >= 0 ? '+' : ''}${a.pct.toFixed(0)}%)` : ''}
              </span>
            ))}
          </div>
        )}

        {tcgDaySeries.length > 0 && (
          <div className="mt-4 h-64 w-full">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">TCG — avg price &amp; # sales by day (UTC)</p>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={tcgDaySeries} onClick={(e) => openDailyPointFromPlatform('tcg', e)}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="dayLabel" tick={{ fontSize: 10 }} />
                <YAxis
                  yAxisId="l"
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v) => (typeof v === 'number' ? `$${v.toFixed(0)}` : v)}
                />
                <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip
                  formatter={(val: number, name: string) => (name === 'avgPrice' ? [fmtMoney(val), 'Avg price'] : [val, 'Lines'])}
                  labelFormatter={(_, p) => (p?.length ? p[0]?.payload?.dayLabel : '')}
                />
                <Legend />
                <Line
                  yAxisId="l"
                  type="monotone"
                  dataKey="avgPrice"
                  name="Avg price"
                  stroke="#2563eb"
                  dot={renderClickableDailyDot('tcg', '#2563eb')}
                  strokeWidth={2}
                />
                <Bar
                  yAxisId="r"
                  dataKey="salesCount"
                  name="# sales"
                  fill="#94a3b8"
                  barSize={14}
                  onClick={(d: unknown) => openDailyPointFromPlatform('tcg', d)}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        {rows.length > 0 && (
          <div className="mt-3 overflow-x-auto max-h-56 overflow-y-auto border border-slate-200 rounded-lg">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-100/95 text-slate-600 text-[10px] uppercase tracking-wider">
                <tr>
                  <th className="text-left px-2 py-1.5">Date</th>
                  <th className="text-left px-2 py-1.5">Cond</th>
                  <th className="text-right px-2 py-1.5">Qty</th>
                  <th className="text-right px-2 py-1.5">Price</th>
                  <th className="text-right px-2 py-1.5">Metric</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.slice(0, 60).map((r: TcgplayerLatestSaleRow, i: number) => {
                  const archived = archivedTcg.has(tcgSaleKey(r));
                  return (
                  <tr key={`${r.at}-${i}`} className={archived ? 'opacity-45 bg-slate-50' : ''}>
                    <td className="px-2 py-1 font-mono text-slate-600 whitespace-nowrap">
                      {new Date(r.at).toLocaleDateString()}
                    </td>
                    <td className="px-2 py-1 text-slate-600 max-w-[8rem] truncate" title={r.condition ?? ''}>
                      {r.condition ?? '—'}
                    </td>
                    <td className="px-2 py-1 text-right font-mono">{r.qty}</td>
                    <td className="px-2 py-1 text-right font-mono font-medium">{fmtMoney(r.price)}</td>
                    <td className="px-2 py-1 text-right">
                      <button
                        type="button"
                        onClick={() => toggleTcgArchive(r)}
                        className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                          archived
                            ? 'text-emerald-700 border-emerald-300 bg-emerald-50'
                            : 'text-slate-500 border-slate-200 bg-white hover:bg-slate-50'
                        }`}
                      >
                        {archived ? 'Include' : 'Archive'}
                      </button>
                    </td>
                  </tr>
                )})}
              </tbody>
            </table>
            {rows.length > 60 && <p className="text-[10px] text-slate-500 px-2 py-1">Showing 60 of {rows.length}…</p>}
          </div>
        )}
      </div>
      )}

      {editingEbayListing && (
        <div
          role="presentation"
          className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-900/45 px-4"
          onClick={cancelEditSpectrum}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="ebay-edit-listing-title"
            className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h4
                  id="ebay-edit-listing-title"
                  className="text-sm font-black uppercase tracking-wider text-slate-800"
                >
                  Edit listing
                </h4>
                <p className="mt-0.5 text-xs text-slate-600">
                  Sold {new Date(editingEbayListing.soldAt).toLocaleDateString()}
                </p>
                <p className="mt-1 text-xs text-slate-700 line-clamp-2" title={editingEbayListing.title}>
                  {editingEbayLinks?.listingUrl ? (
                    <EbayExternalLink
                      href={editingEbayLinks.listingUrl}
                      className="text-blue-600 hover:underline"
                    >
                      {editingEbayListing.title}
                    </EbayExternalLink>
                  ) : (
                    editingEbayListing.title
                  )}
                </p>
                {editingEbayLinks?.resolvedItemId ? (
                  <p className="mt-0.5 font-mono text-[10px] text-slate-500">
                    Item{' '}
                    {editingEbayLinks.itemSoldSearchUrl ? (
                      <EbayExternalLink
                        href={editingEbayLinks.itemSoldSearchUrl}
                        className="rounded bg-slate-100 px-1 py-px text-slate-700 hover:bg-slate-200"
                        title="Open eBay completed listings search for this item id (verify capture)"
                      >
                        {editingEbayLinks.resolvedItemId}
                      </EbayExternalLink>
                    ) : (
                      <button
                        type="button"
                        className="rounded bg-slate-100 px-1 py-px text-slate-700 hover:bg-slate-200"
                        title="Copy listing id"
                        onClick={() =>
                          void navigator.clipboard?.writeText?.(editingEbayLinks.resolvedItemId!)
                        }
                      >
                        {editingEbayLinks.resolvedItemId}
                      </button>
                    )}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={cancelEditSpectrum}
                className="shrink-0 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
            {saveTagError && (
              <p className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-[11px] text-rose-700">
                {saveTagError}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <select
                value={editIsGraded ? 'graded' : 'raw'}
                onChange={(e) => setEditIsGraded(e.target.value === 'graded')}
                className="rounded border border-slate-200 bg-white px-2 py-1"
              >
                <option value="raw">Raw</option>
                <option value="graded">Graded</option>
              </select>
              {editIsGraded ? (
                <>
                  <select
                    value={editGrader}
                    onChange={(e) =>
                      setEditGrader(
                        e.target.value as 'PSA' | 'CGC' | 'BGS' | 'SGC' | 'TAG' | 'ACE' | 'AI'
                      )
                    }
                    className="rounded border border-slate-200 bg-white px-2 py-1"
                  >
                    {(['PSA', 'CGC', 'BGS', 'SGC', 'TAG', 'ACE', 'AI'] as const).map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                  <input
                    value={editGradeTag}
                    onChange={(e) => setEditGradeTag(e.target.value)}
                    placeholder={`${editGrader} 10`}
                    className="w-28 rounded border border-slate-200 bg-white px-2 py-1"
                  />
                </>
              ) : (
                <select
                  value={editConditionTag}
                  onChange={(e) =>
                    setEditConditionTag(e.target.value as 'NM' | 'LP' | 'MP' | 'HP' | 'DMG')
                  }
                  className="rounded border border-slate-200 bg-white px-2 py-1"
                >
                  {(['NM', 'LP', 'MP', 'HP', 'DMG'] as const).map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              )}
              <input
                value={editPrice}
                onChange={(e) => setEditPrice(e.target.value)}
                placeholder="Price"
                className="w-24 rounded border border-slate-200 bg-white px-2 py-1 tabular-nums"
              />
              <label className="inline-flex items-center gap-1 text-slate-600 whitespace-nowrap">
                <input
                  type="checkbox"
                  className="rounded border-slate-300"
                  checked={editIsLot}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setEditIsLot(on);
                    if (!on) setEditLotQty('1');
                    else if (Number.parseInt(editLotQty, 10) < 2) setEditLotQty('2');
                  }}
                />
                Lot
              </label>
              <input
                value={editLotQty}
                onChange={(e) =>
                  setEditLotQty(e.target.value.replace(/[^\d]/g, '').slice(0, 3) || '1')
                }
                placeholder="Qty"
                disabled={!editIsLot}
                className="w-16 rounded border border-slate-200 bg-white px-2 py-1 disabled:bg-slate-100 disabled:text-slate-400"
                title="Lot quantity"
              />
              <label className="inline-flex items-center gap-1 text-slate-600 whitespace-nowrap">
                <input
                  type="checkbox"
                  className="rounded border-slate-300"
                  checked={editPcStamp}
                  onChange={(e) => setEditPcStamp(e.target.checked)}
                />
                PC stamp
              </label>
              <label className="inline-flex items-center gap-1 text-slate-600 whitespace-nowrap">
                <input
                  type="checkbox"
                  className="rounded border-slate-300"
                  checked={editSealed}
                  onChange={(e) => setEditSealed(e.target.checked)}
                />
                Sealed
              </label>
            </div>
            <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3">
              <button
                type="button"
                disabled={saveTagBusy}
                onClick={cancelEditSpectrum}
                className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saveTagBusy}
                onClick={() => void saveEditedSpectrum()}
                className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
      {selectedDayDrilldown && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-slate-900/45 px-4">
          <div className="w-full max-w-3xl rounded-xl border border-slate-200 bg-white p-4 shadow-2xl">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h4 className="text-sm font-black uppercase tracking-wider text-slate-800">
                  {selectedDayDrilldown.platform === 'pc'
                    ? 'PriceCharting day rows'
                    : selectedDayDrilldown.platform === 'tcg'
                      ? 'TCG day rows'
                      : 'eBay day rows'}
                </h4>
                <p className="text-xs text-slate-600">
                  {new Date(selectedDayDrilldown.day).toLocaleDateString()} ·{' '}
                  {selectedDayDrilldown.points.length} matched row
                  {selectedDayDrilldown.points.length === 1 ? '' : 's'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedDayDrilldown(null)}
                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
            <div className="max-h-[28rem] overflow-y-auto rounded-lg border border-slate-200">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-100/95 text-slate-600 text-[10px] uppercase tracking-wider">
                  <tr>
                    <th className="px-2 py-1.5 text-left">When</th>
                    <th className="px-2 py-1.5 text-left">Type</th>
                    <th className="px-2 py-1.5 text-left">Detail</th>
                    <th className="px-2 py-1.5 text-right">$</th>
                    <th className="px-2 py-1.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {selectedDayDrilldown.points.map((p) => {
                    const tcgRow =
                      selectedDayDrilldown.platform === 'tcg'
                        ? rows.find((r) => tcgSaleKey(r) === p.saleKey) ?? null
                        : null;
                    const ebayRow =
                      selectedDayDrilldown.platform === 'ebay'
                        ? ebayListWithRestored.find((r) => ebayListingSaleKey(r) === p.saleKey) ?? null
                        : null;
                    const detail =
                      selectedDayDrilldown.platform === 'pc'
                        ? 'Price history point'
                        : selectedDayDrilldown.platform === 'tcg'
                          ? `${tcgRow?.condition || '—'} · Qty ${tcgRow?.qty ?? '—'}`
                          : ebayRow?.title || 'eBay listing';
                    const typeLabel =
                      selectedDayDrilldown.platform === 'ebay'
                        ? ebayRow?.isGraded
                          ? ebayRow.gradeTag || ebayRow.grader || 'Graded'
                          : ebayRow?.conditionTag
                            ? `Raw · ${ebayRow.conditionTag}`
                            : 'Raw'
                        : selectedDayDrilldown.platform === 'tcg'
                          ? 'TCG'
                          : 'PriceCharting';
                    return (
                      <tr key={p.saleKey}>
                        <td className="px-2 py-1.5 font-mono text-slate-600 whitespace-nowrap">
                          {formatMarketSaleInstant(p.t)}
                        </td>
                        <td className="px-2 py-1.5 text-slate-700">{typeLabel}</td>
                        <td className="px-2 py-1.5 text-slate-700 max-w-[28rem] truncate" title={detail}>
                          {detail}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono">{fmtMoney(p.rawPrice)}</td>
                        <td className="px-2 py-1.5 text-right">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedDayDrilldown(null);
                              setSelectedRawPoint(p);
                            }}
                            className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            Open detail
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      {selectedRawPoint && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/45 px-4">
          <div className="w-full max-w-xl rounded-xl border border-slate-200 bg-white p-4 shadow-2xl">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h4 className="text-sm font-black uppercase tracking-wider text-slate-800">
                  {selectedRawPoint.platform === 'pc'
                    ? 'PriceCharting point'
                    : selectedRawPoint.platform === 'tcg'
                      ? 'TCG sale point'
                      : 'eBay sold point'}
                </h4>
                <p className="text-xs text-slate-600">
                  {formatMarketSaleInstant(selectedRawPoint.t)} · {fmtMoney(selectedRawPoint.rawPrice)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedRawPoint(null)}
                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
            {selectedRawPoint.platform === 'pc' && (
              <div className="space-y-2 text-sm text-slate-700">
                <p>Quick view for this PriceCharting snapshot point.</p>
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                  Recorded:{' '}
                  {selectedPcRow
                    ? formatMarketSaleInstant(selectedPcRow.at)
                    : 'Point no longer in current history'}
                </div>
              </div>
            )}
            {selectedRawPoint.platform === 'tcg' && (
              <div className="space-y-2 text-sm text-slate-700">
                {selectedTcgRow ? (
                  <>
                    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                      Condition: {selectedTcgRow.condition || '—'} · Qty: {selectedTcgRow.qty} · Price:{' '}
                      {fmtMoney(selectedTcgRow.price)}
                      {` · Language ${selectedTcgRow.languageTag ?? inferLanguageTag(tcg?.context?.language)}`}
                      {selectedTcgRow.suspiciousLanguagePump
                        ? ` · Suspicious non-English (${selectedTcgRow.suspiciousReason ?? 'non_english_in_english_market'})`
                        : ''}
                      {` · Photo ${selectedTcgRow.hasPhoto === true ? 'Yes' : selectedTcgRow.hasPhoto === false ? 'No' : 'Unknown'}`}
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleTcgArchive(selectedTcgRow)}
                      className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      {archivedTcg.has(tcgSaleKey(selectedTcgRow)) ? 'Include row' : 'Archive row'}
                    </button>
                  </>
                ) : (
                  <p className="text-xs text-slate-500">Matching TCG row not found in current table data.</p>
                )}
              </div>
            )}
            {selectedRawPoint.platform === 'ebay' && (
              <div className="space-y-2 text-sm text-slate-700">
                {selectedEbayRow ? (
                  <>
                    <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                      {selectedEbayRow.title}
                      {` · Language ${selectedEbayRow.languageTag ?? inferLanguageTag(selectedEbayRow.title)}`}
                      {` · Photo ${selectedEbayRow.hasPhoto === true ? 'Yes' : selectedEbayRow.hasPhoto === false ? 'No' : 'Unknown'}`}
                      {selectedEbayRow.suspiciousLanguagePump
                        ? ` · Suspicious non-English (${selectedEbayRow.suspiciousReason ?? 'non_english_in_english_market'})`
                        : ''}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {selectedEbayListingUrl && (
                        <EbayExternalLink
                          href={selectedEbayListingUrl}
                          className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                        >
                          Open listing <ExternalLink size={12} />
                        </EbayExternalLink>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setEbayDataTab('market');
                          setSelectedRawPoint(null);
                          setSelectedDayDrilldown(null);
                          beginEditSpectrum(selectedEbayRow);
                        }}
                        className="rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                      >
                        Quick edit spectrum
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleEbayArchive(selectedEbayRow)}
                        className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        {archivedEbay.has(ebayListingSaleKey(selectedEbayRow)) ? 'Include row' : 'Archive row'}
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-slate-500">Matching eBay row not found in current table data.</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
};
