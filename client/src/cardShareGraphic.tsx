import { forwardRef, useEffect, useRef, useState } from 'react';
import { ImagePlus, Loader2 } from 'lucide-react';
import { BrandLogoImg, type BrandLogoKey } from './brandLogos';
import type { EnrichedCard } from './sort';
import { fmtMoney, fmtPct } from './math';
import { pcRawTrendForMasterList } from './pcRawTrend';
import { extractCrossGraders } from './pricing';
import {
  SHARE_GRAPHIC_THEME_IDS,
  SHARE_GRAPHIC_THEMES,
  type ShareGraphicThemeId,
} from './cardShareGraphicThemes';
import { resolveServerUrl } from './apiBase';

const W = 540;
const H = 820;

const Row = ({
  label,
  value,
  valueClass = '',
  labelClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
  labelClass: string;
}) => (
  <div className="flex justify-between gap-3 items-baseline text-[11px] leading-tight py-2">
    <span className={`font-bold uppercase tracking-wide shrink-0 ${labelClass}`}>{label}</span>
    <span className={`font-mono font-black tabular-nums text-right text-[13px] ${valueClass}`}>{value}</span>
  </div>
);

const GradeMarketTile = ({
  brand,
  title,
  subtitle,
  priceStr,
  isLight,
}: {
  brand: BrandLogoKey;
  title: string;
  subtitle?: string;
  priceStr: string;
  isLight: boolean;
}) => (
  <div
    className={`rounded-xl px-2 py-2.5 flex flex-col justify-between min-h-[5.5rem] border ${
      isLight
        ? 'border-slate-200/90 bg-white/85 shadow-sm'
        : 'border-white/12 bg-white/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
    }`}
  >
    <div className="flex items-start gap-2">
      <BrandLogoImg
        brand={brand}
        className="h-6 w-auto max-w-[4rem] shrink-0 object-contain object-left mt-0.5"
        title=""
      />
      <div className="min-w-0 flex-1">
        <p
          className={`text-[11px] font-black uppercase tracking-wide leading-tight ${
            isLight ? 'text-slate-800' : 'text-white'
          }`}
        >
          {title}
        </p>
        {subtitle ? (
          <p className={`text-[8px] font-semibold leading-snug line-clamp-2 mt-0.5 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
            {subtitle}
          </p>
        ) : null}
      </div>
    </div>
    <p
      className={`text-[23px] font-black tabular-nums leading-none tracking-tight text-right mt-1 ${
        isLight ? 'text-slate-900' : 'text-white'
      }`}
    >
      {priceStr}
    </p>
  </div>
);

export type CardShareGraphicTemplateProps = {
  card: EnrichedCard;
  collectionName?: string | null;
  themeId: ShareGraphicThemeId;
};

/**
 * Fixed-size frame for PNG export (~1080×1520 @2x). Kept off-screen while capturing.
 */
export const CardShareGraphicTemplate = forwardRef<HTMLDivElement, CardShareGraphicTemplateProps>(
  ({ card, collectionName, themeId }, ref) => {
    const theme = SHARE_GRAPHIC_THEMES[themeId];
    const isLight = theme.tone === 'light';
    const lbl = isLight ? 'text-slate-600' : 'text-slate-400';
    const val = isLight ? 'text-slate-900' : 'text-slate-100';
    const sub = isLight ? 'text-slate-500' : 'text-slate-400';
    const titleMain = isLight ? 'text-slate-900' : 'text-white';
    const evPos = isLight ? 'text-emerald-700' : 'text-emerald-400';
    const evNeg = isLight ? 'text-rose-700' : 'text-rose-400';

    const tcg = card.tcgplayerSummary?.marketPrice;
    const hasTcg = typeof tcg === 'number' && Number.isFinite(tcg) && tcg >= 0;
    const trend = pcRawTrendForMasterList(card);
    const trendStr =
      trend && trend.dir !== 'flat'
        ? `${trend.dir === 'up' ? '+' : ''}${fmtPct(trend.pct)}`
        : trend
          ? '±0%'
          : '—';
    const trendCls =
      trend?.dir === 'up'
        ? isLight
          ? 'text-emerald-700'
          : 'text-emerald-400'
        : trend?.dir === 'down'
          ? isLight
            ? 'text-rose-700'
            : 'text-rose-400'
          : isLight
            ? 'text-slate-500'
            : 'text-slate-400';

    const gr = card.gemRateStats;
    let grPct: number | null = null;
    let grUniversal = false;
    let grHas = false;
    if (gr && (gr.psa10Pct != null || gr.universalGemsPct != null)) {
      grHas = true;
      grPct = (gr.psa10Pct ?? gr.universalGemsPct) ?? null;
      grUniversal = gr.psa10Pct == null && gr.universalGemsPct != null;
    }

    const evCls = card.metrics.ev >= 0 ? evPos : evNeg;
    const roiCls = card.metrics.roiPct >= 0 ? evPos : evNeg;

    const rawPriceClass = isLight ? 'text-slate-900' : 'text-white';

    const cross = extractCrossGraders(card.allPrices, card.raw, card.psa10);
    const bgsRow = cross.find((x) => x.company === 'BGS');
    const cgcRow = cross.find((x) => x.company === 'CGC');

    return (
      <div
        ref={ref}
        className="relative rounded-[28px] overflow-hidden shadow-2xl antialiased"
        style={{
          width: W,
          height: H,
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
        }}
      >
        {/* Soft blurred card backdrop */}
        {card.localImage ? (
          <>
            <img
              src={resolveServerUrl(card.localImage)}
              alt=""
              className="absolute inset-0 w-[118%] h-[118%] -left-[9%] -top-[9%] object-cover scale-110 blur-3xl opacity-[0.55] pointer-events-none"
            />
            <div
              className="absolute inset-0 pointer-events-none"
              style={{ background: theme.overlay }}
            />
            <div
              className="absolute inset-0 pointer-events-none bg-gradient-to-b from-black/25 via-transparent to-black/65"
              aria-hidden
            />
          </>
        ) : (
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ background: theme.fallbackBg }}
          />
        )}

        <div
          className="relative z-10 h-full flex flex-col px-5 pt-5 pb-4 box-border text-slate-100"
          style={{ color: isLight ? '#0f172a' : '#f8fafc' }}
        >
          <div className="flex items-center justify-between gap-2 mb-3 shrink-0">
            <p className={`text-[10px] font-black uppercase tracking-[0.22em] ${theme.headerClass}`}>
              Raw Investor
            </p>
            <p className={`text-[9px] font-semibold ${sub}`}>Master list</p>
          </div>

          <div className="flex gap-3 flex-1 min-h-0">
            <div
              className={`w-[198px] shrink-0 rounded-2xl overflow-hidden self-start ring-2 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.65)] ${
                isLight ? 'ring-amber-900/20' : 'ring-white/10'
              }`}
              style={{ aspectRatio: '100 / 140' }}
            >
              {card.localImage ? (
                <img src={resolveServerUrl(card.localImage)} alt="" className="w-full h-full object-cover object-center" />
              ) : (
                <div
                  className={`w-full h-full flex items-center justify-center text-4xl font-black ${
                    isLight ? 'bg-amber-100 text-amber-300' : 'bg-slate-800 text-slate-600'
                  }`}
                >
                  ?
                </div>
              )}
            </div>

            <div className="flex-1 min-w-0 flex flex-col gap-1.5 overflow-hidden">
              <div className="shrink-0">
                <h2 className={`text-[16px] font-black leading-snug line-clamp-3 tracking-tight ${titleMain}`}>
                  {card.name}
                </h2>
                <p className={`text-[10px] font-bold uppercase tracking-[0.12em] mt-1 line-clamp-2 ${sub}`}>
                  {(card.set || '').trim() || '—'}
                  {card.rarity ? (
                    <span className="font-semibold normal-case tracking-normal opacity-80">
                      {' '}
                      · {card.rarity}
                    </span>
                  ) : null}
                </p>
                {collectionName ? (
                  <p
                    className={`text-[9px] font-bold mt-0.5 truncate ${
                      isLight ? 'text-violet-800' : 'text-violet-300/95'
                    }`}
                  >
                    Collection · {collectionName}
                  </p>
                ) : null}
              </div>

              <div className="grid grid-cols-2 gap-1.5 shrink-0 mt-0.5">
                <div
                  className={`rounded-xl px-2 py-2.5 text-center border ${theme.rawPc.border}`}
                  style={{
                    background: theme.rawPc.bg,
                    boxShadow: theme.rawPc.glow,
                  }}
                >
                  <BrandLogoImg
                    brand="pricecharting"
                    className="h-[26px] w-auto max-w-[5.25rem] mx-auto object-contain mb-1"
                    title="PriceCharting"
                  />
                  <p className={`text-[7px] font-black uppercase tracking-[0.15em] mb-0.5 ${theme.rawPc.labelClass}`}>
                    Raw
                  </p>
                  <p className={`text-[24px] font-black tabular-nums leading-none tracking-tight ${rawPriceClass}`}>
                    {fmtMoney(card.raw)}
                  </p>
                </div>
                <div
                  className={`rounded-xl px-2 py-2.5 text-center border ${theme.rawTcg.border}`}
                  style={{
                    background: theme.rawTcg.bg,
                    boxShadow: theme.rawTcg.glow,
                  }}
                >
                  <BrandLogoImg
                    brand="tcgplayer"
                    className="h-[26px] w-auto max-w-[5.25rem] mx-auto object-contain mb-1"
                    title="TCGplayer"
                  />
                  <p className={`text-[7px] font-black uppercase tracking-[0.15em] mb-0.5 ${theme.rawTcg.labelClass}`}>
                    Market
                  </p>
                  <p
                    className={`text-[24px] font-black tabular-nums leading-none tracking-tight ${
                      hasTcg ? (isLight ? 'text-sky-900' : 'text-sky-100') : isLight ? 'text-slate-400' : 'text-slate-500'
                    }`}
                  >
                    {hasTcg ? fmtMoney(tcg) : '—'}
                  </p>
                </div>
              </div>

              <div
                className={`flex items-center justify-between gap-2 rounded-lg border px-2 py-1 shrink-0 ${theme.deltaBar}`}
              >
                <span className={`text-[9px] font-bold uppercase tracking-wider ${lbl}`}>PC raw Δ</span>
                <span className={`text-[12px] font-mono font-black tabular-nums ${trendCls}`}>{trendStr}</span>
              </div>

              {/* GemRate — prominent */}
              <div
                className={`rounded-xl px-2 py-2.5 shrink-0 border text-center ${theme.gemRate.border}`}
                style={{
                  background: theme.gemRate.bg,
                  boxShadow: theme.gemRate.glow,
                }}
              >
                <div className="flex justify-center mb-1.5 px-1" style={{ isolation: 'isolate' }}>
                  <BrandLogoImg
                    brand="gemrate"
                    className="h-12 w-auto max-w-[min(220px,94%)] object-contain object-center mix-blend-screen opacity-[0.98]"
                    title="GemRate"
                  />
                </div>
                <p className={`text-[8px] font-black uppercase tracking-[0.18em] mb-0.5 ${theme.gemRate.captionClass}`}>
                  {grUniversal ? 'Universal Gems+ rate' : 'PSA 10 share · population'}
                </p>
                <p
                  className={`text-[34px] font-black tabular-nums leading-none tracking-tight ${theme.gemRate.pctClass}`}
                  style={{ textShadow: isLight ? 'none' : '0 2px 24px rgba(0,0,0,0.35)' }}
                >
                  {grHas && grPct != null ? `${grPct.toFixed(1)}%` : '—'}
                </p>
                <p className={`text-[8px] font-semibold mt-1 leading-tight ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
                  {grUniversal
                    ? 'GemRate · Universal Gems+ when PSA pop unknown'
                    : grHas
                      ? 'GemRate · graded population data'
                      : 'Link GemRate ID in the app to load this stat'}
                </p>
              </div>

              <div className={`mt-0.5 pt-2 border-t flex-1 min-h-0 overflow-hidden flex flex-col ${theme.dividerClass}`}>
                <p className={`text-[8px] font-black uppercase tracking-[0.2em] mb-1.5 ${lbl}`}>Graded market</p>
                <div className="grid grid-cols-2 gap-1.5 shrink-0 mb-2">
                  <GradeMarketTile
                    brand="psa"
                    title="PSA 9"
                    priceStr={fmtMoney(card.grade9)}
                    isLight={isLight}
                  />
                  <GradeMarketTile
                    brand="psa"
                    title="PSA 10"
                    priceStr={fmtMoney(card.psa10)}
                    isLight={isLight}
                  />
                  <GradeMarketTile
                    brand="beckett"
                    title="BGS"
                    subtitle={bgsRow?.label}
                    priceStr={bgsRow ? fmtMoney(bgsRow.price) : '—'}
                    isLight={isLight}
                  />
                  <GradeMarketTile
                    brand="cgc"
                    title="CGC"
                    subtitle={cgcRow?.label}
                    priceStr={cgcRow ? fmtMoney(cgcRow.price) : '—'}
                    isLight={isLight}
                  />
                </div>
                <Row
                  label="P10 / P9"
                  value={`${card.p10.toFixed(2)} / ${card.p9.toFixed(2)}`}
                  labelClass={lbl}
                  valueClass={val}
                />
                <Row label="EV" value={fmtMoney(card.metrics.ev)} labelClass={lbl} valueClass={evCls} />
                <Row label="ROI" value={fmtPct(card.metrics.roiPct)} labelClass={lbl} valueClass={roiCls} />
              </div>
            </div>
          </div>

          <p
            className={`text-[9px] text-center mt-2 pt-2 border-t shrink-0 leading-relaxed ${
              isLight ? 'text-slate-500 border-amber-200/70' : 'text-slate-500 border-slate-700/50'
            }`}
          >
            Powered by <span className={`font-black ${isLight ? 'text-slate-700' : 'text-slate-400'}`}>RawGraded</span>
            <span className={isLight ? 'text-slate-400' : 'text-slate-600'}> · </span>
            For sharing — not financial advice
          </p>
        </div>
      </div>
    );
  }
);

CardShareGraphicTemplate.displayName = 'CardShareGraphicTemplate';

function shareFilename(card: EnrichedCard, themeId: ShareGraphicThemeId): string {
  const s = card.name
    .replace(/[^\w\s-]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 40);
  return `raw-investor-${s || 'card'}-${themeId}`;
}

export const MasterListShareButton = ({
  card,
  collectionName,
}: {
  card: EnrichedCard;
  collectionName?: string | null;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [themeId, setThemeId] = useState<ShareGraphicThemeId>('dark');

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const download = async () => {
    const el = ref.current;
    if (!el || busy) return;
    setBusy(true);
    try {
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      const { toPng } = await import('html-to-image');
      const theme = SHARE_GRAPHIC_THEMES[themeId];
      const dataUrl = await toPng(el, {
        pixelRatio: 2,
        cacheBust: true,
        backgroundColor: theme.exportBg,
      });
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `${shareFilename(card, themeId)}.png`;
      a.rel = 'noopener';
      a.click();
      setOpen(false);
    } catch (err) {
      console.error(err);
      window.alert(
        'Could not create the image. If this keeps happening, try a card with a locally saved image or refresh the page.'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative inline-flex" ref={wrapRef}>
      <div className="fixed left-[-12000px] top-0 pointer-events-none overflow-hidden -z-10" aria-hidden>
        <CardShareGraphicTemplate
          ref={ref}
          card={card}
          collectionName={collectionName}
          themeId={themeId}
        />
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        disabled={busy}
        className="p-2 text-slate-300 hover:text-violet-500 transition-colors bg-white rounded-lg border border-transparent hover:border-violet-100 hover:shadow-sm disabled:opacity-40"
        title="Share graphic — choose theme & download PNG"
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : <ImagePlus size={16} />}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full z-[100] mt-1 w-[min(18rem,calc(100vw-2rem))] rounded-2xl border border-slate-200 bg-white shadow-xl p-3 text-left"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Theme</p>
          <div className="grid grid-cols-4 gap-1.5 mb-3">
            {SHARE_GRAPHIC_THEME_IDS.map((id) => {
              const t = SHARE_GRAPHIC_THEMES[id];
              const active = themeId === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setThemeId(id)}
                  className={`rounded-lg px-1.5 py-2 text-[9px] font-bold leading-tight border transition-all ${
                    active
                      ? 'border-violet-500 bg-violet-50 text-violet-900 ring-2 ring-violet-300/60'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                  }`}
                >
                  <span
                    className="block h-2 w-full rounded mb-1"
                    style={{ background: t.fallbackBg }}
                  />
                  {t.label}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void download();
            }}
            disabled={busy}
            className="w-full py-2.5 rounded-xl bg-slate-900 text-white text-xs font-black uppercase tracking-widest hover:bg-slate-800 disabled:opacity-50"
          >
            {busy ? 'Rendering…' : 'Download PNG'}
          </button>
        </div>
      )}
    </div>
  );
};
