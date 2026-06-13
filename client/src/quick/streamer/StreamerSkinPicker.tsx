import { STREAMER_SKIN_OPTIONS } from './skins/registry';
import type { StreamerSkinId } from './skins/types';

export const StreamerSkinPicker = ({
  skinId,
  onSkinIdChange,
  className = '',
  selectClassName = '',
  id,
}: {
  skinId: StreamerSkinId;
  onSkinIdChange: (id: StreamerSkinId) => void;
  className?: string;
  selectClassName?: string;
  id?: string;
}) => (
  <label className={`inline-flex flex-col gap-1 ${className}`}>
    <select
      id={id}
      value={skinId}
      onChange={(e) => onSkinIdChange(e.target.value as StreamerSkinId)}
      className={
        selectClassName ||
        'rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/50'
      }
      aria-label="Streamer mode skin"
    >
      {STREAMER_SKIN_OPTIONS.map((opt) => (
        <option key={opt.id} value={opt.id}>
          {opt.label}
        </option>
      ))}
    </select>
  </label>
);
