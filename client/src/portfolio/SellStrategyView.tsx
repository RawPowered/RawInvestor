import { useState } from 'react';
import type { Collection } from '../types';
import type { EnrichedCard } from '../sort';
import { resolveTcgDisplayMarketPrice } from '../tcgDisplayPrice';
import { fmtMoney } from '../math';
import { BrandLogoImg } from '../brandLogos';
import { computeSellPriceTargets, DEFAULT_SELL_PRICING_POLICY } from '../pricing';
import { resolveServerUrl } from '../apiBase';
import { suggestAutoBin } from '../rowSignals';

export const SellStrategyView = ({
  cards,
  collections,
  sellCollectionId,
  holdCollectionId,
  autoPopulateMode,
  onAutoPopulateModeChange,
  onRunAutoPopulate,
  onAssignCollection,
}: {
  cards: EnrichedCard[];
  collections: Collection[];
  sellCollectionId: string | null;
  holdCollectionId: string | null;
  autoPopulateMode: 'unassigned' | 'force';
  onAutoPopulateModeChange: (mode: 'unassigned' | 'force') => void;
  onRunAutoPopulate: (mode: 'unassigned' | 'force') => void;
  onAssignCollection: (cardId: string, collectionId: string | undefined) => void;
}) => {
  const [binView, setBinView] = useState<'all' | 'sell' | 'hold'>('all');
  const [roundingMode, setRoundingMode] = useState<'exact' | 'half' | 'whole'>('exact');
  const [marketMode, setMarketMode] = useState<'best' | 'ebay' | 'whatnot' | 'cashapp'>('best');
  const roundForView = (value: number): number => {
    if (!Number.isFinite(value)) return 0;
    if (roundingMode === 'whole') return Math.round(value);
    if (roundingMode === 'half') return Math.round(value * 2) / 2;
    return Math.round(value * 100) / 100;
  };
  const rows = cards.filter((card) => {
    if (binView === 'all') return true;
    if (binView === 'sell') {
      return Boolean(sellCollectionId && card.collectionId === sellCollectionId);
    }
    if (binView === 'hold') {
      return Boolean(holdCollectionId && card.collectionId === holdCollectionId);
    }
    return false;
  });

  const rowProjections = rows.map((card) => {
    const marketPrice = resolveTcgDisplayMarketPrice(card) ?? card.raw;
    const rawPricing = computeSellPriceTargets(marketPrice, DEFAULT_SELL_PRICING_POLICY);
    const pricing = {
      marketPrice: roundForView(rawPricing.marketPrice),
      optimalEbayPrice: roundForView(rawPricing.optimalEbayPrice),
      optimalWhatnotPrice: roundForView(rawPricing.optimalWhatnotPrice),
      directCashAppOffer: roundForView(rawPricing.directCashAppOffer),
    };
    const basisPaid = typeof card.actualCost === 'number' && card.actualCost > 0 ? card.actualCost : card.raw;
    const inboundShip = card.freeShipping ? 0 : Number(card.shippingCost) || 0;
    const costBasis = basisPaid + inboundShip;
    const ebayNet = pricing.optimalEbayPrice * (1 - DEFAULT_SELL_PRICING_POLICY.ebayFeeRate) - costBasis;
    const whatnotNet = pricing.optimalWhatnotPrice * (1 - DEFAULT_SELL_PRICING_POLICY.whatnotFeeRate) - costBasis;
    const cashAppNet = pricing.directCashAppOffer - costBasis;
    const ebayNetBase = rawPricing.optimalEbayPrice * (1 - DEFAULT_SELL_PRICING_POLICY.ebayFeeRate) - costBasis;
    const whatnotNetBase = rawPricing.optimalWhatnotPrice * (1 - DEFAULT_SELL_PRICING_POLICY.whatnotFeeRate) - costBasis;
    const cashAppNetBase = rawPricing.directCashAppOffer - costBasis;
    const bestChannel = ebayNet >= whatnotNet && ebayNet >= cashAppNet ? 'eBay' : whatnotNet >= cashAppNet ? 'Whatnot' : 'Cash App';
    const netProfit = Math.max(ebayNet, whatnotNet, cashAppNet);
    const bestNetRounded = bestChannel === 'eBay' ? ebayNet : bestChannel === 'Whatnot' ? whatnotNet : cashAppNet;
    const bestNetBase = bestChannel === 'eBay' ? ebayNetBase : bestChannel === 'Whatnot' ? whatnotNetBase : cashAppNetBase;
    const bestListAt = bestChannel === 'eBay' ? pricing.optimalEbayPrice : bestChannel === 'Whatnot' ? pricing.optimalWhatnotPrice : pricing.directCashAppOffer;
    const selectedNet = marketMode === 'ebay' ? ebayNet : marketMode === 'whatnot' ? whatnotNet : marketMode === 'cashapp' ? cashAppNet : netProfit;
    return { card, pricing, bestChannel, ebayNet, whatnotNet, cashAppNet, selectedNet, bestListAt, bestNetBase, bestNetRounded };
  });
  const totalProjectedNet = rowProjections.reduce((sum, r) => sum + r.selectedNet, 0);

  return (
    <div className="w-full max-w-none mt-6 mb-12">
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 bg-slate-50 border-b border-slate-200 flex flex-wrap justify-between items-center gap-3">
          <div>
            <h3 className="font-black text-slate-800 uppercase tracking-widest text-sm">Sell Strategy</h3>
            <p className="text-xs text-slate-500 mt-1">
              Market, optimal eBay/Whatnot list prices, and direct Cash App offer guidance. Sell / Hold lists only
              cards in that bin; suggested bin stays in its column.
            </p>
            <p className={`text-sm font-black mt-2 ${totalProjectedNet >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
              Total projected net profit ({marketMode === 'best' ? 'best channel' : marketMode}): {fmtMoney(totalProjectedNet)}
            </p>
            <div className="mt-3 inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
              <button onClick={() => setBinView('all')} className={`px-2.5 py-1 text-[10px] font-black uppercase tracking-widest rounded ${binView === 'all' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>All</button>
              <button onClick={() => setBinView('sell')} className={`px-2.5 py-1 text-[10px] font-black uppercase tracking-widest rounded ${binView === 'sell' ? 'bg-rose-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>Sell</button>
              <button onClick={() => setBinView('hold')} className={`px-2.5 py-1 text-[10px] font-black uppercase tracking-widest rounded ${binView === 'hold' ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>Hold</button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
              <button onClick={() => setMarketMode('best')} className={`px-2 py-1 text-[10px] font-black uppercase tracking-widest rounded ${marketMode === 'best' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>Best</button>
              <button onClick={() => setMarketMode('ebay')} className={`px-2 py-1 rounded ${marketMode === 'ebay' ? 'bg-blue-50 border border-blue-200' : 'hover:bg-slate-100'}`} title="eBay"><BrandLogoImg brand="ebay" className="h-4 w-auto" title="eBay" /></button>
              <button onClick={() => setMarketMode('whatnot')} className={`px-2 py-1 rounded ${marketMode === 'whatnot' ? 'bg-amber-50 border border-amber-200' : 'hover:bg-slate-100'}`} title="Whatnot"><BrandLogoImg brand="whatnot" className="h-4 w-auto" title="Whatnot" /></button>
              <button onClick={() => setMarketMode('cashapp')} className={`px-2 py-1 rounded ${marketMode === 'cashapp' ? 'bg-emerald-50 border border-emerald-200' : 'hover:bg-slate-100'}`} title="Cash App"><BrandLogoImg brand="cashapp" className="h-4 w-auto" title="Cash App" /></button>
            </div>
            <select value={roundingMode} onChange={(e) => setRoundingMode(e.target.value === 'whole' ? 'whole' : e.target.value === 'half' ? 'half' : 'exact')} className="text-xs font-semibold border border-slate-200 rounded-lg px-2 py-1.5 bg-white" title="Round displayed strategy prices">
              <option value="exact">Exact cents</option>
              <option value="half">Nearest $0.50</option>
              <option value="whole">Nearest $1.00</option>
            </select>
            <select value={autoPopulateMode} onChange={(e) => onAutoPopulateModeChange(e.target.value === 'force' ? 'force' : 'unassigned')} className="text-xs font-semibold border border-slate-200 rounded-lg px-2 py-1.5 bg-white">
              <option value="unassigned">Assign unassigned only</option>
              <option value="force">Force reassign all</option>
            </select>
            <button onClick={() => onRunAutoPopulate(autoPopulateMode)} className="text-xs font-black uppercase tracking-widest px-3 py-2 rounded-lg border bg-slate-900 text-white border-slate-900 hover:bg-slate-800">Auto-populate bins</button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[74rem] text-left text-[14px]">
            <thead><tr className="text-[10px] uppercase font-black tracking-[0.14em] text-slate-500 border-b border-slate-100 bg-white"><th className="px-3 py-4">Preview</th><th className="px-3 py-4">Card</th><th className="px-3 py-4 text-right">Market</th><th className="px-3 py-4 text-right">Optimal eBay</th><th className="px-3 py-4 text-right">Optimal Whatnot</th><th className="px-3 py-4 text-right">Cash App Offer</th><th className="px-3 py-4 text-right">Net Profit</th><th className="px-3 py-4 text-center">Suggested Bin</th><th className="px-3 py-4 text-center">Current Bin</th><th className="px-3 py-4 text-center">Actions</th></tr></thead>
            <tbody className="divide-y divide-slate-50 font-medium">
              {rowProjections.map(({ card, pricing, bestChannel, ebayNet, whatnotNet, cashAppNet, bestListAt, bestNetBase, bestNetRounded }) => {
                const suggested = suggestAutoBin(card);
                const currentCollection = collections.find((c) => c.id === card.collectionId);
                const bestBrand = bestChannel === 'eBay' ? 'ebay' : bestChannel === 'Whatnot' ? 'whatnot' : 'cashapp';
                return (
                  <tr key={card.id} className="hover:bg-slate-50/60">
                    <td className="px-3 py-4">{card.localImage ? <img src={resolveServerUrl(card.localImage)} alt={card.name} className="h-16 w-12 object-cover rounded border border-slate-200 shadow-sm bg-slate-100" loading="lazy" /> : <div className="h-16 w-12 rounded border border-dashed border-slate-300 bg-slate-50 text-[9px] font-bold uppercase tracking-wide text-slate-400 flex items-center justify-center">No Img</div>}</td>
                    <td className="px-3 py-4"><div className="font-semibold text-slate-800">{card.name}</div><div className="text-xs text-slate-500">{card.set}</div></td>
                    <td className="px-3 py-4 text-right tabular-nums">{fmtMoney(pricing.marketPrice)}</td><td className="px-3 py-4 text-right tabular-nums">{fmtMoney(pricing.optimalEbayPrice)}</td><td className="px-3 py-4 text-right tabular-nums">{fmtMoney(pricing.optimalWhatnotPrice)}</td><td className="px-3 py-4 text-right tabular-nums">{fmtMoney(pricing.directCashAppOffer)}</td>
                    <td className="px-3 py-4 tabular-nums"><div className="mx-auto flex w-full max-w-[13rem] flex-col items-center rounded-xl border border-slate-200/90 bg-gradient-to-b from-white via-slate-50/60 to-emerald-50/40 px-3 py-2 shadow-[0_6px_20px_-16px_rgba(15,23,42,0.6)]"><div className="inline-flex items-center gap-2 rounded-full border border-emerald-200/90 bg-white/90 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-emerald-800"><BrandLogoImg brand={bestBrand} className="h-6 w-auto" title={bestChannel} /><span>Best Offer</span></div><div className="mt-2 text-center"><div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">List at</div><div className="text-2xl font-black leading-tight tracking-tight text-slate-900">{fmtMoney(bestListAt)}</div></div><div className="mt-2 w-full border-t border-slate-200/80 pt-2 text-center"><div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Net profit</div><div className={`mt-0.5 text-lg font-bold tabular-nums leading-snug ${bestNetRounded >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}><span className="text-slate-500 font-semibold">{fmtMoney(bestNetBase)}</span><span className="mx-1.5 text-slate-300 font-light">/</span><span>{fmtMoney(bestNetRounded)}</span></div><div className="mt-0.5 text-[10px] font-medium text-slate-400">Base / rounded (list price)</div></div></div><div className="mt-1.5 text-center space-y-0.5 text-[10px]"><div className={`${bestChannel === 'eBay' ? 'font-black text-emerald-700' : 'text-slate-500'} inline-flex items-center gap-1`}><BrandLogoImg brand="ebay" className="h-3.5 w-auto" title="eBay" />eBay {fmtMoney(ebayNet)}</div><div className={`${bestChannel === 'Whatnot' ? 'font-black text-emerald-700' : 'text-slate-500'} inline-flex items-center gap-1`}><BrandLogoImg brand="whatnot" className="h-3.5 w-auto" title="Whatnot" />Whatnot {fmtMoney(whatnotNet)}</div><div className={`${bestChannel === 'Cash App' ? 'font-black text-emerald-700' : 'text-slate-500'} inline-flex items-center gap-1`}><BrandLogoImg brand="cashapp" className="h-3.5 w-auto" title="Cash App" />Cash App {fmtMoney(cashAppNet)}</div></div></td>
                    <td className="px-3 py-4 text-center text-xs font-bold uppercase tracking-wide text-slate-700">{suggested ?? 'none'}</td>
                    <td className="px-3 py-4 text-center text-xs font-semibold text-slate-600">{currentCollection?.name ?? 'unassigned'}</td>
                    <td className="px-3 py-4 text-center"><div className="inline-flex items-center gap-1"><button onClick={() => onAssignCollection(card.id, sellCollectionId ?? undefined)} disabled={!sellCollectionId} className="text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded border border-rose-200 text-rose-700 bg-rose-50 disabled:opacity-40">Sell</button><button onClick={() => onAssignCollection(card.id, holdCollectionId ?? undefined)} disabled={!holdCollectionId} className="text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded border border-emerald-200 text-emerald-700 bg-emerald-50 disabled:opacity-40">Hold</button></div></td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={10} className="px-3 py-10 text-center text-slate-400 text-sm">No cards in this view.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
