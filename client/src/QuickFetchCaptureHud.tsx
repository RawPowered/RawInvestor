import { useEffect, useState } from 'react';
import { tailTextToHudLines } from './utils/captureLogTicker';

type CaptureLogApi = {
  readTail?: (n?: number) => Promise<string>;
};

function getCaptureLogApi(): CaptureLogApi | null {
  if (typeof window === 'undefined') return null;
  const w = window as Window & { rawEngine?: { captureLog?: CaptureLogApi } };
  return w.rawEngine?.captureLog ?? null;
}

type Props = {
  active: boolean;
  phase: string;
  progressPct: number | null;
  targetSummary: string | null;
  stage?: 'capturing' | 'refreshing' | 'idle';
};

export const QuickFetchCaptureHud = ({
  active,
  phase,
  progressPct,
  targetSummary,
  stage = 'capturing',
}: Props) => {
  const [lines, setLines] = useState<string[]>([]);
  const [rotateIx, setRotateIx] = useState(0);
  const [logOk, setLogOk] = useState(false);

  useEffect(() => {
    if (!active) {
      setLines([]);
      setRotateIx(0);
      setLogOk(false);
      return;
    }
    const cap = getCaptureLogApi();
    if (!cap?.readTail) {
      setLogOk(false);
      return;
    }
    setLogOk(true);
    let cancelled = false;
    const poll = async () => {
      try {
        const tail = await cap.readTail!(80);
        if (cancelled) return;
        const next = tailTextToHudLines(tail, 14);
        if (next.length) {
          setLines(next);
          setRotateIx(Math.max(0, next.length - 1));
        }
      } catch {
        /* ignore */
      }
    };
    void poll();
    const id = setInterval(() => void poll(), 480);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [active]);

  useEffect(() => {
    if (!active || lines.length < 2) return;
    const id = setInterval(() => {
      setRotateIx((i) => (i + 1) % lines.length);
    }, 1100);
    return () => clearInterval(id);
  }, [active, lines.length]);

  if (!active) return null;

  const pct = typeof progressPct === 'number' && Number.isFinite(progressPct) ? progressPct : 0;
  const headline = lines.length ? lines[Math.min(rotateIx, lines.length - 1)] : '';
  const recent = lines.slice(-5);
  const refreshing = stage === 'refreshing';

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-[200] pointer-events-none"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="pointer-events-auto mx-auto max-w-4xl px-3 pb-3 md:px-4 md:pb-4">
        <div className="rounded-t-2xl border border-slate-600/80 bg-slate-950/95 text-slate-100 shadow-2xl backdrop-blur-sm overflow-hidden">
          <div className="px-3 py-2 border-b border-slate-700/80 flex flex-wrap items-center gap-2 gap-y-1">
            <span className="text-[10px] font-black uppercase tracking-[0.14em] text-emerald-400/90">
              Quick fetch
            </span>
            {targetSummary ? (
              <span className="text-[11px] font-semibold text-slate-300 truncate max-w-[min(100%,28rem)]">
                {targetSummary}
              </span>
            ) : null}
            <span className="text-[10px] font-mono text-slate-500 ml-auto tabular-nums">{pct}%</span>
          </div>
          <div className="h-1 bg-slate-800">
            <div
              className={`h-full transition-[width] duration-300 ease-out ${refreshing ? 'bg-emerald-500 animate-pulse' : 'bg-emerald-500'}`}
              style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
            />
          </div>
          <div className="px-3 py-2 space-y-1.5">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">{phase || '…'}</p>
            {refreshing ? (
              <p className="text-[10px] text-emerald-300/95 font-medium">Charts updating in portfolio…</p>
            ) : null}
            {!logOk ? (
              <p className="text-[10px] text-amber-200/90 font-medium leading-snug">
                Live log tail needs the RawEngine desktop shell (captureLog.readTail). Phase above still updates from the client.
              </p>
            ) : (
              <>
                <div
                  className="min-h-[2.75rem] text-[11px] font-mono text-emerald-100/95 leading-snug break-words border border-slate-700/60 rounded-lg px-2 py-1.5 bg-slate-900/80 transition-opacity duration-200"
                  title={headline}
                >
                  {headline || '… waiting for log lines …'}
                </div>
                <div className="max-h-[4.5rem] overflow-y-auto space-y-0.5 pr-1">
                  {recent.map((ln, i) => (
                    <div
                      key={`${ln.slice(0, 48)}-${i}`}
                      className="text-[9px] font-mono text-slate-500 leading-tight break-words opacity-90"
                    >
                      {ln.length > 160 ? `${ln.slice(0, 159)}…` : ln}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
