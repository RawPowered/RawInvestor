import { BrandLogoImg } from '../brandLogos';

type QuickTopCard = {
  label: string;
  brand: 'pricecharting' | 'tcgplayer' | 'ebay';
  pct: number | null;
  current: number | null;
  basisLabel?: string;
};

type SalesToday = {
  pc?: number;
  tcg?: number;
  ebay?: number;
} | null;

export type SidebarSummary = {
  salesToday: SalesToday;
  biasKey: 'buy' | 'hold' | 'sell' | 'neutral';
  trendKey: 'up' | 'down' | 'flat';
  spikeFlag: 'none' | 'watch' | 'high';
};

export const QuickPriceSidebar = ({
  open,
  hiddenDefault,
  onToggleOpen,
  onChangeHiddenDefault,
  quickTopCards,
  summary,
  formatMoney,
}: {
  open: boolean;
  hiddenDefault: boolean;
  onToggleOpen: (v: boolean) => void;
  onChangeHiddenDefault: (v: boolean) => void;
  quickTopCards: Array<QuickTopCard | null | undefined>;
  summary: SidebarSummary;
  formatMoney: (n: number) => string;
}) => {
  if (!open) {
    return (
      <div className="hidden xl:block fixed right-0 top-1/2 -translate-y-1/2 z-40">
        <button
          type="button"
          onClick={() => onToggleOpen(true)}
          className="rounded-l-xl border border-r-0 border-slate-300 bg-white/95 shadow-md px-2 py-4 text-[10px] font-black uppercase tracking-[0.14em] text-slate-600 hover:bg-slate-50"
          style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
        >
          Prices
        </button>
      </div>
    );
  }

  return (
    <aside className="hidden xl:block fixed right-3 top-24 z-40 w-[248px] max-h-[calc(100vh-120px)] overflow-auto rounded-xl border border-slate-300 bg-white/97 shadow-xl p-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-600">Price Sidebar</div>
        <button
          type="button"
          onClick={() => onToggleOpen(false)}
          className="px-2 py-1 rounded-md border border-slate-200 text-[10px] font-semibold uppercase tracking-[0.09em] text-slate-500 hover:bg-slate-50"
        >
          Hide
        </button>
      </div>
      <label className="inline-flex items-center gap-1.5 text-[10px] text-slate-600 font-medium">
        <input
          type="checkbox"
          checked={hiddenDefault}
          onChange={(e) => onChangeHiddenDefault(e.target.checked)}
          className="rounded border-slate-300"
        />
        Hide by default
      </label>
      <div className="space-y-1.5">
        {quickTopCards.map((m) => {
          if (!m) return null;
          const up = typeof m.pct === 'number' && m.pct > 0.2;
          const down = typeof m.pct === 'number' && m.pct < -0.2;
          const today =
            m.brand === 'pricecharting'
              ? summary.salesToday?.pc
              : m.brand === 'tcgplayer'
                ? summary.salesToday?.tcg
                : summary.salesToday?.ebay;
          const deltaText =
            typeof m.pct === 'number' ? `${m.pct >= 0 ? '+' : ''}${m.pct.toFixed(1)}%` : '—';
          return (
            <div key={`quick-sb-${m.label}`} className="rounded-lg border border-slate-200 bg-slate-50/60 px-2 py-2">
              <div className="flex items-center justify-between gap-2">
                <BrandLogoImg
                  brand={m.brand}
                  className="h-[14px] w-auto max-w-[4.8rem] object-contain"
                  title={m.label}
                />
                <div
                  className={`inline-flex items-center gap-1 text-[10px] font-semibold ${
                    up ? 'text-emerald-700' : down ? 'text-rose-700' : 'text-slate-500'
                  }`}
                >
                  {up ? (
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
                      <path d="M2 8.5L6 3.5L10 8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  ) : down ? (
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
                      <path d="M2 3.5L6 8.5L10 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  ) : (
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
                      <path d="M2 6H10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  )}
                  {deltaText}
                </div>
              </div>
              <div className="mt-1 text-[22px] leading-none font-black tracking-tight text-slate-900 tabular-nums">
                {typeof m.current === 'number' ? formatMoney(m.current) : '—'}
              </div>
              <div className="mt-1 text-[10px] text-slate-500">
                Basis:{' '}
                <span className="font-semibold text-slate-700">
                  {m.basisLabel || 'last sale'}
                </span>
              </div>
              <div className="mt-1 text-[10px] text-slate-500">
                Sales today: <span className="font-semibold text-slate-700 tabular-nums">{today ?? 0}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <div className="rounded-md border border-slate-200 bg-white px-2 py-1.5">
          <div className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-500">
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path d="M2.5 6h7M6 2.5v7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            Spike
          </div>
          <div className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-slate-700">
            {summary.spikeFlag === 'high' ? (
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
                <path d="M6 1.8L10.5 10H1.5L6 1.8Z" stroke="#be123c" fill="#ffe4e6" strokeWidth="1.1" />
                <path d="M6 4.3v2.6" stroke="#be123c" strokeWidth="1.1" strokeLinecap="round" />
                <circle cx="6" cy="8.2" r=".6" fill="#be123c" />
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
                <circle cx="6" cy="6" r="4.2" stroke="#15803d" fill="#dcfce7" strokeWidth="1.1" />
                <path d="M4.1 6.2L5.4 7.4L8 4.8" stroke="#15803d" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            {summary.spikeFlag === 'high' ? 'Active' : summary.spikeFlag === 'watch' ? 'Watch' : 'Healthy'}
          </div>
        </div>
        <div className="rounded-md border border-slate-200 bg-white px-2 py-1.5">
          <div className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-500">
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path d="M2.2 9.8H9.8V2.2H2.2V9.8Z" stroke="currentColor" strokeWidth="1.1" />
            </svg>
            Bias
          </div>
          <div className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-slate-700">
            {summary.biasKey === 'buy' ? (
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
                <path d="M2 8.2L5 5.2L6.9 7.1L10 4" stroke="#15803d" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : summary.biasKey === 'hold' ? (
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
                <path d="M3 3.5H9V8.5H3z" stroke="#475569" strokeWidth="1.1" />
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
                <path d="M2 4h8M2 6h8M2 8h8" stroke="#9f1239" strokeWidth="1.1" strokeLinecap="round" />
              </svg>
            )}
            {summary.biasKey === 'buy'
              ? 'Buy'
              : summary.biasKey === 'hold'
                ? 'Hold'
                : summary.biasKey === 'sell'
                  ? 'Sell'
                  : 'Neutral'}
          </div>
        </div>
        <div className="rounded-md border border-slate-200 bg-white px-2 py-1.5 col-span-2">
          <div className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-500">
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path d="M2 9L5 6L7 7.2L10 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Trend
          </div>
          <div className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-slate-700">
            {summary.trendKey === 'up' ? (
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
                <path d="M2 8.4L6 4L10 8.4" stroke="#15803d" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            ) : summary.trendKey === 'down' ? (
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
                <path d="M2 3.6L6 8L10 3.6" stroke="#be123c" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
                <path d="M2 6H10" stroke="#475569" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            )}
            {summary.trendKey === 'up' ? 'Climbing' : summary.trendKey === 'down' ? 'Dropping' : 'Flat'}
          </div>
        </div>
      </div>
    </aside>
  );
};

