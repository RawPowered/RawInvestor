import type { PortfolioKindScope } from '../sort';

export const PortfolioKindScopeTabs = ({
  value,
  onChange,
  disabled = false,
}: {
  value: PortfolioKindScope;
  onChange: (next: PortfolioKindScope) => void;
  disabled?: boolean;
}) => {
  const btn = (id: PortfolioKindScope, label: string) => (
    <button
      key={id}
      type="button"
      disabled={disabled}
      onClick={() => {
        if (!disabled) onChange(id);
      }}
      className={`px-3 py-2 rounded-lg text-xs font-black uppercase tracking-widest border transition-colors ${
        disabled ? 'opacity-50 cursor-not-allowed' : ''
      } ${
        value === id
          ? 'bg-slate-900 text-white border-slate-900'
          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Portfolio kind">
      {btn('all', 'All')}
      {btn('single', 'Singles')}
      {btn('sealed', 'Sealed')}
    </div>
  );
};
