import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiUrl, buildApiHeaders } from '../apiBase';
import { loadFromServer, loadPortfolioMetaFromServer } from '../serverSync';
import type { Hunt, Target } from '../types';

const STORAGE_KEY_HUNTS = 'pcgr:hunts:v1';
const STORAGE_KEY_TARGETS = 'pcgr:targets:v1';

const safeParseArray = <T,>(raw: string | null): T[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
};

const loadLocalHunts = (): Hunt[] => safeParseArray<Hunt>(localStorage.getItem(STORAGE_KEY_HUNTS));
const loadLocalTargets = (): Target[] =>
  safeParseArray<Target>(localStorage.getItem(STORAGE_KEY_TARGETS));

const saveLocal = (hunts: Hunt[], targets: Target[]) => {
  try {
    localStorage.setItem(STORAGE_KEY_HUNTS, JSON.stringify(hunts));
    localStorage.setItem(STORAGE_KEY_TARGETS, JSON.stringify(targets));
  } catch {
    // local persistence best-effort
  }
};

const saveToServer = async (hunts: Hunt[], targets: Target[]): Promise<boolean> => {
  try {
    const r = await fetch(apiUrl('/api/store'), {
      method: 'PUT',
      headers: buildApiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ hunts, targets }),
    });
    if (!r.ok) return false;
    return true;
  } catch {
    return false;
  }
};

export const useArsenalStore = () => {
  const [hunts, setHunts] = useState<Hunt[]>(() => {
    try {
      return loadLocalHunts();
    } catch {
      return [];
    }
  });
  const [targets, setTargets] = useState<Target[]>(() => {
    try {
      return loadLocalTargets();
    } catch {
      return [];
    }
  });

  const [syncState, setSyncState] = useState<'idle' | 'syncing' | 'saved' | 'offline'>('idle');
  const writeTimer = useRef<number | null>(null);

  const rehydrateFromServer = useCallback(async () => {
    const doc = await loadFromServer();
    if (doc && doc.updatedAt && doc.updatedAt > 0) {
      if (Array.isArray((doc as { hunts?: Hunt[] }).hunts)) {
        setHunts((doc as { hunts: Hunt[] }).hunts);
      }
      if (Array.isArray((doc as { targets?: Target[] }).targets)) {
        setTargets((doc as { targets: Target[] }).targets);
      }
    }
  }, []);

  /** Merge hunts/targets from portfolio meta when server row is newer (RawEngine watch PATCH). */
  const rehydrateArsenalFromMeta = useCallback(async () => {
    const doc = await loadPortfolioMetaFromServer();
    if (!doc || !(doc.updatedAt && doc.updatedAt > 0)) return;
    const incomingHunts = (doc as { hunts?: Hunt[] }).hunts;
    if (Array.isArray(incomingHunts)) {
      setHunts((prev) => {
        if (!incomingHunts.length) return prev;
        if (!prev.length) return incomingHunts;
        return prev.map((local) => {
          const s = incomingHunts.find((x) => x.id === local.id);
          if (!s) return local;
          if ((s.updatedAt ?? 0) > (local.updatedAt ?? 0)) return { ...local, ...s };
          return local;
        });
      });
    }
    const incomingTargets = (doc as { targets?: Target[] }).targets;
    if (Array.isArray(incomingTargets)) {
      setTargets((prev) => {
        if (!incomingTargets.length) return prev;
        if (!prev.length) return incomingTargets;
        return prev.map((local) => {
          const s = incomingTargets.find((x) => x.id === local.id);
          if (!s) return local;
          if ((s.updatedAt ?? 0) > (local.updatedAt ?? 0)) return { ...local, ...s };
          return local;
        });
      });
    }
  }, []);

  // Load durable state once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const doc = await loadFromServer();
      if (cancelled) return;
      if (doc && doc.updatedAt && doc.updatedAt > 0) {
        if (Array.isArray((doc as { hunts?: Hunt[] }).hunts)) {
          setHunts((doc as { hunts: Hunt[] }).hunts);
        }
        if (Array.isArray((doc as { targets?: Target[] }).targets)) {
          setTargets((doc as { targets: Target[] }).targets);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const snapshotKey = useMemo(() => {
    // Helps avoid re-scheduling writes when state changes but serializes identically.
    // (Cheap heuristic; correctness relies on actual write payload.)
    return `${hunts.length}|${targets.length}`;
  }, [hunts, targets]);

  useEffect(() => {
    if (!snapshotKey) return;
    setSyncState((s) => (s === 'offline' ? s : 'syncing'));
    if (writeTimer.current) window.clearTimeout(writeTimer.current);
    writeTimer.current = window.setTimeout(async () => {
      saveLocal(hunts, targets);
      const ok = await saveToServer(hunts, targets);
      setSyncState(ok ? 'saved' : 'offline');
    }, 750);
    return () => {
      if (writeTimer.current) window.clearTimeout(writeTimer.current);
    };
  }, [hunts, targets, snapshotKey]);

  return { hunts, targets, setHunts, setTargets, syncState, rehydrateFromServer, rehydrateArsenalFromMeta };
};

