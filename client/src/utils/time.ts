export const toEpochMsLoose = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return v < 1_000_000_000_000 ? v * 1000 : v;
  }
  const raw = String(v ?? '').trim();
  if (!raw) return null;
  const asNum = Number(raw);
  if (Number.isFinite(asNum)) {
    return asNum < 1_000_000_000_000 ? asNum * 1000 : asNum;
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Short "5 min ago" style relative time for refresh timestamps. */
export const formatRelative = (ts: number): string => {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 45) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(ts).toLocaleDateString();
};

export const formatMasterListDate = (ms: number | null | undefined): string | null =>
  typeof ms === 'number' && Number.isFinite(ms) && ms > 0
    ? new Date(ms).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : null;

/** Chart/drilldown sale instant — avoids showing date-only rows as 12:00 AM (local midnight). */
export const formatMarketSaleInstant = (ms: number): string => {
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return '—';
  const h = d.getHours();
  const m = d.getMinutes();
  const s = d.getSeconds();
  const frac = d.getMilliseconds();
  if (h === 0 && m === 0 && s === 0 && frac === 0) {
    return d.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};
