import { useEffect, useMemo, useState } from 'react';
import type { Card, SealedSetGalleryPreviewItem, SealedSetGalleryState } from '../types';
import type { EnrichedCard } from '../sort';
import { apiUrl } from '../apiBase';
import {
  classifyPokemonProductBucket,
  defaultSealedGalleryToggles,
  galleryItemVisible,
} from './pokemonGalleryBucket';

type CatalogPreviewResponse = {
  items: SealedSetGalleryPreviewItem[];
  warnings?: string[];
  error?: string;
  fetchedAt?: number;
  sourceUrl?: string;
};

export const SealedSetGallery = ({
  card,
  onFieldChange,
  onImportSelectedAsSingles,
}: {
  card: EnrichedCard;
  onFieldChange: <K extends keyof Card>(id: string, key: K, value: Card[K]) => void;
  /** Optional: import checked gallery items as portfolio singles (PriceCharting search + scrape). */
  onImportSelectedAsSingles?: (items: SealedSetGalleryPreviewItem[]) => Promise<void>;
}) => {
  const g = card.sealedSetGallery;
  const toggles = g?.toggles ?? defaultSealedGalleryToggles();
  const [draftUrl, setDraftUrl] = useState(g?.catalogUrl ?? '');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [filterQ, setFilterQ] = useState('');
  const [importSinglesBusy, setImportSinglesBusy] = useState(false);

  useEffect(() => {
    setDraftUrl(card.sealedSetGallery?.catalogUrl ?? '');
  }, [card.id, card.sealedSetGallery?.catalogUrl]);

  const previewItems = g?.previewItems ?? [];
  const selectedSet = useMemo(() => new Set(g?.selectedProductIds ?? []), [g?.selectedProductIds]);

  const mergeGallery = (patch: Partial<SealedSetGalleryState>) => {
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

  const loadCatalog = async () => {
    const url = draftUrl.trim();
    if (!url) {
      setErr('Paste a TCGPlayer set / catalog browse URL.');
      return;
    }
    setErr(null);
    setLoading(true);
    try {
      const res = await fetch(apiUrl('/api/tcgplayer/catalog-preview'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = (await res.json()) as CatalogPreviewResponse & { error?: string };
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      const items = Array.isArray(data.items) ? data.items : [];
      const togg = card.sealedSetGallery?.toggles ?? defaultSealedGalleryToggles();
      const visibleIds = items
        .filter((it) =>
          galleryItemVisible(classifyPokemonProductBucket(it.rarityName, it.productName), togg)
        )
        .map((it) => it.productId);
      const selectedProductIds =
        visibleIds.length > 0 ? visibleIds : items.map((x) => x.productId);
      mergeGallery({
        catalogUrl: url,
        previewItems: items,
        fetchedAt: typeof data.fetchedAt === 'number' ? data.fetchedAt : Date.now(),
        selectedProductIds,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Catalog load failed');
    } finally {
      setLoading(false);
    }
  };

  const visibleItems = useMemo(() => {
    const q = filterQ.trim().toLowerCase();
    return previewItems.filter((it) => {
      const bucket = classifyPokemonProductBucket(it.rarityName, it.productName);
      if (!galleryItemVisible(bucket, toggles)) return false;
      if (!q) return true;
      const hay = `${it.productName} ${it.setName} ${it.rarityName ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [previewItems, toggles, filterQ]);

  const toggleSelected = (productId: number, on: boolean) => {
    const cur = new Set(g?.selectedProductIds ?? []);
    if (on) cur.add(productId);
    else cur.delete(productId);
    mergeGallery({ selectedProductIds: [...cur] });
  };

  const selectAllVisible = () => {
    const cur = new Set(g?.selectedProductIds ?? []);
    for (const it of visibleItems) cur.add(it.productId);
    mergeGallery({ selectedProductIds: [...cur] });
  };

  const clearSelection = () => mergeGallery({ selectedProductIds: [] });

  const toggleFilter = (key: keyof typeof toggles) => {
    mergeGallery({
      toggles: { ...toggles, [key]: !toggles[key] },
    });
  };

  return (
    <div className="rounded-lg border border-indigo-200 bg-white p-2 space-y-2">
      <div className="text-[10px] font-black uppercase tracking-widest text-indigo-900">
        Set catalog — gallery picker
      </div>
      <p className="text-[10px] text-slate-600 leading-snug">
        Paste a TCGPlayer set browse URL, or use <span className="font-semibold text-slate-700">Load linked products</span>{' '}
        after fetching a buyer&apos;s guide article (above) when product links were found in the article.
      </p>
      <p className="text-[10px] text-slate-500 leading-snug">
        Search grid URLs (<code className="text-[10px] bg-slate-100 px-1 rounded">/search/…</code>) are loaded on your PC in the background;
        rarity filters in the query string are kept. If capture fails, simplify filters or use article-linked products.
      </p>
      <div className="flex flex-wrap gap-2 items-center">
        <input
          type="url"
          className="flex-1 min-w-[180px] rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
          placeholder="https://www.tcgplayer.com/categories/…"
          value={draftUrl}
          onChange={(e) => setDraftUrl(e.target.value)}
        />
        <button
          type="button"
          disabled={loading}
          onClick={() => void loadCatalog()}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
        >
          {loading ? '…' : 'Load catalog'}
        </button>
      </div>
      {err && <p className="text-xs text-rose-700">{err}</p>}
      {previewItems.length > 0 && (
        <>
          <div className="flex flex-wrap gap-2 text-[10px] items-center">
            <span className="font-bold text-slate-700">Show:</span>
            <label className="flex items-center gap-1 cursor-pointer">
              <input type="checkbox" checked={toggles.showCommons} onChange={() => toggleFilter('showCommons')} />
              Commons
            </label>
            <label className="flex items-center gap-1 cursor-pointer">
              <input type="checkbox" checked={toggles.includeSir} onChange={() => toggleFilter('includeSir')} />
              SIR
            </label>
            <label className="flex items-center gap-1 cursor-pointer">
              <input type="checkbox" checked={toggles.includeIr} onChange={() => toggleFilter('includeIr')} />
              IR
            </label>
            <label className="flex items-center gap-1 cursor-pointer">
              <input type="checkbox" checked={toggles.includeFullArt} onChange={() => toggleFilter('includeFullArt')} />
              Full art
            </label>
            <label className="flex items-center gap-1 cursor-pointer">
              <input type="checkbox" checked={toggles.includeEx} onChange={() => toggleFilter('includeEx')} />
              ex / DR
            </label>
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                checked={toggles.includeOtherPremium}
                onChange={() => toggleFilter('includeOtherPremium')}
              />
              Other premium
            </label>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <input
              type="search"
              className="flex-1 min-w-[120px] rounded border border-slate-200 px-2 py-1 text-[11px]"
              placeholder="Filter gallery…"
              value={filterQ}
              onChange={(e) => setFilterQ(e.target.value)}
            />
            <button
              type="button"
              onClick={selectAllVisible}
              className="rounded border border-indigo-200 bg-indigo-50 px-2 py-1 text-[10px] font-bold text-indigo-900"
            >
              Select visible
            </button>
            <button
              type="button"
              onClick={clearSelection}
              className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-bold text-slate-700"
            >
              Clear selection
            </button>
            {onImportSelectedAsSingles && selectedSet.size > 0 ? (
              <button
                type="button"
                disabled={importSinglesBusy}
                onClick={() => {
                  const sel = previewItems.filter((it) => selectedSet.has(it.productId));
                  void (async () => {
                    setImportSinglesBusy(true);
                    try {
                      await onImportSelectedAsSingles(sel);
                    } finally {
                      setImportSinglesBusy(false);
                    }
                  })();
                }}
                className="rounded border border-emerald-500 bg-emerald-600 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-white disabled:opacity-50"
              >
                {importSinglesBusy ? 'Importing…' : 'Import selected to portfolio (singles)'}
              </button>
            ) : null}
            <span className="text-[10px] text-slate-500">
              {selectedSet.size} selected · {visibleItems.length} visible / {previewItems.length} loaded
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-72 overflow-y-auto pr-1">
            {visibleItems.map((it) => {
              const sel = selectedSet.has(it.productId);
              return (
                <button
                  key={it.productId}
                  type="button"
                  onClick={() => toggleSelected(it.productId, !sel)}
                  className={`text-left rounded-lg border p-1.5 transition-colors ${
                    sel ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-300' : 'border-slate-200 bg-slate-50/80'
                  }`}
                >
                  <div className="aspect-[63/88] w-full rounded bg-slate-200 overflow-hidden mb-1 flex items-center justify-center">
                    {it.imageUrl ? (
                      <img src={it.imageUrl} alt="" className="w-full h-full object-contain" loading="lazy" />
                    ) : (
                      <span className="text-[9px] text-slate-500 px-1 text-center line-clamp-3">{it.productName}</span>
                    )}
                  </div>
                  <div className="text-[9px] font-semibold text-slate-900 line-clamp-2">{it.productName}</div>
                  <div className="text-[9px] text-slate-500 line-clamp-1">{it.rarityName || '—'}</div>
                  <div className="text-[9px] font-mono text-indigo-800">${it.marketPrice.toFixed(2)}</div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};
