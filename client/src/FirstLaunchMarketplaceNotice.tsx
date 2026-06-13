import { useEffect, useState } from 'react';
import { ExternalLink, Sparkles, X } from 'lucide-react';
import { isRawEngineShell } from './apiBase';
import { ExtensionInstallGuide } from './extension/ExtensionInstallGuide';

const STORAGE_KEY = 'pcgr:first-launch-marketplace-notice:v1';

const STEP_COUNT = 3;

type BrowserApi = {
  newTab?: (url: string) => Promise<{ ok?: boolean; id?: number | null } | boolean>;
};

function getBrowser(): BrowserApi | null {
  if (typeof window === 'undefined') return null;
  const w = window as Window & { rawEngine?: { browser?: BrowserApi } };
  return w.rawEngine?.browser ?? null;
}

const TCG_HOME = 'https://www.tcgplayer.com/';
const PC_HOME = 'https://www.pricecharting.com/';

export function FirstLaunchMarketplaceNotice({ hydrated }: { hydrated: boolean }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [tabHint, setTabHint] = useState<string | null>(null);

  useEffect(() => {
    if (!hydrated || !isRawEngineShell()) return;
    try {
      if (localStorage.getItem(STORAGE_KEY) === '1') {
        setOpen(false);
        return;
      }
      setOpen(true);
    } catch {
      setOpen(false);
    }
  }, [hydrated]);

  const dismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      /* ignore */
    }
    void (window as Window & { rawEngine?: { clearExtensionGuideMarker?: () => Promise<unknown> } })
      .rawEngine?.clearExtensionGuideMarker?.();
    setOpen(false);
    setStep(0);
    setTabHint(null);
  };

  const openMarket = async (url: string, label: string) => {
    const b = getBrowser();
    if (!b?.newTab) {
      setTabHint('Browser tabs are not available here — open the link in your system browser from Help.');
      return;
    }
    try {
      await b.newTab(url);
      setTabHint(`Opened ${label} in a new capture tab — use the tab strip at the top to switch to it and sign in.`);
    } catch (e) {
      setTabHint(e instanceof Error ? e.message : String(e));
    }
  };

  if (!open) return null;

  const goNext = () => {
    if (step >= STEP_COUNT - 1) {
      dismiss();
      return;
    }
    setStep((s) => Math.min(STEP_COUNT - 1, s + 1));
  };

  const goBack = () => {
    setStep((s) => Math.max(0, s - 1));
  };

  const stepTitle = (() => {
    switch (step) {
      case 0:
        return 'Edge capture (one-time)';
      case 1:
        return 'Load the extension';
      case 2:
        return 'You are ready';
      default:
        return '';
    }
  })();

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="first-launch-marketplace-title"
    >
      <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-600/80 bg-slate-900 text-slate-100 shadow-2xl shadow-black/40">
        <button
          type="button"
          onClick={() => dismiss()}
          className="absolute top-3 right-3 p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/80 transition-colors z-10"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="p-6 pt-10">
          <div className="flex items-start gap-3 mb-3">
            <div className="mt-0.5 rounded-lg bg-emerald-500/15 p-2 text-emerald-400 shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                Step {step + 1} of {STEP_COUNT}
              </p>
              <h2
                id="first-launch-marketplace-title"
                className="text-lg font-black tracking-tight text-white"
              >
                Welcome — set up capture
              </h2>
              <p className="text-sm font-bold text-emerald-200/90 mt-0.5">{stepTitle}</p>
            </div>
          </div>

          <div className="h-1 rounded-full bg-slate-800 mb-5 overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-[width] duration-300"
              style={{ width: `${((step + 1) / STEP_COUNT) * 100}%` }}
            />
          </div>

          {step === 0 ? (
            <div className="space-y-3 text-sm text-slate-300 font-medium leading-relaxed mb-5">
              <p>
                eBay and marketplace capture works best in <span className="text-white font-bold">Microsoft Edge</span>{' '}
                with a small helper extension. Raw Investor links to it automatically while the app is running — no
                copying keys.
              </p>
              <p className="text-xs text-slate-500">
                Sold comps via Admin → eBay API is optional and separate from this capture extension.
              </p>
              <button
                type="button"
                onClick={() => dismiss()}
                className="text-xs text-slate-500 hover:text-slate-300 underline font-semibold"
              >
                Skip for now — I&apos;ll set up Edge later
              </button>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="mb-5">
              <ExtensionInstallGuide
                variant="firstRun"
                onComplete={() => setStep(2)}
                onSkip={() => dismiss()}
              />
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-4 mb-5">
              <p className="text-sm text-slate-300 font-medium leading-relaxed">
                You can capture from Edge while Raw Investor shows <strong className="text-white">Running</strong> in the
                extension popup. TCGPlayer and PriceCharting also work in the in-app browser tabs below.
              </p>
              <ul className="space-y-2 text-xs text-slate-400">
                <li>
                  <span className="text-violet-400 font-black">Quick &amp; Full fetch</span> — match{' '}
                  <strong className="text-slate-300">Quick (~100 sales)</strong> or{' '}
                  <strong className="text-slate-300">More history</strong> in the extension to in-app refresh depth.
                </li>
                <li>
                  <span className="text-amber-400 font-black">BOT_CHECK</span> on a normal tab → use{' '}
                  <strong className="text-slate-300">No challenge here</strong> in the extension popup.
                </li>
              </ul>
              <div className="flex flex-col sm:flex-row flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void openMarket(TCG_HOME, 'TCGPlayer')}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold transition-colors"
                >
                  <ExternalLink className="w-4 h-4 shrink-0" />
                  Open TCGPlayer
                </button>
                <button
                  type="button"
                  onClick={() => void openMarket(PC_HOME, 'PriceCharting')}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-sm font-bold transition-colors"
                >
                  <ExternalLink className="w-4 h-4 shrink-0" />
                  Open PriceCharting
                </button>
              </div>
            </div>
          ) : null}

          {tabHint ? (
            <p className="text-xs text-amber-200/90 bg-amber-950/40 border border-amber-800/50 rounded-lg px-3 py-2 font-medium mb-4">
              {tabHint}
            </p>
          ) : null}

          {step !== 1 ? (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2 border-t border-slate-700/80">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={step === 0}
                  onClick={goBack}
                  className="px-4 py-2 rounded-xl border border-slate-600 text-slate-300 text-sm font-bold hover:bg-slate-800/80 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={goNext}
                  className="px-4 py-2 rounded-xl bg-slate-100 text-slate-900 text-sm font-black hover:bg-white transition-colors"
                >
                  {step >= STEP_COUNT - 1 ? 'Continue to app' : 'Next'}
                </button>
              </div>
              <p className="text-[11px] text-slate-500 font-medium sm:text-right">
                Market tabs: <span className="text-slate-400">File → New browser tab</span>
              </p>
            </div>
          ) : (
            <div className="pt-2 border-t border-slate-700/80">
              <button
                type="button"
                onClick={goBack}
                className="px-4 py-2 rounded-xl border border-slate-600 text-slate-300 text-sm font-bold hover:bg-slate-800/80"
              >
                Back to intro
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
