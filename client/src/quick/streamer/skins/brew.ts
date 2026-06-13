import type { StreamerSkinDefinition } from './types';

const CHART_EBAY = '#dc2626';
const CHART_TCG = '#9333ea';

export const brewSkin: StreamerSkinDefinition = {
  id: 'brew',
  label: 'Brew (Mimikbrew)',
  description: 'Chalkboard backdrop with gold accents for Mimikbrew streams.',
  tokens: {
    light: false,
    chartEbay: CHART_EBAY,
    chartTcg: CHART_TCG,
    chartEbayAreaOpacity: 0.35,
    chartTcgAreaOpacity: 0.3,
    gridStroke: 'rgba(180, 140, 60, 0.25)',
    axisTick: '#a8a29e',
    shell:
      'rounded-3xl border border-amber-700/40 text-stone-100 shadow-2xl relative overflow-hidden',
    subhead: 'text-amber-200/70',
    kicker: 'text-amber-400/90',
    headerSubtitle: 'Mimikbrew',
    navBtn:
      'border-amber-700/35 bg-black/50 text-stone-100 hover:bg-black/65 disabled:opacity-35 backdrop-blur-sm',
    themeBtn:
      'border-amber-700/35 bg-black/50 text-stone-100 hover:bg-black/65 backdrop-blur-sm',
    imgRing:
      'ring-2 ring-amber-600/45 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.85)] bg-black/40 backdrop-blur-sm',
    pickerBtn: 'bg-black/55 border-amber-700/35 hover:bg-black/70 backdrop-blur-sm',
    pickerPop: 'border-amber-700/40 bg-black/90 shadow-2xl backdrop-blur-md',
    pickerInput:
      'bg-black/60 border-amber-700/35 text-stone-100 placeholder:text-stone-500 backdrop-blur-sm',
    pickerThumbBorder: 'border-amber-700/35',
    pickerPlaceholderBg: 'bg-black/50',
    pickerPlaceholderBorder: 'border-amber-700/35',
    pickerChevron: 'text-amber-200/60',
    pickerDivide: 'divide-amber-900/30',
    linkChip:
      'border-amber-700/35 bg-black/45 hover:bg-black/60 backdrop-blur-sm',
    linkCaption: 'text-amber-200/60',
    titleMain: 'text-stone-50',
    setSub: 'text-stone-400',
    emptyTile: 'border-amber-700/30 bg-black/40 backdrop-blur-sm',
    priceTile:
      'border-amber-600/35 bg-black/50 shadow-inner backdrop-blur-sm',
    gradeTile: 'border-amber-600/35 bg-black/45 backdrop-blur-sm',
    gradeLbl: 'text-amber-200/65',
    priceNum: 'text-stone-50',
    sectionLbl: 'text-amber-200/60',
    chartBox: 'border-amber-700/35 bg-black/45 backdrop-blur-sm',
    chartMeta: 'text-amber-200/55',
    legendTxt: 'text-stone-400',
    deltaNeutral: 'text-stone-500',
    listHover: 'hover:bg-black/50',
    listSelected: 'bg-purple-950/50',
    noImg: 'text-stone-500',
    showRadialGlow: false,
    backgroundImageUrl: './skins/brew/background.png',
    backgroundOverlay:
      'linear-gradient(165deg, rgba(10,10,12,0.88) 0%, rgba(18,16,14,0.82) 45%, rgba(8,8,10,0.9) 100%)',
    tagline: {
      text: "WHAT'S UP BREWS?",
      className:
        'pointer-events-none select-none text-lg md:text-xl font-bold italic tracking-wide text-purple-300',
    },
  },
};
