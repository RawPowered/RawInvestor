import type { Fees, SealedPullSlot } from '../types';
import { fmtMoney, revenueAt } from '../math';

export type SealedEdgeQuickTag = {
  label: string;
  tone: 'neutral' | 'good' | 'bad';
  detail: string;
  kpi: string;
  /** Set when EV(open) vs sealed was computed from filled slots. */
  evOpenNet?: number;
  netSealed?: number;
  /** Sum of active-slot probabilities (0–1+); surfaced when outside ~100%. */
  probMass?: number;
};

/** Short headline + hint for Quick sealed summary (no Greek symbols / Σ notation). */
export const sealedEdgePlainSummary = (t: SealedEdgeQuickTag): { headline: string; hint: string } => {
  switch (t.label) {
    case 'No pull mapping':
      return {
        headline: 'No pull-outcome data yet',
        hint: 'Expand Advanced and fetch a TCGPlayer pull-rate article to fill in odds per rarity.',
      };
    case 'No slots in EV':
      return {
        headline: 'Nothing is counted toward “opening” yet',
        hint: 'In Advanced, include at least one slot in the worksheet or fetch a buyer’s guide.',
      };
    case 'Incomplete mapping':
      return {
        headline: 'Finish the worksheet',
        hint: 'Each checked outcome needs a pull chance (%) and a resale price.',
      };
    case 'Favor opening':
      if (typeof t.evOpenNet === 'number' && typeof t.netSealed === 'number') {
        let hint = `Rough net after fees if you open packs (weighted by odds): ${fmtMoney(t.evOpenNet)}. Selling sealed nets about ${fmtMoney(t.netSealed)}. Estimates only.`;
        if (typeof t.probMass === 'number' && (t.probMass < 0.98 || t.probMass > 1.02)) {
          hint += ` Probabilities sum to ${(t.probMass * 100).toFixed(0)}% — you can renormalize in Advanced.`;
        }
        return {
          headline: 'Opening looks better on paper',
          hint,
        };
      }
      return { headline: 'Opening looks better on paper', hint: t.detail };
    case 'Keep Sealed':
      if (typeof t.evOpenNet === 'number' && typeof t.netSealed === 'number') {
        let hint = `Selling sealed nets about ${fmtMoney(t.netSealed)}. Opening is closer to ${fmtMoney(t.evOpenNet)} after fees. Estimates only.`;
        if (typeof t.probMass === 'number' && (t.probMass < 0.98 || t.probMass > 1.02)) {
          hint += ` Probabilities sum to ${(t.probMass * 100).toFixed(0)}% — renormalize in Advanced if needed.`;
        }
        return {
          headline: 'Keeping sealed looks safer',
          hint,
        };
      }
      return { headline: 'Keeping sealed looks safer', hint: t.detail };
    default:
      return { headline: t.label, hint: t.detail };
  }
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Expected net revenue from selling a pulled card at gross price `grossUsd` (fees only, no extra basis).
 */
const netResaleFromGross = (grossUsd: number, fees: Fees): number => revenueAt(grossUsd, fees);

/**
 * Compare EV(open) — Σ p·net(resale) — to net sealed sale (sell product sealed at `raw`).
 * Equal EV → Keep Sealed (neutral).
 */
export const evaluateSealedOpenVsKeep = (
  netSealed: number,
  slots: SealedPullSlot[] | null | undefined,
  fees: Fees
): SealedEdgeQuickTag => {
  if (!slots?.length) {
    return {
      kpi: 'Sealed Edge',
      label: 'No pull mapping',
      tone: 'neutral',
      detail: 'Fetch a buyer\'s guide and enter per-row resale to compare EV(open) vs net sealed sale',
    };
  }

  const active = slots.filter((s) => !s.excludeFromEv);
  if (active.length === 0) {
    return {
      kpi: 'Sealed Edge',
      label: 'No slots in EV',
      tone: 'neutral',
      detail: 'Turn on “Include in EV” for at least one pull-rate row, or fetch a buyer\'s guide',
    };
  }

  let missingProb = false;
  let missingPrice = false;
  let probMass = 0;

  for (const s of active) {
    const hasP = s.probability != null && Number.isFinite(s.probability);
    const hasR = s.resaleUsd != null && Number.isFinite(s.resaleUsd) && s.resaleUsd >= 0;
    if (!hasP) missingProb = true;
    if (!hasR) missingPrice = true;
    if (hasP) probMass += s.probability ?? 0;
  }

  if (missingProb || missingPrice) {
    return {
      kpi: 'Sealed Edge',
      label: 'Incomplete mapping',
      tone: 'neutral',
      detail:
        'Enter probability + gross resale USD for each slot · EV(open)=Σ p×net(sale) vs net sealed',
    };
  }

  let evOpenNet = 0;
  for (const s of active) {
    const p = s.probability ?? 0;
    const g = s.resaleUsd ?? 0;
    evOpenNet += p * netResaleFromGross(g, fees);
  }
  evOpenNet = round2(evOpenNet);
  const ns = round2(netSealed);

  const sumNote =
    probMass < 0.98 || probMass > 1.02
      ? ` · Σp=${(probMass * 100).toFixed(0)}%`
      : '';

  if (evOpenNet > ns) {
    return {
      kpi: 'Sealed Edge',
      label: 'Favor opening',
      tone: 'good',
      detail: `EV(open) $${evOpenNet.toFixed(2)} > net sealed $${ns.toFixed(2)}${sumNote} · pull-weighted resale`,
      evOpenNet,
      netSealed: ns,
      probMass,
    };
  }

  return {
    kpi: 'Sealed Edge',
    label: 'Keep Sealed',
    tone: 'neutral',
    detail: `Net sealed $${ns.toFixed(2)} ≥ EV(open) $${evOpenNet.toFixed(2)}${sumNote} · EV(open)=Σ p×net(sale)`,
    evOpenNet,
    netSealed: ns,
    probMass,
  };
};
