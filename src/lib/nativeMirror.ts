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
let lastMasterVolume = 1;
let nativeAudible = false;
let pendingNativeUrl: string | null = null;
let nativeTakeoverTimer: number | null = null;

const isPlayableHttpUrl = (url: string | null | undefined): url is string =>
  !!url && typeof url === 'string' && /^https?:\/\//i.test(url);

export function attachNativeMirror(audio: HTMLAudioElement, opts: AttachOptions): void {
  if (!isNativePlayerAvailable()) return;
  if (attached) return; // single primary element only
  attached = true;

  const muteShadowAudio = () => {
    try {
      audio.muted = true;
      audio.volume = 0;
    } catch { /* ignore */ }
  };

  const clearNativeTakeoverTimer = () => {
    if (nativeTakeoverTimer != null) {
      window.clearTimeout(nativeTakeoverTimer);
      nativeTakeoverTimer = null;
    }
  };

  const restoreWebAudioFallback = () => {
    clearNativeTakeoverTimer();
    pendingNativeUrl = null;
    nativeAudible = false;
    void ExoPlayerPlugin.stop().catch(() => undefined);
    try {
      audio.muted = false;
      audio.volume = lastMasterVolume;
      if (audio.src && audio.paused) void audio.play().catch(() => undefined);
    } catch { /* ignore */ }
  };

  const startExo = async (url: string) => {
    const song = opts.getSong();
    const title = song?.title || 'Universe Flow';
    const artist = song?.artist || song?.author || '';
    const artworkUrl = song?.thumbnail || song?.cover_url || song?.image_url || undefined;
    lastPlayCallAt = Date.now();
    nativeAudible = false;
    pendingNativeUrl = url;
    clearNativeTakeoverTimer();
    try {
      await ExoPlayerPlugin.play({ url, title, artist, artworkUrl });
      // Do NOT mute the WebView shadow immediately. The native bridge resolves
      // after ExoPlayer accepts the MediaItem, not after audio is actually
      // audible. Muting here was the root cause of "tap song → silence → skip".
      // We only mute after the native listener reports real `playing` below.
      nativeTakeoverTimer = window.setTimeout(() => {
        if (!nativeAudible && pendingNativeUrl === url) {
          // Exo is still buffering/stuck; keep the user's song audible via the
          // normal HTMLAudioElement instead of leaving the app silent.
          restoreWebAudioFallback();
        }
      }, 5000);
    } catch (e) {
      console.warn('[nativeMirror] ExoPlayer.play failed', (e as Error)?.message);
      // Permanent safety net: if the native service cannot start, do NOT leave
      // the only active HTMLAudioElement muted. Fall back to audible WebView
      // playback instead of creating silent tracks that auto-advance.
      restoreWebAudioFallback();
      opts.onUnrecoverableError?.();
    }
  };

  // src changes → restart ExoPlayer
  audio.addEventListener('loadstart', () => {
    // Use the assigned src, not currentSrc: currentSrc can change during CDN /
    // googlevideo redirects and retrigger this path mid-song, which restarted
    // ExoPlayer and caused auto-stops/auto-skips.
    const src = audio.src;
    if (!isPlayableHttpUrl(src)) return;
    if (src === lastUrl) return;
    lastUrl = src;
    void startExo(src);
  });

  audio.addEventListener('play', () => {
    if (!nativeAudible) return;
    // Avoid duplicate play() right after a fresh start.
    if (Date.now() - lastPlayCallAt < 500) return;
    void ExoPlayerPlugin.resume().catch(() => undefined);
  });

  audio.addEventListener('pause', () => {
    if (!nativeAudible) return;
    // System / WebView background throttling fires `pause` even though the user
    // didn't pause. ExoPlayer is what keeps audible playback alive in the
    // background, so we ignore pause events fired while the page is hidden.
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (audio.ended) return;
    void ExoPlayerPlugin.pause().catch(() => undefined);
  });

  audio.addEventListener('seeked', () => {
    if (!nativeAudible) return;
    const positionMs = Math.max(0, Math.floor(audio.currentTime * 1000));
    void ExoPlayerPlugin.seekTo({ positionMs }).catch(() => undefined);
  });

  audio.addEventListener('emptied', () => {
    // `emptied` also fires during a legitimate `audio.load()` for the next
    // source. Stopping ExoPlayer here races with startExo() and can stop every
    // song right after it starts. Only stop when the element was truly cleared.
    if (!audio.src) {
      lastUrl = null;
      pendingNativeUrl = null;
      clearNativeTakeoverTimer();
      void ExoPlayerPlugin.stop().catch(() => undefined);
    }
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
      if (s.state === 'playing' && pendingNativeUrl) {
        nativeAudible = true;
        pendingNativeUrl = null;
        clearNativeTakeoverTimer();
        muteShadowAudio();
        return;
      }
      if (s.state === 'ended') {
        nativeAudible = false;
        pendingNativeUrl = null;
        clearNativeTakeoverTimer();
        // Native ExoPlayer is authoritative on Android. Dispatch a dedicated
        // event so PlayerContext can ignore premature muted-WebView `ended`
        // events and only advance when ExoPlayer really finishes.
        audio.dispatchEvent(new Event('uf-native-ended'));
      }
    }).then((h) => { stateUnlisten = () => h.remove(); }).catch(() => undefined);

    ExoPlayerPlugin.addListener('playbackError', (data) => {
      const e = data as ExoPlaybackError;
      console.warn('[nativeMirror] ExoPlayer error', e?.message);
      restoreWebAudioFallback();
      opts.onUnrecoverableError?.();
    }).then((h) => { errorUnlisten = () => h.remove(); }).catch(() => undefined);
  }
}

export function setNativeMirrorVolume(volume: number): void {
  if (!isNativePlayerAvailable()) return;
  const v = Math.max(0, Math.min(1, volume));
  lastMasterVolume = v;
  void ExoPlayerPlugin.setVolume({ volume: v }).catch(() => undefined);
}

export function stopNativeMirror(): void {
  if (!isNativePlayerAvailable()) return;
  lastUrl = null;
  pendingNativeUrl = null;
  if (nativeTakeoverTimer != null) {
    window.clearTimeout(nativeTakeoverTimer);
    nativeTakeoverTimer = null;
  }
  nativeAudible = false;
  void ExoPlayerPlugin.stop().catch(() => undefined);
}

export function disposeNativeMirror(): void {
  attached = false;
  listenersBound = false;
  nativeAudible = false;
  pendingNativeUrl = null;
  if (nativeTakeoverTimer != null) {
    window.clearTimeout(nativeTakeoverTimer);
    nativeTakeoverTimer = null;
  }
  try { stateUnlisten?.(); } catch { /* ignore */ }
  try { progressUnlisten?.(); } catch { /* ignore */ }
  try { errorUnlisten?.(); } catch { /* ignore */ }
  stateUnlisten = progressUnlisten = errorUnlisten = null;
}
