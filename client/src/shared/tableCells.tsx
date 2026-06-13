import { ArrowDown, ArrowUp, Info, Minus } from 'lucide-react';
import type { Card } from '../types';
import { fmtMoney } from '../math';
import { recommendGraderFromEstimated } from '../utils/grading';
import { BrandLogoImg } from '../brandLogos';

export const PriceCell = ({
  current,
  previous,
}: {
  current: number;
  previous?: number;
}) => {
  const hasDelta = typeof previous === 'number' && Number.isFinite(previous) && previous > 0;
  const delta = hasDelta ? current - previous : 0;
  const pct = hasDelta && previous > 0 ? (delta / previous) * 100 : 0;
  const dir: 'up' | 'down' | 'flat' = !hasDelta || Math.abs(delta) < 0.01 ? 'flat' : delta > 0 ? 'up' : 'down';
  const color = dir === 'up' ? 'text-emerald-600' : dir === 'down' ? 'text-rose-600' : 'text-slate-400';
  const Icon = dir === 'up' ? ArrowUp : dir === 'down' ? ArrowDown : Minus;

  return (
    <td className="px-3 py-4 text-right text-slate-600 font-semibold align-middle">
      <div className="tabular-nums">{fmtMoney(current)}</div>
      {hasDelta && dir !== 'flat' && (
        <div
          className={`text-[10px] font-bold flex items-center justify-end gap-0.5 ${color}`}
          title={`Previous: ${fmtMoney(previous)}`}
        >
          <Icon size={9} />
          {fmtMoney(Math.abs(delta))}
          <span className="opacity-60">({pct >= 0 ? '+' : ''}{pct.toFixed(1)}%)</span>
        </div>
      )}
    </td>
  );
};

export const PotentialValueCell = ({ card }: { card: Card }) => {
  const has = typeof card.potentialValue === 'number' && Number.isFinite(card.potentialValue);
  const rec = recommendGraderFromEstimated(card);
  return (
    <td className="px-3 py-4 text-right text-slate-700 align-middle">
      <div className="tabular-nums font-semibold">{has ? fmtMoney(card.potentialValue as number) : '—'}</div>
      {card.estimatedGradeKey ? <div className="text-[10px] text-slate-400">{card.estimatedGradeKey}</div> : null}
      {rec ? (
        <span className="inline-flex items-center gap-1 mt-1 text-[10px] text-slate-500 justify-end w-full">
          <BrandLogoImg brand={rec.brand} className="h-3.5 w-auto object-contain" title={rec.label} />
          {rec.label}
        </span>
      ) : null}
    </td>
  );
};

export const HeaderCell = ({
  label,
  tip,
  align,
  highlight,
}: {
  label: string;
  tip: string;
  align: 'left' | 'center' | 'right';
  highlight?: boolean;
}) => {
  const alignCls = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  const justifyCls = align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start';
  const thCls = highlight ? 'bg-blue-50/30 text-blue-600' : '';
  const tooltipPos = align === 'right' ? 'right-0' : align === 'center' ? 'left-1/2 -translate-x-1/2' : 'left-0';

  return (
    <th className={`px-3 py-4 ${alignCls} ${thCls}`}>
      <span className="relative inline-block group">
        <span
          tabIndex={0}
          className="cursor-help border-b border-dotted border-current outline-none focus:text-slate-700"
        >
          <span className={`inline-flex items-center gap-1 ${justifyCls}`}>
            {label}
            <Info size={10} className="opacity-50" />
          </span>
        </span>
        <span
          role="tooltip"
          className={`pointer-events-none absolute top-full mt-2 ${tooltipPos} z-20
            w-64 rounded-lg bg-slate-900 text-white text-[11px] font-medium normal-case tracking-normal
            leading-snug px-3 py-2 shadow-xl opacity-0 translate-y-[-4px] transition
            group-hover:opacity-100 group-hover:translate-y-0
            group-focus-within:opacity-100 group-focus-within:translate-y-0`}
        >
          {tip}
        </span>
      </span>
    </th>
  );
};
