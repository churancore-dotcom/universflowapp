import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_MIX,
  STEM_PRESETS,
  clampMix,
  isDefaultMix,
  getPresetForMix,
  describeMix,
  loadMix,
  saveMix,
  saveRemixForSong,
  getRemixForSong,
  removeRemixForSong,
  countRemixes,
} from '../stemLab';

// Node test env has no localStorage — stub a tiny in-memory one.
const store = new Map<string, string>();
(globalThis as { localStorage?: Storage }).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
} as Storage;

beforeEach(() => {
  store.clear();
});

describe('clampMix', () => {
  it('clamps out-of-range faders', () => {
    const m = clampMix({ vocals: 500, backing: -20, shine: 130, width: 999 });
    expect(m).toEqual({ vocals: 140, backing: 0, shine: 100, width: 100 });
  });

  it('fills missing faders with defaults', () => {
    expect(clampMix({ vocals: 0 })).toEqual({ ...DEFAULT_MIX, vocals: 0 });
  });
});

describe('presets', () => {
  it('karaoke silences the vocal stem', () => {
    const karaoke = STEM_PRESETS.find((p) => p.id === 'karaoke')!;
    expect(karaoke.mix.vocals).toBe(0);
    expect(karaoke.mix.backing).toBeGreaterThan(0);
  });

  it('a cappella silences the backing stem', () => {
    const acapella = STEM_PRESETS.find((p) => p.id === 'acapella')!;
    expect(acapella.mix.backing).toBe(0);
  });

  it('recognises a preset mix', () => {
    const karaoke = STEM_PRESETS.find((p) => p.id === 'karaoke')!;
    expect(getPresetForMix(karaoke.mix)?.id).toBe('karaoke');
    expect(getPresetForMix({ vocals: 61, backing: 100, shine: 0, width: 50 })).toBeNull();
  });
});

describe('describeMix', () => {
  it('labels the default mix', () => {
    expect(isDefaultMix(DEFAULT_MIX)).toBe(true);
    expect(describeMix(DEFAULT_MIX)).toBe('Original mix');
  });

  it('labels custom mixes with levels', () => {
    expect(describeMix({ vocals: 0, backing: 100, shine: 0, width: 50 })).toContain('Vocals 0%');
  });
});

describe('persistence', () => {
  it('round-trips the current mix', () => {
    const mix = clampMix({ vocals: 20, backing: 120, shine: 40, width: 70 });
    saveMix(mix);
    expect(loadMix()).toEqual(mix);
  });

  it('returns defaults when nothing is stored or data is corrupt', () => {
    expect(loadMix()).toEqual(DEFAULT_MIX);
    window.localStorage.setItem('uf-stemlab-mix', '{nope');
    expect(loadMix()).toEqual(DEFAULT_MIX);
  });
});

describe('per-song remix memory', () => {
  it('saves, reads and removes a remix for a song', () => {
    const mix = clampMix({ vocals: 0 });
    expect(getRemixForSong('song-1')).toBeNull();
    saveRemixForSong('song-1', mix);
    expect(getRemixForSong('song-1')).toEqual(mix);
    expect(countRemixes()).toBe(1);
    removeRemixForSong('song-1');
    expect(getRemixForSong('song-1')).toBeNull();
  });

  it('keeps remixes for different songs separate', () => {
    saveRemixForSong('a', clampMix({ vocals: 0 }));
    saveRemixForSong('b', clampMix({ backing: 0 }));
    expect(getRemixForSong('a')!.vocals).toBe(0);
    expect(getRemixForSong('b')!.backing).toBe(0);
    expect(countRemixes()).toBe(2);
  });
});
