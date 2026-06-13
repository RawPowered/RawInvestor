import { useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from 'recharts';
import { BarChart3, Orbit, Sparkles, Trophy } from 'lucide-react';
import type { EnrichedCard } from './sort';
import { fmtMoney } from './math';
import { NebulaView } from './NebulaView';
import { PortfolioTickerCharts } from './portfolioTickerCharts';
import type { TickerCardRow } from './portfolioTickerData';
import { TopWinnersHero } from './topWinnersHero';

export type PortfolioEvChartRow = {
  id: string;
  name: string;
  ev: number;
  net10: number;
  net9: number;
  totalInvested: number;
};

const Kv = ({ k, v, bold = false }: { k: string; v: string; bold?: boolean }) => (
  <div className={`flex justify-between text-sm ${bold ? 'font-black text-slate-900' : 'font-medium text-slate-600'}`}>
    <span>{k}:</span>
    <span>{v}</span>
  </div>
);

const tabs = [
  { id: 'winners' as const, label: 'Top winners', icon: Trophy },
  { id: 'ev' as const, label: 'EV chart', icon: BarChart3 },
  { id: 'ticker' as const, label: 'Market ticker', icon: Sparkles },
  { id: 'nebula' as const, label: 'Nebula', icon: Orbit },
];

export const PortfolioInsightsTabs = ({
  topFive,
  chartData,
  tickerRows,
  visible,
}: {
  topFive: EnrichedCard[];
  chartData: PortfolioEvChartRow[];
  tickerRows: TickerCardRow[];
  visible: EnrichedCard[];
}) => {
  const [tab, setTab] = useState<(typeof tabs)[number]['id']>('winners');

  return (
    <div className="bg-white p-6 sm:p-8 rounded-3xl border border-slate-200 shadow-sm">
      <div className="flex flex-col gap-4">
        <div>
          <h3 className="font-black text-slate-800 uppercase tracking-widest text-sm flex items-center gap-2">
            <BarChart3 size={16} className="text-blue-600" />
            Portfolio insights
          </h3>
          <p className="text-xs text-slate-500 font-medium mt-1">
            Winners, charts, and 3D view — same filters as your master list.
          </p>
        </div>

        <div
          role="tablist"
          className="flex flex-wrap gap-2 border-b border-slate-100 pb-3 -mb-px"
        >
          {tabs.map(({ id, label, icon: Icon }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(id)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-colors ${
                  active
                    ? 'bg-slate-900 text-white shadow-md'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                <Icon size={14} className={active ? 'text-amber-300' : 'text-slate-500'} />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-6 min-h-[320px]" role="tabpanel">
        {tab === 'winners' && <TopWinnersHero cards={topFive} />}

        {tab === 'ev' && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-slate-500 font-semibold">Green = +EV · Red = −EV</span>
            </div>
            <div className="h-[400px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="name" hide />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                  <Tooltip
                    cursor={{ fill: '#f8fafc' }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload as PortfolioEvChartRow;
                      return (
                        <div className="bg-white p-4 shadow-2xl rounded-xl border border-slate-200 min-w-[260px]">
                          <p className="font-bold border-b pb-2 mb-2 text-slate-800 uppercase text-xs tracking-wider">
                            {d.name}
                          </p>
                          <Kv k="Invested" v={fmtMoney(d.totalInvested)} />
                          <Kv k="Net PSA 10" v={fmtMoney(d.net10)} />
                          <Kv k="Net Grade 9" v={fmtMoney(d.net9)} />
                          <div className="border-t pt-2 mt-2">
                            <Kv k="Expected Value" v={fmtMoney(d.ev)} bold />
                          </div>
                        </div>
                      );
                    }}
                  />
                  <ReferenceLine y={0} stroke="#475569" strokeWidth={2} />
                  <Bar dataKey="ev" name="Expected Value" radius={[4, 4, 0, 0]}>
                    {chartData.map((entry) => (
                      <Cell key={entry.id} fill={entry.ev >= 0 ? '#16a34a' : '#ef4444'} />
                    ))}
                  </Bar>
                  <Legend verticalAlign="top" height={40} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {tab === 'ticker' && (
          <div>
            <p className="text-xs text-slate-500 font-medium mb-4">
              Top {Math.min(5, tickerRows.length)} by EV — PC raw, PSA 10, and sell pace (raw vs PSA 10).
            </p>
            <PortfolioTickerCharts rows={tickerRows} />
          </div>
        )}

        {tab === 'nebula' && (
          <div className="space-y-3">
            <p className="text-xs text-slate-500 font-medium">
              3D view: X = momentum, Y = ROI%, Z = activity. Drag to orbit, scroll to zoom.
            </p>
            <div className="flex justify-center rounded-2xl border border-slate-100 bg-slate-50/50 p-4 overflow-hidden">
              <NebulaView cards={visible} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
