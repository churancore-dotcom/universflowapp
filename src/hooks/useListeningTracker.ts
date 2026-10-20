// Measures real audible listening time.
//
// Server play events carry no duration, so "minutes listened" could only ever be
// an estimate. This sampler watches the player and records the seconds a track
// was genuinely audible into the device-local listen log.
//
// APK note: Android WebViews throttle/suspend timers while the screen is off,
// so a fixed-interval delta check used to discard whole background sessions.
// We now count wall-clock time while playing (capped by real progress) and
// flush on pause, track change, and app backgrounding.

import { useEffect, useRef } from 'react';
import { usePlayer } from '@/contexts/PlayerContext';
import { useAuth } from '@/contexts/AuthContext';
import { playerProgressStore } from '@/lib/playerProgressStore';
import { recordListenPlay, recordListenSeconds, touchListenDay } from '@/lib/listenLog';
import { trackFingerprint } from '@/lib/listeningInsights';

const SAMPLE_MS = 15_000;

export function useListeningTracker() {
  const { currentSong, isPlaying } = usePlayer();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const lastKey = useRef<string | null>(null);

  useEffect(() => {
    touchListenDay(userId);
  }, [userId]);

  // A new track start (or a replay of the same track) is a real play.
  const songKey = currentSong ? `${currentSong.id ?? ''}|${currentSong.title}|${currentSong.artist}` : null;
  useEffect(() => {
    if (!songKey) return;
    if (songKey === lastKey.current) return;
    lastKey.current = songKey;
    recordListenPlay(userId);
  }, [songKey, userId]);

  // Detect replays of the same song (repeat-one / replay from start).
  useEffect(() => {
    if (!isPlaying || !songKey) return;
    let prev = playerProgressStore.getEstimatedProgress();
    const id = window.setInterval(() => {
      const now = playerProgressStore.getEstimatedProgress();
      if (prev > 30 && now < 5) recordListenPlay(userId);
      prev = now;
    }, 3_000);
    return () => window.clearInterval(id);
  }, [isPlaying, songKey, userId]);

  // Accumulate audible seconds while playing.
  useEffect(() => {
    if (!isPlaying || !currentSong?.title) return;
    const fp = trackFingerprint(currentSong.title, currentSong.artist);
    let wallStart = Date.now();
    let progStart = playerProgressStore.getEstimatedProgress();

    const flush = () => {
      const wall = (Date.now() - wallStart) / 1000;
      const now = playerProgressStore.getEstimatedProgress();
      const prog = now - progStart;
      wallStart = Date.now();
      progStart = now;
      if (wall <= 0) return;
      // Normal forward playback: trust progress, bounded by wall time.
      // Progress unreadable/reset (background, repeat): fall back to wall time.
      let secs = prog > 0 && prog <= wall * 1.5 + 2 ? Math.min(prog, wall + 1) : wall;
      // Never credit more than a full long track per flush.
      secs = Math.min(secs, 60 * 60);
      if (secs >= 1) recordListenSeconds(userId, Math.round(secs), fp);
    };

    const id = window.setInterval(flush, SAMPLE_MS);
    const onVis = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', flush);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [isPlaying, currentSong?.title, currentSong?.artist, userId]);
}
