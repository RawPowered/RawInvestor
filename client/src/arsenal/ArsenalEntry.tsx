import { useEffect } from 'react';
import type { Card, Fees } from '../types';
import { registerArsenalSyncBridge, unregisterArsenalSyncBridge } from './arsenalSyncBridge';
import { ArsenalWorkspace } from './ArsenalWorkspace';
import { useArsenalStore } from './useArsenalStore';

export const ArsenalEntry = ({
  cards,
  fees,
}: {
  cards: Card[];
  fees: Fees;
}) => {
  const { hunts, targets, setHunts, setTargets, syncState, rehydrateFromServer, rehydrateArsenalFromMeta } =
    useArsenalStore();

  useEffect(() => {
    registerArsenalSyncBridge({
      getSnapshot: () => ({ hunts, targets }),
      applyPatch: (patch) => {
        if (patch.hunts) setHunts(patch.hunts);
        if (patch.targets) setTargets(patch.targets);
      },
      rehydrateFromServer,
    });
    return () => unregisterArsenalSyncBridge();
  }, [hunts, targets, setHunts, setTargets, rehydrateFromServer]);

  useEffect(() => {
    const watchAny = targets.some((t) => (t.armed && t.sniperEnabled) || t.liveWatch === true);
    if (!watchAny || targets.length === 0) return;
    const id = window.setInterval(() => void rehydrateArsenalFromMeta(), 8500);
    return () => window.clearInterval(id);
  }, [targets, rehydrateArsenalFromMeta]);

  return (
    <ArsenalWorkspace
      cards={cards}
      fees={fees}
      hunts={hunts}
      targets={targets}
      onHuntsChange={setHunts}
      onTargetsChange={setTargets}
      syncState={syncState}
    />
  );
};

