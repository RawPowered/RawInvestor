import { classify } from './constellation';
import type { EnrichedCard } from './sort';

export type RowSignalIcons = {
  mustGrade: boolean;
  goodCatch: boolean;
  hold: boolean;
  mustSell: boolean;
};

export type AutoBinDecision = 'sell' | 'hold' | null;

/**
 * Compact icon flags for the master list. Uses the same {@link classify}
 * tree as Nebula so rows stay consistent with the 3D view.
 */
export const computeRowSignalIcons = (card: EnrichedCard): RowSignalIcons => {
  const { category } = classify(card);
  const { ev, roiPct, totalInvested } = card.metrics;
  const raw = Number(card.raw) || 0;
  const purchase =
    typeof card.actualCost === 'number' && card.actualCost > 0
      ? card.actualCost
      : raw;

  const mustSell =
    category === 'NGMI' ||
    category === 'SELL' ||
    (ev < 0 && roiPct < -8);

  const mustGrade =
    !mustSell &&
    ev > 0 &&
    totalInvested > 0 &&
    (category === 'BUY' ||
      category === 'SLEEPER' ||
      category === 'CLIMBER' ||
      roiPct >= 22);

  const hold =
    !mustSell && !mustGrade && (category === 'HOLD' || category === 'DUD');

  const goodCatch = raw > 0 && purchase > 0 && purchase < raw * 0.9;

  return { mustGrade, goodCatch, hold, mustSell };
};

export const suggestAutoBin = (card: EnrichedCard): AutoBinDecision => {
  const { category, pacePerMonth } = classify(card);
  const icons = computeRowSignalIcons(card);
  if (icons.mustSell || category === 'SELL' || category === 'NGMI') return 'sell';
  if (icons.hold || category === 'HOLD' || category === 'DUD') return 'hold';
  if (card.metrics.roiPct <= -8 || card.metrics.ev <= -10) return 'sell';
  if (card.metrics.roiPct >= 20 && card.metrics.ev > 0 && pacePerMonth < 2) return 'hold';
  return null;
};
