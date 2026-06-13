import { useMemo, useState } from 'react';
import { FolderHeart, FolderPlus, Trash2, X } from 'lucide-react';
import type { Card, Collection } from '../types';

export const CollectionManager = ({
  collections,
  cards,
  onCreate,
  onUpdate,
  onDelete,
  onClose,
  palette,
}: {
  collections: Collection[];
  cards: Card[];
  onCreate: (name: string, color: string) => string;
  onUpdate: (id: string, patch: Partial<Collection>) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  palette: string[];
}) => {
  const [name, setName] = useState('');
  const [color, setColor] = useState(palette[0]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate(trimmed, color);
    setName('');
    setColor(palette[(palette.indexOf(color) + 1) % palette.length]);
  };

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cards) {
      if (!c.collectionId) continue;
      m.set(c.collectionId, (m.get(c.collectionId) ?? 0) + 1);
    }
    return m;
  }, [cards]);

  return (
    <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-black text-slate-800 uppercase tracking-widest text-sm flex items-center gap-2">
          <FolderHeart size={16} /> Monitored Collections
        </h3>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
          <X size={18} />
        </button>
      </div>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3 mb-5 pb-5 border-b border-slate-100">
        <div className="flex-1 min-w-[220px]">
          <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">New collection name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Surging Sparks Binder" className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-300" />
        </div>
        <div>
          <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Color</label>
          <div className="flex gap-1">
            {palette.map((c) => (
              <button key={c} type="button" onClick={() => setColor(c)} className={`h-7 w-7 rounded-full border-2 transition-all ${color === c ? 'border-slate-900 scale-110' : 'border-transparent'}`} style={{ backgroundColor: c }} aria-label={`Pick color ${c}`} />
            ))}
          </div>
        </div>
        <button type="submit" disabled={!name.trim()} className="bg-slate-900 text-white px-4 py-2 rounded-lg font-bold uppercase tracking-widest text-xs hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5">
          <FolderPlus size={14} /> Create
        </button>
      </form>
      {collections.length === 0 ? (
        <p className="text-sm text-slate-400 italic text-center py-6">No collections yet. Create one above to start grouping and monitoring cards.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {collections.map((c) => (
            <li key={c.id} className="py-3 flex items-center gap-3">
              <span className="inline-block h-3 w-3 rounded-full flex-none" style={{ backgroundColor: c.color }} />
              <input value={c.name} onChange={(e) => onUpdate(c.id, { name: e.target.value })} className="flex-1 text-sm font-bold text-slate-800 bg-transparent border-b border-transparent focus:border-slate-300 focus:outline-none px-1 py-0.5" />
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{counts.get(c.id) ?? 0} cards</span>
              <div className="flex gap-1">
                {palette.map((p) => (
                  <button key={p} type="button" onClick={() => onUpdate(c.id, { color: p })} className={`h-5 w-5 rounded-full border-2 ${c.color === p ? 'border-slate-900' : 'border-transparent'}`} style={{ backgroundColor: p }} aria-label={`Set color ${p}`} />
                ))}
              </div>
              <button onClick={() => { if (window.confirm(`Delete collection "${c.name}"? Cards will become unassigned.`)) { onDelete(c.id); } }} className="p-2 text-slate-300 hover:text-rose-500 transition-colors" title="Delete collection">
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
