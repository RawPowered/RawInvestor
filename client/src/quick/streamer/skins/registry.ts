import { brewSkin } from './brew';
import { defaultDarkSkin } from './defaultDark';
import { defaultLightSkin } from './defaultLight';
import type { StreamerSkinDefinition, StreamerSkinId } from './types';

export const STREAMER_SKINS: Record<StreamerSkinId, StreamerSkinDefinition> = {
  'default-dark': defaultDarkSkin,
  'default-light': defaultLightSkin,
  brew: brewSkin,
};

export const STREAMER_SKIN_IDS = Object.keys(STREAMER_SKINS) as StreamerSkinId[];

export const STREAMER_SKIN_OPTIONS = STREAMER_SKIN_IDS.map((id) => ({
  id,
  label: STREAMER_SKINS[id].label,
  description: STREAMER_SKINS[id].description,
}));

export const DEFAULT_STREAMER_SKIN_ID: StreamerSkinId = 'default-dark';

export function getStreamerSkin(id: StreamerSkinId): StreamerSkinDefinition {
  return STREAMER_SKINS[id] ?? STREAMER_SKINS[DEFAULT_STREAMER_SKIN_ID];
}

export function normalizeStreamerSkinId(raw: unknown): StreamerSkinId {
  if (raw === 'default-light' || raw === 'brew' || raw === 'default-dark') {
    return raw;
  }
  return DEFAULT_STREAMER_SKIN_ID;
}
