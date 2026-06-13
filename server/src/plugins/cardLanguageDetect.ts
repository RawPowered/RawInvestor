export type CardLanguageTag = 'EN' | 'JP' | 'KR' | 'CN' | 'ES' | 'FR' | 'DE' | 'PT' | 'IT' | 'OTHER' | 'UNKNOWN';

export type ImageLanguageSignals = {
  alt?: string | null;
  title?: string | null;
  src?: string | null;
};

const pickStronger = (a: CardLanguageTag, b: CardLanguageTag): CardLanguageTag => {
  if (a === 'UNKNOWN') return b;
  if (b === 'UNKNOWN') return a;
  if (a === b) return a;
  if (a === 'OTHER' && b !== 'OTHER') return b;
  if (b === 'OTHER' && a !== 'OTHER') return a;
  if (a === 'EN' || b === 'EN') return a === 'EN' ? b : a;
  return a;
};

export const inferLanguageTagFromText = (raw: unknown): CardLanguageTag => {
  const text = String(raw || '').trim();
  if (!text) return 'UNKNOWN';
  const lower = text.toLowerCase();

  if (/[\uac00-\ud7af]/.test(text) || /\bkorean\b|\bkor\b/i.test(lower)) return 'KR';
  if (/[\u3040-\u30ff\u31f0-\u31ff]/.test(text) || /\bjapanese\b|\bjpn\b/i.test(lower)) return 'JP';
  if (/[\u4e00-\u9fff]/.test(text) || /\bchinese\b|\bsimplified\b|\btraditional\b/i.test(lower)) return 'CN';
  if (/\bspanish\b|\bespañol\b|\bespanol\b/i.test(lower)) return 'ES';
  if (/\bfrench\b|\bfrançais\b|\bfrancais\b/i.test(lower)) return 'FR';
  if (/\bgerman\b|\bdeutsch\b/i.test(lower)) return 'DE';
  if (/\bportuguese\b|\bportuguês\b|\bportugues\b/i.test(lower)) return 'PT';
  if (/\bitalian\b|\bitaliano\b/i.test(lower)) return 'IT';
  if (/\benglish\b|\benh\b|\beng\b/i.test(lower)) return 'EN';

  if (/[\u0400-\u04ff]/.test(text)) return 'OTHER';
  if (/[\u0600-\u06ff]/.test(text)) return 'OTHER';
  if (/[\u0590-\u05ff]/.test(text)) return 'OTHER';
  if (/[\u0e00-\u0e7f]/.test(text)) return 'OTHER';

  return 'OTHER';
};

export const inferLanguageFromImageSignals = (signals: ImageLanguageSignals): CardLanguageTag => {
  const blob = [signals.alt, signals.title, signals.src]
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .join(' ');
  if (!blob) return 'UNKNOWN';

  const fromText = inferLanguageTagFromText(blob);
  if (fromText !== 'UNKNOWN' && fromText !== 'OTHER') return fromText;

  const lower = blob.toLowerCase();
  if (/(?:^|[/_-])(jp|jpn|japanese)(?:[/_-]|$)/i.test(lower)) return 'JP';
  if (/(?:^|[/_-])(kr|kor|korean)(?:[/_-]|$)/i.test(lower)) return 'KR';
  if (/(?:^|[/_-])(cn|zh|chinese)(?:[/_-]|$)/i.test(lower)) return 'CN';
  if (/(?:^|[/_-])(es|spanish|espanol|espa\u00f1ol)(?:[/_-]|$)/i.test(lower)) return 'ES';
  if (/(?:^|[/_-])(fr|french)(?:[/_-]|$)/i.test(lower)) return 'FR';
  if (/(?:^|[/_-])(de|german)(?:[/_-]|$)/i.test(lower)) return 'DE';
  if (/(?:^|[/_-])(pt|portuguese)(?:[/_-]|$)/i.test(lower)) return 'PT';
  if (/(?:^|[/_-])(it|italian)(?:[/_-]|$)/i.test(lower)) return 'IT';

  const altTitle = `${signals.alt ?? ''} ${signals.title ?? ''}`.trim();
  if (altTitle && inferLanguageTagFromText(altTitle) !== 'OTHER') return inferLanguageTagFromText(altTitle);

  return fromText;
};

export const inferLanguageFromTcgContext = (raw: unknown): CardLanguageTag => {
  const t = String(raw || '').trim().toLowerCase();
  if (!t) return 'UNKNOWN';
  if (t.includes('english')) return 'EN';
  if (t.includes('japanese')) return 'JP';
  if (t.includes('korean')) return 'KR';
  if (t.includes('chinese')) return 'CN';
  if (t.includes('spanish')) return 'ES';
  if (t.includes('french')) return 'FR';
  if (t.includes('german')) return 'DE';
  if (t.includes('portuguese')) return 'PT';
  if (t.includes('italian')) return 'IT';
  return inferLanguageTagFromText(raw);
};

export const isEnglishMarketContext = (language: string | null | undefined): boolean => {
  const t = String(language ?? '').trim().toLowerCase();
  return !t || t.includes('english') || t === 'en';
};

export const mergeLanguageTags = (...tags: CardLanguageTag[]): CardLanguageTag => {
  let out: CardLanguageTag = 'UNKNOWN';
  for (const tag of tags) out = pickStronger(out, tag);
  return out;
};

export const assessSuspiciousNonEnglish = (opts: {
  languageTag: CardLanguageTag;
  marketLanguage?: string | null;
}): { suspiciousLanguagePump: boolean; suspiciousReason: string | null } => {
  const { languageTag, marketLanguage } = opts;
  if (!isEnglishMarketContext(marketLanguage)) {
    return { suspiciousLanguagePump: false, suspiciousReason: null };
  }
  if (languageTag === 'EN' || languageTag === 'UNKNOWN') {
    return { suspiciousLanguagePump: false, suspiciousReason: null };
  }
  return {
    suspiciousLanguagePump: true,
    suspiciousReason: 'non_english_in_english_market',
  };
};

export const inferListingLanguage = (opts: {
  title?: string | null;
  imageUrl?: string | null;
  imageAlt?: string | null;
  imageTitle?: string | null;
  marketLanguage?: string | null;
}): { languageTag: CardLanguageTag; suspiciousLanguagePump: boolean; suspiciousReason: string | null } => {
  const fromTitle = inferLanguageTagFromText(opts.title);
  const fromImage = inferLanguageFromImageSignals({
    alt: opts.imageAlt,
    title: opts.imageTitle,
    src: opts.imageUrl,
  });
  const languageTag = mergeLanguageTags(fromTitle, fromImage);
  const suspicious = assessSuspiciousNonEnglish({ languageTag, marketLanguage: opts.marketLanguage });
  return { languageTag, ...suspicious };
};
