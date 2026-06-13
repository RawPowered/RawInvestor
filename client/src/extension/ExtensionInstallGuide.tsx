import { useEffect, useState } from 'react';
import { Check, ChevronRight, Copy, ExternalLink, Loader2 } from 'lucide-react';
import {
  copyExtensionFolderPath,
  getDefaultCaptureBrowser,
  openCaptureBrowserExtensionsPage,
  prepareExtensionInstall,
} from '../apiBase';
import { DeveloperModeToggleDemo } from './DeveloperModeToggleDemo';
import { PinExtensionDemo } from './PinExtensionDemo';

const STEPS = [
  { id: 'copy', title: 'Copy to clipboard' },
  { id: 'dev', title: 'Open & enable Developer mode' },
  { id: 'load', title: 'Open location (Load unpacked)' },
  { id: 'pin', title: 'Enable & pin' },
] as const;

export function ExtensionInstallGuide({
  variant = 'firstRun',
  onComplete,
  onSkip,
}: {
  variant?: 'firstRun' | 'settings';
  onComplete?: () => void;
  onSkip?: () => void;
}) {
  const [step, setStep] = useState(0);
  const [browser, setBrowser] = useState<'edge' | 'chrome'>('edge');
  const [prepError, setPrepError] = useState<string | null>(null);
  const [prepReady, setPrepReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [browserOpened, setBrowserOpened] = useState(false);
  const [loadAck, setLoadAck] = useState(false);

  const browserLabel = browser === 'chrome' ? 'Chrome' : 'Edge';

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [prep, br] = await Promise.all([prepareExtensionInstall(), getDefaultCaptureBrowser()]);
      if (cancelled) return;
      setBrowser(br.browser);
      if (prep.ok) {
        setPrepReady(true);
        setPrepError(null);
      } else {
        setPrepError(prep.error || 'Could not prepare extension files.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const runCopy = async () => {
    setHint(null);
    setBusy(true);
    try {
      const r = await copyExtensionFolderPath();
      if (!r.ok) {
        setHint(r.error || 'Copy failed.');
        return;
      }
      setCopied(true);
      if (r.browser === 'chrome' || r.browser === 'edge') setBrowser(r.browser);
      setHint('Copied — keep this for step 3 when you pick the extension folder.');
      setStep(1);
    } finally {
      setBusy(false);
    }
  };

  const runOpenBrowser = async () => {
    setHint(null);
    setBusy(true);
    try {
      const r = await openCaptureBrowserExtensionsPage(browser);
      if (!r.ok) {
        setHint(r.error || `Could not open ${browserLabel}. Open edge://extensions or chrome://extensions manually.`);
        return;
      }
      if (r.browser === 'chrome' || r.browser === 'edge') setBrowser(r.browser);
      setBrowserOpened(true);
      setHint(`Opened ${browserLabel} extensions. Turn on Developer mode using the switch shown below.`);
    } finally {
      setBusy(false);
    }
  };

  const canNext = () => {
    if (step === 0) return copied;
    if (step === 1) return browserOpened;
    if (step === 2) return loadAck;
    return true;
  };

  const goNext = () => {
    setHint(null);
    if (step >= STEPS.length - 1) {
      onComplete?.();
      return;
    }
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };

  const goBack = () => {
    setHint(null);
    setStep((s) => Math.max(0, s - 1));
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-1">
        {STEPS.map((s, i) => (
          <div
            key={s.id}
            className={`h-1 flex-1 rounded-full transition-colors ${
              i <= step ? 'bg-emerald-500' : 'bg-slate-700'
            }`}
            title={s.title}
          />
        ))}
      </div>

      <ol className="space-y-1">
        {STEPS.map((s, i) => (
          <li
            key={s.id}
            className={`flex items-center gap-2 text-[11px] font-semibold ${
              i === step ? 'text-emerald-300' : i < step ? 'text-slate-500' : 'text-slate-600'
            }`}
          >
            {i < step ? (
              <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            ) : (
              <span
                className={`w-4 h-4 rounded-full border flex items-center justify-center text-[9px] shrink-0 ${
                  i === step ? 'border-emerald-400 text-emerald-300' : 'border-slate-600'
                }`}
              >
                {i + 1}
              </span>
            )}
            {s.title}
          </li>
        ))}
      </ol>

      {prepError ? (
        <p className="text-xs text-amber-200/90 bg-amber-950/40 border border-amber-800/50 rounded-lg px-3 py-2">
          {prepError}
        </p>
      ) : null}

      {step === 0 ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-300 leading-relaxed">
            Copy the extension folder path to your clipboard. You will paste it in step 3 — we will not open File
            Explorer for you.
          </p>
          <button
            type="button"
            disabled={!prepReady || busy}
            onClick={() => void runCopy()}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-black uppercase tracking-wider"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Copy className="w-4 h-4" />}
            {busy ? 'Copying…' : 'Copy extension folder'}
          </button>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-300 leading-relaxed">
            Open <strong className="text-white">{browserLabel}</strong> on the extensions page, then turn on{' '}
            <strong className="text-white">Developer mode</strong>.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void runOpenBrowser()}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-sm font-black uppercase tracking-wider"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
            {busy ? 'Opening…' : `Open ${browserLabel} extensions`}
          </button>
          <DeveloperModeToggleDemo active animate />
        </div>
      ) : null}

      {step === 2 ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-300 leading-relaxed">
            With Developer mode on, click <strong className="text-white">Load unpacked</strong>. In the folder window:
          </p>
          <ol className="list-decimal pl-5 text-xs text-slate-400 space-y-1.5">
            <li>
              Press <kbd className="px-1 py-0.5 rounded bg-slate-800 border border-slate-600 font-mono text-[10px]">Ctrl+L</kbd>{' '}
              to focus the path bar
            </li>
            <li>
              Press <kbd className="px-1 py-0.5 rounded bg-slate-800 border border-slate-600 font-mono text-[10px]">Ctrl+V</kbd>{' '}
              to paste the path you copied in step 1
            </li>
            <li>
              Press <kbd className="px-1 py-0.5 rounded bg-slate-800 border border-slate-600 font-mono text-[10px]">Enter</kbd>{' '}
              and choose the folder
            </li>
          </ol>
          <label className="flex items-start gap-2 text-xs text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={loadAck}
              onChange={(e) => setLoadAck(e.target.checked)}
              className="mt-0.5 rounded border-slate-500"
            />
            <span>I loaded the extension from the pasted folder</span>
          </label>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-300 leading-relaxed">
            Turn the extension on and pin it so capture is one click away.
          </p>
          <PinExtensionDemo />
        </div>
      ) : null}

      {hint ? (
        <p className="text-xs text-amber-200/90 bg-amber-950/40 border border-amber-800/50 rounded-lg px-3 py-2 font-medium">
          {hint}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-700/80">
        <div className="flex gap-2">
          <button
            type="button"
            disabled={step === 0}
            onClick={goBack}
            className="px-3 py-2 rounded-xl border border-slate-600 text-slate-300 text-sm font-bold hover:bg-slate-800/80 disabled:opacity-40"
          >
            Back
          </button>
          <button
            type="button"
            disabled={!canNext()}
            onClick={goNext}
            className="inline-flex items-center gap-1 px-4 py-2 rounded-xl bg-slate-100 text-slate-900 text-sm font-black hover:bg-white disabled:opacity-40"
          >
            {step >= STEPS.length - 1 ? (variant === 'firstRun' ? 'Continue' : 'Done') : 'Next'}
            {step < STEPS.length - 1 ? <ChevronRight className="w-4 h-4" /> : null}
          </button>
        </div>
        {onSkip ? (
          <button
            type="button"
            onClick={onSkip}
            className="text-xs text-slate-500 hover:text-slate-300 underline font-semibold"
          >
            Skip setup
          </button>
        ) : null}
      </div>
    </div>
  );
}
