import { useState } from 'react';
import { ExternalLink, Store } from 'lucide-react';
import type { Card, TcgplayerMarketHistory, TcgplayerProductSummary } from '../types';
import type { EnrichedCard } from '../sort';
import { fmtMoney, fmtPct } from '../math';
import { buildTcgplayerProductFetchUrl } from '../tcgplayerRequest';
import { buildTcgSalesAnomalies } from '../tcgSalesAnomalies';
import { appendTcgplayerSelfSample } from '../tcgplayerSelfHistory';
import {
  applyExtensionTcgCapture,
  buildTcgSalesSnapshotFromExtension,
  fetchLatestTcgExtensionCapture,
} from '../services/extensionCapture';
import { resolveTcgDisplayMarketPrice } from '../tcgDisplayPrice';
import { apiUrl } from '../apiBase';
import { pickLatestPcSale, saleGradeShort } from '../utils/recentSales';
import { formatRelative } from '../utils/time';
import { entCardFrame, entMicroLabel, entSectionHeading } from './enterpriseDashboardUi';

export const TcgplayerCompareSection = ({
  card,
  onFieldChange,
}: {
  card: EnrichedCard;
  onFieldChange: <K extends keyof Card>(id: string, key: K, value: Card[K]) => void;
}) => {
  const [loading, setLoading] = useState(false);
  const [loadingHist, setLoadingHist] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [histError, setHistError] = useState<string | null>(null);

  const load = async () => {
    const u = (card.tcgplayerUrl ?? '').trim();
    if (!u || !/tcgplayer\.com\/product\/\d+/i.test(u)) {
      setError('Paste a tcgplayer.com product URL (…/product/12345/…).');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const r = await fetch(buildTcgplayerProductFetchUrl(u), { cache: 'no-store' });
      const data = (await r.json()) as TcgplayerProductSummary | { error: string };
      if (!r.ok || 'error' in data) throw new Error('error' in data ? data.error : `HTTP ${r.status}`);
      const ext = await fetchLatestTcgExtensionCapture(u);
      const merged = applyExtensionTcgCapture(data, ext?.capture ?? null);
      const salesSnapshot = ext ? buildTcgSalesSnapshotFromExtension(u, ext) : null;
      onFieldChange(card.id, 'tcgplayerSummary', merged);
      onFieldChange(card.id, 'tcgplayerSalesSnapshot', salesSnapshot);
      onFieldChange(card.id, 'tcgplayerSalesAnomalies', salesSnapshot?.latestSalesRows?.length ? buildTcgSalesAnomalies(salesSnapshot.latestSalesRows) : []);
      onFieldChange(card.id, 'tcgplayerSelfHistory', appendTcgplayerSelfSample(card.tcgplayerSelfHistory, merged.marketPrice, Date.now()));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const loadChartHistory = async () => {
    const u = (card.tcgplayerUrl ?? '').trim();
    if (!u || !/tcgplayer\.com\/product\/\d+/i.test(u)) {
      setHistError('Save a tcgplayer.com product URL first.');
      return;
    }
    setHistError(null);
    setLoadingHist(true);
    try {
      const r = await fetch(apiUrl(`/api/tcgplayer/history?url=${encodeURIComponent(u)}`));
      const data = (await r.json()) as TcgplayerMarketHistory | { error: string };
      if (!r.ok || 'error' in data) throw new Error('error' in data ? data.error : `HTTP ${r.status}`);
      onFieldChange(card.id, 'tcgplayerMarketHistory', data);
    } catch (e) {
      setHistError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingHist(false);
    }
  };

  const s = card.tcgplayerSummary;
  const mh = card.tcgplayerMarketHistory;
  const salesSnapshot = card.tcgplayerSalesSnapshot;
  const anomalies = card.tcgplayerSalesAnomalies ?? [];
  const raw = card.raw;
  const lastPcSale = pickLatestPcSale(card.recentSales);
  const pctVsPc = (tcg: number | null | undefined): number | null => {
    if (tcg == null || !Number.isFinite(tcg) || raw <= 0) return null;
    return ((tcg - raw) / raw) * 100;
  };

  return (
    <section className={`${entCardFrame} p-5 space-y-4`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <span className={entMicroLabel}>External venue</span>
          <h4 className={`${entSectionHeading} flex items-center gap-2`}>
            <Store size={14} className="text-slate-500 shrink-0" /> TCGplayer listing prices
          </h4>
        </div>
        {s?.fetchedAt && <span className="text-[10px] text-slate-400 font-medium">Loaded {formatRelative(s.fetchedAt)}</span>}
      </div>
      {s ? (
        <p className="text-[10px] text-slate-500 -mt-2">
          Source: {s.source ?? 'api_details'}{s.usedAuth ? ' (auth)' : ' (no auth)'}
          {typeof s.apiMarketPrice === 'number' && typeof s.priceDriftVsApi === 'number' ? ` · Drift vs API ${fmtMoney(s.priceDriftVsApi)}` : ''}
        </p>
      ) : null}
      {s?.captureHint ? <p className="text-[10px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1 font-medium">{s.captureHint}</p> : null}
      {salesSnapshot ? <p className="text-[10px] text-slate-500 -mt-1">Extension sales rows: {salesSnapshot.latestSalesRows.length} ({salesSnapshot.captureMode}{salesSnapshot.hasMore ? ', more available' : ''})</p> : null}
      {anomalies.length ? <div className="space-y-1">{anomalies.slice(0, 5).map((a, idx) => <p key={`${a.window}-${a.kind}-${idx}`} className="text-[10px] text-indigo-900 bg-indigo-50 border border-indigo-200 rounded-md px-2 py-1 font-medium">{a.label}{a.pct != null ? `: ${a.pct >= 0 ? '+' : ''}${a.pct.toFixed(1)}%` : ''}</p>)}</div> : null}
      <p className="text-[11px] text-slate-500 leading-snug"><strong className="text-slate-700">PC raw</strong> is your card&rsquo;s PriceCharting ungraded price; <strong className="text-slate-700">TCG market</strong> is TCGplayer&rsquo;s headline listing metric (not a PC grade).<strong className="text-slate-700"> Last sold</strong> is the newest row from the PC sales table we scrape on refresh.</p>
      <div className="flex flex-wrap gap-2">
        <input placeholder="https://www.tcgplayer.com/product/…" className="flex-1 min-w-[200px] bg-slate-50 px-3 py-2 rounded-lg border border-slate-200 focus:outline-blue-500 text-sm" value={card.tcgplayerUrl ?? ''} onChange={(e) => onFieldChange(card.id, 'tcgplayerUrl', e.target.value)} />
        <button type="button" onClick={load} disabled={loading} className="bg-violet-600 hover:bg-violet-700 disabled:bg-slate-200 disabled:text-slate-400 text-white px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wider shrink-0">{loading ? 'Loading…' : 'Load'}</button>
        <button type="button" onClick={loadChartHistory} disabled={loadingHist} title="Load weekly sales chart from TCGplayer" className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 text-white px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wider shrink-0">{loadingHist ? 'Chart…' : 'Chart history'}</button>
      </div>
      {mh?.points?.length ? <p className="text-[10px] text-indigo-800 font-semibold">Stored {mh.points.length} weekly TCG points ({mh.source}{mh.fetchedAt ? ` · ${formatRelative(mh.fetchedAt)}` : ''}).</p> : mh?.hint && mh.source === 'none' ? <p className="text-[10px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1 font-medium">{mh.hint}</p> : null}
      {histError && <p className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-2 py-1 font-medium">{histError}</p>}
      {error && <p className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-2 py-1 font-medium">{error}</p>}
      <div className="grid grid-cols-2 gap-3">
        <div className={`${entCardFrame} bg-slate-50/90 px-4 py-3 text-center`}>
          <div className={entMicroLabel}>PC raw</div>
          <div className="text-2xl font-mono font-bold text-slate-900 tabular-nums mt-1">{fmtMoney(raw)}</div>
        </div>
        <div className={`${entCardFrame} border-violet-200/90 bg-violet-50/50 px-4 py-3 text-center`}>
          <div className={`${entMicroLabel} text-violet-800/90`}>TCG market (Near Mint)</div>
          <div className="text-2xl font-mono font-bold text-violet-950 tabular-nums mt-1">
            {s ? fmtMoney(resolveTcgDisplayMarketPrice(card) ?? s.marketPrice) : '—'}
          </div>
          {!s && <div className="text-[10px] text-violet-700/80 font-medium mt-1">Load TCG URL above</div>}
        </div>
      </div>
      {lastPcSale ? (
        <div className={`${entCardFrame} px-4 py-3 flex flex-wrap items-center justify-between gap-3`}>
          <div>
            <div className={entMicroLabel}>Last sold (PriceCharting)</div>
            <div className="text-2xl font-mono font-bold text-slate-900 tabular-nums mt-0.5">
              {fmtMoney(lastPcSale.price)}
            </div>
          </div>
          <div className="text-right text-xs text-slate-600 font-medium leading-snug">
            <div>{saleGradeShort(lastPcSale)}</div>
            <div className="text-slate-400 font-normal">{formatRelative(lastPcSale.at)}</div>
          </div>
        </div>
      ) : (
        <p className="text-[11px] text-slate-400 font-medium italic">
          No PriceCharting sale rows yet—refresh the card from its PC URL to pull the recent sales table.
        </p>
      )}
      {s && (
        <div className="space-y-2 text-sm">
          <div className="text-xs text-slate-600 leading-snug">
            <span className="font-semibold text-slate-800">{s.productName}</span>
            {s.setName ? (
              <>
                {' '}
                <span className="text-slate-400">·</span> {s.setName}
              </>
            ) : null}
            {s.rarityName ? (
              <>
                {' '}
                <span className="text-slate-400">·</span> {s.rarityName}
              </>
            ) : null}
          </div>
          <table className="w-full text-sm border border-slate-100 rounded-lg overflow-hidden">
            <thead>
              <tr className="bg-violet-50/60 text-[10px] font-black uppercase tracking-wider text-slate-600">
                <th className="text-left py-2 px-3">TCGplayer metric</th>
                <th className="text-right py-2 px-3">Price</th>
                {raw > 0 && <th className="text-right py-2 px-3 w-[5.5rem]">vs PC raw</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(
                [
                  { label: 'Market price', value: s.marketPrice },
                  { label: 'Lowest listing', value: s.lowestPrice },
                  { label: 'Lowest w/ shipping', value: s.lowestPriceWithShipping },
                  ...(s.medianPrice != null ? [{ label: 'Median', value: s.medianPrice }] : []),
                ] as { label: string; value: number | null }[]
              ).map(({ label, value }) => {
                if (value == null) return null;
                const d = pctVsPc(value);
                return (
                  <tr key={label}>
                    <td className="py-2 px-3 text-slate-600">{label}</td>
                    <td className="py-2 px-3 text-right font-mono font-semibold text-slate-900">
                      {fmtMoney(value)}
                    </td>
                    {raw > 0 && (
                      <td
                        className={`py-2 px-3 text-right font-mono text-xs font-bold ${
                          d == null ? 'text-slate-400' : d >= 0 ? 'text-emerald-600' : 'text-rose-600'
                        }`}
                      >
                        {d == null ? '—' : fmtPct(d)}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {(typeof s.listings === 'number' && s.listings > 0) ||
          (typeof s.sellers === 'number' && s.sellers > 0) ? (
            <p className="text-[10px] text-slate-400 font-medium">
              {typeof s.listings === 'number' && s.listings > 0
                ? `${s.listings.toLocaleString()} listings`
                : ''}
              {typeof s.listings === 'number' && s.listings > 0 &&
              typeof s.sellers === 'number' &&
              s.sellers > 0
                ? ' · '
                : ''}
              {typeof s.sellers === 'number' && s.sellers > 0
                ? `${s.sellers.toLocaleString()} sellers`
                : ''}
            </p>
          ) : null}
          <a
            href={s.url}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-bold text-violet-600 hover:text-violet-800 inline-flex items-center gap-1"
          >
            Open on TCGplayer <ExternalLink size={12} />
          </a>
        </div>
      )}
    </section>
  );
};
