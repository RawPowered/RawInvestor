import { useMemo } from 'react';
import { ArrowUpDown, Check, Filter, FolderHeart, RefreshCw, Search, Store, X } from 'lucide-react';
import type { Collection } from '../types';
import { SORT_LABELS, UNASSIGNED, releaseYearUtc, type EnrichedCard, type EvSign, type FilterState, type ProfitLens, type SortPreset } from '../sort';

export const Toolbar = ({
  filters,
  setFilters,
  sort,
  setSort,
  collections,
  portfolioCards,
  onToggleCollection,
  onManageCollections,
  showCollections,
  visibleCount,
  totalCount,
  onRefreshAll,
  bulkRefresh,
  onRefreshAllEbay,
  bulkEbayRefresh,
  refreshableCount,
  ebayRefreshableCount,
  profitLensLabels,
}: {
  filters: FilterState;
  setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
  sort: SortPreset;
  setSort: (s: SortPreset) => void;
  collections: Collection[];
  portfolioCards: EnrichedCard[];
  onToggleCollection: (id: string) => void;
  onManageCollections: () => void;
  showCollections: boolean;
  visibleCount: number;
  totalCount: number;
  onRefreshAll: () => void;
  bulkRefresh: { done: number; total: number; errors: number } | null;
  onRefreshAllEbay: () => void;
  bulkEbayRefresh: { done: number; total: number; errors: number } | null;
  refreshableCount: number;
  ebayRefreshableCount: number;
  profitLensLabels: Record<ProfitLens, string>;
}) => {
  const selected = new Set(filters.collectionIds);
  const setOptions = useMemo(() => [...new Set(portfolioCards.map((c) => c.set).filter((s) => s && String(s).trim()))].sort((a, b) => a.localeCompare(b)), [portfolioCards]);
  const yearOptions = useMemo(() => {
    const ys = new Set<number>();
    for (const c of portfolioCards) {
      const y = releaseYearUtc(c);
      if (y != null) ys.add(y);
    }
    return [...ys].sort((a, b) => b - a);
  }, [portfolioCards]);
  const refineActive =
    filters.sets.length > 0 ||
    filters.releaseYears.length > 0 ||
    filters.pokemonName.trim() !== '' ||
    filters.profitLens !== 'all' ||
    filters.portfolioKindScope !== 'all';
  const toggleSetFilter = (setName: string) => setFilters((f) => ({ ...f, sets: f.sets.includes(setName) ? f.sets.filter((x) => x !== setName) : [...f.sets, setName] }));
  const toggleYearFilter = (year: number) => setFilters((f) => ({ ...f, releaseYears: f.releaseYears.includes(year) ? f.releaseYears.filter((x) => x !== year) : [...f.releaseYears, year] }));
  const clearRefine = () =>
    setFilters((f) => ({
      ...f,
      sets: [],
      releaseYears: [],
      pokemonName: '',
      profitLens: 'all',
      portfolioKindScope: 'all',
    }));
  const cycleEvSign = () => {
    const order: EvSign[] = ['all', 'positive', 'negative'];
    const next = order[(order.indexOf(filters.evSign) + 1) % order.length];
    setFilters((f) => ({ ...f, evSign: next }));
  };
  const evSignLabel: Record<EvSign, string> = { all: 'All EV', positive: '+EV only', negative: '\u2212EV only' };

  return (
    <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-4 mb-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="text" value={filters.search} onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))} placeholder="Search name, set, or rarity..." className="w-full pl-9 pr-9 py-2.5 rounded-xl border border-slate-200 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-300" />
          {filters.search && <button onClick={() => setFilters((f) => ({ ...f, search: '' }))} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700" title="Clear search"><X size={14} /></button>}
        </div>
        <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-500"><ArrowUpDown size={14} /> Sort<select value={sort} onChange={(e) => setSort(e.target.value as SortPreset)} className="text-sm font-semibold border border-slate-200 rounded-lg px-3 py-1.5 bg-white normal-case tracking-normal focus:outline-none focus:ring-2 focus:ring-blue-300">{(Object.keys(SORT_LABELS) as SortPreset[]).map((k) => (<option key={k} value={k}>{SORT_LABELS[k]}</option>))}</select></label>
        <button onClick={cycleEvSign} className={`text-xs font-black uppercase tracking-widest px-3 py-2 rounded-lg border transition-colors ${filters.evSign === 'all' ? 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50' : filters.evSign === 'positive' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-rose-50 border-rose-200 text-rose-700'}`} title="Cycle EV-sign filter"><Filter size={12} className="inline mr-1.5 -mt-0.5" />{evSignLabel[filters.evSign]}</button>
        <button onClick={onRefreshAll} disabled={!!bulkRefresh || refreshableCount === 0} className="text-xs font-black uppercase tracking-widest px-3 py-2 rounded-lg border transition-colors bg-white border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed" title={refreshableCount === 0 ? 'Add cards via a PriceCharting URL to enable refresh' : `Re-scrape prices for ${refreshableCount} card${refreshableCount === 1 ? '' : 's'}`}><RefreshCw size={12} className={`inline mr-1.5 -mt-0.5 ${bulkRefresh ? 'animate-spin' : ''}`} />{bulkRefresh ? `Refreshing ${bulkRefresh.done}/${bulkRefresh.total}${bulkRefresh.errors ? ` (${bulkRefresh.errors} failed)` : ''}` : `Refresh prices${refreshableCount > 0 ? ` (${refreshableCount})` : ''}`}</button>
        <button onClick={onRefreshAllEbay} disabled={!!bulkEbayRefresh || ebayRefreshableCount === 0} className="text-xs font-black uppercase tracking-widest px-3 py-2 rounded-lg border transition-colors bg-white border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed" title={`Refresh eBay sold comps for ${ebayRefreshableCount} card${ebayRefreshableCount === 1 ? '' : 's'}`}><Store size={12} className={`inline mr-1.5 -mt-0.5 ${bulkEbayRefresh ? 'animate-pulse' : ''}`} />{bulkEbayRefresh ? `eBay ${bulkEbayRefresh.done}/${bulkEbayRefresh.total}${bulkEbayRefresh.errors ? ` (${bulkEbayRefresh.errors} failed)` : ''}` : `Refresh eBay${ebayRefreshableCount > 0 ? ` (${ebayRefreshableCount})` : ''}`}</button>
        <button onClick={onManageCollections} className={`text-xs font-black uppercase tracking-widest px-3 py-2 rounded-lg border transition-colors ${showCollections ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'}`}><FolderHeart size={12} className="inline mr-1.5 -mt-0.5" />Collections ({collections.length})</button>
        <span className="ml-auto text-[11px] font-bold uppercase tracking-widest text-slate-400">{visibleCount}/{totalCount} visible</span>
      </div>
      <div className="mt-3 pt-3 border-t border-slate-100">
        <div className="flex flex-wrap items-end gap-3 gap-y-2">
          <div className="flex-1 min-w-[200px] max-w-xl"><span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1">Set</span><div className="max-h-28 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/80 p-2 flex flex-wrap gap-1">{setOptions.map((s) => { const on = filters.sets.includes(s); return <button key={s} type="button" onClick={() => toggleSetFilter(s)} className={`text-[11px] font-semibold px-2 py-0.5 rounded-md border transition-colors ${on ? 'border-slate-800 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}>{s}</button>; })}{setOptions.length === 0 && <span className="text-xs text-slate-400 italic px-1">No sets yet</span>}</div></div>
          <div className="min-w-[120px]"><span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1">Release year</span><div className="max-h-28 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/80 p-2 flex flex-wrap gap-1">{yearOptions.map((y) => { const on = filters.releaseYears.includes(y); return <button key={y} type="button" onClick={() => toggleYearFilter(y)} className={`text-xs font-bold tabular-nums px-2 py-0.5 rounded-md border transition-colors ${on ? 'border-emerald-700 bg-emerald-700 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}>{y}</button>; })}{yearOptions.length === 0 && <span className="text-xs text-slate-400 italic px-1">No release dates</span>}</div></div>
          <div className="min-w-[140px] flex-1 max-w-xs"><label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1">Name contains</label><input type="text" value={filters.pokemonName} onChange={(e) => setFilters((f) => ({ ...f, pokemonName: e.target.value }))} placeholder="e.g. Charizard" className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-300" /></div>
          <div className="min-w-[200px] max-w-sm"><label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1">Profit view</label><select value={filters.profitLens} onChange={(e) => setFilters((f) => ({ ...f, profitLens: e.target.value as ProfitLens }))} className="w-full text-sm font-semibold border border-slate-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-300">{(Object.keys(profitLensLabels) as ProfitLens[]).map((k) => (<option key={k} value={k}>{profitLensLabels[k]}</option>))}</select></div>
          {refineActive && <button type="button" onClick={clearRefine} className="text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-700 self-end mb-1">Clear refine</button>}
        </div>
      </div>
      {collections.length > 0 && <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center gap-2"><span className="text-[10px] font-black uppercase tracking-widest text-slate-400 mr-1">Show:</span>{collections.map((c) => { const active = selected.has(c.id); return <button key={c.id} onClick={() => onToggleCollection(c.id)} className={`text-xs font-bold px-2.5 py-1 rounded-full border flex items-center gap-1.5 transition-all ${active ? 'border-slate-800 bg-slate-50 shadow-sm' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'}`} style={active ? { boxShadow: `inset 0 -2px 0 ${c.color}` } : undefined}><span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: c.color }} />{c.name}{active && <Check size={11} />}</button>; })}<button onClick={() => onToggleCollection(UNASSIGNED)} className={`text-xs font-bold px-2.5 py-1 rounded-full border italic transition-all ${selected.has(UNASSIGNED) ? 'border-slate-800 bg-slate-50 shadow-sm text-slate-700' : 'border-dashed border-slate-300 bg-white text-slate-400 hover:border-slate-400'}`}>Unassigned{selected.has(UNASSIGNED) && <Check size={11} className="inline ml-1" />}</button>{selected.size > 0 && <button onClick={() => setFilters((f) => ({ ...f, collectionIds: [] }))} className="text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-700 ml-1">Clear</button>}</div>}
    </div>
  );
};
