/** Dismissible preflight before deep Quick Fetch (eBay / TCG automation). */

export type QuickFetchPreflightKind = 'signed-out' | 'generic';

type Props = {
  open: boolean;
  kind: QuickFetchPreflightKind;
  onContinue: () => void;
  onStop: () => void;
  onDontShowAgain: () => void;
};

export const QuickFetchMarketplacePreflight = ({
  open,
  kind,
  onContinue,
  onStop,
  onDontShowAgain,
}: Props) => {
  if (!open) return null;

  const title =
    kind === 'signed-out'
      ? 'eBay looks signed out in Raw Investor'
      : 'Full Quick Fetch uses marketplace automation';

  const body =
    kind === 'signed-out' ? (
      <>
        <p className="text-sm text-slate-700 leading-relaxed">
          Full Quick Fetch can hit login walls and automation may click the wrong control (for example a
          sign-in link instead of &ldquo;load more&rdquo;).
        </p>
        <p className="text-sm text-slate-600 mt-2 leading-relaxed">
          Use Arsenal &rarr; Open eBay sign-in (and sign in to TCGPlayer in a Capture tab if you use TCG
          data), then run Quick Fetch again. You can still try anyway.
        </p>
      </>
    ) : (
      <>
        <p className="text-sm text-slate-700 leading-relaxed">
          Deep runs automate eBay sold search and (when applicable) TCGPlayer. You should already be signed
          in inside Raw Investor&rsquo;s embedded browser.
        </p>
        <p className="text-sm text-slate-600 mt-2 leading-relaxed">
          Tip: Arsenal &rarr; Open eBay sign-in; Capture menu for marketplace tabs.
        </p>
      </>
    );

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="qf-preflight-title"
    >
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-xl p-5 space-y-4">
        <h2 id="qf-preflight-title" className="text-base font-bold text-slate-900">
          {title}
        </h2>
        {body}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end pt-2">
          <button
            type="button"
            className="order-3 sm:order-1 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 rounded-lg border border-transparent"
            onClick={onDontShowAgain}
          >
            Don&rsquo;t show again
          </button>
          <button
            type="button"
            className="order-2 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 rounded-lg border border-slate-200"
            onClick={onStop}
          >
            Stop
          </button>
          <button
            type="button"
            className="order-1 sm:order-3 px-4 py-2 text-sm font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg"
            onClick={onContinue}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
};
