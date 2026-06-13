import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { fmtMoney } from './math';
import { SALES_STATS_WINDOW_DAYS } from './pricing';
import type { TickerCardRow } from './portfolioTickerData';

const axisTick = { fontSize: 10, fill: '#64748b' };

const firstTickerRow = (payload: unknown): { row?: TickerCardRow; value: number | null } => {
  if (!Array.isArray(payload) || payload.length === 0) return { value: null };
  const x = payload[0] as { payload?: TickerCardRow; value?: unknown };
  const row = x.payload;
  const v0 = x.value;
  const num =
    typeof v0 === 'number' && Number.isFinite(v0)
      ? v0
      : typeof v0 === 'string'
        ? parseFloat(v0)
        : NaN;
  return { row, value: Number.isFinite(num) ? num : null };
};

const TickerTooltip = ({
  active,
  payload,
  valueLabel,
  valueSuffix = '',
}: {
  active?: boolean;
  payload?: unknown;
  valueLabel: string;
  valueSuffix?: string;
}) => {
  if (!active) return null;
  const { row, value: num } = firstTickerRow(payload);
  if (!row) return null;
  return (
    <div className="bg-white p-3 shadow-xl rounded-xl border border-slate-200 min-w-[220px]">
      <p className="font-bold text-slate-900 text-xs leading-tight border-b border-slate-100 pb-1 mb-1.5">
        {row.name}
      </p>
      <p className="text-[10px] text-slate-500 font-medium mb-2 line-clamp-2">{row.set}</p>
      <div className="text-[10px] space-y-1">
        <div className="flex justify-between gap-3">
          <span className="text-slate-500">EV</span>
          <span className={`font-mono font-bold ${row.ev >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
            {fmtMoney(row.ev)}
          </span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-slate-500">{valueLabel}</span>
          <span className="font-mono font-bold text-slate-900">
            {num != null && Number.isFinite(num) ? `${fmtMoney(num)}${valueSuffix}` : '—'}
          </span>
        </div>
      </div>
    </div>
  );
};

export const PortfolioTickerCharts = ({ rows }: { rows: TickerCardRow[] }) => {
  if (rows.length === 0) {
    return (
      <p className="text-xs text-slate-400 font-medium py-6 text-center">
        Add cards (or clear filters) to see the market ticker.
      </p>
    );
  }

  return (
    <div className="space-y-6 mt-4">
      <p className="text-[11px] text-slate-500 leading-relaxed">
        Same top names by <strong className="text-slate-700">expected value</strong> as the chart
        above — compare <strong className="text-emerald-800">PC raw</strong> and{' '}
        <strong className="text-green-800">PSA 10</strong> guide prices, then{' '}
        <strong className="text-sky-800">raw</strong> vs <strong className="text-indigo-800">PSA 10</strong>{' '}
        sell pace (sales / mo from the last {SALES_STATS_WINDOW_DAYS}-day pricing window).
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">
            PC Raw ($)
          </h4>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis
                  dataKey="label"
                  tick={axisTick}
                  interval={0}
                  angle={-28}
                  textAnchor="end"
                  height={68}
                />
                <YAxis tick={axisTick} width={44} tickFormatter={(v) => `$${Math.round(v)}`} />
                <Tooltip
                  cursor={{ fill: '#f8fafc' }}
                  content={(props) => (
                    <TickerTooltip active={props.active} payload={props.payload} valueLabel="PC Raw" />
                  )}
                />
                <Bar dataKey="raw" name="Raw" radius={[3, 3, 0, 0]}>
                  {rows.map((e) => (
                    <Cell key={e.id} fill={e.ev >= 0 ? '#059669' : '#94a3b8'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div>
          <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">
            PSA 10 ($)
          </h4>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis
                  dataKey="label"
                  tick={axisTick}
                  interval={0}
                  angle={-28}
                  textAnchor="end"
                  height={68}
                />
                <YAxis tick={axisTick} width={44} tickFormatter={(v) => `$${Math.round(v)}`} />
                <Tooltip
                  cursor={{ fill: '#f8fafc' }}
                  content={(props) => (
                    <TickerTooltip active={props.active} payload={props.payload} valueLabel="PSA 10" />
                  )}
                />
                <Bar dataKey="psa10" name="PSA 10" radius={[3, 3, 0, 0]}>
                  {rows.map((e) => (
                    <Cell key={e.id} fill={e.ev >= 0 ? '#047857' : '#cbd5e1'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div>
        <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">
          Sell pace (sales / month · raw vs PSA 10)
        </h4>
        <div className="h-[240px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis
                dataKey="label"
                tick={axisTick}
                interval={0}
                angle={-28}
                textAnchor="end"
                height={68}
              />
              <YAxis tick={axisTick} width={36} tickFormatter={(v) => `${v.toFixed(1)}`} />
              <Tooltip
                cursor={{ fill: '#f8fafc' }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const row = payload[0]?.payload as TickerCardRow | undefined;
                  if (!row) return null;
                  const which = payload[0]?.dataKey === 'paceP10' ? 'PSA 10 pace' : 'Raw pace';
                  const val = payload[0]?.value;
                  return (
                    <div className="bg-white p-3 shadow-xl rounded-xl border border-slate-200 min-w-[220px]">
                      <p className="font-bold text-slate-900 text-xs leading-tight border-b border-slate-100 pb-1 mb-1.5">
                        {row.name}
                      </p>
                      <p className="text-[10px] text-slate-500 font-medium mb-2">{which}</p>
                      <div className="text-[10px] space-y-1">
                        <div className="flex justify-between gap-3">
                          <span className="text-slate-500">EV</span>
                          <span
                            className={`font-mono font-bold ${row.ev >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}
                          >
                            {fmtMoney(row.ev)}
                          </span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span className="text-slate-500">Pace</span>
                          <span className="font-mono font-bold text-slate-900">
                            {typeof val === 'number' && Number.isFinite(val) ? `${val.toFixed(2)} / mo` : '—'}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="paceRaw" name="Raw pace" fill="#0ea5e9" radius={[2, 2, 0, 0]} maxBarSize={28} />
              <Bar dataKey="paceP10" name="PSA 10 pace" fill="#4f46e5" radius={[2, 2, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};
