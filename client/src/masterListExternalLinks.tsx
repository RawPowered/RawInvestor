import type { Card } from './types';
import { BrandLogoImg } from './brandLogos';
import { EbayExternalLink } from './components/EbayExternalLink';
import { ensureTcgplayerNearMintUrl } from './tcgplayerRequest';

const linkBase =
  'inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-300';

const disabledWrap = 'inline-flex cursor-not-allowed items-center justify-center rounded-lg border border-slate-100 bg-slate-50 p-1.5 text-slate-300';

const linkLogoCls = 'h-[22px] w-auto max-h-[22px] max-w-[5.5rem] object-contain object-center pointer-events-none';

const ebaySearchBase = (card: Pick<Card, 'name' | 'set' | 'cardNumber'>): string => {
  const parts = [card.name, card.cardNumber, card.set].filter((s) => String(s ?? '').trim());
  const q = parts.join(' ').replace(/\s+/g, ' ').trim() || 'pokemon card';
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}`;
};

/** eBay active search from card fields (no stored eBay URL on the model). */
export const ebaySearchUrlForCard = (card: Pick<Card, 'name' | 'set' | 'cardNumber'>): string =>
  ebaySearchBase(card);

/** Active listings sorted price + shipping lowest first (matches extension eBay panel). */
export const ebayPurchaseSearchUrlForCard = (
  card: Pick<Card, 'name' | 'set' | 'cardNumber'>
): string => `${ebaySearchUrlForCard(card)}&_sop=15`;

/** eBay completed / sold listings for the same query (manual comps). */
export const ebaySoldSearchUrlForCard = (card: Pick<Card, 'name' | 'set' | 'cardNumber'>): string =>
  `${ebaySearchBase(card)}&LH_Sold=1&LH_Complete=1`;

/**
 * Same sold SERP with Graded facet in the query string so the SERP loads filtered without
 * a separate facet-click prep phase (used for Quick refresh + watermark).
 */
export const ebaySoldSearchUrlForCardWithGraded = (
  card: Pick<Card, 'name' | 'set' | 'cardNumber'>,
  graded: 'no' | 'yes'
): string => {
  const u = new URL(ebaySoldSearchUrlForCard(card));
  u.searchParams.set('Graded', graded === 'yes' ? 'Yes' : 'No');
  return u.toString();
};

/** Sold/completed SERP with search box set to a listing id (verify capture vs eBay). */
export const ebaySoldSearchUrlForItemId = (itemId: string): string | null => {
  const trimmed = String(itemId || '').trim();
  if (!trimmed || !/^\d{6,}$/.test(trimmed)) return null;
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(trimmed)}&LH_Sold=1&LH_Complete=1`;
};

/** Canonical sold listing page (item id). Prefer over generic listing URLs when opening from a comp row. */
export const ebayItmUrl = (itemId: string | null | undefined): string | null => {
  const trimmed = String(itemId ?? '').trim();
  if (!trimmed || !/^\d{6,}$/.test(trimmed)) return null;
  return `https://www.ebay.com/itm/${encodeURIComponent(trimmed)}`;
};

type EbayListingLinkRow = { itemId?: string | null; itemUrl?: string | null };

/** Numeric eBay listing id from row fields or embedded in itemUrl. */
export const resolveEbayListingItemId = (row: EbayListingLinkRow): string | null => {
  const id = String(row.itemId ?? '').trim();
  if (/^\d{6,}$/.test(id)) return id;
  const url = String(row.itemUrl ?? '').trim();
  if (!url) return null;
  const fromItm = url.match(/\/itm\/(\d{6,})/i);
  if (fromItm?.[1]) return fromItm[1];
  const fromItem = url.match(/[?&]item=(\d{6,})/i);
  if (fromItem?.[1]) return fromItem[1];
  return null;
};

/** Canonical /itm/ URL when a listing id is known; else stored itemUrl. */
export const ebayListingUrlForRow = (row: EbayListingLinkRow): string | null => {
  const fromId = ebayItmUrl(resolveEbayListingItemId(row));
  if (fromId) return fromId;
  const url = String(row.itemUrl ?? '').trim();
  return url || null;
};

export const resolveTcgplayerProductUrl = (
  card: Pick<Card, 'tcgplayerUrl' | 'tcgplayerSummary'>
): string | null => {
  const u = (card.tcgplayerUrl ?? '').trim();
  if (/^https?:\/\/(www\.)?tcgplayer\.com\/product\/\d+/i.test(u)) {
    return ensureTcgplayerNearMintUrl(u);
  }
  const s = (card.tcgplayerSummary?.url ?? '').trim();
  if (/^https?:\/\/(www\.)?tcgplayer\.com\/product\/\d+/i.test(s)) {
    return ensureTcgplayerNearMintUrl(s);
  }
  return null;
};

type LinkCard = Pick<Card, 'url' | 'name' | 'set' | 'cardNumber' | 'tcgplayerUrl' | 'tcgplayerSummary'>;

export const MasterListExternalLinks = ({ card }: { card: LinkCard }) => {
  const pc = (card.url ?? '').trim();
  const ebay = ebaySearchUrlForCard(card);
  const tcg = resolveTcgplayerProductUrl(card);

  return (
    <div className="flex flex-col items-center justify-center gap-1.5 py-0.5">
      <div className="flex items-center justify-center gap-1">
        {pc ? (
          <a
            href={pc}
            target="_blank"
            rel="noopener noreferrer"
            className={linkBase}
            title="Open on PriceCharting"
          >
            <span className="sr-only">PriceCharting</span>
            <BrandLogoImg brand="pricecharting" className={linkLogoCls} title="PriceCharting" />
          </a>
        ) : (
          <span className={disabledWrap} title="Add a PriceCharting URL (scrape or edit card)">
            <BrandLogoImg
              brand="pricecharting"
              className={`${linkLogoCls} opacity-35 grayscale`}
              title="PriceCharting"
            />
          </span>
        )}
        <EbayExternalLink href={ebay} className={linkBase} title="Search this card on eBay">
          <span className="sr-only">eBay search</span>
          <BrandLogoImg brand="ebay" className={linkLogoCls} title="eBay" />
        </EbayExternalLink>
        {tcg ? (
          <a
            href={tcg}
            target="_blank"
            rel="noopener noreferrer"
            className={linkBase}
            title="Open on TCGplayer"
          >
            <span className="sr-only">TCGplayer</span>
            <BrandLogoImg brand="tcgplayer" className="h-7 w-7 object-contain" title="TCGplayer" />
          </a>
        ) : (
          <span className={disabledWrap} title="Paste a TCGplayer product URL in the expanded row">
            <BrandLogoImg
              brand="tcgplayer"
              className="h-7 w-7 object-contain opacity-35"
              title="TCGplayer"
            />
          </span>
        )}
      </div>
    </div>
  );
};
