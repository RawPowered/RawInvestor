export type StreamerSkinId = 'default-dark' | 'default-light' | 'brew';

export type StreamerSkinTagline = {
  text: string;
  className: string;
};

export type StreamerSkinTokens = {
  light: boolean;
  chartEbay: string;
  chartTcg: string;
  chartEbayAreaOpacity: number;
  chartTcgAreaOpacity: number;
  gridStroke: string;
  axisTick: string;
  shell: string;
  subhead: string;
  kicker: string;
  headerSubtitle?: string;
  navBtn: string;
  themeBtn: string;
  imgRing: string;
  pickerBtn: string;
  pickerPop: string;
  pickerInput: string;
  pickerThumbBorder: string;
  pickerPlaceholderBg: string;
  pickerPlaceholderBorder: string;
  pickerChevron: string;
  pickerDivide: string;
  linkChip: string;
  linkCaption: string;
  titleMain: string;
  setSub: string;
  emptyTile: string;
  priceTile: string;
  gradeTile: string;
  gradeLbl: string;
  priceNum: string;
  sectionLbl: string;
  chartBox: string;
  chartMeta: string;
  legendTxt: string;
  deltaNeutral: string;
  listHover: string;
  listSelected: string;
  noImg: string;
  showRadialGlow: boolean;
  backgroundImageUrl?: string;
  backgroundOverlay?: string;
  tagline?: StreamerSkinTagline;
};

export type StreamerSkinDefinition = {
  id: StreamerSkinId;
  label: string;
  description?: string;
  tokens: StreamerSkinTokens;
};
