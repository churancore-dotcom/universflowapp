import { useEffect, useRef } from 'react';
// TYPE-ONLY on purpose: PlayerContext imports this hook, so a value import
// here made a real runtime cycle (PlayerContext -> useMediaSession ->
// PlayerContext). In a chunked production build the module that loses the race
// sees an uninitialised namespace, which surfaced as
// "Cannot read properties of null (reading 'useState')".
import type { Song } from '@/contexts/PlayerContext';

interface UseMediaSessionOptions {
  song: Song | null;
  isPlaying: boolean;
  onPlay: () => void;
  onPause: () => void;
  onNext: () => void;
  onPrev: () => void;
  onSeek?: (time: number) => void;
  onStop?: () => void;
  duration?: number;
  progress?: number;
}

export const useMediaSession = ({
  song,
  isPlaying,
  onPlay,
  onPause,
  onNext,
  onPrev,
  onSeek,
  onStop,
  duration = 0,
  progress = 0,
}: UseMediaSessionOptions) => {
  const lastPositionUpdate = useRef(0);
  const updateInterval = useRef<number | null>(null);
  const progressRef = useRef(progress);
  const durationRef = useRef(duration);

  useEffect(() => {
    progressRef.current = progress;
    durationRef.current = duration;
  }, [progress, duration]);

  // Update metadata when song changes
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;

    if (song) {
      // Always include app logo as a fallback so lock screen / control center
      // always shows artwork (Universflow brand) even when cover is missing.
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      const logo192 = `${origin}/pwa-192x192.png`;
      const logo512 = `${origin}/pwa-512x512.png`;

      const cover = song.cover_url;
      const coverType = cover && /\.png(\?|$)/i.test(cover) ? 'image/png' : 'image/jpeg';

      const artwork = cover
        ? [
            { src: cover, sizes: '96x96', type: coverType },
            { src: cover, sizes: '128x128', type: coverType },
            { src: cover, sizes: '192x192', type: coverType },
            { src: cover, sizes: '256x256', type: coverType },
            { src: cover, sizes: '384x384', type: coverType },
            { src: cover, sizes: '512x512', type: coverType },
            { src: logo512, sizes: '512x512', type: 'image/png' },
          ]
        : [
            { src: logo192, sizes: '192x192', type: 'image/png' },
            { src: logo512, sizes: '512x512', type: 'image/png' },
          ];

      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: song.title,
          artist: song.artist,
          album: song.album || 'Univers Flow',
          artwork,
        });
      } catch (error) {
        console.warn('Failed to set media metadata:', error);
      }
    }
  }, [song]);

  // Update playback state
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;

    try {
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    } catch (error) {
      // Ignore playback state errors
    }
  }, [isPlaying]);

  // Set up action handlers
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;

    const handlers: Array<[MediaSessionAction, MediaSessionActionHandler | null]> = [
      ['play', () => onPlay()],
      ['pause', () => onPause()],
      ['previoustrack', () => onPrev()],
      ['nexttrack', () => onNext()],
      ['stop', onStop ? () => onStop() : null],
    ];

    // Add seek handlers if seek function is provided
    if (onSeek) {
      handlers.push(
        ['seekto', (details) => {
          if (details.seekTime !== undefined) {
            onSeek(details.seekTime);
          }
        }],
        ['seekbackward', (details) => {
          const skipTime = details.seekOffset || 10;
          onSeek(Math.max(progress - skipTime, 0));
        }],
        ['seekforward', (details) => {
          const skipTime = details.seekOffset || 10;
          onSeek(Math.min(progress + skipTime, duration));
        }]
      );
    }

    // Register all handlers
    handlers.forEach(([action, handler]) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch (error) {
        // Some actions may not be supported
      }
    });

    return () => {
      handlers.forEach(([action]) => {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch {
          // Ignore cleanup errors
        }
      });
    };
  }, [onPlay, onPause, onNext, onPrev, onSeek, onStop, progress, duration]);

  // Update position state with throttling for better performance
  useEffect(() => {
    if (!('mediaSession' in navigator) || !song) return;

    // Throttle position updates to avoid excessive calls
    const now = Date.now();
    if (now - lastPositionUpdate.current < 1000) return;
    lastPositionUpdate.current = now;

    try {
      navigator.mediaSession.setPositionState({
        duration: duration || 0,
        playbackRate: 1,
        position: Math.min(Math.max(0, progress), duration || 0),
      });
    } catch (error) {
      // Position state update failed, ignore
    }
  }, [progress, duration, song]);

  // Set up periodic position updates while playing
  useEffect(() => {
    if (!('mediaSession' in navigator) || !song || !isPlaying) {
      if (updateInterval.current) {
        clearInterval(updateInterval.current);
        updateInterval.current = null;
      }
      return;
    }

    // Update position every second while playing without recreating the timer
    // on every progress tick.
    updateInterval.current = window.setInterval(() => {
      try {
        const currentDuration = durationRef.current || 0;
        const currentProgress = progressRef.current || 0;
        navigator.mediaSession.setPositionState({
          duration: currentDuration,
          playbackRate: 1,
          position: Math.min(Math.max(0, currentProgress), currentDuration),
        });
      } catch {
        // Ignore errors
      }
    }, 1000);

    return () => {
      if (updateInterval.current) {
        clearInterval(updateInterval.current);
        updateInterval.current = null;
      }
    };
  }, [isPlaying, song?.id]);
};

export default useMediaSession;
