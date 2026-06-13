import type { PortfolioBatchCardJob } from '../types';

export type EbayBatchProgressPanelProps = {
  jobs: PortfolioBatchCardJob[];
  running: boolean;
};

export function EbayBatchProgressPanel({ jobs, running }: EbayBatchProgressPanelProps) {
  if (!jobs.length) return null;

  return (
    <div
      className="rounded-xl border border-slate-200 bg-white p-3 space-y-2"
      data-plugin-id="ebay-batch-progress"
    >
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600">
        eBay portfolio batch {running ? '(running)' : ''}
      </p>
      <ul className="space-y-1 max-h-40 overflow-y-auto">
        {jobs.map((j) => (
          <li
            key={j.cardId}
            className="flex justify-between gap-2 text-[11px] font-mono border-b border-slate-100 pb-1"
          >
            <span className="truncate text-slate-800">{j.cardName}</span>
            <span
              className={
                j.status === 'done'
                  ? 'text-emerald-700'
                  : j.status === 'error'
                    ? 'text-red-700'
                    : j.status === 'running'
                      ? 'text-amber-700'
                      : 'text-slate-500'
              }
            >
              {j.status}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
