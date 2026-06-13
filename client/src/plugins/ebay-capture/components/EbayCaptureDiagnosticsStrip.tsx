import type { EbayCaptureDiagnostics } from '../types';

export type EbayCaptureDiagnosticsStripProps = {
  phase?: string | null;
  busy?: boolean;
  stats?: EbayCaptureDiagnostics | null;
};

export function EbayCaptureDiagnosticsStrip({ phase, busy, stats }: EbayCaptureDiagnosticsStripProps) {
  if (!phase && !stats) return null;

  const lines: string[] = [];
  if (stats?.pagesScanned != null) lines.push(`pages ${stats.pagesScanned}`);
  if (stats?.ebayDeepFetchConcurrency != null) {
    lines.push(`deep conc ${stats.ebayDeepFetchConcurrency}`);
    if (
      stats.ebayDeepFetchConcurrencyInitial != null &&
      stats.ebayDeepFetchConcurrencyInitial !== stats.ebayDeepFetchConcurrency
    ) {
      lines.push(`(started ${stats.ebayDeepFetchConcurrencyInitial})`);
    }
  }
  if (stats?.ebayDeepFetchPhaseMs != null) {
    lines.push(`deep phase ${(stats.ebayDeepFetchPhaseMs / 1000).toFixed(1)}s`);
  }
  if (stats?.ebayDeepAdaptiveConcurrencyReduced) lines.push('adaptive: lowered concurrency');
  if (stats?.parallelDual) lines.push('parallel dual lanes');

  return (
    <div
      className="basis-full w-full text-[10px] font-mono text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 space-y-0.5"
      data-plugin-id="ebay-capture-diagnostics"
    >
      {phase ? (
        <p className="text-[11px] text-slate-800">
          {busy ? '… ' : ''}
          {phase}
        </p>
      ) : null}
      {lines.length > 0 ? <p>{lines.join(' · ')}</p> : null}
    </div>
  );
}
