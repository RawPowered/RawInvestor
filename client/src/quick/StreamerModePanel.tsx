import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChevronDown, ChevronLeft, ChevronRight, Palette } from 'lucide-react';
import { getStreamerSkin } from './streamer/skins/registry';
import type { StreamerSkinId } from './streamer/skins/types';
import { StreamerSkinPicker } from './streamer/StreamerSkinPicker';
import { BrandLogoImg, type BrandLogoKey } from '../brandLogos';
import { resolveServerUrl } from '../apiBase';
import { extractCrossGraders } from '../pricing';
import type { EnrichedCard } from '../sort';
import { PresaleBadgeStrip } from '../sealed/SealedQuickPanels';
import { startOfUtcDay } from '../releaseFilter';
import { formatMarketSaleInstant } from '../utils/time';
import { EbayExternalLink } from '../components/EbayExternalLink';
import { ebayItmUrl, resolveTcgplayerProductUrl } from '../masterListExternalLinks';

export type StreamerPriceTile = {
  label: string;
  brand: 'pricecharting' | 'tcgplayer' | 'ebay';
  pct: number | null;
  current: number | null;
  basisLabel?: string;
};

export type StreamerSalePoint = {
  t: number;
  price: number;
  platform: 'ebay' | 'tcg';
  itemId: string | null;
};

export type StreamerLinkItem = {
  brand: BrandLogoKey;
  href: string;
  linkTitle: string;
  label: string;
  caption?: string | null;
};

type StreamerLineRow = {
  t: number;
  /** Chart Y: arithmetic mean when available, else median */
  ebayAvg: number | null;
  tcgAvg: number | null;
  ebayMean: number | null;
  tcgMean: number | null;
  ebayMed: number | null;
  tcgMed: number | null;
  ebayCount: number;
  tcgCount: number;
  ebayMin: number | null;
  ebayMax: number | null;
  tcgMin: number | null;
  tcgMax: number | null;
  /** Most recent first, capped for tooltip */
  ebaySamples: StreamerSalePoint[];
  tcgSamples: StreamerSalePoint[];
};

const SAMPLE_CAP = 10;

const medianSorted = (vals: number[]): number | null => {
  const a = vals.filter((x) => Number.isFinite(x) && x > 0 && x < 100_000).sort((x, y) => x - y);
  if (!a.length) return null;
  return a[Math.floor((a.length - 1) / 2)] ?? null;
};

const meanVals = (vals: number[]): number | null => {
  const a = vals.filter((x) => Number.isFinite(x) && x > 0 && x < 100_000);
  if (!a.length) return null;
  return a.reduce((s, x) => s + x, 0) / a.length;
};

const bucketByUtcDay = (points: StreamerSalePoint[]): Map<number, StreamerSalePoint[]> => {
  const byDay = new Map<number, StreamerSalePoint[]>();
  for (const p of points) {
    const d = startOfUtcDay(p.t);
    const arr = byDay.get(d) ?? [];
    arr.push(p);
    byDay.set(d, arr);
  }
  return byDay;
};

const buildLineRows = (ebayScatter: StreamerSalePoint[], tcgScatter: StreamerSalePoint[]): StreamerLineRow[] => {
  const ebayBy = bucketByUtcDay(ebayScatter);
  const tcgBy = bucketByUtcDay(tcgScatter);
  const days = new Set<number>([...ebayBy.keys(), ...tcgBy.keys()]);
  return [...days]
    .sort((a, b) => a - b)
    .map((t) => {
      const eSales = (ebayBy.get(t) ?? []).sort((a, b) => b.t - a.t);
      const tSales = (tcgBy.get(t) ?? []).sort((a, b) => b.t - a.t);
      const ePrices = eSales.map((s) => s.price);
      const tPrices = tSales.map((s) => s.price);
      const eMean = meanVals(ePrices);
      const tMean = meanVals(tPrices);
      const eMed = medianSorted(ePrices);
      const tMed = medianSorted(tPrices);
      return {
        t,
        ebayAvg: eMean ?? eMed,
        tcgAvg: tMean ?? tMed,
        ebayMean: eMean,
        tcgMean: tMean,
        ebayMed: eMed,
        tcgMed: tMed,
        ebayCount: eSales.length,
        tcgCount: tSales.length,
        ebayMin: ePrices.length ? Math.min(...ePrices) : null,
        ebayMax: ePrices.length ? Math.max(...ePrices) : null,
        tcgMin: tPrices.length ? Math.min(...tPrices) : null,
        tcgMax: tPrices.length ? Math.max(...tPrices) : null,
        ebaySamples: eSales.slice(0, SAMPLE_CAP),
        tcgSamples: tSales.slice(0, SAMPLE_CAP),
      };
    });
};

type TooltipPayloadRow = StreamerLineRow;

const StreamerMarketTooltip = ({
  active,
  payload,
  light,
  chartEbay,
  chartTcg,
  formatMoney,
  card,
}: {
  active?: boolean;
  payload?: Array<{ payload?: TooltipPayloadRow }>;
  light: boolean;
  chartEbay: string;
  chartTcg: string;
  formatMoney: (n: number) => string;
  card: EnrichedCard;
}) => {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as StreamerLineRow | undefined;
  if (!row || typeof row.t !== 'number') return null;
  const bg = light ? '#ffffff' : '#0f172a';
  const border = light ? '#cbd5e1' : '#334155';
  const labelC = light ? '#0f172a' : '#e2e8f0';
  const muted = light ? '#64748b' : '#94a3b8';
  const tcgProduct = resolveTcgplayerProductUrl(card);

  const block = (
    label: string,
    color: string,
    mean: number | null,
    med: number | null,
    count: number,
    minV: number | null,
    maxV: number | null,
    samples: StreamerSalePoint[],
    isEbay: boolean,
    showDivider: boolean
  ) => {
    if (count === 0) return null;
    const headline = mean ?? med;
    if (headline == null) return null;
    const range =
      minV != null && maxV != null && Number.isFinite(minV) && Number.isFinite(maxV)
        ? `${formatMoney(minV)} – ${formatMoney(maxV)}`
        : '—';
    const more = count > samples.length ? ` · +${count - samples.length} more` : '';
    return (
      <div
        className={showDivider ? 'mt-2 pt-2 border-t' : ''}
        style={showDivider ? { borderColor: border } : undefined}
      >
        <div className="font-black uppercase tracking-wide text-[10px] flex items-center gap-1.5" style={{ color: muted }}>
          <span className="inline-block h-2 w-2 rounded-full shrink-0" style={{ background: color }} />
          {label}
        </div>
        <div className="font-black tabular-nums text-base mt-0.5" style={{ color: labelC }}>
          {mean != null ? <>Mean {formatMoney(mean)}</> : <>Median {formatMoney(med!)}</>}
        </div>
        <div className="text-[11px] mt-0.5 space-y-0.5" style={{ color: muted }}>
          {med != null && mean != null && Math.abs(med - mean) > 0.005 ? <div>Median {formatMoney(med)}</div> : null}
          <div>
            {count} sale{count === 1 ? '' : 's'} · range {range}
            {more}
          </div>
        </div>
        {samples.length > 0 && (
          <div className="mt-1.5 space-y-1 max-h-[9.5rem] overflow-y-auto pr-0.5">
            <div className="text-[10px] font-bold uppercase tracking-wide" style={{ color: muted }}>
              Supporting comps (recent first)
            </div>
            {samples.map((s, i) => {
              const href = isEbay ? ebayItmUrl(s.itemId) : tcgProduct;
              const body = (
                <>
                  <span className="font-black tabular-nums">{formatMoney(s.price)}</span>
                  <span className="opacity-80"> · {formatMarketSaleInstant(s.t)}</span>
                </>
              );
              return href ? (
                isEbay ? (
                  <EbayExternalLink
                    key={`${label}-${i}-${s.t}`}
                    href={href}
                    className="block text-[11px] font-medium leading-snug hover:underline truncate"
                    style={{ color: chartEbay }}
                  >
                    {body}
                  </EbayExternalLink>
                ) : (
                  <a
                    key={`${label}-${i}-${s.t}`}
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="block text-[11px] font-medium leading-snug hover:underline truncate"
                    style={{ color: chartTcg }}
                  >
                    {body}
                  </a>
                )
              ) : (
                <div key={`${label}-${i}-${s.t}`} className="block text-[11px] font-medium leading-snug truncate" style={{ color: labelC }}>
                  {body}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className="rounded-lg px-3 py-2.5 text-xs shadow-lg border max-w-[min(100vw-2rem,22rem)]"
      style={{ backgroundColor: bg, borderColor: border, color: labelC }}
    >
      <div className="font-black uppercase tracking-wide text-[10px]" style={{ color: muted }}>
        UTC day (Quick filters)
      </div>
      <div className="text-[11px] font-semibold mt-0.5" style={{ color: muted }}>
        {new Date(row.t).toLocaleDateString(undefined, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })}
      </div>
      {block('eBay raw', chartEbay, row.ebayMean, row.ebayMed, row.ebayCount, row.ebayMin, row.ebayMax, row.ebaySamples, true, false)}
      {block('TCGPlayer', chartTcg, row.tcgMean, row.tcgMed, row.tcgCount, row.tcgMin, row.tcgMax, row.tcgSamples, false, row.ebayCount > 0)}
      {!tcgProduct && row.tcgCount > 0 ? (
        <p className="text-[10px] mt-2 leading-snug" style={{ color: muted }}>
          Link a TCGPlayer product on this card to open sales from the tooltip.
        </p>
      ) : null}
    </div>
  );
};

type Props = {
  card: EnrichedCard;
  topCards: Array<StreamerPriceTile | null | undefined>;
  ebayScatter: StreamerSalePoint[];
  tcgScatter: StreamerSalePoint[];
  formatMoney: (n: number) => string;
  links: StreamerLinkItem[];
  quickCards: EnrichedCard[];
  filteredQuickCards: EnrichedCard[];
  quickSearch: string;
  onQuickSearchChange: (q: string) => void;
  onSelectCard: (id: string) => void;
  onPrev: () => void;
  onNext: () => void;
  skinId: StreamerSkinId;
  onSkinIdChange: (id: StreamerSkinId) => void;
};

const xTickLabel = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export const StreamerModePanel = ({
  card,
  topCards,
  ebayScatter,
  tcgScatter,
  formatMoney,
  links,
  quickCards,
  filteredQuickCards,
  quickSearch,
  onQuickSearchChange,
  onSelectCard,
  onPrev,
  onNext,
  skinId,
  onSkinIdChange,
}: Props) => {
  const skin = getStreamerSkin(skinId);
  const t = skin.tokens;
  const chartGradId = useId().replace(/:/g, '');
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!pickerRef.current) return;
      if (!pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, []);

  const cross = extractCrossGraders(card.allPrices, card.raw, card.psa10);
  const cgcRow = cross.find((x) => x.company === 'CGC');
  const bgsRow = cross.find((x) => x.company === 'BGS');

  const hasChartData = ebayScatter.length > 0 || tcgScatter.length > 0;

  const lineData = useMemo(() => buildLineRows(ebayScatter, tcgScatter), [ebayScatter, tcgScatter]);

  const chartBounds = useMemo(() => {
    const allPts = [...ebayScatter, ...tcgScatter];
    if (!allPts.length) return { xMin: 0, xMax: 1, yMin: 0, yMax: 1 };
    const ts = allPts.map((p) => p.t);
    const prices = allPts.map((p) => p.price);
    let xMin = Math.min(...ts);
    let xMax = Math.max(...ts);
    let pMin = Math.min(...prices);
    let pMax = Math.max(...prices);
    for (const r of lineData) {
      xMin = Math.min(xMin, r.t);
      xMax = Math.max(xMax, r.t);
      if (r.ebayAvg != null) {
        pMin = Math.min(pMin, r.ebayAvg);
        pMax = Math.max(pMax, r.ebayAvg);
      }
      if (r.tcgAvg != null) {
        pMin = Math.min(pMin, r.tcgAvg);
        pMax = Math.max(pMax, r.tcgAvg);
      }
    }
    const pad = (pMax - pMin) * 0.08 || 1;
    return { xMin, xMax, yMin: Math.max(0, pMin - pad), yMax: pMax + pad };
  }, [ebayScatter, tcgScatter, lineData]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        onPrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        onNext();
      }
    },
    [onPrev, onNext]
  );

  return (
    <div
      className={`${t.shell} overflow-hidden outline-none relative`}
      tabIndex={0}
      onKeyDown={onKeyDown}
      role="region"
      aria-label="Streamer mode card view"
    >
      {t.backgroundImageUrl ? (
        <>
          <div
            className="absolute inset-0 bg-cover bg-center pointer-events-none"
            style={{ backgroundImage: `url(${t.backgroundImageUrl})` }}
            aria-hidden
          />
          {t.backgroundOverlay ? (
            <div className="absolute inset-0 pointer-events-none" style={{ background: t.backgroundOverlay }} aria-hidden />
          ) : null}
        </>
      ) : null}
      {t.showRadialGlow && !t.backgroundImageUrl ? (
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(59,130,246,0.12),transparent)]" />
      ) : null}
      {t.tagline ? (
        <p className={`absolute top-4 right-4 md:top-6 md:right-8 z-20 streamer-tagline-brew ${t.tagline.className}`}>
          {t.tagline.text}
        </p>
      ) : null}

      <div className="relative z-10 p-4 md:p-6 lg:p-8 space-y-5 md:space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className={`text-[11px] font-black uppercase tracking-[0.2em] ${t.kicker}`}>Streamer mode</h3>
            {t.headerSubtitle ? (
              <p className={`text-[10px] font-bold uppercase tracking-[0.18em] mt-0.5 ${t.kicker}`}>{t.headerSubtitle}</p>
            ) : null}
            <p className={`text-xs font-medium mt-1 max-w-xl ${t.subhead}`}>
              Large card readout for capture / stream. Same filters as Quick Card; arrows or search to change card.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div
              className={`inline-flex h-11 items-center gap-2 rounded-xl border px-2 ${t.themeBtn}`}
              title="Streamer mode skin"
            >
              <Palette size={16} className="shrink-0 opacity-80" aria-hidden />
              <StreamerSkinPicker
                skinId={skinId}
                onSkinIdChange={onSkinIdChange}
                selectClassName="bg-transparent border-0 py-1 pl-0 pr-1 text-[11px] font-black uppercase tracking-wider focus:outline-none focus:ring-0 min-w-[7.5rem] cursor-pointer"
              />
            </div>
            <button
              type="button"
              onClick={onPrev}
              disabled={quickCards.length <= 1}
              className={`inline-flex h-11 w-11 items-center justify-center rounded-xl border ${t.navBtn} disabled:pointer-events-none transition-colors`}
              title="Previous card"
              aria-label="Previous card"
            >
              <ChevronLeft size={22} />
            </button>
            <button
              type="button"
              onClick={onNext}
              disabled={quickCards.length <= 1}
              className={`inline-flex h-11 w-11 items-center justify-center rounded-xl border ${t.navBtn} disabled:pointer-events-none transition-colors`}
              title="Next card"
              aria-label="Next card"
            >
              <ChevronRight size={22} />
            </button>
          </div>
        </div>

        <PresaleBadgeStrip card={card} />

        <div className="flex flex-col xl:flex-row gap-6 xl:gap-10 items-stretch">
          <div className="flex flex-col items-center xl:items-start gap-4 shrink-0 xl:w-[min(42%,420px)]">
            <div
              className={`relative w-full max-w-[min(100%,380px)] rounded-2xl overflow-hidden ${t.imgRing}`}
              style={{ aspectRatio: '100 / 140' }}
            >
              {card.localImage ? (
                <img
                  src={resolveServerUrl(card.localImage)}
                  alt={card.name}
                  className="h-full w-full object-contain object-center"
                  loading="lazy"
                />
              ) : (
                <div className={`h-full w-full flex items-center justify-center text-sm font-semibold p-4 text-center ${t.noImg}`}>
                  No image on file
                </div>
              )}
            </div>

            <div ref={pickerRef} className="relative w-full max-w-[min(100%,380px)]">
              <button
                type="button"
                onClick={() => setPickerOpen((v) => !v)}
                className={`w-full px-3 py-2.5 rounded-xl border text-left flex items-center gap-3 ${t.pickerBtn}`}
              >
                {card.localImage ? (
                  <img
                    src={resolveServerUrl(card.localImage)}
                    alt=""
                    className={`h-10 w-10 rounded-md object-cover border ${t.pickerThumbBorder}`}
                    loading="lazy"
                  />
                ) : (
                  <div className={`h-10 w-10 rounded-md border ${t.pickerPlaceholderBg} ${t.pickerPlaceholderBorder}`} />
                )}
                <div className="min-w-0 flex-1">
                  <div className={`text-sm font-semibold truncate ${t.titleMain}`}>{card.name}</div>
                  <div className={`text-[11px] truncate ${t.setSub}`}>
                    {card.set || 'Unknown set'}
                    {card.cardNumber ? ` · ${card.cardNumber}` : ''}
                  </div>
                </div>
                <ChevronDown size={14} className={`shrink-0 ${t.pickerChevron}`} />
              </button>
              {pickerOpen && (
                <div className={`absolute z-40 mt-1 w-full rounded-xl border p-2 space-y-2 ${t.pickerPop}`}>
                  <input
                    value={quickSearch}
                    onChange={(e) => onQuickSearchChange(e.target.value)}
                    placeholder="Search name, set, or number…"
                    className={`w-full px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/60 ${t.pickerInput}`}
                  />
                  <div className={`max-h-64 overflow-auto divide-y ${t.pickerDivide}`}>
                    {filteredQuickCards.slice(0, 120).map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          onSelectCard(c.id);
                          setPickerOpen(false);
                        }}
                        className={`w-full text-left px-2 py-2 flex items-center gap-2 ${t.listHover} ${
                          c.id === card.id ? t.listSelected : ''
                        }`}
                      >
                        {c.localImage ? (
                          <img
                            src={resolveServerUrl(c.localImage)}
                            alt=""
                            className={`h-9 w-9 rounded object-cover border ${t.pickerThumbBorder}`}
                            loading="lazy"
                          />
                        ) : (
                          <div className={`h-9 w-9 rounded border ${t.pickerPlaceholderBg} ${t.pickerPlaceholderBorder}`} />
                        )}
                        <div className="min-w-0">
                          <div className={`text-[13px] font-semibold truncate ${t.titleMain}`}>{c.name}</div>
                          <div className={`text-[11px] truncate ${t.setSub}`}>
                            {c.set || 'Unknown set'}
                            {c.cardNumber ? ` · ${c.cardNumber}` : ''}
                          </div>
                        </div>
                      </button>
                    ))}
                    {filteredQuickCards.length === 0 && (
                      <div className={`px-2 py-3 text-xs ${t.noImg}`}>
                        No cards match your search.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2 justify-center xl:justify-start w-full max-w-[min(100%,380px)]">
              {links.map((item) => {
                const chip = (
                  <>
                    <BrandLogoImg
                      brand={item.brand}
                      className="h-[18px] w-auto max-w-[4.5rem] object-contain opacity-95"
                      title={item.linkTitle}
                    />
                    {item.caption ? (
                      <span
                        className={`text-[9px] font-bold uppercase tracking-wide ${t.linkCaption}`}
                      >
                        {item.caption}
                      </span>
                    ) : null}
                  </>
                );
                const chipClass = `inline-flex flex-col items-center justify-center gap-0.5 rounded-lg border px-2.5 py-2 min-w-[4.5rem] ${t.linkChip}`;
                return item.brand === 'ebay' ? (
                  <EbayExternalLink
                    key={`${item.label}-${item.caption ?? 'link'}`}
                    href={item.href}
                    className={chipClass}
                    title={item.linkTitle}
                  >
                    {chip}
                  </EbayExternalLink>
                ) : (
                  <a
                    key={`${item.label}-${item.caption ?? 'link'}`}
                    href={item.href}
                    target="_blank"
                    rel="noreferrer"
                    className={chipClass}
                    title={item.linkTitle}
                  >
                    {chip}
                  </a>
                );
              })}
            </div>
          </div>

          <div className="flex-1 min-w-0 space-y-5">
            <div>
              <h2 className={`text-2xl md:text-3xl font-black tracking-tight leading-tight ${t.titleMain}`}>{card.name}</h2>
              <p className={`text-sm md:text-base font-medium mt-1 ${t.setSub}`}>
                {card.set || 'Unknown set'}
                {card.cardNumber ? ` · #${card.cardNumber}` : ''}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4">
              {topCards.map((m, idx) => {
                if (!m) {
                  return <div key={`empty-${idx}`} className={`rounded-2xl border px-4 py-5 min-h-[120px] ${t.emptyTile}`} />;
                }
                const up = typeof m.pct === 'number' && m.pct > 0.2;
                const down = typeof m.pct === 'number' && m.pct < -0.2;
                const deltaText =
                  typeof m.pct === 'number' ? `${m.pct >= 0 ? '+' : ''}${m.pct.toFixed(1)}%` : '—';
                const deltaCls = up
                  ? 'text-emerald-600'
                  : down
                    ? 'text-rose-600'
                    : t.deltaNeutral;
                return (
                  <div key={m.brand} className={`rounded-2xl border px-4 py-4 ${t.priceTile}`}>
                    <div className="flex items-center justify-between gap-2">
                      <BrandLogoImg
                        brand={m.brand}
                        className="h-[18px] w-auto max-w-[5.5rem] object-contain opacity-95"
                        title={m.label}
                      />
                      <div className={`inline-flex items-center gap-1 text-[11px] font-bold tabular-nums ${deltaCls}`}>
                        {deltaText}
                      </div>
                    </div>
                    <div className={`mt-3 text-3xl md:text-[2.1rem] font-black tabular-nums tracking-tight leading-none ${t.priceNum}`}>
                      {typeof m.current === 'number' ? formatMoney(m.current) : '—'}
                    </div>
                    {m.basisLabel ? (
                      <div className={`mt-1.5 text-[10px] font-semibold uppercase tracking-wider ${t.sectionLbl}`}>
                        {m.basisLabel}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <div>
              <p className={`text-[10px] font-black uppercase tracking-[0.16em] mb-2 ${t.sectionLbl}`}>Gem grades · PC</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className={`rounded-2xl border px-4 py-3 flex flex-col gap-2 ${t.gradeTile}`}>
                  <div className="flex items-center gap-2">
                    <BrandLogoImg brand="psa" className="h-7 w-auto max-w-[4rem] object-contain opacity-95" title="PSA" />
                    <span className={`text-[11px] font-black uppercase tracking-wide ${t.gradeLbl}`}>PSA 10</span>
                  </div>
                  <p className={`text-2xl font-black tabular-nums ${t.priceNum}`}>{formatMoney(card.psa10)}</p>
                </div>
                <div className={`rounded-2xl border px-4 py-3 flex flex-col gap-2 ${t.gradeTile}`}>
                  <div className="flex items-center gap-2">
                    <BrandLogoImg brand="cgc" className="h-7 w-auto max-w-[4rem] object-contain opacity-95" title="CGC" />
                    <span className={`text-[11px] font-black uppercase tracking-wide truncate ${t.gradeLbl}`}>
                      {cgcRow?.label ?? 'CGC 10'}
                    </span>
                  </div>
                  <p className={`text-2xl font-black tabular-nums ${t.priceNum}`}>
                    {cgcRow ? formatMoney(cgcRow.price) : '—'}
                  </p>
                </div>
                <div className={`rounded-2xl border px-4 py-3 flex flex-col gap-2 ${t.gradeTile}`}>
                  <div className="flex items-center gap-2">
                    <BrandLogoImg
                      brand="beckett"
                      className="h-7 w-auto max-w-[4rem] object-contain opacity-95"
                      title="BGS"
                    />
                    <span className={`text-[11px] font-black uppercase tracking-wide truncate ${t.gradeLbl}`}>
                      {bgsRow?.label ?? 'BGS 10'}
                    </span>
                  </div>
                  <p className={`text-2xl font-black tabular-nums ${t.priceNum}`}>
                    {bgsRow ? formatMoney(bgsRow.price) : '—'}
                  </p>
                </div>
              </div>
            </div>

            <div className={`rounded-2xl border px-3 py-4 ${t.chartBox}`}>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <span className={`text-[10px] font-black uppercase tracking-[0.14em] ${t.chartMeta}`}>
                  Raw eBay + TCG sales
                </span>
                <span className={`text-[9px] font-semibold uppercase tracking-wide ${t.chartMeta}`}>
                  Daily average (UTC) · hover for comps and links
                </span>
              </div>
              {hasChartData ? (
                <div className="h-[280px] w-full min-h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart margin={{ top: 10, right: 14, left: 2, bottom: 6 }}>
                      <defs>
                        <linearGradient id={`seaf-${chartGradId}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={t.chartEbay} stopOpacity={t.chartEbayAreaOpacity} />
                          <stop offset="100%" stopColor={t.chartEbay} stopOpacity={0.02} />
                        </linearGradient>
                        <linearGradient id={`staf-${chartGradId}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={t.chartTcg} stopOpacity={t.chartTcgAreaOpacity} />
                          <stop offset="100%" stopColor={t.chartTcg} stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke={t.gridStroke} vertical={false} />
                      <XAxis
                        type="number"
                        dataKey="t"
                        domain={[chartBounds.xMin, chartBounds.xMax]}
                        allowDataOverflow
                        tick={{ fill: t.axisTick, fontSize: 10 }}
                        tickFormatter={(v) => xTickLabel(Number(v))}
                        axisLine={{ stroke: t.gridStroke }}
                        tickLine={{ stroke: t.gridStroke }}
                      />
                      <YAxis
                        type="number"
                        domain={[chartBounds.yMin, chartBounds.yMax]}
                        allowDataOverflow
                        tick={{ fill: t.axisTick, fontSize: 10 }}
                        tickFormatter={(v) => (typeof v === 'number' ? `$${Math.round(v)}` : v)}
                        axisLine={{ stroke: t.gridStroke }}
                        tickLine={{ stroke: t.gridStroke }}
                        width={52}
                      />
                      <Tooltip
                        cursor={{ strokeDasharray: '4 4', stroke: t.gridStroke }}
                        content={(tipProps) => (
                          <StreamerMarketTooltip
                            active={tipProps.active}
                            payload={tipProps.payload}
                            light={t.light}
                            chartEbay={t.chartEbay}
                            chartTcg={t.chartTcg}
                            formatMoney={formatMoney}
                            card={card}
                          />
                        )}
                      />
                      <Legend
                        wrapperStyle={{ fontSize: '11px', paddingTop: 6 }}
                        formatter={(value) => <span className={t.legendTxt}>{value}</span>}
                      />
                      {lineData.length > 0 && (
                        <>
                          <Area
                            type="monotone"
                            data={lineData}
                            dataKey="ebayAvg"
                            name="eBay (daily avg)"
                            stroke="none"
                            fill={`url(#seaf-${chartGradId})`}
                            connectNulls
                            isAnimationActive={false}
                          />
                          <Area
                            type="monotone"
                            data={lineData}
                            dataKey="tcgAvg"
                            name="TCG (daily avg)"
                            stroke="none"
                            fill={`url(#staf-${chartGradId})`}
                            connectNulls
                            isAnimationActive={false}
                          />
                          <Line
                            type="monotone"
                            data={lineData}
                            dataKey="ebayAvg"
                            name="eBay trend"
                            stroke={t.chartEbay}
                            strokeWidth={2.75}
                            dot={false}
                            connectNulls
                            isAnimationActive={false}
                          />
                          <Line
                            type="monotone"
                            data={lineData}
                            dataKey="tcgAvg"
                            name="TCG trend"
                            stroke={t.chartTcg}
                            strokeWidth={2.75}
                            dot={false}
                            connectNulls
                            isAnimationActive={false}
                          />
                        </>
                      )}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className={`text-sm text-center py-8 ${t.chartMeta}`}>
                  No filtered raw eBay or TCG sale points for this card yet. Capture sales on Quick Card to populate the
                  chart.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
