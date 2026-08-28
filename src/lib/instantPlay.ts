// INSTANT PLAY (Echo-Music behaviour)
//
// Echo-Music feels instant because it never resolves a stream *after* the tap —
// it resolves it *before*. This module pre-warms stream URLs for songs the user
// is about to play:
//
//   1. When a rail/list renders, the first few visible tracks are warmed.
//   2. The moment a finger touches a card (pointerdown / touchstart — which
//      fires ~80-250ms before `click`), that exact track is warmed.
//
// By the time playSong() runs, `resolveYouTubeVideoStream` / the native
// StreamResolver both hit an in-memory cache, so playback starts immediately.
//
// Everything here is fire-and-forget and de-duplicated: no UI state, no
// blocking, no errors surfaced.

import type { Song } from '@/contexts/PlayerContext';
import { prefetchIndexedTrack, prefetchYouTubeVideoStream } from '@/lib/musicIndexer';
import { isNativePlayerAvailable, StreamResolverPlugin } from '@/lib/nativePlayer';

const warmed = new Set<string>();
const WARM_TTL_MS = 5 * 60 * 1000;
const warmedAt = new Map<string, number>();

type WarmableSong = Partial<Song> & { videoId?: string | null };

export function getSongVideoId(song?: WarmableSong | null): string | null {
  if (!song) return null;
  const direct = (song.videoId || '').trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(direct)) return direct;
  const fromUrl = (song.audio_url || '').startsWith('yt-video:')
    ? song.audio_url!.replace('yt-video:', '').trim()
    : '';
  if (/^[a-zA-Z0-9_-]{11}$/.test(fromUrl)) return fromUrl;
  const id = (song.id || '').trim();
  if (id.startsWith('ytm-')) {
    const tail = id.slice(4);
    if (/^[a-zA-Z0-9_-]{11}$/.test(tail)) return tail;
  }
  return null;
}

function warmKey(song: WarmableSong): string {
  return getSongVideoId(song) || `${(song.artist || '').toLowerCase()}|${(song.title || '').toLowerCase()}`;
}

function alreadyPlayable(song: WarmableSong): boolean {
  const url = song.audio_url || '';
  return /^(https?:|blob:)/.test(url);
}

/**
 * Pre-resolve one song's stream so a tap plays instantly. Safe to call on every
 * pointerdown — repeat calls within the TTL are ignored.
 */
export function prewarmSong(song?: WarmableSong | null): void {
  if (!song || typeof window === 'undefined') return;
  if (alreadyPlayable(song)) return;
  const key = warmKey(song);
  if (!key || key === '|') return;
  const last = warmedAt.get(key) ?? 0;
  if (warmed.has(key) && Date.now() - last < WARM_TTL_MS) return;
  warmed.add(key);
  warmedAt.set(key, Date.now());

  const videoId = getSongVideoId(song);

  // Native (APK): warm the on-device resolver cache (JioSaavn → InnerTube).
  if (isNativePlayerAvailable()) {
    try {
      void StreamResolverPlugin.prefetch({
        tracks: [{ videoId: videoId || undefined, title: song.title || undefined, artist: song.artist || undefined }],
        limit: 1,
      });
    } catch { /* plugin missing — web path below still warms */ }
  }

  // Web + native fallback: warm the JS-side stream caches.
  if (videoId) prefetchYouTubeVideoStream(videoId, { title: song.title, artist: song.artist });
  else if (song.artist && song.title) prefetchIndexedTrack(song.artist, song.title);
}

/** Warm the first `limit` tracks of a rail/list as soon as it renders. */
export function prewarmSongs(songs?: Array<WarmableSong | null | undefined> | null, limit = 2): void {
  if (!songs?.length || typeof window === 'undefined') return;
  const batch = songs.filter(Boolean).slice(0, limit) as WarmableSong[];
  if (!batch.length) return;

  if (isNativePlayerAvailable()) {
    try {
      void StreamResolverPlugin.prefetch({
        tracks: batch.map((s) => ({
          videoId: getSongVideoId(s) || undefined,
          title: s.title || undefined,
          artist: s.artist || undefined,
        })),
        limit: batch.length,
      });
    } catch { /* ignore */ }
  }

  // Stagger the JS resolvers so a rail render never floods the network. Home
  // renders several rails at once, so warms are spaced generously and the
  // resolver's own low-priority queue absorbs the rest.
  batch.forEach((song, i) => {
    window.setTimeout(() => prewarmSong(song), 60 + i * 180);
  });

}

/** Spread onto any tappable song element to warm on finger-down. */
export function prewarmIntentProps(song?: WarmableSong | null) {
  const warm = () => prewarmSong(song);
  return {
    onPointerDown: warm,
    onPointerEnter: warm,
    onTouchStart: warm,
  } as const;
}
