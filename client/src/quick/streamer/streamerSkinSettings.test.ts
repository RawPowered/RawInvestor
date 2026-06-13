import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  STORAGE_KEY_STREAMER_LIGHT_LEGACY,
  STORAGE_KEY_STREAMER_SKIN,
  loadStreamerSkinId,
  saveStreamerSkinId,
} from './streamerSkinSettings';

function installLocalStorageMock() {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => {
      store.clear();
    },
  });
}

describe('streamerSkinSettings', () => {
  beforeEach(() => {
    installLocalStorageMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to default-dark when no keys exist', () => {
    expect(loadStreamerSkinId()).toBe('default-dark');
  });

  it('loads saved skin id', () => {
    saveStreamerSkinId('brew');
    expect(loadStreamerSkinId()).toBe('brew');
  });

  it('normalizes unknown skin id to default-dark', () => {
    localStorage.setItem(STORAGE_KEY_STREAMER_SKIN, 'not-a-skin');
    expect(loadStreamerSkinId()).toBe('default-dark');
  });

  it('migrates legacy light flag when skin key is absent', () => {
    localStorage.setItem(STORAGE_KEY_STREAMER_LIGHT_LEGACY, '1');
    expect(loadStreamerSkinId()).toBe('default-light');
    localStorage.setItem(STORAGE_KEY_STREAMER_LIGHT_LEGACY, '0');
    expect(loadStreamerSkinId()).toBe('default-dark');
  });

  it('prefers skin key over legacy light flag', () => {
    localStorage.setItem(STORAGE_KEY_STREAMER_LIGHT_LEGACY, '1');
    localStorage.setItem(STORAGE_KEY_STREAMER_SKIN, 'brew');
    expect(loadStreamerSkinId()).toBe('brew');
  });
});
