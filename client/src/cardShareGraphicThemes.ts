/**
 * Pokémon-inspired palette overlays for share PNGs (tints the blurred card backdrop).
 */
export type ShareGraphicThemeId =
  | 'psychic'
  | 'electric'
  | 'metal'
  | 'light'
  | 'dark'
  | 'grass'
  | 'fire';

export const SHARE_GRAPHIC_THEME_IDS: ShareGraphicThemeId[] = [
  'psychic',
  'electric',
  'metal',
  'light',
  'dark',
  'grass',
  'fire',
];

export type ShareGraphicTheme = {
  id: ShareGraphicThemeId;
  /** Light themes use dark text on pale overlays */
  tone: 'dark' | 'light';
  label: string;
  /** Full-bleed tint over blurred card art */
  overlay: string;
  /** Fallback when no card image */
  fallbackBg: string;
  /** “Raw Investor” header */
  headerClass: string;
  /** PriceCharting raw tile */
  rawPc: { border: string; bg: string; glow: string; labelClass: string };
  /** TCGplayer tile */
  rawTcg: { border: string; bg: string; glow: string; labelClass: string };
  /** PC raw Δ bar */
  deltaBar: string;
  /** GemRate hero panel */
  gemRate: { border: string; bg: string; glow: string; pctClass: string; captionClass: string };
  /** Stat rows divider */
  dividerClass: string;
  /** PNG export corner color (html-to-image) */
  exportBg: string;
};

export const SHARE_GRAPHIC_THEMES: Record<ShareGraphicThemeId, ShareGraphicTheme> = {
  psychic: {
    id: 'psychic',
    tone: 'dark',
    label: 'Psychic',
    overlay:
      'linear-gradient(165deg, rgba(88,28,135,0.82) 0%, rgba(157,23,77,0.55) 45%, rgba(49,46,129,0.75) 100%)',
    fallbackBg: 'linear-gradient(165deg, #4c1d95 0%, #831843 50%, #312e81 100%)',
    headerClass: 'text-fuchsia-300',
    rawPc: {
      border: 'border-fuchsia-400/35',
      bg: 'linear-gradient(180deg, rgba(134,25,143,0.45) 0%, rgba(15,23,42,0.88) 100%)',
      glow: '0 0 28px -6px rgba(217,70,239,0.45)',
      labelClass: 'text-fuchsia-200/80',
    },
    rawTcg: {
      border: 'border-violet-400/35',
      bg: 'linear-gradient(180deg, rgba(76,29,149,0.5) 0%, rgba(15,23,42,0.88) 100%)',
      glow: '0 0 28px -6px rgba(167,139,250,0.4)',
      labelClass: 'text-violet-200/80',
    },
    deltaBar: 'bg-purple-950/55 border-fuchsia-500/25',
    gemRate: {
      border: 'border-cyan-400/35',
      bg: 'linear-gradient(135deg, rgba(6,182,212,0.25) 0%, rgba(88,28,135,0.45) 50%, rgba(15,23,42,0.92) 100%)',
      glow: '0 0 32px -4px rgba(34,211,238,0.35)',
      pctClass: 'text-white',
      captionClass: 'text-fuchsia-200/75',
    },
    dividerClass: 'border-fuchsia-900/40 divide-fuchsia-900/35',
    exportBg: '#3b0764',
  },
  electric: {
    id: 'electric',
    tone: 'dark',
    label: 'Electric',
    overlay:
      'linear-gradient(165deg, rgba(202,138,4,0.75) 0%, rgba(59,130,246,0.45) 50%, rgba(234,179,8,0.55) 100%)',
    fallbackBg: 'linear-gradient(165deg, #ca8a04 0%, #2563eb 50%, #eab308 100%)',
    headerClass: 'text-amber-200',
    rawPc: {
      border: 'border-amber-400/45',
      bg: 'linear-gradient(180deg, rgba(180,83,9,0.5) 0%, rgba(15,23,42,0.9) 100%)',
      glow: '0 0 28px -6px rgba(250,204,21,0.5)',
      labelClass: 'text-amber-100/85',
    },
    rawTcg: {
      border: 'border-sky-400/45',
      bg: 'linear-gradient(180deg, rgba(12,74,110,0.55) 0%, rgba(15,23,42,0.9) 100%)',
      glow: '0 0 28px -6px rgba(56,189,248,0.45)',
      labelClass: 'text-sky-100/85',
    },
    deltaBar: 'bg-amber-950/40 border-amber-400/30',
    gemRate: {
      border: 'border-amber-300/40',
      bg: 'linear-gradient(135deg, rgba(251,191,36,0.2) 0%, rgba(37,99,235,0.25) 100%)',
      glow: '0 0 32px -4px rgba(252,211,77,0.4)',
      pctClass: 'text-amber-50',
      captionClass: 'text-amber-200/80',
    },
    dividerClass: 'border-amber-900/35 divide-amber-900/30',
    exportBg: '#422006',
  },
  metal: {
    id: 'metal',
    tone: 'dark',
    label: 'Metal',
    overlay:
      'linear-gradient(165deg, rgba(71,85,105,0.85) 0%, rgba(148,163,184,0.45) 50%, rgba(51,65,85,0.8) 100%)',
    fallbackBg: 'linear-gradient(165deg, #475569 0%, #94a3b8 50%, #334155 100%)',
    headerClass: 'text-slate-200',
    rawPc: {
      border: 'border-slate-400/40',
      bg: 'linear-gradient(180deg, rgba(71,85,105,0.55) 0%, rgba(15,23,42,0.92) 100%)',
      glow: '0 0 24px -6px rgba(203,213,225,0.35)',
      labelClass: 'text-slate-200/85',
    },
    rawTcg: {
      border: 'border-cyan-300/35',
      bg: 'linear-gradient(180deg, rgba(100,116,139,0.5) 0%, rgba(15,23,42,0.92) 100%)',
      glow: '0 0 24px -6px rgba(165,243,252,0.3)',
      labelClass: 'text-cyan-100/80',
    },
    deltaBar: 'bg-slate-900/60 border-slate-500/35',
    gemRate: {
      border: 'border-slate-300/35',
      bg: 'linear-gradient(135deg, rgba(148,163,184,0.25) 0%, rgba(30,41,59,0.9) 100%)',
      glow: '0 0 28px -4px rgba(226,232,240,0.25)',
      pctClass: 'text-white',
      captionClass: 'text-slate-300',
    },
    dividerClass: 'border-slate-700/50 divide-slate-700/45',
    exportBg: '#1e293b',
  },
  light: {
    id: 'light',
    tone: 'light',
    label: 'Light',
    overlay:
      'linear-gradient(165deg, rgba(254,252,232,0.55) 0%, rgba(253,230,138,0.45) 45%, rgba(251,191,36,0.4) 100%)',
    fallbackBg: 'linear-gradient(165deg, #fefce8 0%, #fde68a 50%, #fbbf24 100%)',
    headerClass: 'text-amber-900',
    rawPc: {
      border: 'border-amber-600/35',
      bg: 'linear-gradient(180deg, rgba(254,243,199,0.55) 0%, rgba(255,255,255,0.92) 100%)',
      glow: '0 0 24px -6px rgba(251,191,36,0.45)',
      labelClass: 'text-amber-900/80',
    },
    rawTcg: {
      border: 'border-sky-500/35',
      bg: 'linear-gradient(180deg, rgba(224,242,254,0.65) 0%, rgba(255,255,255,0.92) 100%)',
      glow: '0 0 24px -6px rgba(14,165,233,0.35)',
      labelClass: 'text-sky-900/80',
    },
    deltaBar: 'bg-amber-100/80 border-amber-700/25',
    gemRate: {
      border: 'border-amber-500/30',
      bg: 'linear-gradient(135deg, rgba(254,249,195,0.7) 0%, rgba(255,255,255,0.95) 100%)',
      glow: '0 0 28px -4px rgba(250,204,21,0.35)',
      pctClass: 'text-amber-950',
      captionClass: 'text-amber-800/85',
    },
    dividerClass: 'border-amber-200/80 divide-amber-200/70',
    exportBg: '#fffbeb',
  },
  dark: {
    id: 'dark',
    tone: 'dark',
    label: 'Dark',
    overlay:
      'linear-gradient(165deg, rgba(15,23,42,0.88) 0%, rgba(30,27,75,0.65) 50%, rgba(2,6,23,0.92) 100%)',
    fallbackBg: 'linear-gradient(165deg, #020617 0%, #1e1b4b 50%, #020617 100%)',
    headerClass: 'text-sky-400',
    rawPc: {
      border: 'border-emerald-500/30',
      bg: 'linear-gradient(180deg, rgba(6,78,59,0.4) 0%, rgba(15,23,42,0.9) 100%)',
      glow: '0 0 28px -8px rgba(16,185,129,0.4)',
      labelClass: 'text-emerald-200/75',
    },
    rawTcg: {
      border: 'border-sky-500/30',
      bg: 'linear-gradient(180deg, rgba(12,74,110,0.45) 0%, rgba(15,23,42,0.9) 100%)',
      glow: '0 0 28px -8px rgba(56,189,248,0.4)',
      labelClass: 'text-sky-200/75',
    },
    deltaBar: 'bg-slate-950/65 border-slate-600/45',
    gemRate: {
      border: 'border-cyan-500/30',
      bg: 'linear-gradient(135deg, rgba(6,182,212,0.15) 0%, rgba(88,28,135,0.35) 55%, rgba(15,23,42,0.95) 100%)',
      glow: '0 0 36px -4px rgba(34,211,238,0.25)',
      pctClass: 'text-white',
      captionClass: 'text-slate-300',
    },
    dividerClass: 'border-slate-700/55 divide-slate-700/50',
    exportBg: '#020617',
  },
  grass: {
    id: 'grass',
    tone: 'dark',
    label: 'Grass',
    overlay:
      'linear-gradient(165deg, rgba(21,128,61,0.78) 0%, rgba(74,222,128,0.4) 50%, rgba(20,83,45,0.82) 100%)',
    fallbackBg: 'linear-gradient(165deg, #15803d 0%, #4ade80 50%, #14532d 100%)',
    headerClass: 'text-lime-200',
    rawPc: {
      border: 'border-lime-400/35',
      bg: 'linear-gradient(180deg, rgba(22,101,52,0.55) 0%, rgba(15,23,42,0.9) 100%)',
      glow: '0 0 28px -6px rgba(163,230,53,0.45)',
      labelClass: 'text-lime-100/85',
    },
    rawTcg: {
      border: 'border-emerald-400/35',
      bg: 'linear-gradient(180deg, rgba(5,150,105,0.5) 0%, rgba(15,23,42,0.9) 100%)',
      glow: '0 0 28px -6px rgba(52,211,153,0.4)',
      labelClass: 'text-emerald-100/85',
    },
    deltaBar: 'bg-emerald-950/45 border-lime-500/25',
    gemRate: {
      border: 'border-lime-400/30',
      bg: 'linear-gradient(135deg, rgba(74,222,128,0.2) 0%, rgba(21,128,61,0.4) 100%)',
      glow: '0 0 32px -4px rgba(190,242,100,0.35)',
      pctClass: 'text-white',
      captionClass: 'text-lime-100/80',
    },
    dividerClass: 'border-emerald-900/40 divide-emerald-900/35',
    exportBg: '#14532d',
  },
  fire: {
    id: 'fire',
    tone: 'dark',
    label: 'Fire',
    overlay:
      'linear-gradient(165deg, rgba(185,28,28,0.72) 0%, rgba(251,146,60,0.5) 50%, rgba(127,29,29,0.85) 100%)',
    fallbackBg: 'linear-gradient(165deg, #b91c1c 0%, #fb923c 50%, #7f1d1d 100%)',
    headerClass: 'text-orange-200',
    rawPc: {
      border: 'border-orange-400/45',
      bg: 'linear-gradient(180deg, rgba(154,52,18,0.55) 0%, rgba(15,23,42,0.9) 100%)',
      glow: '0 0 28px -6px rgba(251,146,60,0.5)',
      labelClass: 'text-orange-100/85',
    },
    rawTcg: {
      border: 'border-red-400/40',
      bg: 'linear-gradient(180deg, rgba(127,29,29,0.5) 0%, rgba(15,23,42,0.9) 100%)',
      glow: '0 0 28px -6px rgba(248,113,113,0.4)',
      labelClass: 'text-red-100/85',
    },
    deltaBar: 'bg-red-950/45 border-orange-500/30',
    gemRate: {
      border: 'border-orange-400/35',
      bg: 'linear-gradient(135deg, rgba(251,146,60,0.25) 0%, rgba(185,28,28,0.4) 100%)',
      glow: '0 0 32px -4px rgba(253,186,116,0.4)',
      pctClass: 'text-white',
      captionClass: 'text-orange-100/85',
    },
    dividerClass: 'border-red-900/40 divide-red-900/35',
    exportBg: '#7f1d1d',
  },
};
