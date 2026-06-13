import type { PullRateGuide, PullRateGuideTable, SealedPullSlot } from '../types';
import { sealedSlotId } from './sealedSlotId';

/** Parse a single cell for a probability in [0, 1]. */
export const parseProbabilityFromCell = (cell: string): number | null => {
  const s = String(cell ?? '').trim();
  if (!s) return null;
  const pct = s.match(/(\d+(?:\.\d+)?)\s*%/);
  if (pct) {
    const v = parseFloat(pct[1]);
    if (!Number.isFinite(v)) return null;
    return Math.min(1, Math.max(0, v / 100));
  }
  const oneIn = s.match(/1\s*in\s*(\d+)/i);
  if (oneIn) {
    const n = parseInt(oneIn[1], 10);
    if (n > 0) return Math.min(1, 1 / n);
  }
  const frac = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (frac) {
    const a = parseInt(frac[1], 10);
    const b = parseInt(frac[2], 10);
    if (b > 0) return Math.min(1, a / b);
  }
  return null;
};

const pickProbColumnIndex = (headers: string[], rows: string[][]): number | null => {
  const hl = headers.map((h) => String(h ?? '').toLowerCase());
  for (let i = 0; i < hl.length; i++) {
    const h = hl[i];
    if (/%|percent|pull rate|rate|odds|ratio|chance|probability/.test(h)) return i;
  }
  let bestCol = -1;
  let bestScore = 0;
  for (let c = 0; c < headers.length; c++) {
    let hits = 0;
    for (const row of rows.slice(0, 12)) {
      const cell = row[c];
      if (cell != null && parseProbabilityFromCell(String(cell)) != null) hits += 1;
    }
    if (hits > bestScore) {
      bestScore = hits;
      bestCol = c;
    }
  }
  return bestScore >= Math.min(2, rows.length) ? bestCol : null;
};

const rowLabel = (row: string[], probCol: number | null): string => {
  const cells = row.map((c) => String(c ?? '').trim()).filter(Boolean);
  if (cells.length === 0) return '—';
  if (probCol === 0 && cells.length > 1) return cells.slice(1).join(' · ').slice(0, 120) || cells[0];
  return cells[0].slice(0, 120);
};

const parseTableRows = (
  tableIndex: number,
  table: PullRateGuideTable,
  warnings: string[]
): SealedPullSlot[] => {
  const headers = table.headers ?? [];
  const rows = table.rows ?? [];
  if (rows.length === 0) return [];

  const probCol = pickProbColumnIndex(headers, rows);
  if (probCol == null) {
    warnings.push(`Table ${tableIndex + 1}: could not detect a probability column — edit odds manually.`);
  }

  const out: SealedPullSlot[] = [];
  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri];
    if (!row || row.every((c) => !String(c ?? '').trim())) continue;

    let p: number | null = null;
    if (probCol != null && probCol >= 0 && probCol < row.length) {
      p = parseProbabilityFromCell(String(row[probCol] ?? ''));
    }
    if (p == null) {
      for (let ci = 0; ci < row.length; ci++) {
        if (probCol != null && ci === probCol) continue;
        p = parseProbabilityFromCell(String(row[ci] ?? ''));
        if (p != null) break;
      }
    }

    const id = sealedSlotId(tableIndex, ri, row);
    out.push({
      slotId: id,
      tableIndex,
      rowIndex: ri,
      label: rowLabel(row, probCol),
      probability: p,
      resaleUsd: null,
    });
  }
  return out;
};

export type ParsePullRateTablesResult = {
  slots: SealedPullSlot[];
  warnings: string[];
  confidence: 'high' | 'low';
};

/** Extract per-row slots from guide tables; probabilities best-effort from % / 1-in-N / fractions. */
export const parsePullRateTables = (guide: PullRateGuide | null | undefined): ParsePullRateTablesResult => {
  const warnings: string[] = [];
  if (!guide?.tables?.length) {
    return { slots: [], warnings: ['No tables in pull rate guide.'], confidence: 'low' };
  }

  const slots: SealedPullSlot[] = [];
  guide.tables.forEach((tb, tableIndex) => {
    slots.push(...parseTableRows(tableIndex, tb, warnings));
  });

  if (slots.length === 0) {
    warnings.push('No data rows found in guide tables.');
    return { slots: [], warnings, confidence: 'low' };
  }

  const withProb = slots.filter((s) => s.probability != null);
  const sum = withProb.reduce((a, s) => a + (s.probability ?? 0), 0);
  if (withProb.length > 0 && (sum < 0.75 || sum > 1.25)) {
    warnings.push(
      `Parsed probabilities sum to ~${(sum * 100).toFixed(0)}% — normalize or edit rows if needed.`
    );
  }
  if (withProb.length < slots.length) {
    warnings.push('Some rows are missing odds — enter probability manually.');
  }

  const confidence: 'high' | 'low' =
    withProb.length >= slots.length && sum >= 0.9 && sum <= 1.1 ? 'high' : 'low';

  return { slots, warnings, confidence };
};

/** Merge freshly parsed slots with existing card slots (preserve resale; prefer parsed prob when present). */
export const mergeSealedPullSlots = (
  parsed: SealedPullSlot[],
  existing: SealedPullSlot[] | null | undefined
): SealedPullSlot[] => {
  if (!existing?.length) return parsed.map((s) => ({ ...s }));
  const byId = new Map(existing.map((s) => [s.slotId, s]));
  return parsed.map((s) => {
    const prev = byId.get(s.slotId);
    if (!prev) return { ...s };
    return {
      ...s,
      probability: s.probability != null ? s.probability : prev.probability,
      resaleUsd: prev.resaleUsd != null ? prev.resaleUsd : s.resaleUsd,
      excludeFromEv: prev.excludeFromEv,
    };
  });
};
