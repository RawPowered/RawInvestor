import { ChevronDown, ChevronRight, RefreshCw, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Card, Collection, Fees } from '../types';
import type { EnrichedCard } from '../sort';
import { fmtMoney, fmtPct } from '../math';
import { formatMasterListDate } from '../utils/time';
import { MasterListExternalLinks } from '../masterListExternalLinks';
import { MasterListRawCell } from '../masterListRawCell';
import { MasterListShareButton } from '../cardShareGraphic';
import { SignalIconsRow } from '../signalIcons';
import { PotentialValueCell, PriceCell } from '../shared/tableCells';
import { resolveServerUrl } from '../apiBase';
import { ProbInput } from '../shared/formFields';

export const FragmentRow = ({
  card,
  fees,
  collections,
  isOpen,
  psaToken,
  isRefreshing,
  isRefreshingEbay,
  refreshApplied,
  bulkSelected,
  onToggle,
  onToggleBulk,
  onDelete,
  onRefresh,
  onRefreshEbay,
  onFieldChange,
  onFetchPsaPop,
  onApplyPsaProbs,
  renderPaidCell,
  renderShipCell,
  renderGemRateCell,
  ExpandedDetailComponent,
}: {
  card: EnrichedCard;
  fees: Fees;
  collections: Collection[];
  isOpen: boolean;
  psaToken: string;
  isRefreshing: boolean;
  isRefreshingEbay: boolean;
  refreshApplied: { tcg: number; ebay: number; at: number } | null;
  bulkSelected: boolean;
  onToggle: () => void;
  onToggleBulk: () => void;
  onDelete: () => void;
  onRefresh: () => void;
  onRefreshEbay: () => void;
  onFieldChange: <K extends keyof Card>(id: string, key: K, value: Card[K]) => void;
  onFetchPsaPop: () => void;
  onApplyPsaProbs: () => void;
  renderPaidCell: () => ReactNode;
  renderShipCell: () => ReactNode;
  renderGemRateCell: () => ReactNode;
  ExpandedDetailComponent: React.ComponentType<{
    card: EnrichedCard;
    fees: Fees;
    psaToken: string;
    collections: Collection[];
    onFieldChange: <K extends keyof Card>(id: string, key: K, value: Card[K]) => void;
    onFetchPsaPop: () => void;
    onApplyPsaProbs: () => void;
  }>;
}) => {
  const collection = collections.find((c) => c.id === card.collectionId);
  const prev = card.previousPrices;
  const rel = formatMasterListDate(card.releaseDateMs);
  return (
    <>
      <tr className="group hover:bg-slate-50/80 transition-colors">
        <td className="w-7 px-0.5 py-4 align-top"><input type="checkbox" className="rounded border-slate-300" checked={bulkSelected} onChange={onToggleBulk} onClick={(e) => e.stopPropagation()} title="Select for bulk eBay actions" aria-label="Select card for bulk actions" /></td>
        <td className="px-2 py-4 text-slate-400 align-top"><button onClick={onToggle} className="p-1 hover:text-slate-700">{isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button></td>
        <td className="px-2 py-4 align-top w-[6.75rem] min-w-[6.75rem] box-border"><div className="w-[6.25rem] min-w-[6.25rem] mx-auto">{card.localImage ? <a href={card.url || resolveServerUrl(card.localImage)} target="_blank" rel="noreferrer" className="block rounded-lg border border-slate-200 shadow-sm overflow-hidden bg-slate-100"><img src={resolveServerUrl(card.localImage)} alt={card.name} width={100} height={140} className="block h-[8.75rem] w-full object-cover object-center" loading="lazy" /></a> : <div className="h-[8.75rem] w-full rounded-lg bg-slate-100 border border-slate-200" />}</div></td>
        <td className="px-4 py-4 align-top min-w-[12.5rem]"><div className="font-semibold text-slate-900 leading-snug flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[20px]">{collection && <span className="inline-block h-2 w-2 rounded-full flex-none" style={{ backgroundColor: collection.color }} title={`Collection: ${collection.name}`} />}<span>{card.name}</span>{card.rarity ? <span className="text-[11px] font-bold text-slate-400 normal-case tracking-normal">· {card.rarity}</span> : null}</div><div className="text-[13px] text-slate-700 font-semibold uppercase tracking-wide mt-1.5 leading-tight">Set · {(card.set || '').trim() || '—'}</div>{rel ? <><div className="text-[11px] text-slate-600 font-medium mt-1">Release · {rel}</div><div className="text-[10px] text-slate-400 font-medium mt-0.5 leading-tight" title="From PriceCharting product details. When the site does not list a separate set-wide date, this repeats the same product date.">Set release · {rel}</div></> : <div className="text-[9px] text-slate-400 mt-1 font-medium">Release / set release — rescrape card to load from PC</div>}{collection && <div className="text-[9px] text-slate-400 mt-1 normal-case tracking-normal font-semibold">in {collection.name}</div>}</td>
        <td className="px-1 py-4 align-middle w-[6.5rem] min-w-[6.5rem]"><MasterListExternalLinks card={card} /></td>
        <td className="px-1.5 py-4 align-middle text-center">{card.rowSignalIcons ? <SignalIconsRow icons={card.rowSignalIcons} /> : null}</td>
        <MasterListRawCell card={card} />
        {renderPaidCell()}
        {renderShipCell()}
        <PriceCell current={card.grade9} previous={prev?.grade9} />
        <PriceCell current={card.psa10} previous={prev?.psa10} />
        <PotentialValueCell card={card} />
        {renderGemRateCell()}
        <td className="px-3 py-4 text-center"><ProbInput value={card.p10} onChange={(v) => onFieldChange(card.id, 'p10', v)} /></td>
        <td className="px-3 py-4 text-center"><ProbInput value={card.p9} onChange={(v) => onFieldChange(card.id, 'p9', v)} /></td>
        <td className="px-3 py-4 text-right bg-blue-50/30"><div className="font-black text-slate-900 text-[15px] tabular-nums">{fmtMoney(card.metrics.totalInvested)}</div></td>
        <td className="px-3 py-4 text-right"><div className={`font-black text-[15px] tabular-nums ${card.metrics.ev >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmtMoney(card.metrics.ev)}</div></td>
        <td className="px-3 py-4 text-right"><div className={`font-black text-[15px] tabular-nums ${card.metrics.roiPct >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmtPct(card.metrics.roiPct)}</div></td>
        <td className="px-3 py-4 text-right">
          <div className="flex items-center justify-end gap-1">
            <MasterListShareButton card={card} collectionName={collection?.name} />
            <button onClick={onRefresh} disabled={isRefreshing || !card.url} className="p-2 text-slate-300 hover:text-blue-500 transition-colors bg-white rounded-lg border border-transparent hover:border-blue-100 hover:shadow-sm disabled:opacity-30 disabled:cursor-not-allowed" title={!card.url ? 'No PriceCharting URL stored for this card' : card.lastRefreshedAt ? `Refresh prices (last: ${new Date(card.lastRefreshedAt).toLocaleString()})` : 'Refresh prices from PriceCharting'}><RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} /></button>
            <button onClick={onRefreshEbay} disabled={isRefreshingEbay} className="px-2 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-blue-600 transition-colors bg-white rounded-lg border border-slate-200 hover:border-blue-200 disabled:opacity-30 disabled:cursor-not-allowed" title="Refresh eBay extension capture merge">{isRefreshingEbay ? 'eB…' : 'eB'}</button>
            <button onClick={onDelete} className="p-2 text-slate-300 hover:text-rose-500 transition-colors bg-white rounded-lg border border-transparent hover:border-rose-100 hover:shadow-sm" title="Delete"><Trash2 size={16} /></button>
          </div>
          {refreshApplied ? (
            <div
              className="mt-1 text-[10px] font-semibold text-emerald-700 tabular-nums"
              title={`Latest apply: ${new Date(refreshApplied.at).toLocaleString()}`}
            >
              +TCG {refreshApplied.tcg} · +eB {refreshApplied.ebay}
            </div>
          ) : null}
        </td>
      </tr>
      {isOpen && (
        <tr className="bg-slate-50/50">
          <td colSpan={19} className="px-6 py-6">
            <ExpandedDetailComponent card={card} fees={fees} psaToken={psaToken} collections={collections} onFieldChange={onFieldChange} onFetchPsaPop={onFetchPsaPop} onApplyPsaProbs={onApplyPsaProbs} />
          </td>
        </tr>
      )}
    </>
  );
};
