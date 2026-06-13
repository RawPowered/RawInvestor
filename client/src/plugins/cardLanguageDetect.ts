export type CardLanguageTag = 'EN' | 'JP' | 'KR' | 'CN' | 'ES' | 'FR' | 'DE' | 'PT' | 'IT' | 'OTHER' | 'UNKNOWN';

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

export const isEnglishMarketContext = (language: string | null | undefined): boolean => {
  const t = String(language ?? '').trim().toLowerCase();
  return !t || t.includes('english') || t === 'en';
};

export const mergeLanguageTags = (...tags: CardLanguageTag[]): CardLanguageTag => {
  let out: CardLanguageTag = 'UNKNOWN';
  for (const tag of tags) out = pickStronger(out, tag);
  return out;
};

export const inferLanguageTag = inferLanguageTagFromText;
