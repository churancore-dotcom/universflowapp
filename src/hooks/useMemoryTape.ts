/**
 * Memory Tape playback.
 *
 * Plays a list of Moments back to back: for each one it starts the real track,
 * waits until the stream is actually rolling, jumps to the bookmarked second,
 * plays a short clip, then advances. Everything is timer + ref based so the
 * 250ms progress ticks never re-render the page.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePlayer } from '@/contexts/PlayerContext';
import { playerProgressStore } from '@/lib/playerProgressStore';
import { clampClipMs, momentToSong, type Moment } from '@/lib/moments';
import { toast } from 'sonner';

const SEEK_POLL_MS = 180;
const SEEK_TIMEOUT_MS = 12_000;

interface UseMemoryTapeReturn {
  isTapePlaying: boolean;
  currentMomentId: string | null;
  startTape: (moments: Moment[], startIndex?: number) => void;
  stopTape: () => void;
}

export const useMemoryTape = (): UseMemoryTapeReturn => {
  const { playSong, seek, pause } = usePlayer();
  const [isTapePlaying, setIsTapePlaying] = useState(false);
  const [currentMomentId, setCurrentMomentId] = useState<string | null>(null);

  const listRef = useRef<Moment[]>([]);
  const indexRef = useRef(0);
  const pollRef = useRef<number | null>(null);
  const advanceRef = useRef<number | null>(null);
  const activeRef = useRef(false);

  const clearTimers = useCallback(() => {
    if (pollRef.current !== null) { window.clearInterval(pollRef.current); pollRef.current = null; }
    if (advanceRef.current !== null) { window.clearTimeout(advanceRef.current); advanceRef.current = null; }
  }, []);

  const stopTape = useCallback(() => {
    activeRef.current = false;
    clearTimers();
    setIsTapePlaying(false);
    setCurrentMomentId(null);
    pause();
  }, [clearTimers, pause]);

  const playAt = useCallback((index: number) => {
    const list = listRef.current;
    if (!activeRef.current) return;
    if (index >= list.length) {
      activeRef.current = false;
      clearTimers();
      setIsTapePlaying(false);
      setCurrentMomentId(null);
      toast.success('That was your tape', { description: 'Every second you saved, back to back.' });
      return;
    }

    const moment = list[index];
    indexRef.current = index;
    setCurrentMomentId(moment.id);
    clearTimers();

    playerProgressStore.reset();
    playSong(momentToSong(moment), undefined, list.map(momentToSong));

    const startedAt = Date.now();
    let seeked = false;
    pollRef.current = window.setInterval(() => {
      if (!activeRef.current) { clearTimers(); return; }
      const rolling = playerProgressStore.getDuration() > 0 && playerProgressStore.getPlaying();
      const timedOut = Date.now() - startedAt > SEEK_TIMEOUT_MS;
      if (!rolling && !timedOut) return;

      if (pollRef.current !== null) { window.clearInterval(pollRef.current); pollRef.current = null; }

      if (timedOut && !rolling) {
        // This track never started (dead source) — skip to the next memory.
        playAt(indexRef.current + 1);
        return;
      }

      if (!seeked) {
        seeked = true;
        const target = moment.positionMs / 1000;
        const duration = playerProgressStore.getDuration();
        seek(duration > 0 ? Math.min(target, Math.max(0, duration - 2)) : target);
      }

      advanceRef.current = window.setTimeout(() => {
        playAt(indexRef.current + 1);
      }, clampClipMs(moment.clipMs));
    }, SEEK_POLL_MS);
  }, [clearTimers, playSong, seek]);

  const startTape = useCallback((moments: Moment[], startIndex = 0) => {
    const list = moments.filter((m) => m.songId);
    if (!list.length) {
      toast.info('Save a moment first', { description: 'Tap the heart-beat button while a song is playing.' });
      return;
    }
    listRef.current = list;
    activeRef.current = true;
    setIsTapePlaying(true);
    playAt(Math.min(Math.max(0, startIndex), list.length - 1));
  }, [playAt]);

  useEffect(() => () => {
    activeRef.current = false;
    if (pollRef.current !== null) window.clearInterval(pollRef.current);
    if (advanceRef.current !== null) window.clearTimeout(advanceRef.current);
  }, []);

  return { isTapePlaying, currentMomentId, startTape, stopTape };
};

export default useMemoryTape;
