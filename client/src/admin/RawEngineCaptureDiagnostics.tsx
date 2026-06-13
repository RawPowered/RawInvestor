import { useCallback, useState } from 'react';
import { ClipboardCopy, FolderOpen, KeyRound, RefreshCw, Terminal } from 'lucide-react';
import { copyTextToClipboard, getRawEngineRuntime } from '../apiBase';

type CaptureLogApi = {
  append?: (entry: Record<string, unknown>) => Promise<{ ok?: boolean }>;
  openWindow?: () => Promise<{ ok?: boolean }>;
  getInfo?: () => Promise<{ path?: string }>;
  readTail?: (n?: number) => Promise<string>;
  revealFile?: () => Promise<{ ok?: boolean }>;
};

function getCaptureLogApi(): CaptureLogApi | null {
  if (typeof window === 'undefined') return null;
  const w = window as Window & { rawEngine?: { captureLog?: CaptureLogApi } };
  return w.rawEngine?.captureLog ?? null;
}

export const RawEngineCaptureDiagnostics = () => {
  const rt = getRawEngineRuntime();
  const pathFromRt = typeof rt.captureLogPath === 'string' ? rt.captureLogPath : '';
  const extTok = String(rt.extToken || '').trim();
  const cap = getCaptureLogApi();
  const [tail, setTail] = useState('');
  const [busy, setBusy] = useState(false);
  const [path, setPath] = useState(pathFromRt);
  const [tokenHint, setTokenHint] = useState<string | null>(null);

  const copyExtToken = async () => {
    setTokenHint(null);
    if (!extTok) {
      setTokenHint('Extension token is only exposed in the Raw Investor desktop shell.');
      return;
    }
    const r = await copyTextToClipboard(extTok);
    setTokenHint(r.ok ? 'Copied — paste only if extension Advanced connection needs a manual key.' : r.error || 'Copy failed.');
  };

  const refreshTail = useCallback(async () => {
    if (!cap?.readTail) return;
    setBusy(true);
    try {
      const t = await cap.readTail(280);
      setTail(t || '(empty)');
      const info = await cap.getInfo?.();
      if (info?.path) setPath(info.path);
    } finally {
      setBusy(false);
    }
  }, [cap]);

  const copyPath = () => {
    const p = path || pathFromRt;
    if (!p) return;
    void navigator.clipboard.writeText(p).catch(() => {});
  };

  if (!cap?.openWindow && !pathFromRt) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
        <h4 className="text-sm font-black uppercase tracking-[0.12em] text-slate-700">RawEngine capture log</h4>
        <p className="text-xs text-slate-600 leading-relaxed max-w-prose">
          Live capture diagnostics open in a dedicated window and append to a log file under the app profile.
          Use the <span className="font-semibold">RawEngine desktop build</span> (not the browser alone) so Quick Fetch
          and embedded browser captures write structured entries you can share when debugging.
        </p>
        <p className="text-[11px] text-slate-500 font-mono break-all">
          Typical path: …/pcgr-runtime-data/logs/rawengine-capture.log (portable) or application data folder/logs/
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {extTok ? (
        <div className="rounded-xl border border-violet-200 bg-violet-50/80 p-3 space-y-2">
          <div className="flex items-center gap-2 text-violet-950">
            <KeyRound size={16} className="shrink-0" />
            <h4 className="text-xs font-black uppercase tracking-[0.12em]">MV3 extension token</h4>
          </div>
          <p className="text-[11px] text-violet-900/90 leading-relaxed">
            Support-only: the Edge extension usually links automatically when Raw Investor is running. Use this copy
            only if the popup shows Not Running after reinstall.
          </p>
          <button
            type="button"
            onClick={() => void copyExtToken()}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-black uppercase tracking-widest bg-violet-600 text-white hover:bg-violet-500"
          >
            <ClipboardCopy size={14} />
            Copy extension token
          </button>
          {tokenHint ? <p className="text-[11px] text-violet-800 font-medium">{tokenHint}</p> : null}
        </div>
      ) : null}

      <div>
        <h4 className="text-sm font-black uppercase tracking-[0.12em] text-slate-700">
          RawEngine capture debug log
        </h4>
        <p className="text-xs text-slate-500 font-medium mt-1 max-w-prose">
          Same log as <span className="font-semibold">View → Capture control deck</span>. Attach this file when reporting
          capture failures.
        </p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-700 break-all font-mono">
        {(path || pathFromRt) || 'Path loads on refresh…'}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void cap?.openWindow?.()}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-black uppercase tracking-widest border border-slate-200 bg-white hover:bg-slate-50"
        >
          <Terminal size={14} />
          Open control deck
        </button>
        <button
          type="button"
          onClick={() => void cap?.revealFile?.()}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-black uppercase tracking-widest border border-slate-200 bg-white hover:bg-slate-50"
        >
          <FolderOpen size={14} />
          Show in folder
        </button>
        <button
          type="button"
          onClick={copyPath}
          disabled={!(path || pathFromRt)}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-black uppercase tracking-widest border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40"
        >
          <ClipboardCopy size={14} />
          Copy path
        </button>
        <button
          type="button"
          onClick={() => void refreshTail()}
          disabled={busy || !cap?.readTail}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-black uppercase tracking-widest border border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 disabled:opacity-50"
        >
          <RefreshCw size={14} className={busy ? 'animate-spin' : ''} />
          Load tail
        </button>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-[0.11em] font-bold text-slate-500 mb-1">
          Last lines (preview)
        </div>
        <pre className="text-[11px] leading-snug font-mono whitespace-pre-wrap break-all max-h-[min(360px,45vh)] overflow-auto rounded-lg border border-slate-200 bg-slate-900 text-slate-100 p-3">
          {tail || 'Click “Load tail” to preview the end of the log.'}
        </pre>
      </div>
    </div>
  );
};
