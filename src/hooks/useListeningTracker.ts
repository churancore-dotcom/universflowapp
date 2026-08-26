// Measures real audible listening time.
//
// Server play events carry no duration, so "minutes listened" could only ever be
// an estimate. This sampler watches the player and records the seconds a track
// was genuinely audible into the device-local listen log.

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
  const lastFingerprint = useRef<string | null>(null);
  const lastProgress = useRef<number>(0);

  // Count today as an active day the moment the app is opened with a session.
  useEffect(() => {
    touchListenDay(userId);
  }, [userId]);

  // A new track start is a real play.
  useEffect(() => {
    if (!currentSong?.title) return;
    const fp = trackFingerprint(currentSong.title, currentSong.artist);
    if (fp === lastFingerprint.current) return;
    lastFingerprint.current = fp;
    lastProgress.current = 0;
    recordListenPlay(userId);
  }, [currentSong?.title, currentSong?.artist, userId]);

  // Sample audible seconds while playing.
  useEffect(() => {
    if (!isPlaying || !currentSong?.title) return;
    lastProgress.current = playerProgressStore.getEstimatedProgress();
    const fp = trackFingerprint(currentSong.title, currentSong.artist);

    const id = window.setInterval(() => {
      const now = playerProgressStore.getEstimatedProgress();
      const delta = now - lastProgress.current;
      lastProgress.current = now;
      // Only count forward movement within a plausible window — seeks and track
      // changes must never inflate the number.
      if (delta > 0 && delta <= (SAMPLE_MS / 1000) * 1.6) {
        recordListenSeconds(userId, Math.round(delta), fp);
      }
    }, SAMPLE_MS);

    return () => window.clearInterval(id);
  }, [isPlaying, currentSong?.title, currentSong?.artist, userId]);
}
