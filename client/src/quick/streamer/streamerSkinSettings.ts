import { DEFAULT_STREAMER_SKIN_ID, normalizeStreamerSkinId } from './skins/registry';
import type { StreamerSkinId } from './skins/types';

export const STORAGE_KEY_STREAMER_SKIN = 'pcgr:streamer:skin:v1';
/** Legacy light/dark toggle — migrated on first load when skin key is absent. */
export const STORAGE_KEY_STREAMER_LIGHT_LEGACY = 'pcgr:streamer:light:v1';

export function loadStreamerSkinId(): StreamerSkinId {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_STREAMER_SKIN);
    if (raw) {
      return normalizeStreamerSkinId(raw);
    }
    const legacyLight = localStorage.getItem(STORAGE_KEY_STREAMER_LIGHT_LEGACY);
    if (legacyLight != null) {
      return legacyLight === '1' ? 'default-light' : 'default-dark';
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_STREAMER_SKIN_ID;
}

export function saveStreamerSkinId(id: StreamerSkinId): void {
  try {
    localStorage.setItem(STORAGE_KEY_STREAMER_SKIN, id);
  } catch {
    /* quota */
  }
}
