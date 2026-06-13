import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import type { EnrichedCard } from './sort';
import { fmtMoney, fmtPct } from './math';
import { resolveTcgDisplayMarketPrice } from './tcgDisplayPrice';
import { pcRawTrendForMasterList } from './pcRawTrend';
import { effectivePriceHistory } from './releaseFilter';
import { dayOverDayBaseline, deltaUsdAndPct } from './priceHistoryDeltas';

export const MasterListRawCell = ({ card }: { card: EnrichedCard }) => {
  const tcg = resolveTcgDisplayMarketPrice(card);
  const hasTcg = typeof tcg === 'number' && Number.isFinite(tcg) && tcg >= 0;
  const effective = effectivePriceHistory(card.priceHistory, card.releaseDateMs, {
    raw: card.raw,
    grade9: card.grade9,
    psa10: card.psa10,
  });
  const sorted = [...effective].sort((a, b) => a.at - b.at);
  const dayBaseline =
    card.lastRefreshedAt != null && Number.isFinite(card.lastRefreshedAt)
      ? dayOverDayBaseline(sorted, card.lastRefreshedAt)
      : null;
  const dayRaw = dayBaseline?.raw;
  const dayTrend =
    typeof dayRaw === 'number' && Number.isFinite(dayRaw) && dayRaw > 0
      ? (() => {
          const { pct } = deltaUsdAndPct(dayRaw, card.raw);
          if (pct == null) return null;
          return {
            pct,
            dir: Math.abs(pct) < 0.05 ? ('flat' as const) : pct > 0 ? ('up' as const) : ('down' as const),
          };
        })()
      : null;
  const trend = dayTrend ?? pcRawTrendForMasterList(card);
  const Icon =
    trend?.dir === 'up' ? ArrowUp : trend?.dir === 'down' ? ArrowDown : Minus;
  const trendColor =
    trend?.dir === 'up'
      ? 'text-emerald-600'
      : trend?.dir === 'down'
        ? 'text-rose-600'
        : 'text-slate-400';

  return (
    <td className="px-3 py-4 text-right align-middle min-w-[9rem]">
      <div className="flex flex-col items-end gap-0.5">
        <div className="font-semibold tabular-nums text-[15px] tracking-tight leading-tight flex flex-wrap items-baseline justify-end gap-x-1 gap-y-0">
          <span className="text-emerald-600">{fmtMoney(card.raw)}</span>
          <span className="text-slate-300 font-normal">/</span>
          <span className="text-blue-600">{hasTcg ? fmtMoney(tcg) : '—'}</span>
          {trend && (
            <span
              className={`inline-flex items-center gap-0.5 text-[10px] font-semibold tracking-wide ${trendColor}`}
              title={
                dayTrend
                  ? 'PC raw % vs prior UTC day baseline.'
                  : 'PC raw % fallback: last two chart-history raw points, else last two raw completed sales, else vs prior refresh.'
              }
            >
              <Icon size={11} strokeWidth={3} />
              {fmtPct(trend.pct)}
            </span>
          )}
        </div>
      </div>
    </td>
  );
};
