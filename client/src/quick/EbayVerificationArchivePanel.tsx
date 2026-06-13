import type { Card, EbayVerificationArchiveEntry } from '../types';
import { ebayListingSaleKey } from '../ebayStamp';

type Props = {
  card: Card;
  onFieldChange: <K extends keyof Card>(id: string, key: K, value: Card[K]) => void;
};

export function EbayVerificationArchivePanel({ card, onFieldChange }: Props) {
  const rows = card.ebayVerificationArchive ?? [];

  const restore = (entry: EbayVerificationArchiveEntry) => {
    const k = ebayListingSaleKey(entry.listing);
    const nextArch = (card.ebayVerificationArchive ?? []).filter(
      (e) => !(e.archivedAt === entry.archivedAt && ebayListingSaleKey(e.listing) === k)
    );
    const nextKeys = (card.ebayArchivedSaleKeys ?? []).filter((x) => x !== k);
    const listings = [...(card.ebayExtensionSnapshot?.listings ?? []), entry.listing];
    const base = card.ebayExtensionSnapshot;
    if (base) {
      onFieldChange(card.id, 'ebayExtensionSnapshot', {
        ...base,
        listings,
        rowCount: listings.length,
      });
    }
    onFieldChange(card.id, 'ebayVerificationArchive', nextArch);
    onFieldChange(card.id, 'ebayArchivedSaleKeys', nextKeys);
  };

  if (!rows.length) {
    return (
      <p className="text-sm text-slate-600 leading-relaxed">
        No archived comps. After Quick Fetch, high RAW outliers that fail automated listing-title
        verification are moved here (still excluded from KPIs via archived keys). Use Restore to put a
        row back into the live eBay snapshot.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-slate-500 font-medium">
        {rows.length} archived entr{rows.length === 1 ? 'y' : 'ies'} · Restore returns the listing to
        eBay comps and removes it from this list.
      </p>
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 overflow-hidden">
        {rows.map((e) => (
          <li
            key={`${e.archivedAt}-${e.listing.itemId ?? ebayListingSaleKey(e.listing)}`}
            className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 bg-slate-50/50 px-3 py-2.5"
          >
            <div className="min-w-0 space-y-1">
              <div className="text-sm font-semibold text-slate-900 line-clamp-2">{e.listing.title}</div>
              <div className="text-[11px] text-rose-700 font-medium">{e.reason}</div>
              <div className="text-[11px] text-slate-500">
                ${typeof e.listing.price === 'number' ? e.listing.price.toFixed(2) : '—'} · item{' '}
                {e.listing.itemId ?? '—'}
              </div>
            </div>
            <button
              type="button"
              onClick={() => restore(e)}
              className="shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest border border-slate-200 bg-white hover:bg-slate-50 text-slate-800"
            >
              Restore
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
