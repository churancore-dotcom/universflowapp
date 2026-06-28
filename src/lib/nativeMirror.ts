// nativeMirror.ts
// Bridges the existing HTMLAudioElement-based PlayerContext to the native
// ExoPlayer MediaSessionService on Android.
//
// Approach: keep the HTMLAudioElement as the canonical state source (so 2,500+
// lines of EQ/crossfade/lyrics/progress code keep working), but mute it and let
// ExoPlayer be the only AUDIBLE output. ExoPlayer runs in a foreground
// MediaSessionService — survives screen lock, audio-focus changes, and
// WebView background throttling.
//
// On web this module is a no-op.

import { ExoPlayerPlugin, isNativePlayerAvailable, type ExoPlaybackError, type ExoPlaybackProgress, type ExoPlaybackState } from '@/lib/nativePlayer';

interface Song {
  title?: string;
  artist?: string;
  author?: string;
  thumbnail?: string;
  cover_url?: string;
  image_url?: string;
}

type SongGetter = () => Song | null;
type ErrorHandler = () => void;

interface AttachOptions {
  getSong: SongGetter;
  onUnrecoverableError?: ErrorHandler;
}

let attached = false;
let lastUrl: string | null = null;
let lastPlayCallAt = 0;
let listenersBound = false;
let stateUnlisten: (() => void) | null = null;
let progressUnlisten: (() => void) | null = null;
let errorUnlisten: (() => void) | null = null;

const isPlayableHttpUrl = (url: string | null | undefined): url is string =>
  !!url && typeof url === 'string' && /^https?:\/\//i.test(url);

export function attachNativeMirror(audio: HTMLAudioElement, opts: AttachOptions): void {
  if (!isNativePlayerAvailable()) return;
  if (attached) return; // single primary element only
  attached = true;

  // ExoPlayer is the only audible output on native. Mute the HTML element but
  // keep it loading & ticking so timeupdate/ended/loadedmetadata still drive
  // the React state machine.
  try {
    audio.muted = true;
    audio.volume = 0;
  } catch { /* ignore */ }

  const startExo = async (url: string) => {
    const song = opts.getSong();
    const title = song?.title || 'Universe Flow';
    const artist = song?.artist || song?.author || '';
    const artworkUrl = song?.thumbnail || song?.cover_url || song?.image_url || undefined;
    lastPlayCallAt = Date.now();
    try {
      await ExoPlayerPlugin.play({ url, title, artist, artworkUrl });
    } catch (e) {
      console.warn('[nativeMirror] ExoPlayer.play failed', (e as Error)?.message);
    }
  };

  // src changes → restart ExoPlayer
  audio.addEventListener('loadstart', () => {
    const src = audio.currentSrc || audio.src;
    if (!isPlayableHttpUrl(src)) return;
    if (src === lastUrl) return;
    lastUrl = src;
    void startExo(src);
  });

  audio.addEventListener('play', () => {
    // Avoid duplicate play() right after a fresh start.
    if (Date.now() - lastPlayCallAt < 500) return;
    void ExoPlayerPlugin.resume().catch(() => undefined);
  });

  audio.addEventListener('pause', () => {
    // System / WebView background throttling fires `pause` even though the user
    // didn't pause. ExoPlayer is what keeps audible playback alive in the
    // background, so we ignore pause events fired while the page is hidden.
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (audio.ended) return;
    void ExoPlayerPlugin.pause().catch(() => undefined);
  });

  audio.addEventListener('seeked', () => {
    const positionMs = Math.max(0, Math.floor(audio.currentTime * 1000));
    void ExoPlayerPlugin.seekTo({ positionMs }).catch(() => undefined);
  });

  audio.addEventListener('emptied', () => {
    lastUrl = null;
    void ExoPlayerPlugin.stop().catch(() => undefined);
  });

  // The HTML audio element is muted, so we forward MASTER volume changes via a
  // dedicated setter (see setNativeMirrorVolume) — not via the element's
  // volumechange event (which would always read 0).

  if (!listenersBound) {
    listenersBound = true;

    ExoPlayerPlugin.addListener('playbackProgress', (data) => {
      const p = data as ExoPlaybackProgress;
      // Keep HTMLAudioElement in sync so progress UI, lyrics timer, and
      // last-position save (all already wired to HTMLAudioElement) stay
      // correct — especially after background recovery where the element may
      // have stalled but ExoPlayer kept moving forward.
      if (!isFinite(p.position) || !isFinite(p.duration)) return;
      try {
        if (p.duration > 0 && (!isFinite(audio.duration) || audio.duration === 0)) {
          // Soft-set duration via a tiny helper: HTMLAudioElement.duration is
          // read-only, so just rely on its native loadedmetadata to provide it.
          // We only sync currentTime when divergence is large to avoid loops.
        }
        const exoSec = p.position / 1000;
        if (Math.abs(audio.currentTime - exoSec) > 1.5) {
          audio.currentTime = exoSec;
        }
      } catch { /* ignore */ }
    }).then((h) => { progressUnlisten = () => h.remove(); }).catch(() => undefined);

    ExoPlayerPlugin.addListener('playbackStateChange', (data) => {
      const s = data as ExoPlaybackState;
      if (s.state === 'ended') {
        // Let HTMLAudioElement's own 'ended' handler advance the queue. If the
        // element didn't naturally fire ended (background WebView stall), we
        // dispatch one synthetically.
        if (!audio.ended) audio.dispatchEvent(new Event('ended'));
      }
    }).then((h) => { stateUnlisten = () => h.remove(); }).catch(() => undefined);

    ExoPlayerPlugin.addListener('playbackError', (data) => {
      const e = data as ExoPlaybackError;
      console.warn('[nativeMirror] ExoPlayer error', e?.message);
      opts.onUnrecoverableError?.();
    }).then((h) => { errorUnlisten = () => h.remove(); }).catch(() => undefined);
  }
}

export function setNativeMirrorVolume(volume: number): void {
  if (!isNativePlayerAvailable()) return;
  const v = Math.max(0, Math.min(1, volume));
  void ExoPlayerPlugin.setVolume({ volume: v }).catch(() => undefined);
}

export function stopNativeMirror(): void {
  if (!isNativePlayerAvailable()) return;
  lastUrl = null;
  void ExoPlayerPlugin.stop().catch(() => undefined);
}

export function disposeNativeMirror(): void {
  attached = false;
  listenersBound = false;
  try { stateUnlisten?.(); } catch { /* ignore */ }
  try { progressUnlisten?.(); } catch { /* ignore */ }
  try { errorUnlisten?.(); } catch { /* ignore */ }
  stateUnlisten = progressUnlisten = errorUnlisten = null;
}
