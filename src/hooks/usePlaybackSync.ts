import { useEffect, useRef } from 'react';
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
  }, [player, user?.id, currentSong?.id, isPlaying, queue.length]);
}
