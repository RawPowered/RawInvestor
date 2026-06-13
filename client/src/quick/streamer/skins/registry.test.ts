import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STREAMER_SKIN_ID,
  STREAMER_SKIN_IDS,
  getStreamerSkin,
  normalizeStreamerSkinId,
} from './registry';

describe('streamer skin registry', () => {
  it('resolves every registered skin id', () => {
    for (const id of STREAMER_SKIN_IDS) {
      expect(getStreamerSkin(id).id).toBe(id);
    }
  });

  it('falls back to default for unknown ids', () => {
    expect(getStreamerSkin('unknown' as 'brew').id).toBe(DEFAULT_STREAMER_SKIN_ID);
    expect(normalizeStreamerSkinId('bogus')).toBe(DEFAULT_STREAMER_SKIN_ID);
  });

  it('brew skin includes backdrop and tagline', () => {
    const brew = getStreamerSkin('brew');
    expect(brew.tokens.backgroundImageUrl).toBe('./skins/brew/background.png');
    expect(brew.tokens.tagline?.text).toBe("WHAT'S UP BREWS?");
  });
});
