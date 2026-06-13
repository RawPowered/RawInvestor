import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { Card, Fees, Hunt, HuntCriteria, HuntSchedule, Target } from '../types';
import { mergeHuntCriteria, suggestDealHuntThresholds } from '../dealHuntThresholds';
import { listingFitsSuggestedWatch } from '../dealHuntSuggested';
import { buildTargetProbe, targetProbeUnchanged } from './buildTargetProbe';
import { isRawEngineShell } from '../apiBase';
import { loadPortfolioMetaFromServer } from '../serverSync';
import { ebaySessionUiFromExtensionReport, parseEbaySessionExtensionReport } from '../ebaySessionFromMeta';

const MAX_COUNTDOWN_MS = 35 * 24 * 60 * 60 * 1000;
const EBAY_SIGN_IN_URL = 'https://signin.ebay.com/ws/eBayISAPI.dll?SignIn&ru=https%3A%2F%2Fwww.ebay.com%2F';
const EBAY_HOME_URL = 'https://www.ebay.com/';

function canonicalEbayListingUrl(t: Pick<Target, 'listingUrl' | 'itemId'>): string {
  const fromUrl = String(t.listingUrl || '').match(/\/itm\/(\d{6,})/i);
  const id = (t.itemId || '').trim() || (fromUrl ? fromUrl[1] : '');
  if (/^\d{6,}$/.test(id)) return `https://www.ebay.com/itm/${id}`;
  const u = String(t.listingUrl || '').trim().split('#')[0].split('?')[0];
  return u || 'https://www.ebay.com/';
}

function formatAuctionCountdown(endsAtMs: number | null | undefined): string {
  if (endsAtMs == null || !Number.isFinite(endsAtMs)) return 'unknown';
  const rem = endsAtMs - Date.now();
  if (rem <= 0) return 'ended or unknown';
  if (rem > MAX_COUNTDOWN_MS) return 'unclear — open listing';
  const mm = Math.floor(rem / 60_000);
  const ss = Math.floor((rem % 60_000) / 1000);
  if (mm >= 1440) {
    const d = Math.floor(mm / 1440);
    const hm = mm % 1440;
    const h = Math.floor(hm / 60);
    const m = hm % 60;
    return `${d}d ${h}h ${m}m`;
  }
  return `${mm}m ${ss}s`;
}

function liveBidBin(
  t: Target,
  hit: { row: { currentBid?: number | null; buyItNow?: number | null } } | null
): { bid: number | null; bin: number | null } {
  const bid =
    (hit?.row.currentBid != null && hit.row.currentBid > 0 ? hit.row.currentBid : null) ??
    (t.lastProbe?.currentBid != null && t.lastProbe.currentBid > 0 ? t.lastProbe.currentBid : null);
  const bin =
    (hit?.row.buyItNow != null && hit.row.buyItNow > 0 ? hit.row.buyItNow : null) ??
    (t.lastProbe?.buyItNow != null && t.lastProbe.buyItNow > 0 ? t.lastProbe.buyItNow : null);
  return { bid, bin };
}

/** Best display price for the hero row: live bid, BIN, SRP row price, or last captured listing price. */
function primaryAuctionUsd(
  t: Target,
  hit: {
    row: {
      currentBid?: number | null;
      buyItNow?: number | null;
      price?: number;
      listingKind?: string;
      bidCount?: number | null;
    };
  } | null
): { usd: number | null; label: string } {
  const { bid, bin } = liveBidBin(t, hit);
  if (bid != null) return { usd: bid, label: 'Current bid' };
  if (bin != null) return { usd: bin, label: 'Buy It Now' };
  const row = hit?.row;
  const pk = row && typeof row.price === 'number' && Number.isFinite(row.price) && row.price > 0 ? row.price : null;
  if (pk != null && row?.listingKind === 'auction') return { usd: pk, label: 'Listing price' };
  if (pk != null) return { usd: pk, label: 'Price' };
  const cap = t.listingPriceUsd;
  if (cap != null && Number.isFinite(cap) && cap > 0) return { usd: cap, label: 'Last captured' };
  return { usd: null, label: 'Current bid' };
}

type Props = {
  cards: Card[];
  fees: Fees;
  hunts: Hunt[];
  targets: Target[];
  onHuntsChange: Dispatch<SetStateAction<Hunt[]>>;
  onTargetsChange: Dispatch<SetStateAction<Target[]>>;
  syncState?: 'idle' | 'syncing' | 'saved' | 'offline';
};

type RawEngineBrowser = {
  newTab?: (url: string) => Promise<{ ok?: boolean; id?: number | null } | boolean>;
  openOrFocusUrl?: (url: string) => Promise<{ ok?: boolean; id?: number | null; reused?: boolean }>;
  activate?: (id: number) => Promise<boolean>;
  listTabs?: () => Promise<Array<{ id: number; url?: string; active?: boolean }>>;
  sniperClick?: (args: {
    tabId: number;
    maxBidUsd: number;
    maxBinUsd?: number;
  }) => Promise<{ ok: boolean; reason?: string }>;
  ebayListingProbe?: (args: { tabId: number }) => Promise<Record<string, unknown>>;
  ebaySessionStatus?: () => Promise<EbaySessionStatus>;
  clearEbaySession?: () => Promise<{ ok?: boolean; removedCookies?: number; error?: string }>;
};

type EbaySessionStatus = {
  ok?: boolean;
  status?: 'signed-in' | 'signed-out' | 'unknown';
  source?: string;
  url?: string;
  title?: string;
  error?: string;
};

const getRawEngineBrowser = (): RawEngineBrowser | null => {
  const w = window as Window & { rawEngine?: { browser?: RawEngineBrowser } };
  return w.rawEngine?.browser ?? null;
};

/** eBay US: sort by price + shipping, lowest first */
const ebayLowestPriceFirstUrl = (urlStr: string): string => {
  try {
    const u = new URL(urlStr.trim());
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (host !== 'ebay.com' && host !== 'm.ebay.com') return urlStr.trim();
    u.searchParams.set('_sop', '15');
    return u.toString();
  } catch {
    return urlStr;
  }
};

export const ArsenalWorkspace = ({
  cards,
  fees,
  hunts,
  targets,
  onHuntsChange,
  onTargetsChange,
  syncState,
}: Props) => {
  const [huntName, setHuntName] = useState('');
  const [huntUrl, setHuntUrl] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [editingHuntId, setEditingHuntId] = useState<string | null>(null);
  const [selectedHuntId, setSelectedHuntId] = useState<string>('');
  const [huntCardId, setHuntCardId] = useState('');
  const [huntCriteriaMaxBid, setHuntCriteriaMaxBid] = useState('');
  const [huntCriteriaMaxBin, setHuntCriteriaMaxBin] = useState('');
  const [huntCRawOnly, setHuntCRawOnly] = useState(false);
  const [huntCronLocal, setHuntCronLocal] = useState('');

  const [criteriaCardId, setCriteriaCardId] = useState<string>(() => cards[0]?.id ?? '');
  const [rawOnly, setRawOnly] = useState(false);
  const [watchTick, setWatchTick] = useState(0);
  const [ebaySession, setEbaySession] = useState<EbaySessionStatus>({ status: 'unknown' });
  const [ebaySessionBusy, setEbaySessionBusy] = useState(false);
  const [ebaySessionMessage, setEbaySessionMessage] = useState<string | null>(null);
  const targetsRef = useRef(targets);
  targetsRef.current = targets;

  useEffect(() => {
    if (!cards.length) return;
    if (cards.some((c) => c.id === criteriaCardId)) return;
    setCriteriaCardId(cards[0].id);
  }, [cards, criteriaCardId]);

  useEffect(() => {
    if (!hunts.length) {
      setSelectedHuntId('');
      return;
    }
    if (selectedHuntId && hunts.some((h) => h.id === selectedHuntId)) return;
    setSelectedHuntId(hunts[0].id);
  }, [hunts, selectedHuntId]);

  useEffect(() => {
    const id = window.setInterval(() => setWatchTick((v) => v + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const criteriaCard = useMemo(() => cards.find((c) => c.id === criteriaCardId), [cards, criteriaCardId]);
  const thresholds = useMemo(() => {
    if (!criteriaCard) return null;
    return suggestDealHuntThresholds(criteriaCard, fees);
  }, [criteriaCard, fees]);

  const activeListings = useMemo(() => {
    return cards.flatMap((card) =>
      (card.ebayActiveExtensionSnapshot?.listings ?? []).map((row) => ({
        card,
        row,
      }))
    );
  }, [cards]);

  useEffect(() => {
    onTargetsChange((prev) => {
      let changed = false;
      const next = prev.map((t) => {
        const hit = (() => {
          if (t.itemId) {
            const h = activeListings.find((x) => x.row.itemId === t.itemId);
            if (h) return h;
          }
          if (t.listingUrl) {
            const h = activeListings.find((x) => x.row.itemUrl === t.listingUrl);
            if (h) return h;
          }
          return null;
        })();
        if (!hit) return t;
        const probe = buildTargetProbe(hit.row, t);
        const row = hit.row;
        const rowTitle = row.title?.trim().slice(0, 220);
        const rowImg =
          typeof row.imageUrl === 'string' && row.imageUrl.trim() ? row.imageUrl.trim().slice(0, 2000) : '';
        let upd: Target = t;
        let touched = false;
        if (rowTitle && rowTitle !== (t.listingTitle ?? '')) {
          upd = { ...upd, listingTitle: rowTitle };
          touched = true;
        }
        if (rowImg && rowImg !== (t.listingImageUrl ?? '')) {
          upd = { ...upd, listingImageUrl: rowImg };
          touched = true;
        }
        if (!targetProbeUnchanged(t.lastProbe, probe)) {
          upd = { ...upd, lastProbe: probe, updatedAt: Date.now() };
          touched = true;
        } else if (touched) {
          upd = { ...upd, updatedAt: Date.now() };
        }
        if (touched) changed = true;
        return touched ? upd : t;
      });
      return changed ? next : prev;
    });
  }, [activeListings, onTargetsChange]);

  const activeListingForTarget = (t: Target) => {
    if (t.itemId) {
      const hit = activeListings.find((x) => x.row.itemId === t.itemId);
      if (hit) return hit;
    }
    if (t.listingUrl) {
      const hit = activeListings.find((x) => x.row.itemUrl === t.listingUrl);
      if (hit) return hit;
    }
    return null;
  };

  const timeoutByTargetId = useRef<Record<string, number>>({});
  const AUTO_PREOPEN_BUFFER_MS = 2000;

  const activeRows = useMemo(
    () =>
      cards.flatMap((card) =>
        (card.ebayActiveExtensionSnapshot?.listings ?? []).map((row) => ({
          card,
          row,
          suggested:
            thresholds?.maxBidUsd != null ? listingFitsSuggestedWatch(row, thresholds.maxBidUsd, rawOnly) : false,
        }))
      ),
    [cards, thresholds, rawOnly]
  );

  const selectedHunt = useMemo(
    () => hunts.find((h) => h.id === selectedHuntId) ?? null,
    [hunts, selectedHuntId]
  );

  const selectedHuntCeiling = selectedHunt?.criteria?.maxBidUsd ?? thresholds?.maxBidUsd ?? 0;

  /** Listings for the selected hunt: all cards, or only the hunt-linked card when set. */
  const activeRowsForHunt = useMemo(() => {
    if (!selectedHunt?.cardId) return activeRows;
    return activeRows.filter(({ card }) => card.id === selectedHunt.cardId);
  }, [activeRows, selectedHunt?.cardId]);

  const rowMatchesScopeText = (parts: { title: string; cardName: string; itemId: string }, scopeRaw: string) => {
    const tokens = scopeRaw
      .toLowerCase()
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (tokens.length === 0) return true;
    const hay = `${parts.title} ${parts.cardName} ${parts.itemId}`.toLowerCase();
    return tokens.every((t) => hay.includes(t));
  };

  const [scopeDraft, setScopeDraft] = useState('');
  useEffect(() => {
    setScopeDraft(selectedHunt?.scope ?? '');
  }, [selectedHuntId, selectedHunt?.scope]);

  const persistScope = () => {
    if (!selectedHunt) return;
    const nextScope = scopeDraft.trim() || undefined;
    if ((selectedHunt.scope ?? '') === (nextScope ?? '')) return;
    onHuntsChange(
      hunts.map((h) =>
        h.id === selectedHunt.id ? { ...h, scope: nextScope, updatedAt: Date.now() } : h
      )
    );
  };

  const huntListingRowsAll = useMemo(() => {
    const ceiling = selectedHuntCeiling;
    const rawForHunt = selectedHunt?.criteria?.rawOnly ?? rawOnly;
    const sugCeil =
      ceiling > 0 ? ceiling : thresholds?.maxBidUsd != null && thresholds.maxBidUsd > 0 ? thresholds.maxBidUsd : 0;
    return activeRowsForHunt.map(({ card, row }) => {
      const price =
        typeof row.currentBid === 'number' && row.currentBid > 0
          ? row.currentBid
          : row.price;
      const over = selectedHuntCeiling > 0 && price > selectedHuntCeiling;
      const suggested = sugCeil > 0 ? listingFitsSuggestedWatch(row, sugCeil, rawForHunt) : false;
      const imageUrl =
        typeof row.imageUrl === 'string' && row.imageUrl.trim() ? row.imageUrl.trim() : '';
      return {
        card,
        cardName: card.name,
        title: row.title,
        itemId: row.itemId ?? '',
        itemUrl: row.itemUrl ?? '',
        imageUrl,
        listingKind: row.listingKind ?? 'unknown',
        price,
        currentBid: row.currentBid ?? null,
        buyItNow: row.buyItNow ?? null,
        endsAtMs: row.endsAtMs ?? null,
        suggested,
        over,
      };
    });
  }, [activeRowsForHunt, selectedHuntCeiling, selectedHunt, rawOnly, thresholds]);

  const huntListingRows = useMemo(() => {
    const q = scopeDraft.trim();
    if (!q) return huntListingRowsAll;
    return huntListingRowsAll.filter((r) =>
      rowMatchesScopeText({ title: r.title, cardName: r.cardName, itemId: r.itemId }, q)
    );
  }, [huntListingRowsAll, scopeDraft]);

  const formatDateTimeLocal = (atMs: number | null | undefined): string => {
    if (!atMs || !Number.isFinite(atMs)) return '';
    const d = new Date(atMs);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const parseDateTimeLocal = (v: string): number | null => {
    if (!v.trim()) return null;
    const ms = Date.parse(v);
    return Number.isFinite(ms) ? ms : null;
  };

  const saveHunt = () => {
    const name = huntName.trim();
    const url = huntUrl.trim();
    if (!name || !url) return;

    const parseOptUsd = (s: string): number | undefined => {
      const n = parseFloat(String(s).trim());
      return Number.isFinite(n) && n >= 0 ? n : undefined;
    };
    const criteria: HuntCriteria | undefined = (() => {
      const maxBidUsd = parseOptUsd(huntCriteriaMaxBid);
      const maxBinUsd = parseOptUsd(huntCriteriaMaxBin);
      if (maxBidUsd == null && maxBinUsd == null && !huntCRawOnly) return undefined;
      return {
        ...(maxBidUsd != null ? { maxBidUsd } : {}),
        ...(maxBinUsd != null ? { maxBinUsd } : {}),
        ...(huntCRawOnly ? { rawOnly: true } : {}),
      };
    })();

    const cron = huntCronLocal.trim();
    let schedule: HuntSchedule | undefined;
    if (cron) {
      schedule = { kind: 'recurring', cronLocal: cron };
    } else if (editingHuntId) {
      const prev = hunts.find((h) => h.id === editingHuntId);
      if (prev?.schedule?.kind === 'once') schedule = prev.schedule;
    }

    const cardId = huntCardId.trim() || undefined;

    if (editingHuntId) {
      onHuntsChange(
        hunts.map((h) =>
          h.id === editingHuntId
            ? {
                ...h,
                name,
                searchUrl: url,
                cardId,
                criteria,
                schedule,
                updatedAt: Date.now(),
              }
            : h
        )
      );
      setEditingHuntId(null);
    } else {
      const nextHunt: Hunt = {
        id: crypto.randomUUID(),
        name,
        searchUrl: url,
        cardId,
        criteria,
        schedule,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      onHuntsChange([nextHunt, ...hunts]);
    }
    setHuntName('');
    setHuntUrl('');
    setHuntCardId('');
    setHuntCriteriaMaxBid('');
    setHuntCriteriaMaxBin('');
    setHuntCRawOnly(false);
    setHuntCronLocal('');
  };

  const addTargetFromUrl = () => {
    const url = targetUrl.trim();
    if (!url) return;
    if (!criteriaCard || !thresholds) return;
    const listingItemId = (url.match(/\/itm\/(\d{6,})/i) || [])[1];
    const already = listingItemId
      ? targets.some((t) => (t.itemId ?? '') === listingItemId)
      : targets.some((t) => t.listingUrl === url);
    if (already) return;

    const next: Target = {
      id: crypto.randomUUID(),
      listingUrl: url,
      itemId: listingItemId,
      huntId: undefined,
      cardId: criteriaCard?.id,
      label: '',
      maxBidUsd: thresholds.maxBidUsd,
      maxBinUsd: thresholds.maxBinUsd,
      sniperEnabled: false,
      sniperLeadMs: 1500,
      armed: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    onTargetsChange([next, ...targets]);
    setTargetUrl('');
  };

  const addTargetFromActiveRow = (row: {
    itemUrl: string | null;
    itemId: string | null;
    title?: string;
    imageUrl?: string | null;
    price?: number;
  }) => {
    if (!criteriaCard || !thresholds) return;
    const listingUrl = row.itemUrl || (row.itemId ? `https://www.ebay.com/itm/${row.itemId}` : '');
    if (!listingUrl) return;
    const itemId = row.itemId || (listingUrl.match(/\/itm\/(\d{6,})/i) || [])[1];
    const already = itemId ? targets.some((t) => t.itemId === itemId) : targets.some((t) => t.listingUrl === listingUrl);
    if (already) return;
    const cap = Date.now();
    const img =
      typeof row.imageUrl === 'string' && row.imageUrl.trim() ? row.imageUrl.trim().slice(0, 2000) : undefined;
    const next: Target = {
      id: crypto.randomUUID(),
      listingUrl,
      itemId,
      cardId: criteriaCard.id,
      listingTitle: row.title?.trim().slice(0, 220),
      listingImageUrl: img,
      listingPriceUsd:
        typeof row.price === 'number' && Number.isFinite(row.price) ? row.price : undefined,
      listingCapturedAt: cap,
      maxBidUsd: thresholds.maxBidUsd,
      maxBinUsd: thresholds.maxBinUsd,
      sniperEnabled: false,
      sniperLeadMs: 1500,
      armed: false,
      createdAt: cap,
      updatedAt: cap,
    };
    onTargetsChange([next, ...targets]);
  };

  const addTargetFromListingRow = (
    card: Card,
    row: { itemUrl: string | null; itemId: string | null; title?: string; price?: number; imageUrl?: string | null },
    huntId?: string
  ) => {
    const listingUrl = row.itemUrl || (row.itemId ? `https://www.ebay.com/itm/${row.itemId}` : '');
    if (!listingUrl) return;
    const itemId = row.itemId || (listingUrl.match(/\/itm\/(\d{6,})/i) || [])[1];
    const already = itemId ? targets.some((t) => t.itemId === itemId) : targets.some((t) => t.listingUrl === listingUrl);
    if (already) return;
    const base = suggestDealHuntThresholds(card, fees);
    const hunt = huntId ? hunts.find((h) => h.id === huntId) : selectedHunt;
    const merged = mergeHuntCriteria(base, hunt?.criteria);
    const cap = Date.now();
    const lp = typeof row.price === 'number' && Number.isFinite(row.price) ? row.price : undefined;
    const rowImg =
      typeof row.imageUrl === 'string' && row.imageUrl.trim() ? row.imageUrl.trim().slice(0, 2000) : undefined;
    const next: Target = {
      id: crypto.randomUUID(),
      listingUrl,
      itemId,
      huntId: hunt?.id,
      cardId: card.id,
      listingTitle: row.title?.trim().slice(0, 220),
      listingImageUrl: rowImg,
      listingPriceUsd: lp,
      listingCapturedAt: cap,
      maxBidUsd: merged.maxBidUsd,
      maxBinUsd: merged.maxBinUsd,
      sniperEnabled: false,
      sniperLeadMs: 1500,
      armed: false,
      createdAt: cap,
      updatedAt: cap,
    };
    onTargetsChange([next, ...targets]);
  };

  const copyHuntListings = async () => {
    const headers = [
      'cardName',
      'title',
      'listingKind',
      'price',
      'currentBid',
      'buyItNow',
      'endsAtMs',
      'itemId',
      'itemUrl',
      'suggested',
      'overCeiling',
    ];
    const escapeCsv = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [
      headers.join(','),
      ...huntListingRows.map((r) =>
        [
          r.cardName,
          r.title,
          r.listingKind,
          r.price,
          r.currentBid ?? '',
          r.buyItNow ?? '',
          r.endsAtMs ?? '',
          r.itemId,
          r.itemUrl,
          r.suggested ? '1' : '0',
          r.over ? '1' : '0',
        ]
          .map(escapeCsv)
          .join(',')
      ),
    ].join('\n');
    try {
      await navigator.clipboard.writeText(lines);
    } catch {
      // ignore
    }
  };

  const exportHuntListingsJson = () => {
    const blob = new Blob([JSON.stringify(huntListingRows, null, 2)], {
      type: 'application/json',
    });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = `hunt-listings-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
  };

  const setHuntNextCheckAt = (huntId: string, atMs: number | null) => {
    onHuntsChange(
      hunts.map((h) =>
        h.id !== huntId
          ? h
          : {
              ...h,
              schedule: atMs ? { kind: 'once', atMs } : undefined,
              updatedAt: Date.now(),
            }
      )
    );
  };

  const openUrl = async (url: string) => {
    const browser = getRawEngineBrowser();
    if (!browser?.newTab) {
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    await browser.newTab(url);
  };

  const openEbaySignIn = async () => {
    await openUrl(EBAY_SIGN_IN_URL);
  };

  const openEbayHome = async () => {
    await openUrl(EBAY_HOME_URL);
  };

  const checkEbaySession = async () => {
    setEbaySessionBusy(true);
    setEbaySessionMessage(null);
    try {
      const meta = await loadPortfolioMetaFromServer();
      const extReport = parseEbaySessionExtensionReport(
        meta as Record<string, unknown> | null | undefined
      );
      if (extReport) {
        const ui = ebaySessionUiFromExtensionReport(extReport);
        setEbaySession({
          ok: true,
          status: ui.status,
          source: ui.source,
          url: ui.url,
          title: ui.title,
        });
        return;
      }
      const browser = getRawEngineBrowser();
      if (!browser?.ebaySessionStatus) {
        setEbaySession({ status: 'unknown' });
        setEbaySessionMessage(
          isRawEngineShell()
            ? 'No fresh Edge extension session yet — open eBay in Edge with the capture extension, or rely on the embedded tab after opening eBay there.'
            : 'Open the Raw Investor app for an embedded eBay probe, or use Edge with the MV3 extension while the API server is running.'
        );
        return;
      }
      const status = await browser.ebaySessionStatus();
      setEbaySession(
        status && typeof status === 'object'
          ? { ...status, source: status.source ?? 'embedded' }
          : { status: 'unknown', source: 'embedded' }
      );
    } catch (err) {
      setEbaySession({
        status: 'unknown',
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setEbaySessionBusy(false);
    }
  };

  const clearEbaySession = async () => {
    const browser = getRawEngineBrowser();
    if (!browser?.clearEbaySession) return;
    setEbaySessionBusy(true);
    setEbaySessionMessage(null);
    try {
      const out = await browser.clearEbaySession();
      setEbaySession({ status: 'signed-out', ok: true });
      setEbaySessionMessage(`Cleared eBay cookies/storage${out?.removedCookies != null ? ` (${out.removedCookies} cookies)` : ''}.`);
    } catch (err) {
      setEbaySessionMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setEbaySessionBusy(false);
    }
  };

  useEffect(() => {
    void checkEbaySession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** One click anchored to `endsAtMs - sniperLeadMs` when end time is known (armed auto-fire). */
  const executeSniperClick = async (t: Target) => {
    if (!t.sniperEnabled) return;
    const browser = getRawEngineBrowser();
    if (!browser?.sniperClick) return;
    let tabId: number | null = null;
    if (browser.openOrFocusUrl) {
      const opened = await browser.openOrFocusUrl(t.listingUrl);
      tabId = typeof opened?.id === 'number' ? opened.id : null;
    } else if (browser.newTab) {
      const created = await browser.newTab(t.listingUrl);
      tabId = typeof created === 'object' && created && typeof created.id === 'number' ? created.id : null;
    }
    if (tabId == null) return;
    const maxBinUsd = t.maxBinUsd ?? t.maxBidUsd;
    const endsAtMs = t.lastProbe?.endsAtMs;
    const now = Date.now();
    let waitMs = 1100;
    if (typeof endsAtMs === 'number' && Number.isFinite(endsAtMs) && endsAtMs > now + 250) {
      waitMs = Math.max(200, endsAtMs - t.sniperLeadMs - now - 120);
    } else {
      waitMs = Math.max(800, Math.min(4000, t.sniperLeadMs));
    }
    window.setTimeout(() => {
      void browser.sniperClick?.({ tabId, maxBidUsd: t.maxBidUsd, maxBinUsd });
    }, waitMs);
  };

  /** Manual DOM check: opens listing and fires sniper script after a short settle (not tied to auction end). */
  const runSniperTestDom = async (t: Target) => {
    const browser = getRawEngineBrowser();
    if (!browser?.sniperClick) return;
    let tabId: number | null = null;
    if (browser.openOrFocusUrl) {
      const opened = await browser.openOrFocusUrl(t.listingUrl);
      tabId = typeof opened?.id === 'number' ? opened.id : null;
    } else if (browser.newTab) {
      const created = await browser.newTab(t.listingUrl);
      tabId = typeof created === 'object' && created && typeof created.id === 'number' ? created.id : null;
    }
    if (tabId == null) return;
    const maxBinUsd = t.maxBinUsd ?? t.maxBidUsd;
    window.setTimeout(() => {
      void browser.sniperClick?.({ tabId, maxBidUsd: t.maxBidUsd, maxBinUsd });
    }, 1100);
  };

  // Auto-trigger armed Targets based on the latest active listing capture.
  useEffect(() => {
    for (const id of Object.keys(timeoutByTargetId.current)) {
      window.clearTimeout(timeoutByTargetId.current[id]);
    }
    timeoutByTargetId.current = {};

    const armedTargets = targets.filter((t) => t.armed && t.sniperEnabled);
    const now = Date.now();
    for (const t of armedTargets) {
      if (t.lastProbe?.highBidderAboveThreshold) continue;
      const hit = activeListingForTarget(t);
      const endsAtMs = hit?.row.endsAtMs ?? t.lastProbe?.endsAtMs ?? null;
      if (!endsAtMs || !Number.isFinite(endsAtMs) || endsAtMs <= now) continue;

      const bidPrice =
        (typeof hit?.row.currentBid === 'number' && hit.row.currentBid > 0 ? hit.row.currentBid : null) ??
        (typeof t.lastProbe?.currentBid === 'number' && t.lastProbe.currentBid > 0 ? t.lastProbe.currentBid : null);
      if (bidPrice != null && bidPrice > t.maxBidUsd) continue;

      const triggerAt = endsAtMs - t.sniperLeadMs - AUTO_PREOPEN_BUFFER_MS;
      const delay = Math.max(0, triggerAt - now);
      const targetId = t.id;

      const handle = window.setTimeout(() => {
        const cur = targetsRef.current.find((x) => x.id === targetId);
        if (!cur?.sniperEnabled) return;
        onTargetsChange((prev) =>
          prev.map((x) => (x.id === targetId ? { ...x, armed: false, updatedAt: Date.now() } : x))
        );
        void executeSniperClick(cur);
      }, delay);

      timeoutByTargetId.current[t.id] = handle;
    }

    return () => {
      for (const id of Object.keys(timeoutByTargetId.current)) {
        window.clearTimeout(timeoutByTargetId.current[id]);
      }
      timeoutByTargetId.current = {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targets, activeListings]);

  const ebaySessionStatus = ebaySession.status || 'unknown';
  const ebayStatusLabel =
    ebaySessionStatus === 'signed-in'
      ? 'Signed in'
      : ebaySessionStatus === 'signed-out'
        ? 'Signed out'
        : 'Unknown';
  const ebayStatusClass =
    ebaySessionStatus === 'signed-in'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : ebaySessionStatus === 'signed-out'
        ? 'border-rose-200 bg-rose-50 text-rose-800'
        : 'border-slate-200 bg-slate-50 text-slate-700';

  return (
    <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-5 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <h3 className="text-sm font-black uppercase tracking-[0.12em] text-slate-800">Arsenal</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Hunts and targets sync to portfolio storage. RawEngine polls armed sniper targets (and Live watch) on eBay
            item tabs and PATCHes bids/end times. Armed auto-fire opens the listing then clicks at end minus lead ms;
            Test sniper only checks DOM (not auction-synchronized).
          </p>
        </div>
        {syncState ? (
          <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded-md bg-slate-100 text-slate-600 border border-slate-200">
            {syncState}
          </span>
        ) : null}
      </div>

      <div
        className={`rounded-xl border px-4 py-3 text-sm ${
          isRawEngineShell()
            ? 'border-amber-200 bg-amber-50/95 text-amber-950'
            : 'border-slate-200 bg-slate-50 text-slate-800'
        }`}
        role="status"
      >
        <p className="font-semibold tracking-tight">
          {isRawEngineShell() ? 'eBay sign-in (Raw Engine)' : 'Live prices & sniper'}
        </p>
        <p className="mt-1 text-[13px] leading-snug opacity-95">
          {isRawEngineShell() ? (
            <>
              Stay signed in to eBay in the <strong>Raw Engine</strong> browser tab that loads this listing. If you
              are logged out, bids and countdowns will be wrong or missing. Use eBay email/password or passkey inside
              RawInvestor; signing in through Google in another browser will not share cookies back here.
            </>
          ) : (
            <>
              Run <strong>Raw Engine</strong> for background listing probes and sniper timing. In a normal browser
              tab, Arsenal only shows data already on your cards.
            </>
          )}
        </p>
        <p className="mt-2 text-xs leading-relaxed border-t border-black/10 pt-2 opacity-90">
          <span className="font-semibold">Armed + Sniper</span> tries to click eBay&apos;s bid flow near the end
          (auction end minus your lead ms) — it does <span className="font-semibold">not</span> only alert you; you
          should watch the tab and confirm. <span className="font-semibold">Live watch</span> refreshes bid/BIN/time
          only. <span className="font-semibold">Test sniper</span> runs the click script once after ~1s for debugging.
        </p>
        {isRawEngineShell() ? (
          <div className="mt-3 rounded-xl border border-amber-200 bg-white/80 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-black uppercase tracking-wider text-amber-950">eBay Login Manager</p>
                <p className="mt-1 text-xs opacity-90">
                  Status:{' '}
                  <span className={`rounded-md border px-2 py-0.5 font-bold ${ebayStatusClass}`}>{ebayStatusLabel}</span>
                  {ebaySession.source ? <span className="ml-2 opacity-70">via {ebaySession.source}</span> : null}
                </p>
              </div>
              <button
                type="button"
                className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-bold text-amber-950 shadow-sm hover:bg-amber-100 disabled:opacity-50"
                disabled={ebaySessionBusy}
                onClick={() => void checkEbaySession()}
              >
                Re-check status
              </button>
            </div>
            {ebaySessionMessage ? <p className="mt-2 text-xs font-semibold text-amber-900">{ebaySessionMessage}</p> : null}
            {ebaySession.error ? <p className="mt-2 text-xs font-semibold text-rose-700">{ebaySession.error}</p> : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-bold text-amber-950 shadow-sm hover:bg-amber-100"
                onClick={() => void openEbaySignIn()}
              >
                Open eBay sign-in
              </button>
              <button
                type="button"
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50"
                onClick={() => void openEbayHome()}
              >
                Open eBay home
              </button>
              <button
                type="button"
                className="rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-bold text-rose-700 shadow-sm hover:bg-rose-50 disabled:opacity-50"
                disabled={ebaySessionBusy}
                onClick={() => void clearEbaySession()}
              >
                Clear eBay session
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <section aria-label="Deal criteria and quick create">
        <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400 mb-2">Setup</p>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-4 rounded-xl border border-slate-200 p-3 space-y-2 bg-slate-50/50">
          <p className="text-xs font-black uppercase tracking-wider text-slate-600">Criteria card</p>
          <select
            className="w-full border rounded-lg px-3 py-2 text-sm"
            value={criteriaCardId}
            onChange={(e) => setCriteriaCardId(e.target.value)}
          >
            {cards.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              className="rounded border-slate-300"
              checked={rawOnly}
              onChange={(e) => setRawOnly(e.target.checked)}
            />
            Raw only (exclude graded title flags)
          </label>
          {thresholds ? (
            <p className="text-xs text-slate-500">
              Suggest ceilings: maxBid <span className="font-mono">${thresholds.maxBidUsd.toFixed(2)}</span>
              , maxBin <span className="font-mono">${thresholds.maxBinUsd.toFixed(2)}</span>
            </p>
          ) : null}
        </div>

        <div className="lg:col-span-8 space-y-4">
        <div className="rounded-xl border border-slate-200 p-3 space-y-2">
          <p className="text-xs font-black uppercase tracking-wider text-slate-600">Create Hunt</p>
          <input className="w-full border rounded-lg px-3 py-2 text-sm" value={huntName} onChange={(e) => setHuntName(e.target.value)} placeholder="Hunt name" />
          <input className="w-full border rounded-lg px-3 py-2 text-sm" value={huntUrl} onChange={(e) => setHuntUrl(e.target.value)} placeholder="https://www.ebay.com/sch/i.html?_nkw=..." />
          <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Link card (optional)</label>
          <select
            className="w-full border rounded-lg px-3 py-2 text-sm"
            value={huntCardId}
            onChange={(e) => setHuntCardId(e.target.value)}
          >
            <option value="">— None —</option>
            {cards.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <input
              className="w-full border rounded-lg px-3 py-2 text-sm"
              value={huntCriteriaMaxBid}
              onChange={(e) => setHuntCriteriaMaxBid(e.target.value)}
              placeholder="Hunt max bid USD (optional)"
            />
            <input
              className="w-full border rounded-lg px-3 py-2 text-sm"
              value={huntCriteriaMaxBin}
              onChange={(e) => setHuntCriteriaMaxBin(e.target.value)}
              placeholder="Hunt max BIN USD (optional)"
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              className="rounded border-slate-300"
              checked={huntCRawOnly}
              onChange={(e) => setHuntCRawOnly(e.target.checked)}
            />
            Raw-only listings (this hunt)
          </label>
          <input
            className="w-full border rounded-lg px-3 py-2 text-sm font-mono text-xs"
            value={huntCronLocal}
            onChange={(e) => setHuntCronLocal(e.target.value)}
            placeholder="Recurring cron local (5 fields), e.g. */15 * * * * — clears to keep one-shot schedule only"
          />
          <button
            className="px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-bold"
            onClick={saveHunt}
          >
            {editingHuntId ? 'Update Hunt' : 'Save Hunt'}
          </button>
        </div>

        <div className="rounded-xl border border-slate-200 p-3 space-y-2">
          <p className="text-xs font-black uppercase tracking-wider text-slate-600">Create Target</p>
          <input className="w-full border rounded-lg px-3 py-2 text-sm" value={targetUrl} onChange={(e) => setTargetUrl(e.target.value)} placeholder="https://www.ebay.com/itm/..." />
          <button className="px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-bold" onClick={addTargetFromUrl}>Add Target</button>
        </div>
        </div>
        </div>
      </section>

      <div className="rounded-xl border border-slate-200 p-3">
        <p className="text-xs font-black uppercase tracking-wider text-slate-600 mb-2">Hunts</p>
        <div className="space-y-2">
          {hunts.map((h) => (
            <div key={h.id} className="flex items-center justify-between gap-2 text-sm">
              <span>{h.name}</span>
              <div className="flex items-center gap-2">
                <button className="text-blue-600 font-semibold" onClick={() => void openUrl(h.searchUrl)}>Open</button>
                <button
                  className="text-emerald-700 font-semibold"
                  title="Open same search with lowest price + shipping first (eBay)"
                  onClick={() => void openUrl(ebayLowestPriceFirstUrl(h.searchUrl))}
                >
                  Low$
                </button>
                <button
                  className="text-indigo-700 font-semibold"
                  onClick={() => setSelectedHuntId(h.id)}
                >
                  Listings
                </button>
                <button
                  className="text-slate-700 font-semibold"
                  onClick={() => {
                    setEditingHuntId(h.id);
                    setHuntName(h.name);
                    setHuntUrl(h.searchUrl);
                    setHuntCardId(h.cardId ?? '');
                    setHuntCriteriaMaxBid(h.criteria?.maxBidUsd != null ? String(h.criteria.maxBidUsd) : '');
                    setHuntCriteriaMaxBin(h.criteria?.maxBinUsd != null ? String(h.criteria.maxBinUsd) : '');
                    setHuntCRawOnly(h.criteria?.rawOnly === true);
                    setHuntCronLocal(h.schedule?.kind === 'recurring' ? h.schedule.cronLocal : '');
                  }}
                >
                  Edit
                </button>
                <button
                  className="text-rose-700 font-semibold"
                  onClick={() => onHuntsChange(hunts.filter((x) => x.id !== h.id))}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
          {hunts.length === 0 ? <p className="text-xs text-slate-500">No hunts yet.</p> : null}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 p-3 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <p className="text-xs font-black uppercase tracking-wider text-slate-600">Hunt listings</p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Pick a hunt, use Scope to narrow rows, then promote rows to Targets.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button className="text-blue-700 text-xs font-semibold" onClick={() => void copyHuntListings()}>
              Copy CSV
            </button>
            <button className="text-blue-700 text-xs font-semibold" onClick={exportHuntListingsJson}>
              Export JSON
            </button>
          </div>
        </div>

        {hunts.length > 0 ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-slate-600">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Hunt</span>
              <select
                className="border rounded-lg px-2 py-1.5 text-xs min-w-[180px]"
                value={selectedHuntId}
                onChange={(e) => setSelectedHuntId(e.target.value)}
              >
                {hunts.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-600 flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">nextCheckAt</span>
              <input
                type="datetime-local"
                className="border rounded-lg px-2 py-1.5 text-xs"
                value={formatDateTimeLocal(
                  selectedHunt?.schedule?.kind === 'once'
                    ? selectedHunt.schedule.atMs
                    : null
                )}
                onChange={(e) => {
                  if (!selectedHunt) return;
                  setHuntNextCheckAt(selectedHunt.id, parseDateTimeLocal(e.target.value));
                }}
              />
            </label>
            <span className="text-xs text-slate-500 pb-1">
              ceiling: ${selectedHuntCeiling.toFixed(2)}
            </span>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2 space-y-2">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-600">Scope</span>
                <input
                  className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
                  value={scopeDraft}
                  onChange={(e) => setScopeDraft(e.target.value)}
                  onBlur={() => persistScope()}
                  placeholder="e.g. raw refractor 184 — narrows by title, card name, item id (save on blur)"
                />
              </label>
              <p className="text-[11px] text-slate-500">
                Showing <span className="font-mono text-slate-700">{huntListingRows.length}</span> of{' '}
                <span className="font-mono text-slate-700">{huntListingRowsAll.length}</span> listings
                {selectedHunt?.cardId ? (
                  <span className="text-slate-600"> · linked card only</span>
                ) : (
                  <span className="text-slate-600"> · all captured cards</span>
                )}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-500">No hunts yet.</p>
        )}

        <div className="max-h-72 overflow-auto border rounded-lg">
          {huntListingRowsAll.length === 0 ? (
            <p className="text-xs text-slate-500 p-3">
              No listing rows for this hunt yet.
              {selectedHunt?.cardId ? ' Capture active listings for the linked card, or clear the card link to see all cards.' : ''}
            </p>
          ) : huntListingRows.length === 0 ? (
            <p className="text-xs text-amber-800 bg-amber-50 p-3">
              Nothing matches Scope — clear or shorten terms to see listings again.
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-slate-50 sticky top-0">
                <tr className="text-left">
                  <th className="p-2 w-12"> </th>
                  <th className="p-2">Card</th>
                  <th className="p-2">Listing</th>
                  <th className="p-2">Price</th>
                  <th className="p-2">Ends</th>
                  <th className="p-2">Status</th>
                  <th className="p-2"> </th>
                </tr>
              </thead>
              <tbody>
                {huntListingRows.map((r, idx) => (
                  <tr key={`${r.itemId || idx}-${r.cardName}`} className="border-t">
                    <td className="p-1 w-12 align-middle">
                      {r.imageUrl ? (
                        <img
                          src={r.imageUrl}
                          alt=""
                          className="w-10 h-10 rounded object-cover border border-slate-200 bg-slate-50"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded border border-dashed border-slate-200 bg-slate-50" aria-hidden />
                      )}
                    </td>
                    <td className="p-2">{r.cardName}</td>
                    <td className="p-2 truncate max-w-[300px]">{r.title}</td>
                    <td className="p-2">${r.price.toFixed(2)}</td>
                    <td className="p-2">
                      {r.endsAtMs ? new Date(r.endsAtMs).toLocaleString() : '-'}
                    </td>
                    <td className="p-2">
                      {r.over ? (
                        <span className="text-rose-700 font-bold">ABORT</span>
                      ) : r.suggested ? (
                        <span className="text-emerald-700 font-bold">✅ Suggested watch</span>
                      ) : (
                        <span className="text-slate-500">watch</span>
                      )}
                    </td>
                    <td className="p-2 whitespace-nowrap">
                      <button
                        type="button"
                        className="text-blue-600 font-semibold"
                        onClick={() =>
                          addTargetFromListingRow(
                            r.card,
                            {
                              itemUrl: r.itemUrl,
                              itemId: r.itemId,
                              title: r.title,
                              price: r.price,
                              imageUrl: r.imageUrl || null,
                            },
                            selectedHuntId
                          )
                        }
                      >
                        Target
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 p-3">
        <div className="mb-3">
          <p className="text-xs font-black uppercase tracking-wider text-slate-600">Targets · sniper</p>
          <p className="text-[11px] text-slate-500 mt-1">
            Each card combines listing, <span className="font-semibold">current price</span>, countdown, and sniper
            controls. Use <span className="font-semibold">Live watch</span> or <span className="font-semibold">Armed</span>{' '}
            in Raw Engine so bids update from the live tab.
          </p>
        </div>
        <div className="space-y-4">
          {targets.map((t) => {
            void watchTick;
            const hit = activeListingForTarget(t);
            const href = canonicalEbayListingUrl(t);
            const displayId = (t.itemId || '').trim() || (href.match(/\/itm\/(\d+)/i) || [])[1] || '';
            const p = t.lastProbe;
            const endsAtMs = hit?.row.endsAtMs ?? p?.endsAtMs ?? null;
            const remainingMs = endsAtMs ? endsAtMs - Date.now() : null;
            const countdown =
              remainingMs != null && remainingMs > 0
                ? formatAuctionCountdown(endsAtMs ?? undefined)
                : '—';
            const { bid, bin } = liveBidBin(t, hit);
            const primary = primaryAuctionUsd(t, hit);
            const bidCount =
              hit?.row.bidCount != null && Number.isFinite(hit.row.bidCount) && hit.row.bidCount > 0
                ? hit.row.bidCount
                : null;
            const sniperHot = t.armed && t.sniperEnabled;
            const maxBin = t.maxBinUsd ?? t.maxBidUsd;
            const overCeiling = p?.highBidderAboveThreshold === true;
            const withinCeiling =
              !overCeiling &&
              ((bid != null && bid <= t.maxBidUsd) || (bin != null && bin <= maxBin));
            const probeAgeSec =
              typeof p?.atMs === 'number' && Number.isFinite(p.atMs)
                ? Math.max(0, Math.floor((Date.now() - p.atMs) / 1000))
                : null;

            return (
              <div
                key={t.id}
                className={`rounded-2xl border bg-gradient-to-br from-white to-slate-50/95 p-4 shadow-sm ${
                  sniperHot ? 'border-amber-400 ring-1 ring-amber-200/70' : 'border-slate-200/90'
                }`}
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group relative mx-auto shrink-0 block h-40 w-40 overflow-hidden rounded-2xl border border-slate-200/80 bg-slate-100 shadow-md ring-1 ring-black/5 transition hover:ring-2 hover:ring-blue-400/50 lg:mx-0 lg:h-44 lg:w-44"
                    title="Open listing on eBay"
                  >
                    {t.listingImageUrl ? (
                      <img
                        src={t.listingImageUrl}
                        alt=""
                        className="h-full w-full object-cover transition group-hover:scale-[1.02]"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center px-2 text-center text-[11px] text-slate-400">
                        No image — open listing
                      </div>
                    )}
                    <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent py-2 text-center text-[10px] font-bold uppercase tracking-wider text-white opacity-0 transition group-hover:opacity-100">
                      eBay
                    </span>
                  </a>

                  <div className="min-w-0 flex-1 space-y-3">
                    <div>
                      <h4 className="text-lg font-bold leading-snug text-slate-900 line-clamp-2">
                        {t.listingTitle || t.label || 'Target listing'}
                      </h4>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-semibold text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          Open on eBay
                          {displayId ? <span className="font-mono font-normal text-slate-600"> · {displayId}</span> : null}
                        </a>
                        {t.listingCapturedAt ? (
                          <span className="text-xs text-slate-400">
                            Saved {new Date(t.listingCapturedAt).toLocaleString()}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div
                      className={`grid grid-cols-1 gap-4 rounded-xl px-4 py-4 sm:grid-cols-3 ${
                        sniperHot
                          ? 'bg-slate-950 text-white shadow-inner'
                          : 'border border-slate-200 bg-slate-100/90 text-slate-900'
                      }`}
                    >
                      <div className="min-w-0">
                        <div
                          className={`text-[10px] font-bold uppercase tracking-wider ${
                            sniperHot ? 'text-amber-200/90' : 'text-slate-500'
                          }`}
                        >
                          {primary.label}
                        </div>
                        <div
                          className={`mt-0.5 text-3xl font-black tabular-nums tracking-tight sm:text-4xl ${
                            sniperHot ? 'text-white' : 'text-slate-900'
                          }`}
                        >
                          {primary.usd != null ? `$${primary.usd.toFixed(2)}` : '—'}
                        </div>
                        {primary.label === 'Last captured' ? (
                          <p className={`mt-1 text-[11px] leading-snug ${sniperHot ? 'text-slate-400' : 'text-slate-500'}`}>
                            Not a live read yet — turn on Live watch or open the listing in Raw Engine.
                          </p>
                        ) : null}
                        {bid != null && bin != null ? (
                          <p className={`mt-1 text-sm tabular-nums ${sniperHot ? 'text-slate-300' : 'text-slate-600'}`}>
                            BIN <span className="font-semibold">${bin.toFixed(2)}</span>
                          </p>
                        ) : null}
                      </div>
                      <div
                        className={`min-w-0 sm:px-4 ${
                          sniperHot ? 'sm:border-x sm:border-white/15' : 'sm:border-x sm:border-slate-200/90'
                        }`}
                      >
                        <div
                          className={`text-[10px] font-bold uppercase tracking-wider ${
                            sniperHot ? 'text-amber-200/90' : 'text-slate-500'
                          }`}
                        >
                          Time left
                        </div>
                        <div
                          className={`mt-0.5 font-mono text-2xl font-bold tabular-nums sm:text-3xl ${
                            sniperHot ? 'text-white' : 'text-slate-900'
                          }`}
                        >
                          {countdown}
                        </div>
                        {bidCount != null ? (
                          <p className={`mt-1 text-sm ${sniperHot ? 'text-slate-300' : 'text-slate-600'}`}>
                            {bidCount} bid{bidCount === 1 ? '' : 's'}
                          </p>
                        ) : null}
                        {probeAgeSec != null ? (
                          <p className={`mt-1 text-[11px] ${sniperHot ? 'text-slate-500' : 'text-slate-400'}`}>
                            Live read {probeAgeSec}s ago
                          </p>
                        ) : null}
                      </div>
                      <div className="flex min-w-0 flex-col justify-center gap-2">
                        <div className="flex flex-wrap gap-2">
                          {sniperHot ? (
                            <span className="rounded-md bg-amber-400 px-2 py-0.5 text-[10px] font-black uppercase text-slate-950">
                              Armed
                            </span>
                          ) : null}
                          {t.liveWatch ? (
                            <span
                              className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${
                                sniperHot ? 'bg-white/15 text-white' : 'bg-slate-200 text-slate-700'
                              }`}
                            >
                              Live watch
                            </span>
                          ) : null}
                        </div>
                        <div className="text-sm font-semibold">
                          {overCeiling ? (
                            <span className={sniperHot ? 'text-rose-400' : 'text-rose-700'}>Over cap — sniper skips</span>
                          ) : withinCeiling && (bid != null || bin != null || primary.usd != null) ? (
                            <span className={sniperHot ? 'text-emerald-400' : 'text-emerald-700'}>Within your max</span>
                          ) : (
                            <span className={sniperHot ? 'text-slate-400' : 'text-slate-500'}>Need live tab data</span>
                          )}
                        </div>
                        <p className={`text-[11px] leading-snug ${sniperHot ? 'text-slate-400' : 'text-slate-500'}`}>
                          Max ${t.maxBidUsd.toFixed(2)} · BIN cap ${maxBin.toFixed(2)} · Lead {t.sniperLeadMs} ms
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-end gap-3 border-t border-slate-100 pt-3">
                      <label className="text-[10px] text-slate-500">
                        <span className="mb-0.5 block">Max bid</span>
                        <input
                          type="number"
                          step={0.01}
                          className="w-[5.5rem] rounded-lg border border-slate-200 px-2 py-1.5 text-sm font-medium"
                          value={t.maxBidUsd}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            onTargetsChange(
                              targets.map((x) =>
                                x.id === t.id
                                  ? { ...x, maxBidUsd: Number.isFinite(v) ? v : 0, updatedAt: Date.now() }
                                  : x
                              )
                            );
                          }}
                        />
                      </label>
                      <label className="text-[10px] text-slate-500">
                        <span className="mb-0.5 block">BIN cap</span>
                        <input
                          type="number"
                          step={0.01}
                          className="w-[5.5rem] rounded-lg border border-slate-200 px-2 py-1.5 text-sm font-medium"
                          value={t.maxBinUsd ?? ''}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            onTargetsChange(
                              targets.map((x) =>
                                x.id === t.id
                                  ? {
                                      ...x,
                                      maxBinUsd: Number.isFinite(v) ? v : undefined,
                                      updatedAt: Date.now(),
                                    }
                                  : x
                              )
                            );
                          }}
                        />
                      </label>
                      <label className="text-[10px] text-slate-500">
                        <span className="mb-0.5 block">Lead ms</span>
                        <input
                          type="number"
                          step={100}
                          className="w-24 rounded-lg border border-slate-200 px-2 py-1.5 text-sm font-medium"
                          value={t.sniperLeadMs}
                          onChange={(e) => {
                            const v = parseInt(e.target.value, 10);
                            onTargetsChange(
                              targets.map((x) =>
                                x.id === t.id
                                  ? {
                                      ...x,
                                      sniperLeadMs: Number.isFinite(v) ? Math.max(250, v) : 1500,
                                      updatedAt: Date.now(),
                                    }
                                  : x
                              )
                            );
                          }}
                        />
                      </label>
                      <div className="ml-auto flex flex-wrap items-center gap-3">
                        <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-700">
                          <input
                            type="checkbox"
                            className="rounded border-slate-300"
                            checked={t.sniperEnabled}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              onTargetsChange(
                                targets.map((x) =>
                                  x.id === t.id ? { ...x, sniperEnabled: checked, updatedAt: Date.now() } : x
                                )
                              );
                            }}
                          />
                          Sniper
                        </label>
                        <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-700">
                          <input
                            type="checkbox"
                            className="rounded border-slate-300"
                            checked={t.armed}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              onTargetsChange(
                                targets.map((x) =>
                                  x.id === t.id ? { ...x, armed: checked, updatedAt: Date.now() } : x
                                )
                              );
                            }}
                          />
                          Armed
                        </label>
                        <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-700">
                          <input
                            type="checkbox"
                            className="rounded border-slate-300"
                            checked={t.liveWatch === true}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              onTargetsChange(
                                targets.map((x) =>
                                  x.id === t.id ? { ...x, liveWatch: checked, updatedAt: Date.now() } : x
                                )
                              );
                            }}
                          />
                          Live watch
                        </label>
                        <button
                          type="button"
                          className="text-xs font-semibold text-blue-600 hover:text-blue-800"
                          title="Test bid UI (~1s)"
                          onClick={() => void runSniperTestDom(t)}
                        >
                          Test sniper
                        </button>
                        <button
                          type="button"
                          className="text-xs font-semibold text-rose-700 hover:text-rose-900"
                          onClick={() => onTargetsChange(targets.filter((x) => x.id !== t.id))}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          {targets.length === 0 ? <p className="text-xs text-slate-500">No targets yet.</p> : null}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 p-3">
        <p className="text-xs font-black uppercase tracking-wider text-slate-600 mb-2">Suggested watch</p>
        <div className="space-y-1 max-h-64 overflow-auto">
          {activeRows.map(({ card, row, suggested }, idx) => (
            <div key={`${row.itemId ?? idx}-${card.id}`} className="text-xs flex items-center justify-between gap-2">
              <span className="truncate">{card.name} - {row.title}</span>
              <div className="flex items-center gap-2">
                {suggested ? (
                  <>
                    <span className="text-emerald-700 font-bold">✅ Suggested watch</span>
                    <button
                      className="text-blue-600 font-semibold"
                      onClick={() =>
                        addTargetFromActiveRow({
                          itemUrl: row.itemUrl,
                          itemId: row.itemId,
                          title: row.title,
                          imageUrl: row.imageUrl ?? null,
                          price: row.price,
                        })
                      }
                    >
                      Add Target
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          ))}
          {activeRows.length === 0 ? <p className="text-xs text-slate-500">No active capture rows yet.</p> : null}
        </div>
      </div>
    </div>
  );
};
