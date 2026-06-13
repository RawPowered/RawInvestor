import { ExternalLink, Trophy } from 'lucide-react';
import { BrandLogoImg } from './brandLogos';
import { EbayExternalLink } from './components/EbayExternalLink';
import { ebaySoldSearchUrlForCard, resolveTcgplayerProductUrl } from './masterListExternalLinks';
import type { EnrichedCard } from './sort';
import { resolveServerUrl } from './apiBase';
import { fmtMoney, fmtPct } from './math';
import { resolveTcgDisplayMarketPrice } from './tcgDisplayPrice';
import { entHeroTile, entMicroLabel } from './quick/enterpriseDashboardUi';

const rankStyle = (i: number): string => {
  if (i === 0) return 'ring-2 ring-amber-400 shadow-lg shadow-amber-200/40';
  if (i === 1) return 'ring-2 ring-slate-300 shadow-md shadow-slate-200/50';
  if (i === 2) return 'ring-2 ring-amber-800/50 shadow-md shadow-amber-900/10';
  return 'ring-1 ring-slate-200';
};

const Stat = ({ k, v }: { k: string; v: string }) => (
  <div className="flex justify-between gap-2 text-[11px] leading-tight">
    <span className="text-slate-500 font-semibold">{k}</span>
    <span className="font-mono font-bold text-slate-900 tabular-nums text-right">{v}</span>
  </div>
);

const fmtOptUsd = (n: unknown) =>
  typeof n === 'number' && Number.isFinite(n) ? fmtMoney(n) : '—';

const entryPoint = (card: EnrichedCard): number => {
  const paid = typeof card.actualCost === 'number' && card.actualCost > 0 ? card.actualCost : card.raw;
  const inbound = card.freeShipping ? 0 : Number(card.shippingCost) || 0;
  return paid + inbound;
};

const HeroRawPriceStrip = ({ card }: { card: EnrichedCard }) => {
  const tcgMp = resolveTcgDisplayMarketPrice(card);
  const ebaySoldUrl = ebaySoldSearchUrlForCard(card);
  const tcgHref = resolveTcgplayerProductUrl(card);
  const pcHref = (card.url ?? '').trim();

  return (
    <div className="grid grid-cols-3 gap-2">
      <div
        className={entHeroTile}
        title="TCGplayer market price from linked product summary (when loaded)."
      >
        <BrandLogoImg brand="tcgplayer" className="h-[22px] w-auto max-w-[4.5rem] mx-auto mb-1 object-contain" title="TCGplayer" />
        <div className={entMicroLabel}>Raw (market)</div>
        <div className="text-sm font-black text-slate-900 tabular-nums mt-0.5">{fmtOptUsd(tcgMp)}</div>
        {tcgHref ? (
          <a
            href={tcgHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 text-[9px] font-bold text-blue-600 hover:text-blue-800 mt-1"
          >
            Open <ExternalLink className="h-2.5 w-2.5" />
          </a>
        ) : (
          <div className="text-[9px] font-semibold text-slate-400 mt-1">No product link</div>
        )}
      </div>

      <div
        className={entHeroTile}
        title="PriceCharting ungraded / raw reference from the listing."
      >
        <BrandLogoImg brand="pricecharting" className="h-[22px] w-auto max-w-[4.5rem] mx-auto mb-1 object-contain" title="PriceCharting" />
        <div className={entMicroLabel}>Raw (PC)</div>
        <div className="text-sm font-black text-slate-900 tabular-nums mt-0.5">{fmtOptUsd(card.raw)}</div>
        {pcHref ? (
          <a
            href={pcHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 text-[9px] font-bold text-blue-600 hover:text-blue-800 mt-1"
          >
            Open <ExternalLink className="h-2.5 w-2.5" />
          </a>
        ) : null}
      </div>

      <div
        className={`${entHeroTile} flex flex-col items-center gap-1.5`}
        title="Open sold listings to verify raw comps (scraped table rows are not shown here)."
      >
        <BrandLogoImg brand="ebay" className="h-[22px] w-auto max-w-[4.5rem] mx-auto object-contain" title="eBay" />
        <div className={entMicroLabel}>Check last sold</div>
        <p className="text-[8px] font-medium text-slate-400 leading-snug px-0.5">
          Shortcuts only — no auto price
        </p>
        {pcHref ? (
          <a
            href={pcHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-1 w-full rounded-lg border border-slate-200 bg-slate-50/80 px-2 py-1.5 text-[9px] font-bold text-blue-700 hover:bg-slate-100"
          >
            <BrandLogoImg brand="pricecharting" className="h-3.5 w-auto object-contain shrink-0" title="" />
            PC sales table
            <ExternalLink className="h-2.5 w-2.5 shrink-0" />
          </a>
        ) : null}
        <EbayExternalLink
          href={ebaySoldUrl}
          className="inline-flex items-center justify-center gap-1 w-full rounded-lg border border-indigo-200 bg-indigo-50/80 px-2 py-1.5 text-[9px] font-bold text-indigo-700 hover:bg-indigo-100"
        >
          <BrandLogoImg brand="ebay" className="h-3.5 w-auto object-contain shrink-0" title="" />
          eBay sold
          <ExternalLink className="h-2.5 w-2.5 shrink-0" />
        </EbayExternalLink>
      </div>
    </div>
  );
};

export const TopWinnersHero = ({ cards }: { cards: EnrichedCard[] }) => {
  if (cards.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 py-16 text-center">
        <Trophy className="mx-auto h-10 w-10 text-slate-300 mb-3" />
        <p className="text-sm font-bold text-slate-600">No cards in view</p>
        <p className="text-xs text-slate-400 mt-1 font-medium">Add cards or widen filters to see top EV winners.</p>
      </div>
    );
  }

  const hero = cards.slice(0, 3);
  const runners = cards.slice(3, 5);

  return (
    <div className="space-y-8">
      <div>
        <p className="text-[10px] font-black uppercase tracking-widest text-amber-700/90 mb-4 flex items-center gap-2">
          <Trophy size={14} className="text-amber-500" />
          Podium · champion roster (pre-grade target + entry aware)
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 lg:gap-6">
          {hero.map((c, i) => (
            <article
              key={c.id}
              className={`rounded-2xl bg-gradient-to-b from-white to-slate-50/90 overflow-hidden flex flex-col ${rankStyle(i)}`}
            >
              <div className="relative aspect-[100/140] max-h-[280px] bg-slate-100 border-b border-slate-100">
                {c.localImage ? (
                  <img
                    src={resolveServerUrl(c.localImage)}
                    alt={c.name}
                    className="h-full w-full object-cover object-center"
                    loading="lazy"
                  />
                ) : (
                  <div className="h-full w-full flex items-center justify-center text-slate-300">
                    <Trophy className="h-16 w-16 opacity-40" />
                  </div>
                )}
                <span className="absolute top-3 left-3 rounded-full bg-slate-900/85 text-white text-[11px] font-black px-2.5 py-1 shadow-md">
                  #{i + 1}
                </span>
                {c.url ? (
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noreferrer"
                    className="absolute bottom-2 right-2 text-[10px] font-bold uppercase tracking-wider bg-white/90 hover:bg-white text-blue-700 px-2 py-1 rounded-md border border-slate-200"
                  >
                    PC
                  </a>
                ) : null}
              </div>
              <div className="p-4 flex flex-col flex-1 gap-3">
                <div>
                  <h4 className="font-black text-slate-900 text-[15px] leading-snug line-clamp-2">{c.name}</h4>
                  <p className="text-[11px] text-slate-500 font-semibold mt-1 line-clamp-1">{c.set || '—'}</p>
                </div>
                <HeroRawPriceStrip card={c} />
                <div className="space-y-1.5 border-t border-slate-100 pt-3 mt-auto">
                  <Stat k="EV" v={fmtMoney(c.metrics.ev)} />
                  <Stat k="ROI" v={fmtPct(c.metrics.roiPct)} />
                  <Stat k="Entry point" v={fmtMoney(entryPoint(c))} />
                  <Stat k="Potential value" v={fmtOptUsd(c.potentialValue)} />
                  <Stat k="PSA 10" v={fmtMoney(c.psa10)} />
                  <Stat k="Net PSA 10" v={fmtMoney(c.metrics.net10)} />
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>

      {runners.length > 0 ? (
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">
            Also in top 5
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {runners.map((c, j) => (
              <div
                key={c.id}
                className="flex gap-4 rounded-xl border border-slate-200 bg-slate-50/80 p-3 hover:bg-slate-50 transition-colors"
              >
                <div className="w-[5.5rem] h-[7.5rem] shrink-0 rounded-lg overflow-hidden bg-slate-200 border border-slate-200">
                  {c.localImage ? (
                    <img src={resolveServerUrl(c.localImage)} alt="" className="h-full w-full object-cover object-center" loading="lazy" />
                  ) : (
                    <div className="h-full w-full flex items-center justify-center text-slate-400 text-xs font-bold">
                      #{j + 4}
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1 flex flex-col justify-center gap-1">
                  <span className="text-[10px] font-black text-slate-400">#{j + 4}</span>
                  <p className="font-bold text-slate-800 text-sm leading-tight line-clamp-2">{c.name}</p>
                  <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] mt-1">
                    <span className="text-slate-500">EV</span>
                    <span className="font-mono font-bold text-emerald-700 text-right">{fmtMoney(c.metrics.ev)}</span>
                    <span className="text-slate-500">ROI</span>
                    <span className="font-mono font-bold text-slate-800 text-right">{fmtPct(c.metrics.roiPct)}</span>
                    <span className="text-slate-500">Raw</span>
                    <span className="font-mono text-slate-700 text-right">{fmtMoney(c.raw)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
};
