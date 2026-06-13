/**
 * Shared light-enterprise dashboard primitives (Tailwind class strings).
 * Used by expanded detail tabs, signal/sales cards, hero strip, and related panels.
 */

export const entCardFrame =
  'rounded-xl border border-slate-200/90 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06)]';

export const entSection =
  `${entCardFrame} p-5 space-y-4`;

export const entTabList =
  'sticky top-0 z-20 rounded-xl border border-slate-200/90 bg-white/95 backdrop-blur-sm shadow-sm p-1.5';

/** Nested tab control (e.g. Strategy Math sub-views) — not sticky. */
export const entSubTabList =
  'inline-flex rounded-lg border border-slate-200/90 bg-slate-50/90 p-0.5 shadow-sm';

export const entTabBtnBase =
  'px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2';

export const entTabBtnActive = 'bg-slate-900 text-white shadow-sm';

export const entTabBtnIdle = 'text-slate-600 hover:text-slate-900 hover:bg-slate-50/90';

export const entKpiTile =
  'rounded-md border border-slate-200/90 bg-slate-50/90 px-3 py-2.5 shadow-sm';

export const entKpiLabel =
  'text-[10px] text-slate-500 font-semibold uppercase tracking-[0.14em] mb-1';

export const entKpiValue =
  'text-[17px] font-semibold tabular-nums tracking-tight text-slate-900 leading-none flex items-center gap-1';

export const entInsetStrip =
  'rounded-lg border border-slate-200/80 bg-slate-50/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]';

export const entHeroTile = `${entCardFrame} px-2 py-2.5 text-center`;

export const entMicroLabel = 'text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500';

export const entSectionHeading = 'text-sm font-semibold text-slate-900 tracking-tight';
