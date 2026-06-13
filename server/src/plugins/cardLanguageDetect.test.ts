import { describe, expect, it } from 'vitest';
import {
  assessSuspiciousNonEnglish,
  inferLanguageFromImageSignals,
  inferLanguageTagFromText,
  inferListingLanguage,
} from './cardLanguageDetect.js';

describe('inferLanguageTagFromText', () => {
  it('detects common language keywords', () => {
    expect(inferLanguageTagFromText('Japanese Holo')).toBe('JP');
    expect(inferLanguageTagFromText('Korean version')).toBe('KR');
    expect(inferLanguageTagFromText('Spanish copy')).toBe('ES');
    expect(inferLanguageTagFromText('中文')).toBe('CN');
    expect(inferLanguageTagFromText('English')).toBe('EN');
  });
});

describe('inferLanguageFromImageSignals', () => {
  it('reads language hints from image URL', () => {
    expect(
      inferLanguageFromImageSignals({ src: 'https://cdn.example.com/japanese-card-front.jpg' })
    ).toBe('JP');
  });
});

describe('assessSuspiciousNonEnglish', () => {
  it('flags non-English in English market', () => {
    const out = assessSuspiciousNonEnglish({ languageTag: 'ES', marketLanguage: 'English' });
    expect(out.suspiciousLanguagePump).toBe(true);
    expect(out.suspiciousReason).toBe('non_english_in_english_market');
  });

  it('ignores English listings', () => {
    const out = assessSuspiciousNonEnglish({ languageTag: 'EN', marketLanguage: 'English' });
    expect(out.suspiciousLanguagePump).toBe(false);
  });
});

describe('inferListingLanguage', () => {
  it('combines title and image signals', () => {
    const out = inferListingLanguage({
      title: 'Pokemon card',
      imageUrl: 'https://img.example.com/korean-edition.jpg',
      marketLanguage: 'English',
    });
    expect(out.languageTag).toBe('KR');
    expect(out.suspiciousLanguagePump).toBe(true);
  });
});
