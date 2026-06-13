export type GradePrice = {
  key: string;
  label: string;
  price: number;
};

export type PsaGradeCount = {
  grade: string;
  population: number;
  qualifiedPopulation: number;
};

export type PsaPopulation = {
  specId: string | number;
  brand?: string;
  subject?: string;
  year?: string;
  cardNumber?: string;
  grades: PsaGradeCount[];
  totalPop: number;
  /** When we fetched it (epoch ms) so we can show staleness. */
  fetchedAt?: number;
};

export type GemRateCandidate = {
  gemrateId: string;
  description: string;
  populationType: string;
  totalPopulation: number;
  detailUrl: string;
};

export type GemRateSearchResult = {
  query: string;
  candidates: GemRateCandidate[];
};

/** Cached GemRate population stats for the linked universal entry (server `/api/gemrate/card-details`). */
export type GemRateStats = {
  gemrateId: string;
  /** % of PSA slabbed copies graded PSA 10 (g10 / card_total_grades). */
  psa10Pct: number | null;
  /** Universal Gems+ ÷ total population (all graders). */
  universalGemsPct: number | null;
  fetchedAt: number;
};

/** Snapshot from server `GET /api/tcgplayer/product` (mp-search-api listing metrics). */
export type TcgplayerProductSummary = {
  productId: number;
  productName: string;
  setName: string;
  rarityName: string | null;
  marketPrice: number;
  lowestPrice: number | null;
  lowestPriceWithShipping: number | null;
  medianPrice: number | null;
  listings: number | null;
  sellers: number | null;
  url: string;
  source?: 'playwright_exact_url' | 'api_details' | 'extension_capture';
  capturedFromUrl?: string;
  capturedContext?: {
    language: string | null;
    condition: string | null;
    printing: string | null;
  };
  usedAuth?: boolean;
  apiMarketPrice?: number | null;
  priceDriftVsApi?: number | null;
  captureHint?: string;
  fetchedAt: number;
};

/** One TCGplayer market price sample we store on each successful product fetch (self-sampled). */
export type TcgplayerSelfPricePoint = {
  at: number;
  marketPrice: number;
};

/** Weekly-style points from `/api/tcgplayer/history` (Playwright table or env XHR JSON). */
export type TcgplayerMarketHistoryPoint = {
  at: number;
  marketPrice: number;
  volumeUsd?: number | null;
};

/** Backfilled chart series for the expanded price chart. */
export type TcgplayerMarketHistory = {
  points: TcgplayerMarketHistoryPoint[];
  source: 'xhr_env' | 'playwright' | 'none';
  fetchedAt: number;
  hint?: string;
};

export type CardLanguageTag = 'EN' | 'JP' | 'KR' | 'CN' | 'ES' | 'FR' | 'DE' | 'PT' | 'IT' | 'OTHER' | 'UNKNOWN';

export type TcgComparisonMarketPrices = {
  nearMint?: number | null;
  lightlyPlayed?: number | null;
  moderatelyPlayed?: number | null;
  heavilyPlayed?: number | null;
  damaged?: number | null;
};

export type TcgplayerLatestSaleRow = {
  at: number;
  condition: string | null;
  qty: number;
  price: number;
  languageTag?: CardLanguageTag;
  hasPhoto?: boolean | null;
  suspiciousLanguagePump?: boolean;
  suspiciousReason?: string | null;
};

export type TcgplayerSalesSnapshot = {
  capturedAt: number;
  sourceUrl: string;
  context: {
    language: string | null;
    condition: string | null;
    printing: string | null;
  };
  captureMode: 'default' | 'deep';
  hasMore: boolean;
  rowCount: number;
  comparisonMarketPrices?: TcgComparisonMarketPrices;
  pricePoints: {
    marketPrice: number | null;
    capturedMarketPrice?: number | null;
    displayMarketPrice?: number | null;
    mostRecentSale: number | null;
    listedMedian: number | null;
    currentQuantity: number | null;
    currentSellers: number | null;
  };
  latestSalesRows: TcgplayerLatestSaleRow[];
};

export type SalesAnomalyPoint = {
  window: 'daily' | 'weekly' | 'monthly' | 'yearly' | 'all_time';
  kind: 'volume_spike' | 'volume_drop' | 'price_spike' | 'price_drop' | 'insufficient_history';
  label: string;
  pct: number | null;
};

export type Collection = {
  id: string;
  name: string;
  /** Hex color used for badges / chips, e.g. "#0ea5e9". */
  color: string;
  /** Optional free-text note shown in the manager panel. */
  note?: string;
  createdAt: number;
};

/** Parsed TCGPlayer content-article tables (e.g. buyer's guide pull rates). */
export type PullRateGuideTable = {
  headers: string[];
  rows: string[][];
};

export type PullRateGuide = {
  sourceUrl: string;
  fetchedAt: number;
  title?: string;
  excerpt?: string;
  tables: PullRateGuideTable[];
};

/** One row in a buyer's guide table mapped for sealed EV(open) vs keep sealed. */
export type SealedPullSlot = {
  /** Stable id (table/row + content hash) for merging user edits across re-parses. */
  slotId: string;
  tableIndex: number;
  rowIndex: number;
  /** Short label (e.g. first cell or slot name). */
  label: string;
  /** Normalized probability in [0,1]; null if not parsed. */
  probability: number | null;
  /** Expected gross resale USD for this pull outcome. */
  resaleUsd: number | null;
  /** When true, row is ignored for EV(open) completeness and EV sum (subset modeling). */
  excludeFromEv?: boolean;
};

/** Gallery filters + selection for sealed set catalog (TCGPlayer). */
export type SealedSetGalleryToggles = {
  /** When true, show Common/Uncommon/Dollar Rare bulk slots in the gallery grid. */
  showCommons: boolean;
  includeSir: boolean;
  includeIr: boolean;
  includeFullArt: boolean;
  includeEx: boolean;
  /** Double Rare / Ultra Rare / Hyper / etc. */
  includeOtherPremium: boolean;
};

/** Snapshot row from `/api/tcgplayer/catalog-preview` (persisted for resale fill without re-fetch). */
export type SealedSetGalleryPreviewItem = {
  productId: number;
  productName: string;
  setName: string;
  rarityName: string | null;
  marketPrice: number;
  imageUrl?: string | null;
};

export type SealedSetGalleryState = {
  catalogUrl: string;
  selectedProductIds: number[];
  toggles: SealedSetGalleryToggles;
  fetchedAt: number;
  previewItems?: SealedSetGalleryPreviewItem[] | null;
};

export type Card = {
  id: string;
  name: string;
  set: string;
  /** Singles vs sealed product row; default single when omitted. */
  portfolioKind?: 'single' | 'sealed';
  /** TCGPlayer article snapshot for pull-rate / set guide data. */
  pullRateGuide?: PullRateGuide | null;
  /** Sealed: per-slot odds (parsed/editable) and expected resale for open vs keep decision. */
  sealedPullSlots?: SealedPullSlot[] | null;
  /** Sealed: optional TCGPlayer catalog gallery selection + filters (persisted on card). */
  sealedSetGallery?: SealedSetGalleryState | null;
  rarity?: string;
  /** Optional membership in a monitored collection (Collection.id). */
  collectionId?: string;
  /** Card number like "106" or "238". Used to build accurate GemRate queries. */
  cardNumber?: string;
  url?: string;
  /** PriceCharting collection export product id (CSV `id`) when imported in bulk. */
  priceChartingProductId?: string;
  /** Server-local image path, e.g. /images/pokemon-surging-sparks_pikachu-ex-238.jpg */
  localImage?: string | null;
  raw: number;
  grade9: number;
  psa10: number;
  /** What YOU paid for this specific copy. Falls back to `raw` (market price)
   *  when unset so existing seed data keeps behaving the same. */
  actualCost?: number;
  /** Inbound shipping paid to receive the card. Added to cost basis when set.
   *  When `freeShipping` is true this is ignored and displayed as "FREE". */
  shippingCost?: number;
  /** Explicit "I got free shipping" flag so 0 means "free" vs unset. */
  freeShipping?: boolean;
  /** Full PriceCharting grade matrix, source order. */
  allPrices?: GradePrice[];
  /** User-selected target grade key (from allPrices) for potential value planning. */
  estimatedGradeKey?: string;
  /** Price point mapped from estimatedGradeKey. */
  potentialValue?: number;
  /** PSA SpecID for population lookup (numeric string). */
  psaSpecId?: string;
  /** Cached PSA population. */
  psaPop?: PsaPopulation | null;
  /** Candidate matches from GemRate (captured at scrape-time). */
  gemrateCandidates?: GemRateCandidate[];
  /** User-selected candidate from the list. */
  gemrateId?: string;
  /** GemRate PSA 10 / universal gem rates for {@link gemrateId}; filled by the client via `/api/gemrate/card-details`. */
  gemRateStats?: GemRateStats | null;
  /** Optional TCGPlayer product URL to pull their listing price metrics. */
  tcgplayerUrl?: string;
  /** Cached response from `/api/tcgplayer/product` when the user loads the link. */
  tcgplayerSummary?: TcgplayerProductSummary | null;
  /** Our own time series of TCGplayer market price (each successful product pull). */
  tcgplayerSelfHistory?: TcgplayerSelfPricePoint[];
  /** Optional chart history from `GET /api/tcgplayer/history` (Martech weekly table). */
  tcgplayerMarketHistory?: TcgplayerMarketHistory | null;
  /** Rich capture from browser extension for TCG latest-sales tape + price-points. */
  tcgplayerSalesSnapshot?: TcgplayerSalesSnapshot | null;
  /** Archived/excluded TCG sale keys (excluded from overview metrics/charts). */
  tcgplayerArchivedSaleKeys?: string[];
  /** Persistent dedupe keys for already-scanned TCG extension sales rows. */
  tcgplayerLastScannedSaleKeys?: string[];
  /** Computed anomaly callouts from TCG sales snapshot history. */
  tcgplayerSalesAnomalies?: SalesAnomalyPoint[];
  /** Probability of grading PSA 10 (0..1) */
  p10: number;
  /** Probability of grading PSA 9 (0..1) */
  p9: number;
  /** PriceCharting "Release Date" when scraped; charts/sales skip points before this (UTC day). */
  releaseDateMs?: number | null;
  /** Epoch ms of the last successful PriceCharting refresh. Unset for seed data. */
  lastRefreshedAt?: number;
  /** Epoch ms of the last successful Quick Card Full Fetch. */
  lastFullFetchAt?: number;
  /** Epoch ms of the last successful Quick Card Quick Refresh (Gem Rate interval). */
  lastQuickRefreshAt?: number;
  /** Snapshot of the previous prices so we can show deltas after each refresh. */
  previousPrices?: {
    raw: number;
    grade9: number;
    psa10: number;
    at: number;
  };
  /** Rolling price history, oldest first. Populated from (a) seed data scraped
   *  from PriceCharting's recent sales table when available, and (b) a snapshot
   *  appended on every successful refresh. Each snapshot can have only one
   *  grade populated (for seed sales) or all three (for our full refreshes). */
  priceHistory?: PriceSnapshot[];
  /** Recent completed sales from PriceCharting's sales table, kept so we can
   *  compute pace + price distribution in the UI without re-scraping. */
  recentSales?: RecentSale[];
  /** Latest sales-volume stats scraped from PC. Refreshed on each /api/scrape. */
  salesVolume?: SalesVolume;
  /** Cached eBay sold-listings snapshot keyed to this specific card query. */
  ebaySales?: EbaySalesSummary | null;
  /** Last successful Marketplace Insights fetch (epoch ms). */
  ebayLastApiFetchedAt?: number;
  /** Extension-captured sold rows from the matching eBay search URL. */
  ebayExtensionSnapshot?: EbayExtensionSnapshot | null;
  /** Frozen Graded=No pass during Edge dual capture (cleared after client merge). */
  ebayExtensionSnapshotNo?: EbayExtensionSnapshot | null;
  /** Frozen Graded=Yes pass during Edge dual capture (cleared after client merge). */
  ebayExtensionSnapshotYes?: EbayExtensionSnapshot | null;
  /** Extension-captured active eBay rows from the matching search URL. */
  ebayActiveExtensionSnapshot?: EbayActiveExtensionSnapshot | null;
  /** Archived/excluded eBay sale keys (excluded from overview metrics/charts). */
  ebayArchivedSaleKeys?: string[];
  /** Automated verification failures (high RAW outliers); restorable in Quick → Archived. */
  ebayVerificationArchive?: EbayVerificationArchiveEntry[];
  /** Persistent dedupe keys for already-scanned eBay extension sold rows. */
  ebayLastScannedSaleKeys?: string[];
  /** Auto-filtered eBay rows manually restored back into active charting scope. */
  ebayRestoredFilteredSaleKeys?: string[];
  /** Permanently disbanded eBay rows (excluded from active + filtered queues). */
  ebayDisbandedSaleKeys?: string[];
  /** Optional deal-hunt defaults anchored to this card. */
  dealHunt?: CardDealHuntSettings;
};

export type PriceSnapshot = {
  at: number;
  raw?: number;
  grade9?: number;
  psa10?: number;
  /** Where this datapoint came from. "refresh" = our own rescrape;
   *  "pc_sale" = seed scraped from PriceCharting's recent sales table. */
  source?: 'refresh' | 'pc_sale' | 'initial';
};

export type Fees = {
  gradingFee: number;
  shipToGrader: number;
  shipFromGrader: number;
  saleFeePct: number;
  saleFeeFlat: number;
  shipToBuyer: number;
};

export type CardMetrics = {
  totalInvested: number;
  net10: number;
  net9: number;
  netFail: number;
  pFail: number;
  ev: number;
  roiPct: number;
  /**
   * Net if you sell at raw without grading: raw sale revenue (after fees) minus
   * purchase + inbound shipping only. Independent of {@link totalInvested}.
   */
  netRawNoGrade: number;
  /** Broken-out revenue components for the expanded view math breakdown. */
  revenue10: number;
  revenue9: number;
  revenueFail: number;
};

export type ScrapeResponse = {
  url: string;
  name: string;
  set: string;
  cardNumber: string;
  /** When PC product Genre is "Sealed Product", UI may default new row to sealed. */
  suggestedPortfolioKind?: 'single' | 'sealed' | null;
  /** Auto-detected from PriceCharting card details when TCGPlayer ID is listed. */
  tcgplayerUrl?: string | null;
  raw: number;
  grade9: number;
  psa10: number;
  allPrices: GradePrice[];
  slug: string;
  localImage: string | null;
  /** Best-effort seed history from PriceCharting's recent sales / completed
   *  auctions table, if the page exposes one. Each entry represents one
   *  observed completed sale. Empty array when not available. */
  recentSales: RecentSale[];
  /** Best-effort volume stats scraped directly off the page. Any field may
   *  be undefined if the page doesn't surface it. */
  salesVolume: SalesVolume;
  /** Same semantics as Card.releaseDateMs — from PC product details. */
  releaseDateMs?: number | null;
  /** Catalog IDs from the scraped HTML (`data-product-id`), when present. */
  pcProductIds?: string[];
};

export type RecentSale = {
  at: number;
  grade: 'raw' | 'grade9' | 'psa10' | 'other';
  price: number;
  label?: string;
};

export type SalesVolume = {
  week?: number;
  month?: number;
  year?: number;
  total?: number;
};

export type EbayRecentSold = {
  itemId: string;
  title: string;
  soldAt: number;
  price: number;
  currency: string;
  condition?: string;
  itemUrl?: string;
};

export type EbaySalesSummary = {
  query: string;
  windowDays: number;
  fetchedAt: number;
  count: number;
  low: number | null;
  median: number | null;
  high: number | null;
  mean: number | null;
  p25: number | null;
  p75: number | null;
  pacePerMonth: number;
  pacePerWeek: number;
  source: 'ebay_marketplace_insights';
  currency: string | null;
  listings: EbayRecentSold[];
};

export type EbayExtensionListing = {
  title: string;
  price: number;
  /** Price normalized per single card when listing is a lot. */
  unitPrice?: number;
  /** Quantity represented by the listing (1 for non-lot rows). */
  lotQuantity?: number;
  /** True when title indicates this is a lot / multi-copy listing. */
  isLot?: boolean;
  soldAt: number;
  itemId: string | null;
  itemUrl: string | null;
  listingKind?: 'auction' | 'bin' | 'unknown';
  currentBid?: number | null;
  buyItNow?: number | null;
  bidCount?: number | null;
  endsAtMs?: number | null;
  /** True when card text indicated free shipping; when true, shippingCost is null. */
  freeShipping?: boolean;
  shippingCost?: number | null;
  bestOfferAccepted?: boolean;
  /** Pokémon Center stamp variant; explicit false overrides title heuristics. */
  pokemonCenterStamp?: boolean;
  /** Title contains "sealed" (plastic sleeve); explicit false overrides. */
  sealedInTitle?: boolean;
  gradeTag?: string | null;
  grader?: 'PSA' | 'CGC' | 'BGS' | 'SGC' | 'TAG' | 'ACE' | 'AI' | null;
  isGraded?: boolean;
  conditionTag?: 'NM' | 'LP' | 'MP' | 'HP' | 'DMG' | null;
  languageTag?: CardLanguageTag;
  hasPhoto?: boolean | null;
  suspiciousLanguagePump?: boolean;
  suspiciousReason?: string | null;
};

export type EbayFilteredListing = EbayExtensionListing & {
  filterReason: 'clarity' | 'suspicious' | 'listing_mismatch';
};

export type EbayActiveListing = {
  title: string;
  price: number;
  itemId: string | null;
  itemUrl: string | null;
  listingKind?: 'auction' | 'bin' | 'unknown';
  currentBid?: number | null;
  buyItNow?: number | null;
  bidCount?: number | null;
  endsAtMs?: number | null;
  freeShipping?: boolean;
  shippingCost?: number | null;
  bestOfferAccepted?: boolean;
  isGraded?: boolean;
  grader?: 'PSA' | 'CGC' | 'BGS' | 'SGC' | 'TAG' | 'ACE' | 'AI' | null;
  gradeTag?: string | null;
  conditionTag?: 'NM' | 'LP' | 'MP' | 'HP' | 'DMG' | null;
  pokemonCenterStamp?: boolean;
  sealedInTitle?: boolean;
  /** Listing thumbnail when extension or merge provides it. */
  imageUrl?: string | null;
};

export type EbayActiveExtensionSnapshot = {
  capturedAt: number;
  sourceUrl: string;
  query: string;
  captureMode: 'default' | 'deep';
  hasMore: boolean;
  rowCount: number;
  listings: EbayActiveListing[];
};

/** Dual graded-facet Quick Fetch stats (Graded No pass + Graded Yes pass). */
export type EbayDualCaptureStats = {
  gradedNoRows: number;
  gradedYesRows: number;
  gradedNoPages: number;
  gradedYesPages: number;
  gradedFacetAppliedNo?: boolean;
  gradedFacetAppliedYes?: boolean;
  /** Single deep pass without graded sidebar clicks (sealed products). */
  sealedSinglePass?: boolean;
};

/** Row archived after automated listing-title verification failed (high RAW outlier). */
export type EbayVerificationArchiveEntry = {
  archivedAt: number;
  reason: string;
  listing: EbayExtensionListing;
};

/** Browser extension capture for eBay sold search (merged on eBay refresh / load). */
export type EbayExtensionSnapshot = {
  capturedAt: number;
  sourceUrl: string;
  query: string;
  captureMode: 'default' | 'deep';
  hasMore: boolean;
  rowCount: number;
  listings: EbayExtensionListing[];
  rejectedListings?: EbayFilteredListing[];
  ebayDualCaptureStats?: EbayDualCaptureStats;
  /** Set by server merge when capture came from a graded facet lane. */
  capturePass?: 'ebay-graded-no' | 'ebay-graded-yes';
};

export type HuntSchedule =
  | { kind: 'once'; atMs: number }
  | { kind: 'recurring'; cronLocal: string };

export type HuntCriteria = {
  maxBidUsd?: number;
  maxBinUsd?: number;
  rawOnly?: boolean;
};

export type Hunt = {
  id: string;
  name: string;
  searchUrl: string;
  cardId?: string;
  /** Optional substring filter in Hunt listings (identify targets within results). */
  scope?: string;
  schedule?: HuntSchedule;
  criteria?: HuntCriteria;
  createdAt: number;
  updatedAt: number;
};

export type TargetProbe = {
  atMs: number;
  currentBid?: number | null;
  buyItNow?: number | null;
  endsAtMs?: number | null;
  parseOk: boolean;
  highBidderAboveThreshold: boolean;
};

export type Target = {
  id: string;
  listingUrl: string;
  itemId?: string;
  huntId?: string;
  cardId?: string;
  label?: string;
  /** Title/image/price scraped from the open eBay tab (extension) or hunt rows in-app. */
  listingTitle?: string;
  listingImageUrl?: string;
  listingPriceUsd?: number | null;
  listingCapturedAt?: number;
  maxBidUsd: number;
  maxBinUsd?: number;
  sniperEnabled: boolean;
  sniperLeadMs: number;
  armed: boolean;
  /** When true, RawEngine polls this listing on a slow cadence even if not armed. */
  liveWatch?: boolean;
  createdAt: number;
  updatedAt: number;
  lastProbe?: TargetProbe;
};

export type CardDealHuntSettings = {
  enabled: boolean;
  basis?: 'raw' | 'median_sold' | 'custom';
  customMaxUsd?: number;
  maxBidUsd?: number;
  maxBinUsd?: number;
  rawOnly?: boolean;
  trackedListingIds?: string[];
};

export type PriceAdvice =
  | 'push_higher'
  | 'list_at_p75'
  | 'hold_median'
  | 'pc_reference'
  | 'insufficient';

export type SellPricingPolicy = {
  ebayFeeRate: number;
  whatnotFeeRate: number;
  targetMarginRate: number;
  directOfferDiscountRate: number;
};

export type SellPriceTargets = {
  marketPrice: number;
  optimalEbayPrice: number;
  optimalWhatnotPrice: number;
  directCashAppOffer: number;
};

export type CrossGraderCompany = 'PSA' | 'CGC' | 'SGC' | 'BGS' | 'TAG' | 'ACE' | 'OTHER';

export type CrossGraderPrice = {
  /** Normalized key from allPrices, e.g. "cgc_10_pristine". */
  key: string;
  /** Display label exactly as PriceCharting shows it. */
  label: string;
  company: CrossGraderCompany;
  price: number;
  /** Premium vs raw as a multiplier (e.g. 5.2x). null when raw is unknown. */
  premiumVsRaw: number | null;
  /** Premium vs PSA 10 as a decimal fraction (-0.2 = 20% below PSA 10). null
   *  when PSA 10 price is unknown or zero. */
  deltaVsPsa10: number | null;
};

export type SalesPaceSummary = {
  grade: 'raw' | 'grade9' | 'psa10';
  windowDays: number;
  /** Count of sales of this grade observed inside the window. */
  count: number;
  /** Projected monthly pace (count scaled to 30 days). */
  pacePerMonth: number;
  /** Projected weekly pace. */
  pacePerWeek: number;
  /** Null when count=0; otherwise full distribution. */
  low: number | null;
  p25: number | null;
  median: number | null;
  mean: number | null;
  p75: number | null;
  p90: number | null;
  high: number | null;
  stdDev: number | null;
  /** Recommended list prices derived from the distribution. */
  suggestion: {
    floor: number | null;
    list: number | null;
    stretch: number | null;
  };
  /** Should you push for the higher end of the range? */
  pushHigher: {
    advice: PriceAdvice;
    label: string;
    reason: string;
    confidence: 'low' | 'medium' | 'high';
  };
  /** How the suggestion + pushHigher signal were actually computed:
   *   - "observed": we had >= MIN_SALES_FOR_DISTRIBUTION sales and used quantiles.
   *   - "pc_fallback": thin observation count - we trusted PriceCharting's
   *     posted price as the anchor and built +/- bands around it.
   *   - "no_data": nothing to work with (no observations AND no PC anchor). */
  referenceMode: 'observed' | 'pc_fallback' | 'no_data';
  /** PriceCharting's posted price used in the fallback, or the observed
   *  median when in observed mode. */
  referencePrice: number | null;
};

export type CombinedSalesPace = {
  grade: 'raw' | 'grade9' | 'psa10';
  source: 'pc' | 'ebay' | 'hybrid';
  confidence: 'low' | 'medium' | 'high';
  pacePerMonth: number;
  pacePerWeek: number;
  referencePrice: number | null;
  count: number;
  windowDays: number;
  pc: SalesPaceSummary;
  ebay: EbaySalesSummary | null;
};

export type PriceAction = 'buy_now' | 'wait_to_buy' | 'sell_now' | 'hold_sell_later' | 'hold';

export type PriceSignal = {
  action: PriceAction;
  label: string;
  reason: string;
  confidence: 'low' | 'medium' | 'high';
};

export type GradeAnalytics = {
  grade: 'raw' | 'grade9' | 'psa10';
  n: number;
  firstAt: number | null;
  lastAt: number | null;
  min: number;
  max: number;
  mean: number;
  stdDev: number;
  current: number;
  /** Slope in $/day from an ordinary least-squares fit. */
  slopePerDay: number;
  /** Total % change from first datapoint to current. */
  totalPctChange: number;
  /** 0..1 position between min and max; NaN when min==max. */
  positionInRange: number;
  /** Standardized score of current vs mean. */
  zScore: number;
  /** 90-day projections built from slope + residual std dev. */
  projection: {
    days: number;
    realistic: number;
    bestCase: number;
    worstCase: number;
    /**
     * True when extrapolation was capped because the raw trend implied an
     * unrealistic move vs observed history (sparse points, short span, or
     * huge OLS slope). The headline Trend/day still shows the raw regression.
     */
    trendLimited: boolean;
  };
  /** Buy-side and sell-side signals rendered side by side in the UI. */
  buyerSignal: PriceSignal;
  sellerSignal: PriceSignal;
};

export type FuturesDirection = 'up' | 'down' | 'flat';
export type FuturesSpikeFlag = 'none' | 'watch' | 'high';

export type FuturesSourcePoint = {
  at: number;
  price: number;
};

export type FuturesSignalResult = {
  direction: FuturesDirection;
  directionConfidencePct: number;
  anomalySpikeFlag: FuturesSpikeFlag;
  inflationRiskPct: number;
  deflationRiskPct: number;
  likelihoodUpPct: number;
  likelihoodDownPct: number;
  likelihoodFlatPct: number;
  sampleCount: number;
  rangeStart: number | null;
  rangeEnd: number | null;
  explainers: string[];
  stats: {
    trendRaw: number;
    paceAccel: number;
    volRatio: number;
    median: number;
    q1: number;
    q3: number;
    baselineLowPrice: number | null;
    baselineHighPrice: number | null;
    additionalAnomalyCount: number;
  };
};
