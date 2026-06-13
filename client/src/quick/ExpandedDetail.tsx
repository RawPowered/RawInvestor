import { useMemo, useState, type ReactNode } from 'react';
import { BarChart3, ExternalLink, FolderHeart, Info, RefreshCw, Sparkles, Users } from 'lucide-react';
import type { Card, Collection, Fees } from '../types';
import type { EnrichedCard } from '../sort';
import { BrandLogoImg, GRADER_LINKS } from '../brandLogos';
import { OverviewMarketSalesSection } from '../overviewMarketSalesSection';
import { evaluateFuturesSignal } from '../futuresSignals';
import { fmtMoney, fmtPct, revenueAt } from '../math';
import {
  SALES_STATS_WINDOW_DAYS,
  summarizeSales,
} from '../pricing';
import { recentSalesOnOrAfterRelease, effectivePriceHistory } from '../releaseFilter';
import {
  dayOverDayBaseline,
  deltaUsdAndPct,
  firstObservationWithGrade,
  type ChartGradeKey,
} from '../priceHistoryDeltas';
import { formatRelative } from '../utils/time';
import {
  recommendGraderFromEstimated,
  companyGradeFromKey,
  type GraderCompany,
} from '../utils/grading';
import { GemRateSection, MathGroup, MathLine, OutcomeBlock } from './detailSupport';
import { HistoryAnalyticsSection } from './HistoryAnalyticsSection';
import { SalesPaceSection } from './SalesPaceSection';
import { TcgplayerCompareSection } from './TcgplayerCompareSection';
import {
  entCardFrame,
  entInsetStrip,
  entKpiLabel,
  entKpiTile,
  entKpiValue,
  entMicroLabel,
  entSectionHeading,
  entTabBtnActive,
  entTabBtnBase,
  entTabBtnIdle,
  entTabList,
  entSubTabList,
} from './enterpriseDashboardUi';

const gradeDeltaCells = (
  baseline: { raw?: number; grade9?: number; psa10?: number },
  card: EnrichedCard,
  keyPrefix: string
): ReactNode[] => {
  const cells: ReactNode[] = [];
  const push = (key: ChartGradeKey, abbrev: string, cur: number) => {
    const prevVal = baseline[key];
    if (typeof prevVal !== 'number' || !Number.isFinite(prevVal) || !Number.isFinite(cur)) return;
    const { usd, pct } = deltaUsdAndPct(prevVal, cur);
    const up = usd > 0;
    const flat = usd === 0;
    cells.push(
      <div
        key={`${keyPrefix}-${key}`}
        className="inline-flex items-baseline gap-2.5 pr-4 border-r border-slate-200/90 last:border-r-0 last:pr-0"
      >
        <span className={entMicroLabel}>{abbrev}</span>
        <span
          className={`text-[15px] font-semibold tabular-nums tracking-tight ${
            flat ? 'text-slate-600' : up ? 'text-emerald-600' : 'text-rose-600'
          }`}
        >
          {fmtMoney(usd)}
        </span>
        <span className="text-[11px] tabular-nums text-slate-400">
          {pct != null
            ? fmtPct(pct)
            : usd === 0
              ? fmtPct(0)
              : '—'}
        </span>
      </div>
    );
  };
  push('raw', 'RAW', card.raw);
  push('grade9', 'G9', card.grade9);
  push('psa10', '10', card.psa10);
  return cells;
};

const RefreshPriceDeltas = ({ card }: { card: EnrichedCard }) => {
  const sortedEffective = useMemo(() => {
    const h = effectivePriceHistory(card.priceHistory, card.releaseDateMs, {
      raw: card.raw,
      grade9: card.grade9,
      psa10: card.psa10,
    });
    return [...h].sort((a, b) => a.at - b.at);
  }, [card.priceHistory, card.releaseDateMs, card.raw, card.grade9, card.psa10]);

  const dayBaseline = useMemo(() => {
    if (card.lastRefreshedAt == null || !Number.isFinite(card.lastRefreshedAt)) return null;
    return dayOverDayBaseline(sortedEffective, card.lastRefreshedAt);
  }, [sortedEffective, card.lastRefreshedAt]);

  const firstByGradeBaseline = useMemo(
    () => ({
      raw: firstObservationWithGrade(sortedEffective, 'raw')?.snapshot.raw,
      grade9: firstObservationWithGrade(sortedEffective, 'grade9')?.snapshot.grade9,
      psa10: firstObservationWithGrade(sortedEffective, 'psa10')?.snapshot.psa10,
    }),
    [sortedEffective]
  );

  const refreshAllFlat = useMemo(() => {
    const p = card.previousPrices;
    if (!p) return false;
    let saw = false;
    let flat = true;
    for (const k of ['raw', 'grade9', 'psa10'] as const) {
      const a = p[k];
      const b = card[k];
      if (typeof a !== 'number' || !Number.isFinite(a) || !Number.isFinite(b)) continue;
      saw = true;
      if (Math.abs(b - a) > 1e-6) flat = false;
    }
    return saw && flat;
  }, [card.previousPrices, card.raw, card.grade9, card.psa10]);

  const firstCapturedCells = useMemo(
    () => gradeDeltaCells(firstByGradeBaseline, card, 'first'),
    [firstByGradeBaseline, card.raw, card.grade9, card.psa10]
  );

  if (!card.lastRefreshedAt) return null;

  const p = card.previousPrices;
  const refreshCells = p ? gradeDeltaCells(p, card, 'refresh') : [];
  const dayCells = dayBaseline ? gradeDeltaCells(dayBaseline, card, 'day') : [];

  const showSinceFirst =
    sortedEffective.length >= 2 &&
    firstCapturedCells.length > 0 &&
    (refreshAllFlat || refreshCells.length === 0);

  if (refreshCells.length === 0 && dayCells.length === 0 && !showSinceFirst) return null;

  return (
    <div className="w-full border-t border-slate-200/90 pt-2.5 mt-2 space-y-2">
      {refreshCells.length > 0 ? (
        <div className={`space-y-1 px-2.5 py-1.5 ${entInsetStrip}`}>
          <span className={entMicroLabel}>Move vs last refresh</span>
          <div className="flex flex-wrap gap-2.5">{refreshCells}</div>
        </div>
      ) : null}

      {dayCells.length > 0 ? (
        <div className={`space-y-1 px-2.5 py-1.5 ${entCardFrame} bg-white/90`}>
          <span className={entMicroLabel}>
            Move vs prior UTC day
            <span className="font-medium normal-case text-slate-400 ml-1">
              (or ≥24h before refresh if no prior-day print)
            </span>
          </span>
          <div className="flex flex-wrap gap-2.5">{dayCells}</div>
        </div>
      ) : refreshCells.length > 0 ? (
        <p className="text-[9px] text-slate-400 leading-snug">
          No prior-day move yet: need a history point before the UTC start of this refresh&rsquo;s
          day, or at least ~24h earlier.
        </p>
      ) : null}

      {showSinceFirst ? (
        <div className={`space-y-1 px-2.5 py-1.5 ${entInsetStrip}`}>
          <span className={entMicroLabel}>Since first captured in history</span>
          <div className="flex flex-wrap gap-2.5">{firstCapturedCells}</div>
        </div>
      ) : null}
    </div>
  );
};

const MiniKpi = ({
  label, value, color, icon,
}: {
  label: string;
  value: string;
  color?: string;
  icon?: ReactNode;
}) => (
  <div className={entKpiTile}>
    <div className={entKpiLabel}>{label}</div>
    <div className={`${entKpiValue} ${color ?? 'text-slate-900'}`}>
      {icon}
      {value}
    </div>
  </div>
);

export const ExpandedDetail = ({
  card, fees, psaToken, collections, onFieldChange, onFetchPsaPop, onApplyPsaProbs,
}: {
  card: EnrichedCard;
  fees: Fees;
  psaToken: string;
  collections: Collection[];
  onFieldChange: <K extends keyof Card>(id: string, key: K, value: Card[K]) => void;
  onFetchPsaPop: () => void;
  onApplyPsaProbs: () => void;
}) => {
  const m = card.metrics;
  const isSealed = card.portfolioKind === 'sealed';
  const pFailForDisplay = Math.max(0, 1 - (card.p10 || 0) - (card.p9 || 0));
  const rawSales = useMemo(
    () => recentSalesOnOrAfterRelease(card.recentSales, card.releaseDateMs),
    [card.recentSales, card.releaseDateMs]
  );
  const rawSummary = useMemo(
    () =>
      summarizeSales(
        rawSales,
        'raw',
        SALES_STATS_WINDOW_DAYS,
        card.salesVolume,
        card.raw,
        undefined,
        card.raw
      ),
    [rawSales, card.salesVolume, card.raw]
  );
  const strategyFutures = useMemo(() => {
    const points = rawSales
      .filter((s) => s.grade === 'raw' && Number.isFinite(s.at) && Number.isFinite(s.price) && s.price > 0)
      .map((s) => ({ at: s.at, price: s.price }))
      .sort((a, b) => a.at - b.at);
    if (!points.length) return null;
    return evaluateFuturesSignal({
      points,
      windowLabel: `${SALES_STATS_WINDOW_DAYS}D`,
      additionalAnomalyCount: (card.tcgplayerSalesAnomalies ?? []).length,
      baselineLowPrice: rawSummary.p25,
      baselineHighPrice: rawSummary.p75,
    });
  }, [rawSales, card.tcgplayerSalesAnomalies, rawSummary.p25, rawSummary.p75]);
  const rawPurchase =
    typeof card.actualCost === 'number' && card.actualCost > 0 ? card.actualCost : card.raw;
  const rawInboundShipping = card.freeShipping ? 0 : Number(card.shippingCost) || 0;
  const rawFlipInvested = rawPurchase + rawInboundShipping;
  const rawFlipRevenue = revenueAt(card.raw, fees);
  const rawFlipNet = rawFlipRevenue - rawFlipInvested;
  const rawFlipRoi = rawFlipInvested > 0 ? (rawFlipNet / rawFlipInvested) * 100 : 0;
  const rawFlipBreakEvenSale =
    1 - fees.saleFeePct > 0
      ? (rawFlipInvested + fees.saleFeeFlat + fees.shipToBuyer) / (1 - fees.saleFeePct)
      : Infinity;
  const fairMarketPrice = rawSummary.median ?? rawSummary.referencePrice ?? card.raw;
  const strategicMarketPrice = rawSummary.suggestion.list ?? fairMarketPrice;
  const pushedFairMarketPrice =
    rawSummary.suggestion.stretch ?? strategicMarketPrice;
  const statsSignal =
    rawSummary.pushHigher.advice === 'hold_median' ||
    rawSummary.pushHigher.advice === 'insufficient'
      ? 'HOLD'
      : 'SELL';
  const statsSignalColor = statsSignal === 'SELL' ? 'text-emerald-600' : 'text-amber-600';
  const [detailTab, setDetailTab] = useState<'overview' | 'signals' | 'sales' | 'strategy'>('overview');
  const [mathTab, setMathTab] = useState<'overview' | 'raw' | 'outcomes'>('overview');
  const estimatedGradeOptions = useMemo(() => {
    return (card.allPrices ?? [])
      .filter((p) => Number.isFinite(p.price) && p.price > 0)
      .map((p) => ({ key: p.key, label: p.label, price: p.price }));
  }, [card.allPrices]);
  const recommendedGrader = useMemo(() => recommendGraderFromEstimated(card), [card]);
  const companyGradeMathRows = useMemo(() => {
    const invested = m.totalInvested;
    if (!Array.isArray(card.allPrices) || !card.allPrices.length) return [] as Array<{
      company: GraderCompany;
      grade: string;
      key: string;
      label: string;
      salePrice: number;
      net: number;
      roiPct: number | null;
    }>;
    const rows: Array<{
      company: GraderCompany;
      grade: string;
      key: string;
      label: string;
      salePrice: number;
      net: number;
      roiPct: number | null;
    }> = [];
    for (const p of card.allPrices) {
      if (!Number.isFinite(p.price) || p.price <= 0) continue;
      const cg = companyGradeFromKey(p.key);
      if (!cg) continue;
      const gradeNum = Number.parseFloat(cg.grade);
      if (!Number.isFinite(gradeNum) || gradeNum < 8) continue;
      const revenue = revenueAt(p.price, fees);
      const net = revenue - invested;
      const roiPct = invested > 0 ? (net / invested) * 100 : null;
      rows.push({
        company: cg.company,
        grade: cg.grade,
        key: p.key,
        label: p.label,
        salePrice: p.price,
        net,
        roiPct,
      });
    }
    rows.sort((a, b) => {
      if (a.company !== b.company) return a.company.localeCompare(b.company);
      const ga = Number.parseFloat(a.grade);
      const gb = Number.parseFloat(b.grade);
      if (Number.isFinite(ga) && Number.isFinite(gb) && ga !== gb) return gb - ga;
      return b.salePrice - a.salePrice;
    });
    return rows;
  }, [card.allPrices, m.totalInvested, fees]);
  const bestCompanyGradeRows = useMemo(() => {
    const best = new Map<GraderCompany, (typeof companyGradeMathRows)[number]>();
    for (const r of companyGradeMathRows) {
      const cur = best.get(r.company);
      if (!cur || r.net > cur.net) best.set(r.company, r);
    }
    return Array.from(best.values()).sort((a, b) => b.net - a.net);
  }, [companyGradeMathRows]);

  return (
    <div className="space-y-5">
      <div
        className={`${entCardFrame} bg-gradient-to-b from-white to-slate-50/80 p-4 flex flex-col gap-2`}
      >
        <div className="flex flex-wrap items-center gap-3">
        <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-600 flex items-center gap-1.5">
          <FolderHeart size={13} /> Collection
        </span>
        <select
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 font-semibold bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          value={card.collectionId ?? ''}
          onChange={(e) =>
            onFieldChange(card.id, 'collectionId', (e.target.value || undefined) as Card['collectionId'])
          }
        >
          <option value="">-- Unassigned --</option>
          {collections.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        {collections.length === 0 && (
          <span className="text-xs text-slate-400 italic">
            Create a collection from the toolbar above to start grouping cards.
          </span>
        )}
        <span className="ml-auto text-[10px] font-medium uppercase tracking-[0.12em] text-slate-500 flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1">
          <RefreshCw size={11} />
          {card.lastRefreshedAt
            ? <>Last refreshed {formatRelative(card.lastRefreshedAt)}</>
            : <span className="italic">Never refreshed</span>}
        </span>
        </div>
        <RefreshPriceDeltas card={card} />
      </div>

      <div className={entTabList} role="tablist" aria-label="Card detail sections">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-1">
          {([
            ['overview', 'Overview'],
            ['signals', 'Market Signals'],
            ['sales', 'Sales Pace'],
            ['strategy', 'Strategy Math'],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`dash-tab-${id}`}
              aria-selected={detailTab === id}
              aria-controls={`dash-tabpanel-${id}`}
              onClick={() => setDetailTab(id)}
              className={`${entTabBtnBase} ${
                detailTab === id ? entTabBtnActive : entTabBtnIdle
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {detailTab === 'overview' && (
        <div
          role="tabpanel"
          id="dash-tabpanel-overview"
          aria-labelledby="dash-tab-overview"
          className="grid grid-cols-1 xl:grid-cols-3 gap-5"
        >
          <OverviewMarketSalesSection
            card={card}
            formatRelative={formatRelative}
            onFieldChange={onFieldChange}
          />
          {!isSealed && (
            <section className={`xl:col-span-3 ${entCardFrame} p-4`}>
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[240px]">
                  <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                    Estimated grade (target)
                  </label>
                  <select
                    className="mt-1 w-full bg-slate-50 px-3 py-2 rounded-lg border border-slate-200 text-sm"
                    value={card.estimatedGradeKey ?? ''}
                    onChange={(e) => {
                      const key = e.target.value;
                      const hit = estimatedGradeOptions.find((o) => o.key === key);
                      onFieldChange(card.id, 'estimatedGradeKey', key);
                      onFieldChange(card.id, 'potentialValue', hit?.price ?? undefined);
                    }}
                  >
                    <option value="">Select a grade price point…</option>
                    {estimatedGradeOptions.map((o) => (
                      <option key={o.key} value={o.key}>
                        {o.label} · {fmtMoney(o.price)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 min-w-[180px]">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                    Potential value
                  </div>
                  <div className="text-lg tabular-nums font-semibold text-slate-900">
                    {typeof card.potentialValue === 'number' && Number.isFinite(card.potentialValue)
                      ? fmtMoney(card.potentialValue)
                      : '—'}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 min-w-[180px]">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                    Grade with
                  </div>
                  {recommendedGrader ? (
                    <div className="mt-1 inline-flex items-center gap-2 text-sm font-semibold text-slate-800">
                      <BrandLogoImg
                        brand={recommendedGrader.brand}
                        className="h-4 w-auto object-contain"
                        title={recommendedGrader.label}
                      />
                      {recommendedGrader.label}
                    </div>
                  ) : (
                    <div className="text-sm text-slate-400 mt-1">Select estimated grade</div>
                  )}
                </div>
              </div>
            </section>
          )}
          <section className={`${entCardFrame} p-5 space-y-3`}>
            <div className="flex flex-col gap-0.5">
              <span className={entMicroLabel}>Reference</span>
              <h4 className={`${entSectionHeading} flex items-center gap-2`}>
                <BarChart3 size={14} className="text-slate-500 shrink-0" /> Full Price Guide
              </h4>
            </div>
            {card.allPrices && card.allPrices.length > 0 ? (
              <div className="max-h-80 overflow-y-auto">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-slate-100">
                    {card.allPrices.map((p) => {
                      const isHighlight =
                        p.key === 'ungraded' || p.key === 'grade_9' || p.key === 'psa_10';
                      return (
                        <tr
                          key={p.key}
                          className={isHighlight ? 'bg-blue-50/40 font-bold' : ''}
                        >
                          <td className="py-1.5 text-slate-600">{p.label}</td>
                          <td className="py-1.5 text-right text-slate-800 font-mono">
                            {fmtMoney(p.price)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-slate-400 font-medium">
                No detailed prices captured. Re-fetch the card from its PriceCharting URL.
              </p>
            )}
            {card.url && (
              <a
                href={card.url}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1"
              >
                Open on PriceCharting <ExternalLink size={12} />
              </a>
            )}
          </section>

          {!isSealed && <GemRateSection card={card} onFieldChange={onFieldChange} />}

          {!isSealed && (
          <section className={`${entCardFrame} p-5 space-y-3`}>
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className={entMicroLabel}>Population</span>
                <h4 className={`${entSectionHeading} flex items-center gap-2`}>
                  <BrandLogoImg brand="psa" className="h-6 w-auto max-w-[3.25rem] object-contain shrink-0" title="PSA" />
                  PSA Population
                </h4>
              </div>
              {card.psaPop?.fetchedAt && (
                <span className="text-[10px] text-slate-400 font-medium">
                  {new Date(card.psaPop.fetchedAt).toLocaleDateString()}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 pb-1 border-b border-slate-100">
              <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 shrink-0">
                Other graders
              </span>
              {GRADER_LINKS.map(({ brand, href, label }) => (
                <a
                  key={brand}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={label}
                  className="inline-flex items-center rounded-md border border-slate-200 bg-slate-50/80 px-2 py-1 hover:bg-white hover:border-slate-300 transition-colors"
                >
                  <BrandLogoImg brand={brand} className="h-6 w-auto max-w-[4.25rem] object-contain" title={label} />
                </a>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                placeholder="SpecID"
                className="flex-1 bg-slate-50 px-3 py-2 rounded-lg border border-slate-200 focus:outline-blue-500 text-sm font-mono"
                value={card.psaSpecId ?? ''}
                onChange={(e) => onFieldChange(card.id, 'psaSpecId', e.target.value.trim())}
              />
              <button
                onClick={onFetchPsaPop}
                disabled={!card.psaSpecId || !psaToken}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 text-white px-3 py-2 rounded-lg font-bold text-xs uppercase tracking-wider"
              >
                Fetch
              </button>
            </div>
            {!psaToken && (
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1 font-medium">
                Add PSA token in Admin → Configuration to enable population lookup.
              </p>
            )}

            {card.psaPop && card.psaPop.grades.length > 0 ? (
              <>
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-slate-100">
                    {card.psaPop.grades.map((g) => {
                      const total = card.psaPop!.totalPop || 1;
                      const pct = ((g.population + g.qualifiedPopulation) / total) * 100;
                      return (
                        <tr key={g.grade}>
                          <td className="py-1.5 text-slate-600">{g.grade}</td>
                          <td className="py-1.5 text-right text-slate-800 font-mono">
                            {(g.population + g.qualifiedPopulation).toLocaleString()}
                          </td>
                          <td className="py-1.5 text-right text-slate-400 font-mono w-14">
                            {pct.toFixed(1)}%
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="border-t-2 border-slate-200 font-black">
                      <td className="py-1.5">Total Pop</td>
                      <td className="py-1.5 text-right font-mono">
                        {card.psaPop.totalPop.toLocaleString()}
                      </td>
                      <td></td>
                    </tr>
                  </tbody>
                </table>
                <button
                  onClick={onApplyPsaProbs}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 rounded-lg font-bold text-xs uppercase tracking-wider"
                >
                  Apply pop-weighted probabilities
                </button>
              </>
            ) : card.psaPop ? (
              <p className="text-xs text-slate-400 font-medium">No graded population reported yet.</p>
            ) : (
              <p className="text-xs text-slate-400 font-medium">
                Paste the PSA SpecID (look it up on psacard.com) and hit Fetch.
              </p>
            )}
          </section>
          )}
        </div>
      )}

      {detailTab === 'signals' && (
        <div role="tabpanel" id="dash-tabpanel-signals" aria-labelledby="dash-tab-signals">
          <HistoryAnalyticsSection card={card} />
        </div>
      )}

      {detailTab === 'sales' && (
        <div role="tabpanel" id="dash-tabpanel-sales" aria-labelledby="dash-tab-sales">
          <SalesPaceSection card={card} />
        </div>
      )}

      {detailTab === 'strategy' && (
        <div
          role="tabpanel"
          id="dash-tabpanel-strategy"
          aria-labelledby="dash-tab-strategy"
          className="grid grid-cols-1 xl:grid-cols-5 gap-5"
        >
          <section className={`xl:col-span-3 ${entCardFrame} p-5 space-y-3 text-sm`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className={entMicroLabel}>Model</span>
            <h4 className={`${entSectionHeading} flex items-center gap-2`}>
              <Info size={14} className="text-slate-500 shrink-0" /> Complete Math
            </h4>
          </div>
          <div className={entSubTabList} role="tablist" aria-label="Strategy math views">
            {([
              ['overview', 'Overview'],
              ['raw', 'Raw Tactic'],
              ['outcomes', 'Grade Outcomes'],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={mathTab === id}
                onClick={() => setMathTab(id)}
                className={`px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1 ${
                  mathTab === id
                    ? 'bg-white text-slate-900 shadow-sm border border-slate-200/90'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {mathTab === 'overview' && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
              <MiniKpi label="Invested" value={fmtMoney(m.totalInvested)} />
              <MiniKpi label="EV" value={fmtMoney(m.ev)} color={m.ev >= 0 ? 'text-emerald-600' : 'text-rose-600'} />
              <MiniKpi label="ROI %" value={fmtPct(m.roiPct)} color={m.roiPct >= 0 ? 'text-emerald-600' : 'text-rose-600'} />
              <MiniKpi label="Raw market" value={fmtMoney(card.raw)} />
              <MiniKpi label="Fair market" value={fmtMoney(fairMarketPrice)} />
              <MiniKpi label="Strategic list" value={fmtMoney(strategicMarketPrice)} />
              <MiniKpi label="Pushed fair" value={fmtMoney(pushedFairMarketPrice)} />
              <MiniKpi label="Raw net (no grade)" value={fmtMoney(rawFlipNet)} color={rawFlipNet >= 0 ? 'text-emerald-600' : 'text-rose-600'} />
              <MiniKpi label="Break-even sale" value={Number.isFinite(rawFlipBreakEvenSale) ? fmtMoney(rawFlipBreakEvenSale) : '—'} />
            </div>
            <div className={`px-3 py-2.5 ${entInsetStrip}`}>
              <div className="flex items-center justify-between">
                <span className={entMicroLabel}>
                  Statistics signal ({rawSummary.pushHigher.label})
                </span>
                <span className={`text-sm font-semibold ${statsSignalColor}`}>{statsSignal}</span>
              </div>
              <p className={`text-[11px] font-semibold leading-snug mt-1 ${statsSignalColor}`}>
                {rawSummary.pushHigher.reason}
              </p>
            </div>
          </div>
        )}

        {mathTab === 'raw' && (
          <div className="space-y-2">
            <MathGroup title="Cost basis">
              <MathLine
                k={
                  typeof card.actualCost === 'number' && card.actualCost > 0
                    ? 'Paid (for card)'
                    : 'Raw (fallback — no Paid set)'
                }
                v={fmtMoney(
                  typeof card.actualCost === 'number' && card.actualCost > 0
                    ? card.actualCost
                    : card.raw
                )}
                op="+"
              />
              <MathLine
                k={card.freeShipping ? 'Inbound shipping (FREE)' : 'Inbound shipping'}
                v={fmtMoney(card.freeShipping ? 0 : Number(card.shippingCost) || 0)}
                op="+"
              />
              <MathLine k="Grading" v={fmtMoney(fees.gradingFee)} op="+" />
              <MathLine k="Ship to grader" v={fmtMoney(fees.shipToGrader)} op="+" />
              <MathLine k="Ship from grader" v={fmtMoney(fees.shipFromGrader)} op="=" />
              <MathLine k="Total invested" v={fmtMoney(m.totalInvested)} bold />
            </MathGroup>

            <MathGroup title="Buy raw → sell raw (no grade) projection">
              <MathLine
                k={
                  typeof card.actualCost === 'number' && card.actualCost > 0
                    ? 'Paid (for card)'
                    : 'Raw (fallback — no Paid set)'
                }
                v={fmtMoney(rawPurchase)}
                op="+"
              />
              <MathLine
                k={card.freeShipping ? 'Inbound shipping (FREE)' : 'Inbound shipping'}
                v={fmtMoney(rawInboundShipping)}
                op="="
              />
              <MathLine k="Cash invested (raw tactic)" v={fmtMoney(rawFlipInvested)} bold />
              <MathLine k="Projected sale @ current raw market" v={fmtMoney(card.raw)} op="=" />
              <MathLine
                k={`- ${(fees.saleFeePct * 100).toFixed(2)}% sale fee`}
                v={fmtMoney(-(card.raw * fees.saleFeePct))}
              />
              <MathLine k="- Flat fee" v={fmtMoney(-fees.saleFeeFlat)} />
              <MathLine k="- Ship to buyer" v={fmtMoney(-fees.shipToBuyer)} />
              <MathLine k="Net sale proceeds" v={fmtMoney(rawFlipRevenue)} bold />
              <MathLine k="- Cash invested" v={fmtMoney(-rawFlipInvested)} />
              <MathLine k="Projected net (no grade)" v={fmtMoney(rawFlipNet)} bold />
              <MathLine k="Projected ROI (no grade)" v={fmtPct(rawFlipRoi)} />
              <MathLine
                k="Break-even sale price (after fees + ship)"
                v={Number.isFinite(rawFlipBreakEvenSale) ? fmtMoney(rawFlipBreakEvenSale) : '—'}
              />
            </MathGroup>

            <MathGroup title="Raw sales strategy metrics">
              <MathLine k="Market price (current raw)" v={fmtMoney(card.raw)} />
              <MathLine k="Fair market price" v={fmtMoney(fairMarketPrice)} />
              <MathLine k="Strategic market price" v={fmtMoney(strategicMarketPrice)} />
              <MathLine k="Pushed fair market price" v={fmtMoney(pushedFairMarketPrice)} />
              <MathLine
                k={`Statistics signal (${rawSummary.pushHigher.label})`}
                v={statsSignal}
                bold
              />
              <div className={`text-[11px] font-semibold leading-snug ${statsSignalColor}`}>
                {rawSummary.pushHigher.reason}
              </div>
            </MathGroup>
          </div>
        )}

        {mathTab === 'outcomes' && (
          <div className="space-y-2">
            <OutcomeBlock
              title={`PSA 10 (p=${card.p10.toFixed(2)})`}
              salePrice={card.psa10}
              revenue={m.revenue10}
              net={m.net10}
              invested={m.totalInvested}
              fees={fees}
              ev={(card.p10 || 0) * m.net10}
            />
            <OutcomeBlock
              title={`PSA 9 (p=${card.p9.toFixed(2)})`}
              salePrice={card.grade9}
              revenue={m.revenue9}
              net={m.net9}
              invested={m.totalInvested}
              fees={fees}
              ev={(card.p9 || 0) * m.net9}
            />
            <OutcomeBlock
              title={`Fail (p=${pFailForDisplay.toFixed(2)}) — sell raw`}
              salePrice={card.raw}
              revenue={m.revenueFail}
              net={m.netFail}
              invested={m.totalInvested}
              fees={fees}
              ev={pFailForDisplay * m.netFail}
            />

            <div className="border-t-2 border-slate-300 pt-2 mt-2 space-y-1">
              <div className="flex justify-between font-semibold text-slate-900">
                <span>Expected Value</span>
                <span className={m.ev >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
                  {fmtMoney(m.ev)}
                </span>
              </div>
              <div className="flex justify-between font-semibold">
                <span>ROI %</span>
                <span className={m.roiPct >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
                  {fmtPct(m.roiPct)}
                </span>
              </div>
            </div>
          </div>
        )}
          </section>
          <div className="xl:col-span-2 space-y-5">
            <section className={`${entCardFrame} p-5 space-y-3`}>
              <div className="flex flex-col gap-0.5">
                <span className={entMicroLabel}>Positioning</span>
                <h4 className={`${entSectionHeading} flex items-center gap-2`}>
                  <Sparkles size={14} className="text-slate-500 shrink-0" /> Execution Snapshot
                </h4>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <MiniKpi label="Raw market" value={fmtMoney(card.raw)} />
                <MiniKpi label="Fair market" value={fmtMoney(fairMarketPrice)} />
                <MiniKpi label="Strategic list" value={fmtMoney(strategicMarketPrice)} />
                <MiniKpi label="Pushed fair" value={fmtMoney(pushedFairMarketPrice)} />
                <MiniKpi
                  label="Projected raw net"
                  value={fmtMoney(rawFlipNet)}
                  color={rawFlipNet >= 0 ? 'text-emerald-600' : 'text-rose-600'}
                />
                <MiniKpi
                  label="Projected raw ROI"
                  value={fmtPct(rawFlipRoi)}
                  color={rawFlipRoi >= 0 ? 'text-emerald-600' : 'text-rose-600'}
                />
              </div>
            </section>
            <section className={`${entCardFrame} p-5 space-y-3`}>
              <div className="flex flex-col gap-0.5">
                <span className={entMicroLabel}>Momentum</span>
                <h4 className={`${entSectionHeading} flex items-center gap-2`}>
                  <BarChart3 size={14} className="text-slate-500 shrink-0" /> Futures Signal
                </h4>
              </div>
              {!strategyFutures ? (
                <p className="text-xs text-slate-500">Not enough scoped sales history to produce a Futures read.</p>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div className={entKpiTile}>
                      <div className={entKpiLabel}>Direction forecast</div>
                      <div className={`${entKpiValue} text-sm`}>
                        {strategyFutures.direction.toUpperCase()} · {strategyFutures.directionConfidencePct}%
                      </div>
                    </div>
                    <div className={entKpiTile}>
                      <div className={entKpiLabel}>Anomaly spike flag</div>
                      <div className={`${entKpiValue} text-sm`}>
                        {strategyFutures.anomalySpikeFlag.toUpperCase()}
                      </div>
                    </div>
                    <div className={entKpiTile}>
                      <div className={entKpiLabel}>Infl / Defl risk</div>
                      <div className={`${entKpiValue} text-sm`}>
                        {strategyFutures.inflationRiskPct}% / {strategyFutures.deflationRiskPct}%
                      </div>
                    </div>
                  </div>
                  <div className={`px-3 py-2 text-[11px] text-slate-600 space-y-1 ${entCardFrame} bg-white/95`}>
                    <div>
                      Likelihood up/down/flat: <span className="font-semibold text-slate-800">
                        {strategyFutures.likelihoodUpPct}% / {strategyFutures.likelihoodDownPct}% / {strategyFutures.likelihoodFlatPct}%
                      </span>
                    </div>
                    {strategyFutures.explainers.map((x, i) => (
                      <div key={`f-exp-${i}`}>{x}</div>
                    ))}
                  </div>
                </>
              )}
            </section>
            <section className={`${entCardFrame} p-5 space-y-3`}>
              <div className="flex flex-col gap-0.5">
                <span className={entMicroLabel}>Grader economics</span>
                <h4 className={`${entSectionHeading} flex items-center gap-2`}>
                  <Users size={14} className="text-slate-500 shrink-0" /> Per-Company Grade Math
                </h4>
              </div>
              {companyGradeMathRows.length === 0 ? (
                <p className="text-xs text-slate-500">
                  No company grade pricing rows (8+) available for this card yet.
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {bestCompanyGradeRows.map((r) => (
                      <div key={`best-${r.company}`} className={entKpiTile}>
                        <div className={entKpiLabel}>{r.company} best grade</div>
                        <div className={`${entKpiValue} text-sm`}>
                          {r.grade} · {fmtMoney(r.salePrice)}
                        </div>
                        <div className={`text-[11px] font-medium ${r.net >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                          Net {fmtMoney(r.net)} {r.roiPct != null ? `(${fmtPct(r.roiPct)})` : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="overflow-x-auto max-h-64 overflow-y-auto border border-slate-200 rounded-lg">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-slate-100/95 text-slate-600 text-[10px] uppercase">
                        <tr>
                          <th className="text-left px-2 py-1.5">Company</th>
                          <th className="text-left px-2 py-1.5">Grade</th>
                          <th className="text-right px-2 py-1.5">Sale</th>
                          <th className="text-right px-2 py-1.5">Net</th>
                          <th className="text-right px-2 py-1.5">ROI</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {companyGradeMathRows.map((r) => (
                          <tr key={r.key}>
                            <td className="px-2 py-1 text-slate-700 font-semibold">{r.company}</td>
                            <td className="px-2 py-1 text-slate-700">{r.grade}</td>
                            <td className="px-2 py-1 text-right font-mono">{fmtMoney(r.salePrice)}</td>
                            <td className={`px-2 py-1 text-right font-mono ${r.net >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                              {fmtMoney(r.net)}
                            </td>
                            <td className={`px-2 py-1 text-right font-mono ${r.roiPct != null && r.roiPct >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                              {r.roiPct != null ? fmtPct(r.roiPct) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-[10px] text-slate-500">
                    Net/ROI here are computed with the same total invested basis used in outcomes math, broken out by grader company and grade row.
                  </p>
                </>
              )}
            </section>
            <TcgplayerCompareSection card={card} onFieldChange={onFieldChange} />
          </div>
        </div>
      )}
    </div>
  );
};
