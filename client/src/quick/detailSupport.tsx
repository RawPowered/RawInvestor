import { useState, type ReactNode } from 'react';
import { ExternalLink, Users } from 'lucide-react';
import type { Card, Fees, GemRateSearchResult } from '../types';
import type { EnrichedCard } from '../sort';
import { apiUrl } from '../apiBase';
import { fmtMoney } from '../math';
import { entCardFrame, entInsetStrip, entMicroLabel, entSectionHeading } from './enterpriseDashboardUi';

export const GemRateSection = ({
  card,
  onFieldChange,
}: {
  card: EnrichedCard;
  onFieldChange: <K extends keyof Card>(id: string, key: K, value: Card[K]) => void;
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runSearch = async () => {
    setError(null);
    setLoading(true);
    try {
      const q = [card.name, card.cardNumber, card.set]
        .filter(Boolean)
        .join(' ')
        .replace(/\s*\(\d+\)\s*/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!q) throw new Error('Card needs at least a name.');
      const r = await fetch(apiUrl(`/api/gemrate/search?q=${encodeURIComponent(q)}`));
      const data = (await r.json()) as GemRateSearchResult | { error: string };
      if (!r.ok || 'error' in data) throw new Error('error' in data ? data.error : `HTTP ${r.status}`);
      const candidates = data.candidates || [];
      onFieldChange(card.id, 'gemrateCandidates', candidates);
      if (!card.gemrateId) {
        const universal = candidates.find((c) => c.populationType === 'Universal');
        onFieldChange(card.id, 'gemrateId', universal?.gemrateId || candidates[0]?.gemrateId || '');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const candidates = card.gemrateCandidates ?? [];
  const selected = candidates.find((c) => c.gemrateId === card.gemrateId);
  return (
    <section className={`${entCardFrame} p-5 space-y-3`}>
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <span className={entMicroLabel}>Reference data</span>
          <h4 className={`${entSectionHeading} flex items-center gap-2`}>
            <Users size={14} className="text-slate-500 shrink-0" /> GemRate Pop (All Graders)
          </h4>
        </div>
        <button onClick={runSearch} disabled={loading} className="text-xs font-bold uppercase tracking-wider text-blue-600 hover:text-blue-800 disabled:opacity-50" type="button">
          {loading ? 'Searching...' : candidates.length ? 'Re-search' : 'Search'}
        </button>
      </div>
      {error && <p className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-2 py-1 font-medium">{error}</p>}
      {candidates.length === 0 && !error && <p className="text-xs text-slate-400 font-medium">{loading ? 'Looking up on GemRate…' : 'No GemRate match yet. Click Search.'}</p>}
      {candidates.length > 0 && (
        <>
          <select
            value={card.gemrateId ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              onFieldChange(card.id, 'gemrateId', v);
              if (!v) onFieldChange(card.id, 'gemRateStats', null);
            }}
            className="w-full bg-slate-50 px-2 py-2 rounded-lg border border-slate-200 text-xs font-medium focus:outline-blue-500"
          >
            {candidates.map((c) => (
              <option key={c.gemrateId} value={c.gemrateId}>
                [{c.populationType}] {c.totalPopulation.toLocaleString()} · {c.description.length > 55 ? c.description.slice(0, 55) + '…' : c.description}
              </option>
            ))}
          </select>
          {selected && (
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/80 p-4 space-y-2 text-sm">
              <div className="text-[10px] uppercase font-bold tracking-widest text-slate-400">{selected.populationType} Population</div>
              <div className="text-2xl font-black text-slate-900 font-mono">{selected.totalPopulation.toLocaleString()}</div>
              <div className="text-xs text-slate-500 leading-snug">{selected.description}</div>
              <a href={selected.detailUrl} target="_blank" rel="noreferrer" className="text-xs font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1 pt-1">
                Open full grade breakdown on GemRate <ExternalLink size={12} />
              </a>
              <p className="text-[11px] text-slate-500 font-medium leading-snug pt-1 border-t border-slate-200/80">
                GemRate aggregates PSA + BGS + SGC + CGC. Full per-grade breakdown loads on GemRate itself.
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
};

export const MathGroup = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="mb-3">
    <p className={`${entMicroLabel} mb-1.5`}>{title}</p>
    <div className={`${entInsetStrip} p-3 space-y-0.5`}>{children}</div>
  </div>
);

export const MathLine = ({ k, v, op, bold = false }: { k: string; v: string; op?: string; bold?: boolean }) => (
  <div className={`flex justify-between items-baseline ${bold ? 'font-black text-slate-900 border-t border-slate-200 pt-1.5 mt-1.5' : 'text-slate-600'}`}>
    <span>{op && <span className="text-slate-400 font-mono mr-1">{op}</span>}{k}</span>
    <span className="font-mono tabular-nums">{v}</span>
  </div>
);

export const OutcomeBlock = ({
  title, salePrice, revenue, net, invested, fees, ev,
}: {
  title: string;
  salePrice: number;
  revenue: number;
  net: number;
  invested: number;
  fees: Fees;
  ev: number;
}) => {
  const feeAmount = salePrice * fees.saleFeePct;
  return (
    <MathGroup title={title}>
      <MathLine k="Sale price" v={fmtMoney(salePrice)} op="=" />
      <MathLine k={`- ${(fees.saleFeePct * 100).toFixed(2)}% sale fee`} v={fmtMoney(-feeAmount)} />
      <MathLine k="- Flat fee" v={fmtMoney(-fees.saleFeeFlat)} />
      <MathLine k="- Ship to buyer" v={fmtMoney(-fees.shipToBuyer)} />
      <MathLine k="Net revenue" v={fmtMoney(revenue)} bold />
      <MathLine k="- Invested" v={fmtMoney(-invested)} />
      <MathLine k="Net outcome" v={fmtMoney(net)} bold />
      <MathLine k="EV contribution" v={fmtMoney(ev)} />
    </MathGroup>
  );
};
