import { Cloud, CloudOff, Save } from 'lucide-react';
import type { SyncStatus } from './serverSync';

export const SyncBadge = ({
  status,
  lastSavedAt,
}: {
  status: SyncStatus;
  lastSavedAt: number | null;
}) => {
  const cfg = {
    idle: {
      cls: 'bg-slate-100 text-slate-500 border-slate-200',
      icon: <Cloud size={14} />,
      label: 'Storage idle',
    },
    syncing: {
      cls: 'bg-sky-50 text-sky-700 border-sky-200',
      icon: <Save size={14} className="animate-pulse" />,
      label: 'Saving...',
    },
    saved: {
      cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      icon: <Cloud size={14} />,
      label: 'Saved',
    },
    offline: {
      cls: 'bg-amber-50 text-amber-700 border-amber-200',
      icon: <CloudOff size={14} />,
      label: 'Local only',
    },
  }[status];
  const title =
    status === 'saved' && lastSavedAt
      ? `Last synced to disk at ${new Date(lastSavedAt).toLocaleTimeString()}`
      : status === 'offline'
        ? 'Server unreachable - changes are being held in this browser and will sync when the server is back.'
        : '';
  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-bold uppercase tracking-widest ${cfg.cls}`}
      title={title}
    >
      {cfg.icon}
      {cfg.label}
    </div>
  );
};
