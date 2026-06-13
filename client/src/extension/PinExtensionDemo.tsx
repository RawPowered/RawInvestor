export function PinExtensionDemo() {
  return (
    <div
      className="rounded-lg border border-slate-600 bg-slate-800/80 p-3"
      role="img"
      aria-label="Illustration: pin extension from toolbar puzzle menu"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-slate-700 text-slate-300 text-sm font-bold"
            aria-hidden
          >
            &#x1F9E9;
          </span>
          <span className="text-xs font-semibold text-slate-200">Extensions</span>
        </div>
        <div
          className="flex items-center gap-1.5 px-2 py-1 rounded-md border-2 border-emerald-400 bg-emerald-500/20 animate-pulse"
          style={{ animationDuration: '2s' }}
        >
          <span className="text-[10px] font-bold text-emerald-200 uppercase tracking-wide">Pin</span>
          <span className="text-emerald-300" aria-hidden>
            &#x1F4CC;
          </span>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 px-2 py-1.5 rounded-md bg-indigo-600/30 border border-indigo-400/50">
        <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" aria-hidden />
        <span className="text-[11px] font-semibold text-indigo-100">Raw Investor Tab Capture</span>
      </div>
      <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">
        Puzzle icon → find <strong className="text-slate-300">Raw Investor Tab Capture</strong> → Pin. Open the popup;
        it should say <strong className="text-emerald-300">Running</strong> while this app is open.
      </p>
    </div>
  );
}
