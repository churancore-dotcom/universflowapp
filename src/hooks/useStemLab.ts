import { useCallback, useEffect, useState } from 'react';
import {
  setStemVocalLevel,
  setStemBackingLevel,
  setVocalMix,
  setInstrumentalMix,
} from '@/lib/audioEngine';
import { setNativeStemMix } from '@/lib/nativePlayer';
import {
  StemMix,
  DEFAULT_MIX,
  clampMix,
  loadMix,
  saveMix,
  getRemixForSong,
  saveRemixForSong,
  removeRemixForSong,
  setActiveStemMix,
} from '@/lib/stemLab';

/** Push a mix into the live audio engine. */
export function applyStemMix(mix: StemMix) {
  const m = setActiveStemMix(clampMix(mix));
  setStemVocalLevel(m.vocals);
  setStemBackingLevel(m.backing);
  setVocalMix(m.shine);
  setInstrumentalMix(m.width);
  void setNativeStemMix(m.vocals, m.backing, m.shine, m.width);
  try { window.dispatchEvent(new CustomEvent('uf-stem-changed', { detail: m })); } catch { /* SSR */ }
}

export function useStemLab() {
  const [mix, setMixState] = useState<StemMix>(() => loadMix());
  const [remixSongId, setRemixSongId] = useState<string | null>(null);

  // Apply the persisted mix once the engine is up (it re-applies on rebuild too).
  useEffect(() => {
    applyStemMix(loadMix());
  }, []);

  const setMix = useCallback((next: Partial<StemMix>) => {
    setMixState((prev) => {
      const merged = clampMix({ ...prev, ...next });
      applyStemMix(merged);
      saveMix(merged);
      return merged;
    });
  }, []);

  const reset = useCallback(() => {
    setMixState(() => {
      const m = { ...DEFAULT_MIX };
      applyStemMix(m);
      saveMix(m);
      return m;
    });
  }, []);

  /** Auto-apply a saved remix when a new song starts; restore base mix otherwise. */
  const handleSongChange = useCallback((songId: string | null) => {
    setRemixSongId(songId);
    if (!songId) return;
    const remix = getRemixForSong(songId);
    if (remix) {
      setMixState(remix);
      applyStemMix(remix);
    } else {
      const base = loadMix();
      setMixState(base);
      applyStemMix(base);
    }
  }, []);

  const saveRemix = useCallback((songId: string) => {
    saveRemixForSong(songId, mix);
  }, [mix]);

  const removeRemix = useCallback((songId: string) => {
    removeRemixForSong(songId);
  }, []);

  const hasRemixFor = useCallback((songId: string | null) => {
    return songId ? getRemixForSong(songId) !== null : false;
  }, []);

  return { mix, setMix, reset, handleSongChange, saveRemix, removeRemix, hasRemixFor, remixSongId };
}
