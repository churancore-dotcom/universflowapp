import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useOptionalPlayer } from '@/contexts/PlayerContext';
import { playerProgressStore } from '@/lib/playerProgressStore';
import { getDeviceId, getDeviceLabel } from '@/lib/deviceId';

/**
 * Cross-Device Sync: pushes the user's current playback state
 * (song, queue snapshot, position, device) to the backend so they can
 * resume on any other signed-in device.
 */
export function usePlaybackSync() {
  const { user } = useAuth();
  const player = useOptionalPlayer();
  const currentSong = player?.currentSong ?? null;
  const isPlaying = player?.isPlaying ?? false;
  const queue = player?.queue ?? [];
  const lastWriteRef = useRef<number>(0);
  const lastSongKeyRef = useRef<string>('');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!player || !user || !currentSong) return;

    const songKey = `${currentSong.id}|${isPlaying ? 1 : 0}`;
    const songChanged = songKey !== lastSongKeyRef.current;
    lastSongKeyRef.current = songKey;

    // Debounce: immediate write on song/play-state change, else every 10s
    const now = Date.now();
    const delay = songChanged ? 600 : Math.max(0, 10_000 - (now - lastWriteRef.current));

    const t = window.setTimeout(async () => {
      lastWriteRef.current = Date.now();
      const payload = {
        user_id: user.id,
        // Strip large/unused fields — keep song lean
        song: {
          id: currentSong.id,
          title: currentSong.title,
          artist: currentSong.artist,
          album: currentSong.album ?? null,
          cover_url: currentSong.cover_url ?? null,
          audio_url: currentSong.audio_url,
          duration: currentSong.duration ?? null,
          source: currentSong.source ?? 'library',
        },
        queue: queue.slice(0, 30).map((s) => ({
          id: s.id,
          title: s.title,
          artist: s.artist,
          cover_url: s.cover_url ?? null,
          audio_url: s.audio_url,
          source: s.source ?? 'library',
        })),
        position_seconds: Math.max(0, playerProgressStore.getProgress() || 0),
        is_playing: isPlaying,
        device_id: getDeviceId(),
        device_label: getDeviceLabel(),
        updated_at: new Date().toISOString(),
      };

      await supabase.from('playback_state').upsert(payload, { onConflict: 'user_id' });
    }, delay);

    return () => window.clearTimeout(t);
  }, [player, user?.id, currentSong?.id, isPlaying, queue.length, tick]);

  // The effect above only re-ran on song/play changes, so the saved position
  // froze at the start of each song. Re-arm it every 10s while playing and
  // flush immediately when the app goes to the background.
  useEffect(() => {
    if (!isPlaying || !user) return;
    const iv = window.setInterval(() => setTick((n) => n + 1), 10_000);
    const onHide = () => { if (document.visibilityState === 'hidden') { lastSongKeyRef.current = ''; setTick((n) => n + 1); } };
    document.addEventListener('visibilitychange', onHide);
    return () => { window.clearInterval(iv); document.removeEventListener('visibilitychange', onHide); };
  }, [isPlaying, user?.id]);
}
