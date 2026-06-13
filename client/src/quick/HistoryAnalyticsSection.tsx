import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Minus, TrendingUp } from 'lucide-react';
import {
  Brush,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { EnrichedCard } from '../sort';
import type { PriceSnapshot } from '../types';
import { fmtMoney, fmtPct } from '../math';
import { actionBadge, analyzeGrade } from '../analytics';
import { effectivePriceHistory } from '../releaseFilter';
import {
  deltaUsdAndPct,
  firstObservationWithGrade,
  formatElapsedAfterPrior,
  priorObservationWithGrade,
  type ChartGradeKey,
  yExtentForPriceChart,
} from '../priceHistoryDeltas';
import {
  entCardFrame,
  entInsetStrip,
  entKpiLabel,
  entKpiTile,
  entKpiValue,
  entMicroLabel,
  entSectionHeading,
} from './enterpriseDashboardUi';

const GRADE_TOOLTIP_META: Record<
  ChartGradeKey,
  { label: string; color: string }
> = {
  raw: { label: 'Raw', color: '#64748b' },
  grade9: { label: 'Grade 9', color: '#0ea5e9' },
  psa10: { label: 'PSA 10', color: '#10b981' },
};

type HistoryChartRow = {
  at: number;
  idx: number;
  raw: number | null;
  grade9: number | null;
  psa10: number | null;
  tcgMarket?: number | null;
};

const HistoryChartTooltip = ({
  active,
  payload,
  history,
  chartRows,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{
    dataKey?: string | number;
    payload?: HistoryChartRow;
  }>;
  history: PriceSnapshot[];
  chartRows?: HistoryChartRow[];
}) => {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  const row = item?.payload;
  const dk = item?.dataKey != null ? String(item.dataKey) : '';
  if (!row || typeof row.idx !== 'number') return null;
  if (dk === 'tcgMarket') {
    const price = row.tcgMarket;
    if (typeof price !== 'number' || !Number.isFinite(price)) return null;
    let priorVal: number | null = null;
    let priorAt: number | null = null;
    const rows = chartRows ?? [];
    for (let j = row.idx - 1; j >= 0; j--) {
      const v = rows[j]?.tcgMarket;
      if (typeof v === 'number' && Number.isFinite(v)) {
        priorVal = v;
        priorAt = rows[j]!.at;
        break;
      }
    }
    const when = new Date(row.at).toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
    const delta =
      priorVal != null && priorAt != null ? (
        <div className="mt-1.5 text-[10px] text-slate-500">
          <span className="font-mono font-semibold text-indigo-800">
            {fmtMoney(price - priorVal)}
            {(() => {
              const { pct } = deltaUsdAndPct(priorVal, price);
              return pct != null ? `  /  ${fmtPct(pct)}` : '';
            })()}
          </span>
          <span> vs prior TCG</span>
        </div>
      ) : (
        <p className="text-[10px] text-slate-500 mt-1">No earlier TCG point in this window.</p>
      );
    return (
      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-lg max-w-[16rem]">
        <p className="text-[10px] font-black uppercase tracking-widest text-indigo-700">TCG market</p>
        <p className="text-sm font-mono font-black text-slate-900 tabular-nums mt-0.5">{fmtMoney(price)}</p>
        <p className="text-[10px] text-slate-500 mt-0.5">{when}</p>
        {delta}
      </div>
    );
  }
  if (dk !== 'raw' && dk !== 'grade9' && dk !== 'psa10') return null;
  const grade = dk as ChartGradeKey;
  const price = row[grade];
  if (typeof price !== 'number' || !Number.isFinite(price)) return null;
  const meta = GRADE_TOOLTIP_META[grade];
  const prior = priorObservationWithGrade(history, row.idx, grade);
  const firstObs = firstObservationWithGrade(history, grade);
  const when = new Date(row.at).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

  const pctSuffix = (usd: number, pct: number | null) => {
    if (pct != null) return `  /  ${fmtPct(pct)}`;
    if (usd === 0) return `  /  ${fmtPct(0)}`;
    return '  /  —';
  };

  let deltaBlock: ReactNode = (
    <p className="text-[10px] text-slate-500 mt-1">No earlier point for this grade.</p>
  );
  if (prior) {
    const { usd, pct } = deltaUsdAndPct(prior.snapshot[grade] as number, price);
    const up = usd > 0;
    const flat = usd === 0;
    const elapsed = formatElapsedAfterPrior(row.at, prior.snapshot.at);
    deltaBlock = (
      <div className="mt-1.5 space-y-0.5 text-[10px]">
        <p className="font-mono font-semibold tabular-nums">
          <span className={flat ? 'text-slate-600' : up ? 'text-emerald-700' : 'text-rose-700'}>
            {fmtMoney(usd)}
            {pctSuffix(usd, pct)}
          </span>
          <span className="text-slate-500 font-normal"> vs prior obs</span>
        </p>
        <p className="text-slate-500">{elapsed}</p>
      </div>
    );
  } else if (firstObs && firstObs.index < row.idx) {
    const fromVal = firstObs.snapshot[grade] as number;
    const { usd, pct } = deltaUsdAndPct(fromVal, price);
    const up = usd > 0;
    const flat = usd === 0;
    deltaBlock = (
      <div className="mt-1.5 space-y-0.5 text-[10px]">
        <p className="font-mono font-semibold tabular-nums">
          <span className={flat ? 'text-slate-600' : up ? 'text-emerald-700' : 'text-rose-700'}>
            {fmtMoney(usd)}
            {pctSuffix(usd, pct)}
          </span>
          <span className="text-slate-500 font-normal"> vs first in history</span>
        </p>
        <p className="text-slate-500">
          First: {new Date(firstObs.snapshot.at).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })}
        </p>
      </div>
    );
  } else if (firstObs && firstObs.index === row.idx) {
    deltaBlock = (
      <p className="text-[10px] text-slate-500 mt-1">First observation for this grade.</p>
    );
  }

  return (
    <div
      className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-lg min-w-[200px]"
      style={{ fontSize: 12 }}
    >
      <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">{meta.label}</p>
      <p className="text-xs text-slate-700 font-semibold tabular-nums">{when}</p>
      <p className="text-sm font-mono font-bold mt-0.5" style={{ color: meta.color }}>
        {fmtMoney(price)}
      </p>
      {deltaBlock}
    </div>
  );
};

const GradeSignalCard = ({
  title,
  stats,
}: {
  title: string;
  stats: ReturnType<typeof analyzeGrade>;
}) => {
  const hasData = stats.n > 0;
  const enough = stats.n >= 3;
  const trendDir = stats.slopePerDay > 0.01 ? 'up' : stats.slopePerDay < -0.01 ? 'down' : 'flat';

  return (
    <div className={`${entCardFrame} p-4 space-y-3`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className={entMicroLabel}>Condition tier</span>
          <h5 className={entSectionHeading}>{title}</h5>
        </div>
        <span className="text-[11px] text-slate-400 font-medium tabular-nums shrink-0">n = {stats.n}</span>
      </div>

      {!hasData ? (
        <p className="text-[11px] text-slate-400 italic">No observations yet.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5 text-[11px]">
            <HistoryMiniKpi label="Current" value={fmtMoney(stats.current)} />
            <HistoryMiniKpi label="Mean" value={fmtMoney(stats.mean)} />
            <HistoryMiniKpi label="Range" value={`${fmtMoney(stats.min)} - ${fmtMoney(stats.max)}`} />
            <HistoryMiniKpi
              label="Trend/day"
              value={`${stats.slopePerDay >= 0 ? '+' : ''}${fmtMoney(stats.slopePerDay)}`}
              color={trendDir === 'up' ? 'text-emerald-600' : trendDir === 'down' ? 'text-rose-600' : 'text-slate-500'}
              icon={
                trendDir === 'up' ? <ArrowUp size={10} /> :
                trendDir === 'down' ? <ArrowDown size={10} /> :
                <Minus size={10} />
              }
            />
            <HistoryMiniKpi
              label="Z-score"
              value={stats.zScore.toFixed(2)}
              color={stats.zScore > 0.5 ? 'text-amber-600' : stats.zScore < -0.5 ? 'text-emerald-600' : 'text-slate-500'}
            />
            <HistoryMiniKpi
              label="vs First"
              value={`${stats.totalPctChange >= 0 ? '+' : ''}${stats.totalPctChange.toFixed(1)}%`}
              color={stats.totalPctChange >= 0 ? 'text-emerald-600' : 'text-rose-600'}
            />
          </div>

          {enough && (
            <div className={`p-3 space-y-2 ${entInsetStrip}`}>
              <div className={entMicroLabel}>90-day projection</div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-[9px] text-rose-600 font-medium uppercase tracking-wide">Worst</div>
                  <div className="text-sm font-semibold tabular-nums text-rose-600">{fmtMoney(stats.projection.worstCase)}</div>
                </div>
                <div>
                  <div className="text-[9px] text-slate-600 font-medium uppercase tracking-wide">Realistic</div>
                  <div className="text-sm font-semibold tabular-nums text-slate-800">{fmtMoney(stats.projection.realistic)}</div>
                </div>
                <div>
                  <div className="text-[9px] text-emerald-600 font-medium uppercase tracking-wide">Best</div>
                  <div className="text-sm font-semibold tabular-nums text-emerald-600">{fmtMoney(stats.projection.bestCase)}</div>
                </div>
              </div>
              {stats.projection.trendLimited && (
                <p className="text-[10px] text-slate-500 leading-snug mt-2">
                  Anchored to your observed price range &mdash; not a pure straight-line continuation of Trend/day (that line can spike when timestamps are clustered or comps jump grades).
                </p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <SignalBadge side="BUYER" signal={stats.buyerSignal} />
            <SignalBadge side="SELLER" signal={stats.sellerSignal} />
          </div>
        </>
      )}
    </div>
  );
};

const HistoryMiniKpi = ({
  label, value, color, icon,
}: {
  label: string;
  value: string;
  color?: string;
  icon?: ReactNode;
}) => (
  <div className={entKpiTile}>
    <div className={entKpiLabel}>{label}</div>
    <div className={`${entKpiValue} text-[16px] ${color ?? 'text-slate-900'}`}>
      {icon}
      {value}
    </div>
  </div>
);

const SignalBadge = ({
  side, signal,
}: {
  side: 'BUYER' | 'SELLER';
  signal: ReturnType<typeof analyzeGrade>['buyerSignal'];
}) => {
  const palette = actionBadge(signal.action);
  return (
    <div
      className={`rounded-lg border ${palette.border} ${palette.bg} ${palette.color} px-2 py-1.5`}
      title={signal.reason}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[9px] font-semibold uppercase tracking-[0.12em] opacity-70">{side}</span>
        <span className="text-[10px] font-semibold">{signal.label}</span>
        <span className="text-[9px] font-semibold uppercase tracking-wide opacity-60">{signal.confidence}</span>
      </div>
      <p className="text-[11px] leading-snug mt-0.5 opacity-90">{signal.reason}</p>
    </div>
  );
};

export const HistoryAnalyticsSection = ({ card }: { card: EnrichedCard }) => {
  const history = useMemo(
    () =>
      effectivePriceHistory(card.priceHistory, card.releaseDateMs, {
        raw: card.raw,
        grade9: card.grade9,
        psa10: card.psa10,
      }),
    [card.priceHistory, card.releaseDateMs, card.raw, card.grade9, card.psa10]
  );

  const sortedHistory = useMemo(
    () => [...history].sort((a, b) => a.at - b.at),
    [history]
  );

  const tcgSeriesPoints = useMemo(() => {
    const mh = card.tcgplayerMarketHistory?.points ?? [];
    const sh = card.tcgplayerSelfHistory ?? [];
    const byAt = new Map<number, { at: number; marketPrice: number }>();
    for (const p of sh) {
      if (Number.isFinite(p.at) && Number.isFinite(p.marketPrice) && p.marketPrice >= 0) {
        byAt.set(p.at, { at: p.at, marketPrice: p.marketPrice });
      }
    }
    for (const p of mh) {
      if (Number.isFinite(p.at) && Number.isFinite(p.marketPrice) && p.marketPrice >= 0) {
        byAt.set(p.at, { at: p.at, marketPrice: p.marketPrice });
      }
    }
    return [...byAt.values()].sort((a, b) => a.at - b.at);
  }, [card.tcgplayerMarketHistory, card.tcgplayerSelfHistory]);

  const chartData = useMemo(() => {
    const tcgPts = tcgSeriesPoints;
    let ti = 0;
    let lastTcg: number | null = null;
    return sortedHistory.map((s, idx) => {
      while (ti < tcgPts.length && tcgPts[ti].at <= s.at) {
        lastTcg = tcgPts[ti].marketPrice;
        ti++;
      }
      return {
        at: s.at,
        idx,
        raw: s.raw ?? null,
        grade9: s.grade9 ?? null,
        psa10: s.psa10 ?? null,
        tcgMarket: lastTcg,
      };
    });
  }, [sortedHistory, tcgSeriesPoints]);

  const showTcgMarketLine = tcgSeriesPoints.length > 0;

  const firstDataIdx = useMemo(() => {
    for (let i = 0; i < chartData.length; i++) {
      const r = chartData[i];
      const any =
        (typeof r.raw === 'number' && Number.isFinite(r.raw)) ||
        (typeof r.grade9 === 'number' && Number.isFinite(r.grade9)) ||
        (typeof r.psa10 === 'number' && Number.isFinite(r.psa10));
      if (any) return i;
    }
    return 0;
  }, [chartData]);

  const lastI = Math.max(0, chartData.length - 1);
  const dataFitBrush = useMemo(
    () => ({ start: Math.min(firstDataIdx, lastI), end: lastI }),
    [firstDataIdx, lastI]
  );

  const [manualBrush, setManualBrush] = useState<{
    start: number;
    end: number;
  } | null>(null);

  useEffect(() => {
    setManualBrush(null);
  }, [card.id]);

  const brushStart = Math.max(
    0,
    Math.min(
      manualBrush != null ? manualBrush.start : dataFitBrush.start,
      lastI
    )
  );
  const brushEnd = Math.max(
    brushStart,
    Math.min(manualBrush != null ? manualBrush.end : dataFitBrush.end, lastI)
  );

  const visibleRows = useMemo(
    () => chartData.slice(brushStart, brushEnd + 1),
    [chartData, brushStart, brushEnd]
  );
  const yDom = useMemo(() => yExtentForPriceChart(visibleRows), [visibleRows]);

  const strokeGradPrefix = useMemo(
    () => `pcgr_${card.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
    [card.id]
  );

  const useLogY = useMemo(() => {
    if (!yDom || yDom[0] <= 0) return false;
    return yDom[1] / yDom[0] >= 12;
  }, [yDom]);

  const yAxisDomain = useMemo((): [number, number] | ['auto', 'auto'] => {
    if (!yDom) return ['auto', 'auto'];
    if (useLogY) {
      const lo = Math.max(1, yDom[0] * 0.92);
      const hi = yDom[1] * 1.04;
      return [lo, hi];
    }
    return yDom;
  }, [yDom, useLogY]);

  const brushDiffersFromDataFit =
    brushStart !== dataFitBrush.start || brushEnd !== dataFitBrush.end;
  const showAllDatesBtn =
    chartData.length > 1 && !(brushStart === 0 && brushEnd === lastI);
  const showFitDataBtn = chartData.length > 1 && brushDiffersFromDataFit;
  const xMin = chartData[brushStart]?.at;
  const xMax = chartData[brushEnd]?.at;

  const rawHistoryLen = card.priceHistory?.length ?? 0;
  const droppedAdjustments = rawHistoryLen - history.length;
  const showHistoryFilterNote = droppedAdjustments > 0;

  const analytics = useMemo(
    () => ({
      raw: analyzeGrade(sortedHistory, 'raw', card.raw, 90),
      grade9: analyzeGrade(sortedHistory, 'grade9', card.grade9, 90),
      psa10: analyzeGrade(sortedHistory, 'psa10', card.psa10, 90),
    }),
    [sortedHistory, card.raw, card.grade9, card.psa10]
  );

  if (history.length === 0) {
    const hadPoints = (card.priceHistory?.length ?? 0) > 0;
    return (
      <section className={`${entCardFrame} p-5`}>
        <div className="flex flex-col gap-0.5 mb-2">
          <span className={entMicroLabel}>Time series</span>
          <h4 className={`${entSectionHeading} flex items-center gap-2`}>
            <TrendingUp size={14} className="text-slate-500 shrink-0" /> Price History &amp; Signals
          </h4>
        </div>
        <p className="text-xs text-slate-400 font-medium">
          {hadPoints && card.releaseDateMs != null ? (
            <>
              Every saved datapoint is before this card&rsquo;s release date (
              {new Date(card.releaseDateMs).toLocaleDateString()}). Those are
              placeholder chart levels on PriceCharting &mdash; refresh after release
              or clear history by re-adding the card.
            </>
          ) : (
            <>
              No price history yet. Click the refresh button once or twice over the
              coming days to build a trend.
            </>
          )}
        </p>
      </section>
    );
  }

  return (
    <section className={`${entCardFrame} p-6 space-y-5`}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-0.5">
          <span className={entMicroLabel}>Time series</span>
          <h4 className={`${entSectionHeading} flex items-center gap-2`}>
            <TrendingUp size={14} className="text-slate-500 shrink-0" /> Price History &amp; Signals
          </h4>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
            {history.length} datapoint{history.length === 1 ? '' : 's'} &middot; 90-day outlook
          </span>
          {showFitDataBtn ? (
            <button
              type="button"
              className="text-[10px] font-black uppercase tracking-wider text-blue-600 hover:text-blue-800 underline-offset-2 hover:underline"
              onClick={() => setManualBrush(null)}
            >
              Fit data
            </button>
          ) : null}
          {showAllDatesBtn ? (
            <button
              type="button"
              className="text-[10px] font-black uppercase tracking-wider text-slate-500 hover:text-slate-800 underline-offset-2 hover:underline"
              onClick={() => setManualBrush({ start: 0, end: lastI })}
            >
              All dates
            </button>
          ) : null}
        </div>
      </div>

      <p className="text-[10px] text-slate-500 leading-snug">
        Hover a line to see that grade&rsquo;s price, then <strong>$ / %</strong> vs the
        prior snapshot that included that grade, and how long after that point this
        print is. Drag the brush under the chart to zoom the time window; Y-axis
        rescales to the visible window; Y uses a <strong>log</strong> scale when
        grades span very different magnitudes. Default view is <strong>first price → latest</strong>;
        use <em>All dates</em> to include empty lead-in. Matrix fillers are still stripped;
        lines connect across nulls for readability. Observed pace counts sale rows, not blank days.
        {showTcgMarketLine ? (
          <>
            {' '}
            <strong className="text-indigo-800">TCG market</strong> (indigo) forward-fills from
            chart history + self-samples onto PC dates for comparison.
          </>
        ) : null}
      </p>

      {showHistoryFilterNote && (
        <p className="text-[10px] text-slate-500 font-medium leading-relaxed">
          Showing {history.length} of {rawHistoryLen} saved points
          {card.releaseDateMs != null && (
            <>
              {' '}
              (pre-{new Date(card.releaseDateMs).toLocaleDateString()} hidden)
            </>
          )}
          . ~$6 matrix fillers on raw or graded columns are dropped when
          they&rsquo;re far below posted prices (not real sales). The chart defaults
          to the first row with any grade price through the latest point; Y-axis
          uses a clipped range so one grade does not flatten the others.
        </p>
      )}

      <div className="h-[340px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={chartData}
            margin={{ top: 8, right: 10, bottom: 26, left: 2 }}
          >
            <defs>
              <linearGradient id={`${strokeGradPrefix}_raw`} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#94a3b8" />
                <stop offset="100%" stopColor="#334155" />
              </linearGradient>
              <linearGradient id={`${strokeGradPrefix}_g9`} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#7dd3fc" />
                <stop offset="100%" stopColor="#0369a1" />
              </linearGradient>
              <linearGradient id={`${strokeGradPrefix}_p10`} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#6ee7b7" />
                <stop offset="100%" stopColor="#047857" />
              </linearGradient>
              <linearGradient id={`${strokeGradPrefix}_tcg`} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#a5b4fc" />
                <stop offset="100%" stopColor="#4338ca" />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#e8edf3" strokeDasharray="4 4" vertical={false} />
            <XAxis
              dataKey="at"
              type="number"
              domain={
                typeof xMin === 'number' &&
                typeof xMax === 'number' &&
                chartData.length > 0
                  ? [xMin, xMax]
                  : ['dataMin', 'dataMax']
              }
              allowDataOverflow
              fontSize={10}
              stroke="#94a3b8"
              tickFormatter={(ts: number) =>
                new Date(ts).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                })
              }
            />
            <YAxis
              scale={useLogY ? 'log' : 'linear'}
              domain={yAxisDomain}
              allowDataOverflow={!!yDom}
              fontSize={10}
              stroke="#64748b"
              tick={{ fontFamily: 'ui-monospace, monospace', fontSize: 10 }}
              tickFormatter={(v) => `$${Math.round(Number(v))}`}
              width={48}
            />
            <Tooltip
              shared={false}
              cursor={{ stroke: '#64748b', strokeWidth: 1, strokeDasharray: '4 4' }}
              content={(props) => (
                <HistoryChartTooltip
                  active={props.active}
                  payload={props.payload}
                  history={sortedHistory}
                  chartRows={chartData}
                />
              )}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line
              type="monotone"
              dataKey="raw"
              name="Raw"
              stroke={`url(#${strokeGradPrefix}_raw)`}
              strokeWidth={2.75}
              strokeLinecap="round"
              strokeLinejoin="round"
              dot={{ r: 3.5, strokeWidth: 2, stroke: '#fff', fill: '#334155' }}
              activeDot={{ r: 6, strokeWidth: 2, stroke: '#fff', fill: '#0f172a' }}
              connectNulls
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="grade9"
              name="Grade 9"
              stroke={`url(#${strokeGradPrefix}_g9)`}
              strokeWidth={2.75}
              strokeLinecap="round"
              strokeLinejoin="round"
              dot={{ r: 3.5, strokeWidth: 2, stroke: '#fff', fill: '#0369a1' }}
              activeDot={{ r: 6, strokeWidth: 2, stroke: '#fff', fill: '#0c4a6e' }}
              connectNulls
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="psa10"
              name="PSA 10"
              stroke={`url(#${strokeGradPrefix}_p10)`}
              strokeWidth={2.75}
              strokeLinecap="round"
              strokeLinejoin="round"
              dot={{ r: 3.5, strokeWidth: 2, stroke: '#fff', fill: '#047857' }}
              activeDot={{ r: 6, strokeWidth: 2, stroke: '#fff', fill: '#064e3b' }}
              connectNulls
              isAnimationActive={false}
            />
            {showTcgMarketLine ? (
              <Line
                type="monotone"
                dataKey="tcgMarket"
                name="TCG market"
                stroke={`url(#${strokeGradPrefix}_tcg)`}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={{ r: 3, strokeWidth: 2, stroke: '#fff', fill: '#4338ca' }}
                activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff', fill: '#312e81' }}
                connectNulls
                isAnimationActive={false}
              />
            ) : null}
            {chartData.length > 1 ? (
              <Brush
                dataKey="at"
                height={22}
                stroke="#94a3b8"
                fill="#f8fafc"
                travellerWidth={8}
                startIndex={brushStart}
                endIndex={brushEnd}
                tickFormatter={(v: number) =>
                  new Date(v).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  })
                }
                onChange={(r) => {
                  if (r?.startIndex != null && r?.endIndex != null) {
                    setManualBrush({ start: r.startIndex, end: r.endIndex });
                  }
                }}
              />
            ) : null}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <GradeSignalCard title="Raw" stats={analytics.raw} />
        <GradeSignalCard title="Grade 9" stats={analytics.grade9} />
        <GradeSignalCard title="PSA 10" stats={analytics.psa10} />
      </div>

      <p className="text-[10px] text-slate-400 italic leading-relaxed">
        Signals are heuristics built from your own refresh history plus any sales
        seeded from PriceCharting. Not financial advice -- use them as a
        starting point, not a decision.
      </p>
    </section>
  );
};
