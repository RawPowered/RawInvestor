import { useEffect, useMemo, useState } from 'react';
import type {
  Card,
  Fees,
  PullRateGuide,
  SealedSetGalleryPreviewItem,
  SealedSetGalleryState,
} from '../types';
import type { EnrichedCard } from '../sort';
import { apiUrl } from '../apiBase';
import { mergeSealedPullSlots, parsePullRateTables } from './parsePullRateTables';
import { evaluateSealedOpenVsKeep, sealedEdgePlainSummary } from './sealedOpenEv';
import { fmtMoney } from '../math';
import { isSealedCard, showPresaleBadge } from './sealedCardUi';
import { SealedSetGallery } from './SealedSetGallery';
import {
  classifyPokemonProductBucket,
  defaultSealedGalleryToggles,
  galleryItemVisible,
} from './pokemonGalleryBucket';
import { fillSlotResaleFromGallery } from './fillResaleFromGallery';
import { renormalizeSealedSlotProbabilities } from './renormalizeSealedSlots';

const STORAGE_SEALED_ADVANCED = 'pcgr:sealedQuickAdvancedOpen:v1';

type ArticleResponse = {
  title?: string;
  excerpt?: string;
  tables?: Array<{ headers: string[]; rows: string[][] }>;
  fetchedAt?: number;
  sourceUrl?: string;
  linkedProductIds?: number[];
  error?: string;
};

export const SealedQuickPanels = ({
  card,
  fees,
  onFieldChange,
  onImportGalleryItemsAsSingles,
}: {
  card: EnrichedCard;
  fees: Fees;
  onFieldChange: <K extends keyof Card>(id: string, key: K, value: Card[K]) => void;
  onImportGalleryItemsAsSingles?: (items: SealedSetGalleryPreviewItem[]) => Promise<void>;
}) => {
  const [articleUrl, setArticleUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [searchHits, setSearchHits] = useState<Array<{ title: string; link: string }>>([]);
  const [parseWarnings, setParseWarnings] = useState<string[]>([]);
  const [advancedOpen, setAdvancedOpen] = useState(() => {
    try {
      return typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_SEALED_ADVANCED) === '1';
    } catch {
      return false;
    }
  });
  const [pendingLinkedProductIds, setPendingLinkedProductIds] = useState<number[] | null>(null);
  const [loadingLinkedGallery, setLoadingLinkedGallery] = useState(false);
  const [linkedGalleryErr, setLinkedGalleryErr] = useState<string | null>(null);

  useEffect(() => {
    setArticleUrl(card.pullRateGuide?.sourceUrl ?? '');
  }, [card.id, card.pullRateGuide?.sourceUrl]);

  useEffect(() => {
    setPendingLinkedProductIds(null);
    setLinkedGalleryErr(null);
  }, [card.id]);

  const sealed = isSealedCard(card);
  const guide = card.pullRateGuide;
  const slots = card.sealedPullSlots ?? [];

  const sealedPreview = useMemo(
    () => evaluateSealedOpenVsKeep(card.metrics.netRawNoGrade, card.sealedPullSlots ?? null, fees),
    [card.metrics.netRawNoGrade, card.sealedPullSlots, fees]
  );

  const sealedPlain = useMemo(() => sealedEdgePlainSummary(sealedPreview), [sealedPreview]);

  const persistAdvancedOpen = (open: boolean) => {
    setAdvancedOpen(open);
    try {
      localStorage.setItem(STORAGE_SEALED_ADVANCED, open ? '1' : '0');
    } catch {
      /* ignore */
    }
  };

  const mergeSealedGallery = (patch: Partial<SealedSetGalleryState>) => {
    const cur = card.sealedSetGallery;
    const next: SealedSetGalleryState = {
      catalogUrl: patch.catalogUrl ?? cur?.catalogUrl ?? '',
      selectedProductIds: patch.selectedProductIds ?? cur?.selectedProductIds ?? [],
      toggles: patch.toggles ?? cur?.toggles ?? defaultSealedGalleryToggles(),
      fetchedAt: patch.fetchedAt ?? cur?.fetchedAt ?? Date.now(),
      previewItems: patch.previewItems !== undefined ? patch.previewItems : cur?.previewItems ?? null,
    };
    onFieldChange(card.id, 'sealedSetGallery', next);
  };

  const loadLinkedProductsIntoGallery = async (ids: number[]) => {
    if (ids.length === 0) return;
    setLinkedGalleryErr(null);
    setLoadingLinkedGallery(true);
    try {
      const res = await fetch(apiUrl('/api/tcgplayer/product-preview-by-ids'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      const data = (await res.json()) as {
        items?: Array<{
          productId: number;
          productName: string;
          setName: string;
          rarityName: string | null;
          marketPrice: number;
          lowestPrice: number | null;
          medianPrice: number | null;
          url: string;
          imageUrl?: string | null;
        }>;
        error?: string;
        fetchedAt?: number;
      };
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      const items = Array.isArray(data.items) ? data.items : [];
      const togg = card.sealedSetGallery?.toggles ?? defaultSealedGalleryToggles();
      const visibleIds = items
        .filter((it) => galleryItemVisible(classifyPokemonProductBucket(it.rarityName, it.productName), togg))
        .map((it) => it.productId);
      const selectedProductIds = visibleIds.length > 0 ? visibleIds : items.map((x) => x.productId);
      const traceUrl = articleUrl.trim() || card.pullRateGuide?.sourceUrl?.trim() || '';
      mergeSealedGallery({
        catalogUrl: traceUrl,
        previewItems: items,
        fetchedAt: typeof data.fetchedAt === 'number' ? data.fetchedAt : Date.now(),
        selectedProductIds,
      });
    } catch (e) {
      setLinkedGalleryErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingLinkedGallery(false);
    }
  };

  const applyGuideAndSlots = (next: PullRateGuide) => {
    const { slots: parsed, warnings } = parsePullRateTables(next);
    setParseWarnings(warnings);
    const merged = mergeSealedPullSlots(parsed, card.sealedPullSlots);
    onFieldChange(card.id, 'pullRateGuide', next);
    onFieldChange(card.id, 'sealedPullSlots', merged);
  };

  const fetchArticle = async (url: string) => {
    const u = url.trim();
    if (!u) {
      setErr('Paste a TCGPlayer article URL.');
      return;
    }
    setErr(null);
    setLoading(true);
    try {
      const res = await fetch(apiUrl('/api/tcgplayer/content-article'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: u }),
      });
      const data = (await res.json()) as ArticleResponse;
      if (!res.ok || data.error) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const linked = Array.isArray(data.linkedProductIds) ? data.linkedProductIds : [];
      setPendingLinkedProductIds(linked.length > 0 ? linked : null);
      const next: PullRateGuide = {
        sourceUrl: data.sourceUrl || u,
        fetchedAt: typeof data.fetchedAt === 'number' ? data.fetchedAt : Date.now(),
        title: data.title,
        excerpt: data.excerpt,
        tables: Array.isArray(data.tables) ? data.tables : [],
      };
      applyGuideAndSlots(next);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Fetch failed');
    } finally {
      setLoading(false);
    }
  };

  const reparseFromGuide = () => {
    if (!guide?.tables?.length) return;
    const { slots: parsed, warnings } = parsePullRateTables(guide);
    setParseWarnings(warnings);
    const merged = mergeSealedPullSlots(parsed, card.sealedPullSlots);
    onFieldChange(card.id, 'sealedPullSlots', merged);
  };

  const patchSlot = (
    slotId: string,
    patch: Partial<{ probability: number | null; resaleUsd: number | null; excludeFromEv: boolean }>
  ) => {
    const cur = card.sealedPullSlots ?? [];
    const next = cur.map((s) => (s.slotId === slotId ? { ...s, ...patch } : s));
    onFieldChange(card.id, 'sealedPullSlots', next);
  };

  const handleRenormalizeProbabilities = () => {
    onFieldChange(card.id, 'sealedPullSlots', renormalizeSealedSlotProbabilities(slots));
  };

  const handleFillResaleFromGallery = () => {
    const gal = card.sealedSetGallery;
    const items = gal?.previewItems;
    if (!items?.length || !gal?.selectedProductIds?.length) return;
    const sel = new Set(gal.selectedProductIds);
    const filled = fillSlotResaleFromGallery(
      slots,
      items.map((x) => ({
        productId: x.productId,
        marketPrice: x.marketPrice,
        rarityName: x.rarityName,
        productName: x.productName,
      })),
      sel
    );
    onFieldChange(card.id, 'sealedPullSlots', filled);
  };

  const runSearch = async () => {
    const q = `${card.set || ''} ${card.name || ''}`.trim();
    if (!q) {
      setSearchErr('Card needs a name/set to search.');
      return;
    }
    setSearchErr(null);
    setSearchLoading(true);
    setSearchHits([]);
    try {
      const res = await fetch(apiUrl(`/api/tcgplayer/find-buyers-guide?q=${encodeURIComponent(q)}`));
      const data = (await res.json()) as {
        configured?: boolean;
        items?: Array<{ title: string; link: string }>;
        message?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (data.configured === false) {
        setSearchErr(data.message || 'Search not configured (Google CSE).');
        return;
      }
      setSearchHits(data.items ?? []);
      if ((data.items ?? []).length === 0) setSearchErr('No articles found.');
    } catch (e) {
      setSearchErr(e instanceof Error ? e.message : 'Search failed');
    } finally {
      setSearchLoading(false);
    }
  };

  if (!sealed) return null;

  const netSealedUi =
    typeof card.metrics.netRawNoGrade === 'number' && Number.isFinite(card.metrics.netRawNoGrade)
      ? fmtMoney(card.metrics.netRawNoGrade)
      : '—';

  return (
    <div className="space-y-3 rounded-xl border border-violet-200 bg-violet-50/40 p-3">
      <div className="rounded-xl border border-violet-300/80 bg-white/90 p-4 space-y-3 shadow-sm">
        <div className="text-[11px] font-black uppercase tracking-widest text-violet-900">
          Sealed product — open vs keep
        </div>
        <div className="space-y-2 text-sm">
          <div>
            <span className="text-slate-500 font-medium text-xs uppercase tracking-wide">Sell sealed as-is (after fees)</span>
            <div className="text-lg font-black text-slate-900 tabular-nums mt-0.5">{netSealedUi}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50/90 px-3 py-2">
            <div className="font-bold text-slate-900">{sealedPlain.headline}</div>
            <p className="text-xs text-slate-600 leading-snug mt-1">{sealedPlain.hint}</p>
          </div>
          <p className="text-xs text-slate-500">
            <span className="font-semibold text-slate-600">Pull-rate article: </span>
            {guide?.title ? (
              <>
                Loaded — <span className="text-slate-800">{guide.title}</span>
                {guide.fetchedAt ? (
                  <span className="text-slate-400"> · {new Date(guide.fetchedAt).toLocaleDateString()}</span>
                ) : null}
              </>
            ) : (
              'Not loaded yet — use Advanced to fetch a TCGPlayer buyer’s guide.'
            )}
          </p>
          {pendingLinkedProductIds && pendingLinkedProductIds.length > 0 && (
            <div className="rounded-lg border border-violet-200 bg-violet-50/80 px-3 py-2 space-y-2">
              <p className="text-xs text-slate-700">
                Found <span className="font-bold text-violet-900">{pendingLinkedProductIds.length}</span> TCGPlayer
                product links in this article (e.g. Buy links). You can load them into the set catalog for resale hints
                and import singles.
              </p>
              {linkedGalleryErr && <p className="text-xs text-rose-700">{linkedGalleryErr}</p>}
              <button
                type="button"
                disabled={loadingLinkedGallery}
                onClick={() => void loadLinkedProductsIntoGallery(pendingLinkedProductIds)}
                className="rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50 w-full sm:w-auto"
              >
                {loadingLinkedGallery ? 'Loading…' : 'Load linked products into set catalog'}
              </button>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => persistAdvancedOpen(!advancedOpen)}
          className="w-full sm:w-auto rounded-lg border border-violet-400 bg-violet-600 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-white hover:bg-violet-700"
        >
          {advancedOpen ? 'Hide' : 'Show'} advanced — article tables, set catalog, EV worksheet
        </button>
      </div>

      {advancedOpen && (
        <>
      <div className="space-y-2">
        <div className="text-xs font-bold text-slate-700">Pull rates (TCGPlayer article)</div>
        <div className="flex flex-wrap gap-2">
          <input
            type="url"
            className="flex-1 min-w-[200px] rounded-lg border border-slate-200 px-2 py-1.5 text-xs bg-white"
            placeholder="https://www.tcgplayer.com/content/article/…"
            value={articleUrl}
            onChange={(e) => setArticleUrl(e.target.value)}
          />
          <button
            type="button"
            disabled={loading}
            onClick={() => fetchArticle(articleUrl)}
            className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
          >
            {loading ? '…' : 'Fetch'}
          </button>
          <button
            type="button"
            disabled={searchLoading}
            onClick={() => void runSearch()}
            className="rounded-lg border border-violet-300 bg-white px-3 py-1.5 text-xs font-bold text-violet-800 disabled:opacity-50"
          >
            {searchLoading ? '…' : 'Find guide'}
          </button>
        </div>
        {err && <p className="text-xs text-rose-700">{err}</p>}
        {searchErr && <p className="text-xs text-amber-800">{searchErr}</p>}
        {searchHits.length > 0 && (
          <ul className="max-h-28 overflow-auto text-xs space-y-1">
            {searchHits.map((h) => (
              <li key={h.link}>
                <button
                  type="button"
                  className="text-left text-blue-700 underline font-medium"
                  onClick={() => {
                    setArticleUrl(h.link);
                    void fetchArticle(h.link);
                  }}
                >
                  {h.title || h.link}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-3 mt-3">
        {guide && guide.tables.length > 0 && (
          <div className="rounded-lg border border-slate-200 overflow-auto max-h-64">
            {guide.title && <div className="px-2 py-1 text-xs font-bold text-slate-800 border-b">{guide.title}</div>}
            {guide.tables.map((tb, i) => (
              <table key={i} className="w-full text-[11px]">
                <thead>
                  <tr>
                    {tb.headers.map((h, j) => (
                      <th key={j} className="text-left px-2 py-1 border-b bg-slate-50 font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tb.rows.map((row, ri) => (
                    <tr key={ri}>
                      {row.map((cell, ci) => (
                        <td key={ci} className="px-2 py-1 border-b border-slate-100">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ))}
            <div className="px-2 py-1 text-[10px] text-slate-500 flex flex-wrap gap-2 items-center border-t border-slate-100">
              <a href={guide.sourceUrl} className="text-blue-600 underline" target="_blank" rel="noreferrer">
                Source
              </a>
              {guide.fetchedAt ? ` · ${new Date(guide.fetchedAt).toLocaleString()}` : ''}
              <button
                type="button"
                onClick={() => reparseFromGuide()}
                className="ml-auto rounded border border-violet-300 bg-violet-50 px-2 py-0.5 text-[10px] font-bold text-violet-900"
              >
                Re-parse odds from tables
              </button>
            </div>
          </div>
        )}
        {parseWarnings.length > 0 && (
          <ul className="text-[10px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 space-y-0.5">
            {parseWarnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}

        <SealedSetGallery
          card={card}
          onFieldChange={onFieldChange}
          onImportSelectedAsSingles={onImportGalleryItemsAsSingles}
        />

        {slots.length > 0 && (
          <div className="rounded-lg border border-violet-300 bg-slate-50/60 p-2 space-y-2">
            <div className="text-[10px] font-black uppercase tracking-widest text-violet-900">
              Open vs keep — slot mapping
            </div>
            <p className="text-[10px] text-slate-600 leading-snug">
              Enter gross resale USD per outcome. EV(open) = Σ p × net(sale @ fees). Compared to net sealed (
              {typeof card.metrics.netRawNoGrade === 'number' ? `$${card.metrics.netRawNoGrade.toFixed(2)}` : '—'}).
            </p>
            <div className="rounded-md bg-slate-50 border border-slate-200 px-2 py-1.5 text-[11px]">
              <span className="font-bold text-slate-800">{sealedPreview.label}</span>
              <span className="text-slate-600 font-mono text-[10px]"> · {sealedPreview.detail}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => handleRenormalizeProbabilities()}
                className="rounded border border-violet-300 bg-violet-50 px-2 py-1 text-[10px] font-bold text-violet-900"
              >
                Renormalize Σp (included rows)
              </button>
              <button
                type="button"
                onClick={() => handleFillResaleFromGallery()}
                disabled={!card.sealedSetGallery?.previewItems?.length || !card.sealedSetGallery?.selectedProductIds?.length}
                className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-900 disabled:opacity-40"
              >
                Fill resale from gallery (median by bucket)
              </button>
            </div>
            <div className="overflow-auto max-h-56">
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="text-left border-b border-slate-200">
                    <th className="py-1 pr-2 font-semibold text-slate-700">Slot</th>
                    <th className="py-1 pr-1 font-semibold text-slate-700 w-14 text-center">In EV</th>
                    <th className="py-1 pr-2 font-semibold text-slate-700 w-20">p %</th>
                    <th className="py-1 pr-2 font-semibold text-slate-700 w-24">Resale $</th>
                  </tr>
                </thead>
                <tbody>
                  {slots.map((s) => (
                    <tr key={s.slotId} className="border-b border-slate-100">
                      <td className="py-1 pr-2 text-slate-800 align-top max-w-[140px] truncate" title={s.label}>
                        {s.label}
                      </td>
                      <td className="py-1 pr-1 align-top text-center">
                        <input
                          type="checkbox"
                          title="Include in EV(open)"
                          checked={s.excludeFromEv !== true}
                          onChange={(e) => patchSlot(s.slotId, { excludeFromEv: !e.target.checked })}
                        />
                      </td>
                      <td className="py-1 pr-2 align-top">
                        <input
                          type="number"
                          step={0.01}
                          min={0}
                          max={100}
                          placeholder="—"
                          className="w-full rounded border border-slate-200 px-1 py-0.5 font-mono"
                          value={s.probability != null && Number.isFinite(s.probability) ? +(s.probability * 100).toFixed(4) : ''}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === '') {
                              patchSlot(s.slotId, { probability: null });
                              return;
                            }
                            const x = parseFloat(v);
                            if (!Number.isFinite(x)) return;
                            patchSlot(s.slotId, { probability: Math.min(1, Math.max(0, x / 100)) });
                          }}
                        />
                      </td>
                      <td className="py-1 pr-2 align-top">
                        <input
                          type="number"
                          step={0.01}
                          min={0}
                          placeholder="—"
                          className="w-full rounded border border-slate-200 px-1 py-0.5 font-mono"
                          value={s.resaleUsd != null && Number.isFinite(s.resaleUsd) ? s.resaleUsd : ''}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === '') {
                              patchSlot(s.slotId, { resaleUsd: null });
                              return;
                            }
                            const x = parseFloat(v);
                            if (!Number.isFinite(x) || x < 0) return;
                            patchSlot(s.slotId, { resaleUsd: x });
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
        </>
      )}
    </div>
  );
};

/** Presale ribbon for any card (singles or sealed) when release is in the future. */
export const PresaleBadgeStrip = ({ card }: { card: Pick<Card, 'releaseDateMs'> }) => {
  if (!showPresaleBadge(card.releaseDateMs)) return null;
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-950 mb-2">
      Presale — release {card.releaseDateMs ? new Date(card.releaseDateMs).toLocaleDateString() : 'TBD'}
    </div>
  );
};
