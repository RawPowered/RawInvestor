import type { ReactNode } from 'react';

export const INPUT_CLASS =
  'w-full bg-slate-50 p-3 rounded-xl border border-slate-200 focus:outline-blue-500 font-medium text-[13px] tracking-tight';

export const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="space-y-1">
    <label className="text-[10px] uppercase font-semibold tracking-[0.12em] text-slate-500 ml-1">{label}</label>
    {children}
  </div>
);

export const NumberInput = ({
  value,
  onChange,
  step = 0.01,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) => (
  <input
    type="number"
    step={step}
    inputMode="decimal"
    className={INPUT_CLASS}
    value={Number.isFinite(value) ? value : 0}
    onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
  />
);

export const ProbInput = ({ value, onChange }: { value: number; onChange: (v: number) => void }) => (
  <input
    type="number"
    step={0.05}
    min={0}
    max={1}
    className="w-16 bg-slate-50 px-2 py-1.5 rounded-lg border border-slate-200 focus:outline-blue-500 text-center font-semibold text-xs"
    value={value}
    onChange={(e) => onChange(Math.max(0, Math.min(1, parseFloat(e.target.value) || 0)))}
  />
);
