import type { SalesAnomalyPoint, TcgplayerLatestSaleRow } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

const pctDelta = (cur: number, base: number): number | null => {
  if (!Number.isFinite(cur) || !Number.isFinite(base) || base <= 0) return null;
  return ((cur - base) / base) * 100;
};

const statsForWindow = (rows: TcgplayerLatestSaleRow[], days: number, now: number) => {
  const start = now - days * DAY_MS;
  const inWin = rows.filter((r) => r.at >= start && r.at <= now);
  const qty = inWin.reduce((acc, r) => acc + (Number.isFinite(r.qty) ? r.qty : 0), 0);
  const avgPrice = inWin.length ? mean(inWin.map((r) => r.price)) : null;
  return { countRows: inWin.length, qty, avgPrice };
};

const detectWindowAnomaly = (
  window: SalesAnomalyPoint['window'],
  curQty: number,
  baseQty: number,
  curPrice: number | null,
  basePrice: number | null
): SalesAnomalyPoint[] => {
  const out: SalesAnomalyPoint[] = [];
  const qtyPct = pctDelta(curQty, baseQty);
  if (qtyPct != null) {
    if (qtyPct >= 50) out.push({ window, kind: 'volume_spike', label: `${window} sales influx`, pct: qtyPct });
    else if (qtyPct <= -40) out.push({ window, kind: 'volume_drop', label: `${window} sales drop`, pct: qtyPct });
  }
  if (curPrice != null && basePrice != null) {
    const p = pctDelta(curPrice, basePrice);
    if (p != null) {
      if (p >= 20) out.push({ window, kind: 'price_spike', label: `${window} price spike`, pct: p });
      else if (p <= -20) out.push({ window, kind: 'price_drop', label: `${window} price drop`, pct: p });
    }
  }
  return out;
};

export const buildTcgSalesAnomalies = (
  rows: TcgplayerLatestSaleRow[] | undefined,
  now = Date.now()
): SalesAnomalyPoint[] => {
  const sales = [...(rows ?? [])]
    .filter((r) => Number.isFinite(r.at) && Number.isFinite(r.qty) && Number.isFinite(r.price))
    .sort((a, b) => a.at - b.at);
  if (sales.length < 8) {
    return [{ window: 'daily', kind: 'insufficient_history', label: 'Need more sales history for anomalies', pct: null }];
  }

  const out: SalesAnomalyPoint[] = [];
  const compare = (
    label: SalesAnomalyPoint['window'],
    curDays: number,
    baseDays: number,
    baseOffsetDays: number
  ) => {
    const cur = statsForWindow(sales, curDays, now);
    const baseEnd = now - baseOffsetDays * DAY_MS;
    const base = statsForWindow(sales, baseDays, baseEnd);
    out.push(...detectWindowAnomaly(label, cur.qty, base.qty, cur.avgPrice, base.avgPrice));
  };

  compare('daily', 1, 7, 1);
  compare('weekly', 7, 28, 7);
  compare('monthly', 30, 90, 30);
  compare('yearly', 365, 365, 365);

  const allQty = sales.reduce((acc, r) => acc + r.qty, 0);
  const last90 = statsForWindow(sales, 90, now);
  const allAvg = mean(sales.map((r) => r.price));
  out.push(...detectWindowAnomaly('all_time', last90.qty, allQty / 4, last90.avgPrice, allAvg));

  return out.length
    ? out
    : [{ window: 'monthly', kind: 'insufficient_history', label: 'No strong anomaly signal yet', pct: null }];
};
