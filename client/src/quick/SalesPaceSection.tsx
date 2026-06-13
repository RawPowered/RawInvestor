import { useMemo } from 'react';
import { Sparkles, Users } from 'lucide-react';
import type { EnrichedCard } from '../sort';
import { fmtMoney } from '../math';
import {
  adviceBadge,
  combineSalesPace,
  extractCrossGraders,
  formatSalesCadenceReport,
  SALES_STATS_WINDOW_DAYS,
  summarizeSales,
} from '../pricing';
import { recentSalesOnOrAfterRelease } from '../releaseFilter';
import {
  entCardFrame,
  entKpiLabel,
  entKpiTile,
  entKpiValue,
  entMicroLabel,
  entSection,
  entSectionHeading,
} from './enterpriseDashboardUi';

const MiniKpi = ({ label, value, color }: { label: string; value: string; color?: string }) => (
  <div className={entKpiTile}>
    <div className={entKpiLabel}>{label}</div>
    <div className={`${entKpiValue} text-[16px] ${color ?? 'text-slate-900'}`}>{value}</div>
  </div>
);

const CrossGraderPanel = ({
  crossGraders,
  rawPrice,
  psa10Price,
}: {
  crossGraders: ReturnType<typeof extractCrossGraders>;
  rawPrice: number;
  psa10Price: number;
}) => {
  if (crossGraders.length === 0) return null;
  const hasNonPsa = crossGraders.some((g) => g.company !== 'PSA');
  if (!hasNonPsa) return null;
  return (
    <div className={`${entCardFrame} bg-slate-50/40 p-4 space-y-3`}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className={entMicroLabel}>Market structure</span>
          <h5 className={`${entSectionHeading} flex items-center gap-2`}>
            <Users size={13} className="text-slate-500 shrink-0" /> Cross-Grader Comparison (PriceCharting)
          </h5>
        </div>
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Raw {fmtMoney(rawPrice)} · PSA 10 {fmtMoney(psa10Price)}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="text-[10px] font-black uppercase tracking-widest text-slate-500"><th className="text-left py-1.5">Grader</th><th className="text-right py-1.5">Price</th><th className="text-right py-1.5">vs Raw</th><th className="text-right py-1.5">vs PSA 10</th></tr></thead>
          <tbody className="divide-y divide-slate-200">
            {crossGraders.map((g) => {
              const deltaColor = g.deltaVsPsa10 == null ? 'text-slate-500' : g.deltaVsPsa10 > 0.05 ? 'text-emerald-600' : g.deltaVsPsa10 < -0.05 ? 'text-rose-600' : 'text-slate-500';
              return (
                <tr key={g.key}>
                  <td className="py-1.5"><span className="inline-flex items-center gap-1.5"><span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-200 text-slate-700">{g.company}</span><span className="text-slate-700 font-medium">{g.label}</span></span></td>
                  <td className="py-1.5 text-right font-mono font-bold text-slate-800">{fmtMoney(g.price)}</td>
                  <td className="py-1.5 text-right font-mono text-slate-600">{g.premiumVsRaw == null ? '-' : `${g.premiumVsRaw.toFixed(1)}x`}</td>
                  <td className={`py-1.5 text-right font-mono ${deltaColor}`}>{g.deltaVsPsa10 == null ? '-' : `${g.deltaVsPsa10 >= 0 ? '+' : ''}${(g.deltaVsPsa10 * 100).toFixed(1)}%`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const SalesPaceCard = ({
  title,
  s,
  combined,
}: {
  title: string;
  s: ReturnType<typeof summarizeSales>;
  combined?: ReturnType<typeof combineSalesPace>;
}) => {
  const palette = adviceBadge(s.pushHigher.advice);
  const hasSales = s.count > 0;
  return (
    <div className={`${entCardFrame} p-4 space-y-3.5`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className={entMicroLabel}>Sales window</span>
          <h5 className={entSectionHeading}>{title}</h5>
        </div>
        <div className="flex items-center gap-1.5">
          {combined && <span className="text-[9px] font-semibold uppercase tracking-[0.11em] bg-blue-100 text-blue-700 border border-blue-200 rounded px-1.5 py-0.5" title={`Merged pace source: ${combined.source.toUpperCase()} (${combined.confidence} confidence)`}>{combined.source}</span>}
          {s.referenceMode === 'pc_fallback' && <span className="text-[9px] font-semibold uppercase tracking-[0.11em] bg-violet-100 text-violet-700 border border-violet-200 rounded px-1.5 py-0.5" title={`Thin sales data (${s.count} in window). Using PriceCharting's posted price as the reference.`}>PC ref</span>}
          <span className="text-[11px] text-slate-500 font-medium">{s.count} sale{s.count === 1 ? '' : 's'} / {s.windowDays}d</span>
        </div>
      </div>
      {s.referenceMode === 'pc_fallback' && <div className="rounded-lg bg-violet-50/60 border border-violet-200 text-violet-900 px-3 py-2.5 text-[10px] leading-snug">Using <span className="font-semibold tabular-nums">{fmtMoney(s.referencePrice ?? 0)}</span> from PriceCharting as the reference. Floor / list / stretch are -10% / 0 / +15% around it.</div>}
      {hasSales && <div className="grid grid-cols-2 gap-2.5 text-[11px]"><MiniKpi label="Low" value={fmtMoney(s.low ?? 0)} color="text-rose-600" /><MiniKpi label="High" value={fmtMoney(s.high ?? 0)} color="text-emerald-600" /><MiniKpi label="Median" value={fmtMoney(s.median ?? 0)} /><MiniKpi label="Average" value={fmtMoney(s.mean ?? 0)} /><MiniKpi label="Pace/mo" value={(combined?.pacePerMonth ?? s.pacePerMonth).toFixed(1)} color={(combined?.pacePerMonth ?? s.pacePerMonth) >= 4 ? 'text-emerald-600' : (combined?.pacePerMonth ?? s.pacePerMonth) >= 2 ? 'text-blue-600' : 'text-amber-600'} /><MiniKpi label="Std Dev" value={fmtMoney(s.stdDev ?? 0)} /></div>}
      {!hasSales && s.referenceMode === 'no_data' && <p className="text-[11px] text-slate-400 italic">No sales observed and no PriceCharting price to anchor on.</p>}
      {s.suggestion.list != null && <div className="rounded-lg bg-slate-50/50 border border-slate-200 p-3 space-y-2"><div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Suggested list prices {s.referenceMode === 'pc_fallback' && <span className="ml-1 text-violet-600">(PC-anchored)</span>}</div><div className="grid grid-cols-3 gap-2 text-center"><div className="rounded-md border border-rose-100 bg-rose-50/45 py-2 px-1.5"><div className="text-[9px] text-rose-700 font-semibold uppercase tracking-[0.11em]">{s.referenceMode === 'pc_fallback' ? 'Floor (-10%)' : 'Floor (P25)'}</div><div className="text-base font-semibold tabular-nums text-rose-700 mt-0.5">{fmtMoney(s.suggestion.floor ?? 0)}</div></div><div className="rounded-md border border-slate-200 bg-white py-2 px-1.5"><div className="text-[9px] text-slate-600 font-semibold uppercase tracking-[0.11em]">{s.referenceMode === 'pc_fallback' ? 'List (PC)' : 'List (P75)'}</div><div className="text-base font-semibold tabular-nums text-slate-900 mt-0.5">{fmtMoney(s.suggestion.list ?? 0)}</div></div><div className="rounded-md border border-emerald-100 bg-emerald-50/45 py-2 px-1.5"><div className="text-[9px] text-emerald-700 font-semibold uppercase tracking-[0.11em]">{s.referenceMode === 'pc_fallback' ? 'Stretch (+15%)' : 'Stretch (P90)'}</div><div className="text-base font-semibold tabular-nums text-emerald-700 mt-0.5">{fmtMoney(s.suggestion.stretch ?? 0)}</div></div></div></div>}
      <div className={`rounded-lg border ${palette.border} ${palette.bg} ${palette.color} px-3 py-2`} title={s.pushHigher.reason}><div className="flex items-center justify-between gap-2"><span className="text-[9px] font-semibold uppercase tracking-[0.12em] opacity-70">Strategy</span><span className="text-[10px] font-semibold tracking-wide">{s.pushHigher.label}</span><span className="text-[9px] font-semibold uppercase tracking-wide opacity-60">{s.pushHigher.confidence}</span></div><p className="text-[11px] leading-snug mt-1 opacity-90">{s.pushHigher.reason}</p></div>
    </div>
  );
};

export const SalesPaceSection = ({ card }: { card: EnrichedCard }) => {
  const sales = useMemo(() => recentSalesOnOrAfterRelease(card.recentSales, card.releaseDateMs), [card.recentSales, card.releaseDateMs]);
  const volume = card.salesVolume;
  const summaries = useMemo(() => ({
    raw: summarizeSales(sales, 'raw', SALES_STATS_WINDOW_DAYS, volume, card.raw, undefined, card.raw),
    grade9: summarizeSales(sales, 'grade9', SALES_STATS_WINDOW_DAYS, volume, card.grade9, undefined, card.raw),
    psa10: summarizeSales(sales, 'psa10', SALES_STATS_WINDOW_DAYS, volume, card.psa10, undefined, card.raw),
  }), [sales, volume, card.raw, card.grade9, card.psa10]);
  const combinedRaw = useMemo(() => combineSalesPace('raw', summaries.raw, card.ebaySales ?? null), [summaries.raw, card.ebaySales]);
  const crossGraders = useMemo(() => extractCrossGraders(card.allPrices, card.raw, card.psa10), [card.allPrices, card.raw, card.psa10]);
  const cadenceReport = useMemo(() => formatSalesCadenceReport(sales), [sales]);
  const hasAnyData = summaries.raw.count > 0 || summaries.grade9.count > 0 || summaries.psa10.count > 0 || summaries.raw.referenceMode === 'pc_fallback' || summaries.grade9.referenceMode === 'pc_fallback' || summaries.psa10.referenceMode === 'pc_fallback' || !!volume?.month || !!volume?.week;

  return (
    <section className={entSection}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex flex-col gap-0.5">
          <span className={entMicroLabel}>Liquidity</span>
          <h4 className={`${entSectionHeading} flex items-center gap-2`}>
            <Sparkles size={14} className="text-slate-500 shrink-0" /> Sale Pricing &amp; Pace ({SALES_STATS_WINDOW_DAYS}-day)
          </h4>
        </div>
        {volume && (volume.week || volume.month || volume.year || volume.total) ? <div className="flex flex-wrap gap-1.5 text-[10px] font-bold">{volume.week != null && <span className="bg-slate-100 text-slate-700 rounded-md px-2 py-0.5">Week: <span className="tabular-nums">{volume.week.toLocaleString()}</span></span>}{volume.month != null && <span className="bg-slate-100 text-slate-700 rounded-md px-2 py-0.5">Month: <span className="tabular-nums">{volume.month.toLocaleString()}</span></span>}{volume.year != null && <span className="bg-slate-100 text-slate-700 rounded-md px-2 py-0.5">Year: <span className="tabular-nums">{volume.year.toLocaleString()}</span></span>}{volume.total != null && <span className="bg-slate-100 text-slate-700 rounded-md px-2 py-0.5">Total: <span className="tabular-nums">{volume.total.toLocaleString()}</span></span>}</div> : null}
      </div>
      {!hasAnyData ? <p className="text-xs text-slate-400 font-medium">No recent sales or volume data available for this card. PriceCharting doesn't always surface these stats; try refreshing later.</p> : <div className="grid grid-cols-1 md:grid-cols-3 gap-5"><SalesPaceCard title="Raw" s={summaries.raw} combined={combinedRaw} /><SalesPaceCard title="Grade 9" s={summaries.grade9} /><SalesPaceCard title="PSA 10" s={summaries.psa10} /></div>}
      <CrossGraderPanel crossGraders={crossGraders} rawPrice={card.raw} psa10Price={card.psa10} />
      {cadenceReport ? <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500 mb-1.5">Scrape cadence (counts / implied day &amp; week)</p><pre className="text-[10px] font-mono text-slate-700 leading-snug whitespace-pre-wrap m-0">{cadenceReport}</pre></div> : null}
      <p className="text-[10px] text-slate-400 italic leading-relaxed">P25 = floor (fast sale), P75 = balanced list price, P90 = stretch. All sale counts and distributions use the last {SALES_STATS_WINDOW_DAYS} days of data we can scrape (not PriceCharting&rsquo;s full history). For raw, scraped prices in the ~$5–$8 empty-cell band that sit far below your posted ungraded price are dropped so lows / medians are not pinned to a fake $6 floor. Browser-only URL fragments (anything after # in the address) are not sent to the scrape API, so use the normal product link; cadence counts every completed-sale row we parsed from the returned HTML. Pace is measured from those sales when possible, falling back to their site-wide monthly count. When fewer than 10 sales are observed for a grade, the list price anchors to PriceCharting&rsquo;s posted number (their averaged, outlier-filtered math).</p>
    </section>
  );
};
