import React, { createContext, useContext, useState, useRef, useEffect, useCallback } from 'react';
import { useMediaSession } from '@/hooks/useMediaSession';
import { useGlobalAudioEngine } from '@/hooks/useGlobalAudioEngine';
import { supabase } from '@/integrations/supabase/client';
import { resolveIndexedTrack, resolveYouTubeVideoStream, prefetchIndexedTrack, prefetchYouTubeVideoStream, invalidateYouTubeStream } from '@/lib/musicIndexer';
import { playerProgressStore, usePlayerProgress } from '@/lib/playerProgressStore';
import { recordPerfEvent } from '@/lib/perfMonitor';
import { resume as resumeAudioEngine } from '@/lib/audioEngine';
import { EQ_SETTINGS_KEY, getEQSettings, hasWebAudioEffects } from '@/lib/eqSettings';
import { wrapStreamUrl, isStreamProxyUrl } from '@/lib/streamProxy';
import { getRuntimePremium } from '@/lib/premiumState';
import { noteSongCompleted, primeAdEngine } from '@/lib/adEngine';
import { initNativeBridge } from '@/services/NativeBridge';
import { Capacitor } from '@capacitor/core';
import { isNativePlayerAvailable, InnerTubePlugin, ExoPlayerPlugin, resolveNativeMetadataStream, type ExoPlaybackProgress, type ExoPlaybackState, type ExoPlaybackError, type ExoMediaItemTransition, type NativeQueueTrack } from '@/lib/nativePlayer';
import { toast } from 'sonner';

interface YouTubePlayer {
  playVideo: () => void;
  pauseVideo: () => void;
  stopVideo?: () => void;
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  loadVideoById: (videoId: string, startSeconds?: number) => void;
  destroy: () => void;
  setVolume?: (volume: number) => void;
}

interface YouTubeAPI {
  Player: new (elementId: string | HTMLElement, config: Record<string, unknown>) => YouTubePlayer;
  PlayerState: {
    ENDED: number;
    PLAYING: number;
    PAUSED: number;
  };
}

declare global {
  interface Window {
    YT?: YouTubeAPI;
    onYouTubeIframeAPIReady?: () => void;
  }
}

interface CapacitorAppModule {
  App?: {
    addListener: (
      eventName: 'appStateChange',
      callback: (state: { isActive: boolean }) => void,
    ) => Promise<{ remove?: () => void }>;
  };
}

export interface Song {
  id: string;
  title: string;
  artist: string;
  album?: string;
  cover_url?: string;
  audio_url: string;
  duration?: number;
  artist_id?: string;
  artist_photo_url?: string;
  play_count?: number;
  genre?: string;
  mood?: string;
  created_at?: string;
  source?: 'library' | 'audius' | 'indexed';
}

const getSongIdentity = (song: Pick<Song, 'id' | 'title' | 'artist'>) =>
  `${song.id ?? ''}::${(song.artist ?? '').trim().toLowerCase()}::${(song.title ?? '').trim().toLowerCase()}`;

const reapplyNativeEqSoon = () => {
  // Native ExoPlayer may (re)allocate its audio session id at multiple points
  // between playQueue() and the first `playing` state: prepare, first render,
  // and each mediaItemTransition. Every rebind blanks the AudioEffect chain,
  // so we re-push the user's EQ multiple times over ~2s to guarantee the
  // slider values stick regardless of which rebind wins the race.
  const fire = () => { try { window.dispatchEvent(new Event('uf-eq-changed')); } catch {} };
  fire();
  [120, 350, 750, 1400, 2200].forEach((ms) => window.setTimeout(fire, ms));
};

type SavedPlayerState = {
  queue: Song[];
  index: number;
  song: Song | null;
  progress?: number;
  duration?: number;
  wasPlaying?: boolean;
  savedAt?: number;
};

const PLAYER_QUEUE_STATE_KEY = 'player_queue_state';
const NATIVE_RESTORE_WINDOW_MS = 45 * 60 * 1000;

const isNativeRuntime = () => {
  try {
    return Capacitor.isNativePlatform?.() === true;
  } catch {
    return false;
  }
};

interface PlayerContextType {
  currentSong: Song | null;
  isPlaying: boolean;
  volume: number;
  queue: Song[];
  shuffle: boolean;
  repeat: 'off' | 'all' | 'one';
  isExpanded: boolean;
  crossfade: boolean;
  crossfadeDuration: number;
  crossfadeCurve: 'linear' | 'equal-power' | 'smooth' | 'exponential';
  gaplessPro: boolean;
  audioElement: HTMLAudioElement | null;
  showPrerollAd: boolean;
  adType: 'start' | 'end';
  playSong: (song: Song, offlineUrl?: string | null, songsQueue?: Song[]) => void;
  togglePlay: () => void;
  pause: () => void;
  play: () => void;
  stopSong: () => void;
  nextSong: () => void;
  prevSong: () => void;
  seek: (time: number) => void;
  setVolume: (vol: number) => void;
  setQueue: (songs: Song[]) => void;
  addToQueue: (song: Song) => void;
  toggleShuffle: () => void;
  toggleRepeat: () => void;
  setExpanded: (expanded: boolean) => void;
  toggleCrossfade: () => void;
  setCrossfadeDuration: (seconds: number) => void;
  setCrossfadeCurve: (curve: 'linear' | 'equal-power' | 'smooth' | 'exponential') => void;
  toggleGaplessPro: () => void;
  onPrerollAdComplete: () => void;
}

const PlayerContext = createContext<PlayerContextType | undefined>(undefined);

const NATIVE_RESOLVED_STREAMS_KEY = 'uf_native_resolved_streams_v1';
const nativeResolvedStreamUrls = new Set<string>();
const nativeResolvedStreamVideoIds = new Map<string, string>();

const readNativeResolvedStreamUrls = () => {
  if (typeof window === 'undefined') return;
  try {
    const stored = JSON.parse(localStorage.getItem(NATIVE_RESOLVED_STREAMS_KEY) || '[]');
    if (Array.isArray(stored)) {
      stored.slice(-50).forEach((entry) => {
        const url = typeof entry === 'string' ? entry : typeof entry?.url === 'string' ? entry.url : null;
        const videoId = typeof entry?.videoId === 'string' ? entry.videoId : null;
        if (!url) return;
        nativeResolvedStreamUrls.add(url);
        if (videoId) nativeResolvedStreamVideoIds.set(url, videoId);
      });
    }
  } catch { /* ignore corrupt cache */ }
};

const markNativeResolvedStreamUrl = (url?: string | null, videoId?: string | null) => {
  if (!url || !url.startsWith('http')) return;
  nativeResolvedStreamUrls.add(url);
  if (videoId) nativeResolvedStreamVideoIds.set(url, videoId);
  if (typeof window === 'undefined') return;
  try {
    const stored = JSON.parse(localStorage.getItem(NATIVE_RESOLVED_STREAMS_KEY) || '[]');
    const list = Array.isArray(stored) ? stored : [];
    const next = [
      ...list.filter((entry) => (typeof entry === 'string' ? entry : entry?.url) !== url),
      { url, videoId: videoId || nativeResolvedStreamVideoIds.get(url) || null },
    ].slice(-50);
    localStorage.setItem(NATIVE_RESOLVED_STREAMS_KEY, JSON.stringify(next));
  } catch { /* best effort */ }
};

const isNativeResolvedStreamUrl = (url?: string | null) => {
  if (!url) return false;
  if (nativeResolvedStreamUrls.size === 0) readNativeResolvedStreamUrls();
  return nativeResolvedStreamUrls.has(url);
};

const getNativeResolvedVideoId = (url?: string | null) => {
  if (!url) return null;
  if (nativeResolvedStreamUrls.size === 0) readNativeResolvedStreamUrls();
  return nativeResolvedStreamVideoIds.get(url) || null;
};

const unwrapStreamProxyUrl = (url?: string | null) => {
  if (!url) return null;
  if (!isStreamProxyUrl(url)) return url;
  try {
    const parsed = new URL(url, typeof window !== 'undefined' ? window.location.href : 'http://localhost');
    return parsed.searchParams.get('u') || parsed.searchParams.get('url') || url;
  } catch {
    return url;
  }
};

const shouldUseAnonymousCors = (audioUrl?: string | null) => {
  if (!audioUrl) return false;
  if (audioUrl.startsWith('blob:') || audioUrl.startsWith('data:')) return false;
  if (!audioUrl.startsWith('http')) return false;
  // Native on-device YouTube URLs are signed for the user's phone IP. They must
  // be played directly with NO crossorigin attribute; forcing anonymous CORS
  // makes Android WebView reject the stream before playback even starts.
  if (isNativeResolvedStreamUrl(audioUrl)) return false;
  try {
    const parsed = new URL(audioUrl, window.location.href);
    if (parsed.origin === window.location.origin) return false;
    if (isStreamProxyUrl(audioUrl)) return true;
    if (parsed.pathname.includes('/functions/v1/music-indexer') && parsed.searchParams.has('audio')) return true;
    if (parsed.hostname.endsWith('supabase.co')) return true;
  } catch { /* fall through */ }
  // Unknown direct remote streams should stay on the native <audio> path. If EQ
  // needs WebAudio, buildStreamProxyUrl() first rewrites them to stream-proxy.
  return false;
};

const configureAudioElementSource = (audio: HTMLAudioElement, sourceUrl: string) => {
  // Guard: never assign empty/whitespace src — that triggers a spurious
  // MEDIA_ERR_SRC_NOT_SUPPORTED ("Empty src attribute") which then cascades
  // into the auto-skip handler and creates a skip-storm.
  if (!sourceUrl || !sourceUrl.trim()) {
    return;
  }

  if (shouldUseAnonymousCors(sourceUrl)) {
    audio.crossOrigin = 'anonymous';
  } else {
    audio.crossOrigin = null;
    audio.removeAttribute('crossorigin');
  }

  audio.src = sourceUrl;
  (audio as HTMLAudioElement & { __ufAssignedAt?: number }).__ufAssignedAt = Date.now();
  // Do not force-rebuild the WebAudio graph here. The audio element's real
  // media events (`loadstart`, `loadedmetadata`, `canplay`) already trigger the
  // EQ hook at the correct time; firing a microtask here caused repeated graph
  // rebuilds before the source was ready, which produced startup silence.
};

const shouldProxyStreamUrl = (sourceUrl: string) => {
  if (!sourceUrl.startsWith('http')) return false;
  // The most important APK fix: on-device Innertube returns googlevideo URLs
  // signed for the user's IP. If we send those URLs through the Supabase edge
  // proxy, YouTube sees a different IP and returns 403/empty media, so every tap
  // becomes "This song could not start". Play these URLs directly.
  if (isNativeResolvedStreamUrl(sourceUrl)) return false;

  try {
    const parsed = new URL(sourceUrl, window.location.href);
    if (parsed.origin === window.location.origin) return false;
    if (isStreamProxyUrl(sourceUrl)) return false;
    if (sourceUrl.includes('/functions/v1/music-indexer?audio=')) return false;

    // YouTube streams resolved by our edge function are signed for Supabase's
    // IP, not the user's device/browser. They must be fetched by stream-proxy.
    // Phone-resolved URLs are excluded earlier by isNativeResolvedStreamUrl().
    if (parsed.hostname.endsWith('googlevideo.com')) return true;

    // Always proxy external streams. This keeps the first byte CORS-clean, so
    // the WebAudio/EQ graph can attach instantly when the user enables effects
    // later; otherwise one raw load can permanently taint the element for that
    // song and make the equalizer look dead.
    return true;
  } catch {
    return false;
  }
};

// Cache the current access token so we can append it to <audio src> proxy URLs.
// (audio elements can't send custom Authorization headers.)
let cachedAccessToken: string | null = null;
supabase.auth.getSession().then(({ data }) => {
  cachedAccessToken = data.session?.access_token ?? null;
});
// Store the subscription so HMR / re-evaluation doesn't stack listeners.
const __tokenAuthSub = supabase.auth.onAuthStateChange((_event, session) => {
  cachedAccessToken = session?.access_token ?? null;
});
if (typeof window !== 'undefined') {
  const w = window as unknown as { __universflowTokenAuthSub?: { unsubscribe: () => void } };
  w.__universflowTokenAuthSub?.unsubscribe?.();
  w.__universflowTokenAuthSub = __tokenAuthSub.data.subscription;
}

/**
 * For Premium users we ALWAYS proxy external HTTP streams. That guarantees a
 * CORS-clean response from the very first byte so the WebAudio graph attaches
 * cleanly on `canplay` and EQ tweaks apply instantly — no reload, no glitch.
 * Free users get the raw URL (no EQ available, best background playback).
 */
const buildStreamProxyUrl = (sourceUrl: string) => {
  if (!shouldProxyStreamUrl(sourceUrl)) return sourceUrl;
  // ALWAYS proxy. The Premium gate used to live here, but it caused the
  // cold-boot EQ-is-dead bug: when the very first song loaded before the
  // Premium check resolved, the raw URL tainted the <audio> element and
  // the WebAudio graph could never attach to it again.
  return wrapStreamUrl(sourceUrl, { force: true });
};

const buildNativeExoPlayerUrl = (sourceUrl: string) => {
  if (!sourceUrl || !sourceUrl.startsWith('http')) return sourceUrl;
  if (isStreamProxyUrl(sourceUrl) || isNativeResolvedStreamUrl(sourceUrl)) return sourceUrl;
  try {
    const parsed = new URL(sourceUrl, typeof window !== 'undefined' ? window.location.href : 'http://localhost');
    // Edge-resolved googlevideo URLs are signed for Supabase's IP, so Android
    // ExoPlayer must fetch them through stream-proxy. Normal CDN/upload URLs do
    // not need CORS in ExoPlayer and should stay direct for fastest startup.
    if (parsed.hostname.endsWith('googlevideo.com')) return buildStreamProxyUrl(sourceUrl);
  } catch { /* keep original URL */ }
  return sourceUrl;
};

const isAudioProxyUrl = (url?: string | null) =>
  isStreamProxyUrl(url) || Boolean(url?.includes('/functions/v1/music-indexer?audio='));

const isLocalMediaSource = (url?: string | null) => {
  if (!url) return false;
  return url.startsWith('blob:') || url.startsWith('data:') || url.startsWith('file:') || url.startsWith('capacitor://');
};

// Only run WebAudio when Premium audio effects are actually enabled. Keeping
// flat/default playback on the native <audio> path is much faster and avoids
// Android background WebAudio suspension.
const isEqProcessingEnabled = () => {
  try { return getRuntimePremium() && hasWebAudioEffects(getEQSettings()); } catch { return false; }
};

const isAutoplayEnabled = () => {
  try { return localStorage.getItem('uf_autoplay') !== 'false'; } catch { return true; }
};

const isGaplessPreloadEnabled = () => {
  try { return localStorage.getItem('uf_gapless') !== 'false'; } catch { return true; }
};

const GAPLESS_PRO_OVERLAP_SECONDS = 0.45;

const isYouTubeFallbackUrl = (url?: string | null) => Boolean(url?.startsWith('yt-video:'));

const getYouTubeFallbackVideoId = (url?: string | null) => {
  if (!isYouTubeFallbackUrl(url)) return null;
  return url?.replace('yt-video:', '').trim() || null;
};

const getNativePlaybackVideoId = (song: Pick<Song, 'id' | 'audio_url'> & { videoId?: string }): string | null => {
  const fromFallback = getYouTubeFallbackVideoId(song.audio_url || '');
  if (fromFallback && fromFallback.length === 11) return fromFallback;
  const explicit = song.videoId;
  if (typeof explicit === 'string' && explicit.length === 11) return explicit;
  const id = song.id || '';
  for (const prefix of ['ytm-', 'yt-', 'youtube-']) {
    if (id.startsWith(prefix)) {
      const v = id.slice(prefix.length);
      if (v.length === 11) return v;
    }
  }
  return null;
};

const toNativeQueueTrack = (song: Song): NativeQueueTrack => ({
  id: getSongIdentity(song),
  title: song.title || '',
  artist: song.artist || '',
  artworkUrl: song.cover_url,
  url: song.audio_url,
  videoId: getNativePlaybackVideoId(song as Song & { videoId?: string }) || undefined,
});

// Always send full metadata (artwork + stream URL) for every queue item.
// A previous optimization slimmed items outside a 40-track window, but that
// broke lock-screen artwork and the native `previous` button for tracks
// before the tapped index, and stopped auto-advance from playing library
// (non-YouTube) songs beyond the window because the slim payload dropped
// both `artworkUrl` and `url`. Serialization cost is acceptable — even a
// 500-song queue is well under a couple hundred KB of JSON.
const buildNativeQueuePayload = (songs: Song[], _startIndex: number): NativeQueueTrack[] => {
  return songs.map(toNativeQueueTrack);
};

const isKnownBrokenStreamUrl = (_url?: string | null) => {
  // Server-side probing decides liveness now; don't blanket-block any host here.
  return false;
};

let youtubeIframeApiPromise: Promise<typeof window.YT> | null = null;

const loadYouTubeIframeApi = (): Promise<typeof window.YT> => {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Window is not available'));
  }

  if (window.YT?.Player) {
    return Promise.resolve(window.YT);
  }

  if (youtubeIframeApiPromise) {
    return youtubeIframeApiPromise;
  }

  youtubeIframeApiPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>('script[data-youtube-iframe-api="true"]');

    const handleReady = () => {
      if (window.YT?.Player) {
        resolve(window.YT);
      } else {
        reject(new Error('YouTube player API did not initialize'));
      }
    };

    const previousReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previousReady?.();
      handleReady();
    };

    if (!existingScript) {
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.dataset.youtubeIframeApi = 'true';
      script.onerror = () => reject(new Error('Failed to load YouTube player API'));
      document.head.appendChild(script);
    }
  });

  return youtubeIframeApiPromise;
};

export const PlayerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  // progress/duration live in an external store (playerProgressStore) so the
  // 250ms tick doesn't rerender every component using usePlayer().
  const setProgress = (v: number | ((prev: number) => number)) => {
    const next = typeof v === 'function' ? (v as (p: number) => number)(playerProgressStore.getProgress()) : v;
    playerProgressStore.setProgress(next);
  };
  const setDuration = (v: number) => playerProgressStore.setDuration(v);
  const [volume, setVolumeState] = useState(0.8);
  const [queue, setQueueState] = useState<Song[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<'off' | 'all' | 'one'>('off');
  const [isExpanded, setExpanded] = useState(false);
  // SSR-safe reads: these initializers also run on the server, where
  // localStorage does not exist. Client picks up stored values on hydration.
  const readStored = (key: string): string | null => {
    if (typeof window === 'undefined') return null;
    try { return localStorage.getItem(key); } catch { return null; }
  };
  const [crossfade, setCrossfade] = useState(() => getRuntimePremium() && readStored('uf_crossfade') === 'true');
  const [crossfadeDuration, setCrossfadeDurationState] = useState(() => {
    const v = Number(readStored('uf_crossfade_duration'));
    return Number.isFinite(v) && v >= 1 && v <= 12 ? v : 3;
  });
  const [crossfadeCurve, setCrossfadeCurveState] = useState<'linear' | 'equal-power' | 'smooth' | 'exponential'>(() => {
    const v = readStored('uf_crossfade_curve');
    return (v === 'linear' || v === 'equal-power' || v === 'smooth' || v === 'exponential') ? v : 'equal-power';
  });
  const [gaplessPro, setGaplessPro] = useState(() => getRuntimePremium() && readStored('uf_gapless_pro') === 'true');
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const [showPrerollAd, setShowPrerollAd] = useState(false);
  const [adType, setAdType] = useState<'start' | 'end'>('start');
  const [pendingSong, setPendingSong] = useState<{ song: Song; offlineUrl?: string | null; songsQueue?: Song[] } | null>(null);
  const [playbackSettingsVersion, setPlaybackSettingsVersion] = useState(0);

  // Warm the ad campaign cache once so an ad break never delays playback.
  useEffect(() => {
    primeAdEngine();
  }, []);



  useEffect(() => {
    playerProgressStore.setPlaying(isPlaying);
  }, [isPlaying]);
  
  // Single audio element - simpler approach
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const nextAudioRef = useRef<HTMLAudioElement | null>(null);
  const crossfadeIntervalRef = useRef<number | null>(null);
  const isCrossfading = useRef(false);
  const crossfadeAttemptedForSeqRef = useRef<number>(-1);
  const animationFrameRef = useRef<number | null>(null);
  const recentlyPlayedTimerRef = useRef<number | null>(null);
  const queueRestoredRef = useRef(false);
  // Monotonic request id — increments on every playActualSong / playSongAtIndex
  // call. Any async work that completes after a newer request must abort,
  // otherwise an old `audio.src = ...` can win the race and the WRONG song
  // ends up playing while the UI shows the song the user actually tapped.
  const playRequestSeqRef = useRef(0);
  const activeSongIdentityRef = useRef<string | null>(null);
  const nativeStartupSeqRef = useRef<number | null>(null);
  const nativeStartedForSeqRef = useRef<number | null>(null);
  const nativeStartupTimerRef = useRef<number | null>(null);
  const nativeLastPlayIntentAtRef = useRef(0);
  // Track native progress movement so a spurious `paused` state doesn't flip
  // the UI to a Play button while ExoPlayer keeps advancing the timeline.
  const nativeLastProgressAtRef = useRef(0);
  const nativeLastPositionMsRef = useRef(0);
  const nativeUserPausedRef = useRef(false);
  const queueRef = useRef<Song[]>([]);
  const currentIndexRef = useRef(0);
  const shuffleRef = useRef(false);
  const repeatRef = useRef<'off' | 'all' | 'one'>('off');
  const volumeRef = useRef(volume);
  const isPlayingRef = useRef(isPlaying);
  const endedFiredForSeqRef = useRef<number>(-1);
  // Auto-mix guard: prevents repeated extend calls while the network is in
  // flight, and remembers song-ids already added so we don't loop the same
  // recommendations forever.
  const autoMixInFlightRef = useRef(false);
  const autoMixSeenRef = useRef<Set<string>>(new Set());
  const pendingNativeRestoreRef = useRef<SavedPlayerState | null>(null);
  const nativeRestoreAttemptedRef = useRef(false);
  const currentSongRef = useRef<Song | null>(null);
  const nativeRecoveryAttemptedRef = useRef<Set<string>>(new Set());
  useEffect(() => { currentSongRef.current = currentSong; }, [currentSong]);

  const clearNativeStartupTimer = useCallback(() => {
    if (nativeStartupTimerRef.current != null) {
      window.clearTimeout(nativeStartupTimerRef.current);
      nativeStartupTimerRef.current = null;
    }
  }, []);

  const markNativePlayIntent = useCallback((seq: number) => {
    nativeStartupSeqRef.current = seq;
    nativeStartedForSeqRef.current = null;
    nativeLastPlayIntentAtRef.current = Date.now();
  }, []);

  useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);
  useEffect(() => { shuffleRef.current = shuffle; }, [shuffle]);
  useEffect(() => { repeatRef.current = repeat; }, [repeat]);
  useEffect(() => { volumeRef.current = volume; }, [volume]);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);


  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);


  // YouTube IFrame fallback
  const youtubePlayerRef = useRef<YouTubePlayer | null>(null);
  const youtubeProgressRef = useRef<number | null>(null);
  const youtubeActiveRef = useRef(false);
  const youtubeEndCallbackRef = useRef<(() => void) | null>(null);

  // ── Persist queue across reloads ──
  useEffect(() => {
    if (queueRestoredRef.current) return;
    queueRestoredRef.current = true;
    try {
      const raw = localStorage.getItem(PLAYER_QUEUE_STATE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as SavedPlayerState;
      if (Array.isArray(saved.queue) && saved.queue.length > 0) {
        setQueueState(saved.queue);
        setCurrentIndex(Math.max(0, Math.min(saved.index || 0, saved.queue.length - 1)));
        if (saved.song) setCurrentSong(saved.song);
        if (typeof saved.progress === 'number') setProgress(saved.progress);
        if (typeof saved.duration === 'number') setDuration(saved.duration);
        if (
          saved.song &&
          saved.wasPlaying &&
          isNativeRuntime() &&
          Date.now() - (saved.savedAt || 0) < NATIVE_RESTORE_WINDOW_MS
        ) {
          pendingNativeRestoreRef.current = saved;
        }
      }
    } catch { /* ignore corrupt cache */ }
  }, []);

  const persistPlayerSnapshot = useCallback(() => {
    if (!queueRestoredRef.current) return;
    try {
      const trimmed = queue.slice(0, 100);
      localStorage.setItem(PLAYER_QUEUE_STATE_KEY, JSON.stringify({
        queue: trimmed,
        index: Math.min(currentIndex, trimmed.length - 1),
        song: currentSong,
        progress: playerProgressStore.getEstimatedProgress(),
        duration: playerProgressStore.getDuration(),
        wasPlaying: isPlaying,
        savedAt: Date.now(),
      }));
    } catch { /* quota or disabled */ }
  }, [queue, currentIndex, currentSong, isPlaying]);

  const persistPlayerSnapshotRef = useRef(persistPlayerSnapshot);
  useEffect(() => {
    persistPlayerSnapshotRef.current = persistPlayerSnapshot;
  }, [persistPlayerSnapshot]);

  useEffect(() => {
    persistPlayerSnapshot();
  }, [persistPlayerSnapshot]);

  useEffect(() => {
    // Battery: snapshot only on real lifecycle events (hide / pagehide) and
    // a slow 30s safety tick. The previous 5s tick blocked the main thread
    // on every write for no real benefit.
    const persistIfHidden = () => {
      if (document.visibilityState === 'hidden') persistPlayerSnapshot();
    };
    const persist = () => persistPlayerSnapshot();
    document.addEventListener('visibilitychange', persistIfHidden);
    window.addEventListener('pagehide', persist);
    const id = window.setInterval(persist, 30000);
    return () => {
      document.removeEventListener('visibilitychange', persistIfHidden);
      window.removeEventListener('pagehide', persist);
      window.clearInterval(id);
    };
  }, [persistPlayerSnapshot]);

  // Track whether audio was playing before going to background
  const wasPlayingRef = useRef(false);
  const keepAliveRef = useRef<number | null>(null);
  const backgroundHeartbeatRef = useRef<number | null>(null);
  const intentionalPauseRef = useRef(false);
  const backgroundRecoveryTimerRef = useRef<number | null>(null);
  const backgroundRecoveryAttemptsRef = useRef(0);

  const markIntentionalPause = useCallback(() => {
    intentionalPauseRef.current = true;
    window.setTimeout(() => { intentionalPauseRef.current = false; }, 900);
  }, []);

  // Create audio element once
  useEffect(() => {
    const audio = new Audio();
    audio.volume = volume;
    audio.preload = 'auto';
    audio.setAttribute('playsinline', 'true');
    audio.setAttribute('webkit-playsinline', 'true');
    // iOS Safari + AirPlay: allow background/lockscreen playback handoff
    audio.setAttribute('x-webkit-airplay', 'allow');

    audioRef.current = audio;
    setAudioElement(audio);

    // Android native playback path is fully owned by ExoPlayer (see playSongAtIndex).
    // We deliberately do NOT touch this HTMLAudioElement on Android — no muting,
    // no mirroring. ExoPlayer plays directly; events drive React state via the
    // dedicated subscription useEffect below.

    // Create second audio for crossfade
    const nextAudio = new Audio();
    nextAudio.volume = 0;
    nextAudio.preload = 'auto';
    nextAudio.setAttribute('playsinline', 'true');
    nextAudio.setAttribute('webkit-playsinline', 'true');
    nextAudio.setAttribute('x-webkit-airplay', 'allow');
    nextAudioRef.current = nextAudio;


    const recoverBackgroundPlayback = () => {
      if (isNativePlayerAvailable()) return;
      const a = audioRef.current;
      if (!a || !a.src || intentionalPauseRef.current) return;
      resumeAudioEngine();
      // Only act if the OS actually stalled us. Don't write progress on every
      // tick — the lockscreen/MediaSession already tracks position natively.
      if (wasPlayingRef.current && a.paused) {
        if (backgroundRecoveryAttemptsRef.current >= 3) {
          setIsPlaying(false);
          return;
        }
        backgroundRecoveryAttemptsRef.current += 1;
        window.setTimeout(() => {
          const current = audioRef.current;
          if (!current?.src || !wasPlayingRef.current || !current.paused || intentionalPauseRef.current) return;
          resumeAudioEngine();
          current.play()
            .then(() => { backgroundRecoveryAttemptsRef.current = 0; })
            .catch(() => {
              if (backgroundRecoveryAttemptsRef.current >= 3) setIsPlaying(false);
            });
        }, 80);
      }
    };

    const startBackgroundHeartbeat = () => {
      if (isNativePlayerAvailable()) return;
      if (backgroundHeartbeatRef.current != null) return;
      // Hidden/background only: keep recovery fast enough for OEM WebViews that
      // silently stall within a few seconds, but stop the timer immediately when
      // the app is visible again.
      backgroundHeartbeatRef.current = window.setInterval(recoverBackgroundPlayback, 4500);
    };

    const stopBackgroundHeartbeat = () => {
      if (backgroundHeartbeatRef.current == null) return;
      window.clearInterval(backgroundHeartbeatRef.current);
      backgroundHeartbeatRef.current = null;
      backgroundRecoveryAttemptsRef.current = 0;
    };

    // Track playing state before going to background
    const handleVisibilityChange = () => {
      if (isNativePlayerAvailable()) {
        if (document.visibilityState === 'hidden') {
          wasPlayingRef.current = isPlayingRef.current;
          persistPlayerSnapshotRef.current();
        } else {
          ExoPlayerPlugin.isPlaying()
            .then(({ isPlaying }) => {
              if (!isPlaying && Date.now() - nativeLastPlayIntentAtRef.current < 15000) return;
              setIsPlaying(isPlaying);
              wasPlayingRef.current = isPlaying;
            })
            .catch(() => undefined);
        }
        return;
      }
      if (document.visibilityState === 'hidden') {
        // Entering background — remember if we were playing
        wasPlayingRef.current = !!(audioRef.current && !audioRef.current.paused);
        persistPlayerSnapshotRef.current();
        if (wasPlayingRef.current) startBackgroundHeartbeat();
      } else if (document.visibilityState === 'visible') {
        stopBackgroundHeartbeat();
        resumeAudioEngine();
        if (backgroundRecoveryTimerRef.current) {
          window.clearTimeout(backgroundRecoveryTimerRef.current);
          backgroundRecoveryTimerRef.current = null;
        }
        // Returning to foreground — resume if was playing
        if (wasPlayingRef.current && audioRef.current && audioRef.current.paused && audioRef.current.src) {
          audioRef.current.play().catch(() => {});
        }
      }
    };

    const handlePageHide = () => {
      if (isNativePlayerAvailable()) {
        wasPlayingRef.current = isPlayingRef.current;
        persistPlayerSnapshotRef.current();
        return;
      }
      wasPlayingRef.current = !!(audioRef.current && !audioRef.current.paused);
      persistPlayerSnapshotRef.current();
      if (wasPlayingRef.current) startBackgroundHeartbeat();
    };

    const handlePageShow = () => {
      if (isNativePlayerAvailable()) {
        ExoPlayerPlugin.isPlaying()
          .then(({ isPlaying }) => {
            if (!isPlaying && Date.now() - nativeLastPlayIntentAtRef.current < 15000) return;
            setIsPlaying(isPlaying);
            wasPlayingRef.current = isPlaying;
          })
          .catch(() => undefined);
        return;
      }
      stopBackgroundHeartbeat();
      resumeAudioEngine();
      recoverBackgroundPlayback();
    };
    
    const handleFocus = () => {
      if (isNativePlayerAvailable()) return;
      if (audioRef.current && audioRef.current.src && audioRef.current.paused && wasPlayingRef.current) {
        audioRef.current.play().catch(() => {});
      }
    };

    // Keep-alive: touch audio buffer every 5s to prevent browser from suspending
    keepAliveRef.current = window.setInterval(() => {
      if (audioRef.current && !audioRef.current.paused && audioRef.current.readyState >= 2) {
        // Touch the currentTime to keep the audio pipeline active
        void audioRef.current.currentTime;
      }
    }, 5000);

    // Handle buffering stalls — only nudge if we've actually been stuck for
    // a meaningful window. The old 2s + 0.001s currentTime poke caused a
    // micro-glitch even when playback was healthy. We now wait 4s and only
    // act if readyState is still HAVE_CURRENT_DATA or lower.
    let waitingTimer: number | null = null;
    const handleWaiting = () => {
      if (waitingTimer != null) return;
      waitingTimer = window.setTimeout(() => {
        waitingTimer = null;
        const a = audioRef.current;
        if (a && !a.paused && a.readyState < 2 && a.src) {
          a.play().catch(() => {});
        }
      }, 4000);
    };
    const handleWaitingPerf = () => {
      recordPerfEvent({
        event_type: 'playback_stall',
        severity: 'warn',
        message: 'Buffering / stalled',
      });
    };
    const handlePlaying = () => {
      if (waitingTimer != null) { clearTimeout(waitingTimer); waitingTimer = null; }
      const audioWithTs = audio as HTMLAudioElement & { __ufStartedAt?: number };
      const startedAt = audioWithTs.__ufStartedAt;
      if (startedAt) {
        recordPerfEvent({
          event_type: 'playback_start',
          severity: 'info',
          latency_ms: Math.max(0, Math.round(performance.now() - startedAt)),
        });
        audioWithTs.__ufStartedAt = undefined;
      }
    };
    const handleLoadStartPerf = () => {
      (audio as HTMLAudioElement & { __ufStartedAt?: number }).__ufStartedAt = performance.now();
    };


    audio.addEventListener('waiting', handleWaiting);
    audio.addEventListener('waiting', handleWaitingPerf);
    audio.addEventListener('playing', handlePlaying);
    audio.addEventListener('loadstart', handleLoadStartPerf);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('pageshow', handlePageShow);
    window.addEventListener('freeze', handlePageHide);
    window.addEventListener('resume', handlePageShow);
    window.addEventListener('focus', handleFocus);


    // Native app resume — only fires inside Capacitor APK. Web preview ignores.
    let appResumeRemove: (() => void) | null = null;
    (async () => {
      try {
        const modName = '@capacitor/app';
        const mod = await import(/* @vite-ignore */ modName).catch(() => null) as CapacitorAppModule | null;
        if (!mod?.App) return;
        const handle = await mod.App.addListener('appStateChange', (state: { isActive: boolean }) => {
          if (isNativePlayerAvailable()) {
            if (!state?.isActive) {
              wasPlayingRef.current = isPlayingRef.current;
              persistPlayerSnapshotRef.current();
              return;
            }
            ExoPlayerPlugin.isPlaying()
              .then(({ isPlaying }) => {
                if (!isPlaying && Date.now() - nativeLastPlayIntentAtRef.current < 15000) return;
                setIsPlaying(isPlaying);
                wasPlayingRef.current = isPlaying;
              })
              .catch(() => undefined);
            return;
          }
          if (!state?.isActive) {
            wasPlayingRef.current = !!(audioRef.current && !audioRef.current.paused);
            persistPlayerSnapshotRef.current();
            if (wasPlayingRef.current) startBackgroundHeartbeat();
            return;
          }
          stopBackgroundHeartbeat();
          // Returning to foreground from native background:
          // 1) resume the Web Audio context (Android suspends it while backgrounded)
          // 2) clear any stale 'error' UI state by re-checking the audio element
          // 3) resume if we were playing
          resumeAudioEngine();
          const a = audioRef.current;
          if (!a) return;
          if (a.src && a.readyState < 2) {
            try { void a.currentTime; } catch { /* ignore */ }
          }
          if (wasPlayingRef.current && a.src && a.paused) {
            a.play().catch(() => {});
          }
        });
        appResumeRemove = () => { try { handle.remove?.(); } catch { /* ignore */ } };
      } catch { /* ignore */ }
    })();

    return () => {
      if (waitingTimer != null) clearTimeout(waitingTimer);
      audio.removeEventListener('waiting', handleWaiting);
      audio.removeEventListener('waiting', handleWaitingPerf);
      audio.removeEventListener('playing', handlePlaying);
      audio.removeEventListener('loadstart', handleLoadStartPerf);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('pageshow', handlePageShow);
      window.removeEventListener('freeze', handlePageHide);
      window.removeEventListener('resume', handlePageShow);
      window.removeEventListener('focus', handleFocus);
      if (appResumeRemove) appResumeRemove();
      if (keepAliveRef.current) clearInterval(keepAliveRef.current);
      stopBackgroundHeartbeat();
      if (backgroundRecoveryTimerRef.current) clearTimeout(backgroundRecoveryTimerRef.current);

      audio.pause();
      audio.src = '';
      nextAudio.pause();
      nextAudio.src = '';
      if (crossfadeIntervalRef.current) {
        clearInterval(crossfadeIntervalRef.current);
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  // Update volume on audio element
  useEffect(() => {
    if (audioRef.current && !isCrossfading.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  const preloadedNextIdRef = useRef<string | null>(null);

  useEffect(() => {
    const onPlaybackSettingsChanged = () => setPlaybackSettingsVersion((value) => value + 1);
    window.addEventListener('uf-playback-settings-changed', onPlaybackSettingsChanged);
    return () => window.removeEventListener('uf-playback-settings-changed', onPlaybackSettingsChanged);
  }, []);

  useEffect(() => {
    const syncPremiumAudioTransitions = (premium = getRuntimePremium()) => {
      if (!premium) {
        setCrossfade(false);
        setGaplessPro(false);
        try {
          localStorage.setItem('uf_crossfade', 'false');
          localStorage.setItem('uf_gapless_pro', 'false');
        } catch { /* noop */ }
        return;
      }
      try {
        setCrossfade(localStorage.getItem('uf_crossfade') === 'true');
        setGaplessPro(localStorage.getItem('uf_gapless_pro') === 'true');
      } catch { /* noop */ }
    };
    if (getRuntimePremium()) syncPremiumAudioTransitions(true);
    const onPremiumChanged = (event: Event) => {
      syncPremiumAudioTransitions(Boolean((event as CustomEvent<boolean>).detail));
    };
    window.addEventListener('uf-premium-changed', onPremiumChanged);
    return () => window.removeEventListener('uf-premium-changed', onPremiumChanged);
  }, []);

  // Wire the global EQ/audio engine to the live audio element. Persists across modal open/close.
  useGlobalAudioEngine(audioElement);

  const publishNativeMusicControls = useCallback(async (song: Song, playing: boolean, duration?: number) => {
    try {
      const { showNativeMusicControls } = await import('@/lib/nativeMusicControls');
      await showNativeMusicControls(
        {
          title: song.title,
          artist: song.artist,
          cover: song.cover_url,
          album: song.album,
          duration: duration || song.duration,
        },
        playing,
      );
    } catch { /* native controls are best-effort */ }
  }, []);

  // Premium streams are ALREADY loaded through the CORS-clean proxy with
  // crossOrigin="anonymous", so the WebAudio graph is attached on first
  // canplay. The engine listens to `uf-eq-changed` directly and applies
  // slider moves instantly (BiquadFilter.gain updates — no reload).
  //
  // We still keep a safety reload path for the edge case where a song was
  // loaded BEFORE the user upgraded to Premium (raw URL, no CORS), so the
  // graph is permanently tainted on that element. Reloading via proxy gives
  // the engine a clean source on the next song.
  useEffect(() => {
    const onEqChanged = () => {
      const a = audioRef.current;
      if (!a || !a.src) return;
      if (!isEqProcessingEnabled()) return;

      // Already proxied + anonymous → engine handles it instantly.
      const alreadyProxied = isAudioProxyUrl(a.src);
      const alreadyAnonymous = a.crossOrigin === 'anonymous';
      if (alreadyProxied && alreadyAnonymous) {
        window.dispatchEvent(new CustomEvent('uf-eq-force-reattach'));
        return;
      }

      const currentSrc = a.currentSrc || a.src;
      if (isLocalMediaSource(currentSrc)) {
        // Offline/downloaded blobs and native file URLs are already WebAudio-safe.
        // Do NOT reload them through the network proxy; just force the engine to
        // attach/re-apply on the current element.
        window.dispatchEvent(new CustomEvent('uf-eq-force-reattach'));
        return;
      }

      if (isNativeResolvedStreamUrl(currentSrc) || isNativeResolvedStreamUrl(currentSong?.audio_url)) {
        const videoId = getNativeResolvedVideoId(currentSrc) || getNativeResolvedVideoId(currentSong?.audio_url);
        if (!videoId) return;
        const wasPlaying = !a.paused;
        const at = a.currentTime;
        const seqAtResolve = playRequestSeqRef.current;
        resolveYouTubeVideoStream(videoId, { forceRefresh: true, title: currentSong?.title, artist: currentSong?.artist })
          .then((result) => {
            if (seqAtResolve !== playRequestSeqRef.current || !result?.streamUrl || isYouTubeFallbackUrl(result.streamUrl)) return;
            const proxied = buildStreamProxyUrl(result.streamUrl);
            const refreshed = currentSong ? { ...currentSong, audio_url: result.streamUrl } : null;
            if (refreshed) {
              setCurrentSong(refreshed);
              setQueueState((q) => q.map((queuedSong) => queuedSong.id === refreshed.id ? refreshed : queuedSong));
            }
            let restored = false;
            let restoreTimer: number | null = null;
            const restore = () => {
              if (restored) return;
              restored = true;
              a.removeEventListener('loadedmetadata', restore);
              a.removeEventListener('canplay', restore);
              if (restoreTimer != null) window.clearTimeout(restoreTimer);
              try { a.currentTime = at; } catch { /* ignore */ }
              window.dispatchEvent(new CustomEvent('uf-eq-force-reattach'));
              window.dispatchEvent(new CustomEvent('uf-eq-source-ready'));
              if (wasPlaying) a.play().catch(() => {});
            };
            configureAudioElementSource(a, proxied);
            a.addEventListener('loadedmetadata', restore, { once: true });
            a.addEventListener('canplay', restore, { once: true });
            restoreTimer = window.setTimeout(restore, 900);
            a.load();
          })
          .catch(() => {});
        return;
      }

      // Legacy element loaded before Premium activation — reload through proxy.
      const wasPlaying = !a.paused;
      const at = a.currentTime;
      const songSource = currentSong?.audio_url;
      const original = songSource && songSource.startsWith('http') && !isYouTubeFallbackUrl(songSource) ? songSource : currentSrc;
      if (!original || isLocalMediaSource(original)) return;
      try {
        const proxied = buildStreamProxyUrl(original);
        if ((a.src === proxied || a.currentSrc === proxied) && a.crossOrigin === 'anonymous') {
          window.dispatchEvent(new CustomEvent('uf-eq-force-reattach'));
          return;
        }

        let restoreTimer: number | null = null;
        const cleanup = () => {
          a.removeEventListener('loadedmetadata', restore);
          a.removeEventListener('canplay', restore);
          if (restoreTimer != null) window.clearTimeout(restoreTimer);
          restoreTimer = null;
        };
        const restore = () => {
          cleanup();
          try { a.currentTime = at; } catch { /* ignore */ }
          window.dispatchEvent(new CustomEvent('uf-eq-force-reattach'));
          window.dispatchEvent(new CustomEvent('uf-eq-source-ready'));
          if (wasPlaying) a.play().catch(() => {});
        };

        configureAudioElementSource(a, proxied);
        a.addEventListener('loadedmetadata', restore, { once: true });
        a.addEventListener('canplay', restore, { once: true });
        restoreTimer = window.setTimeout(restore, 900);
        a.load();
      } catch { /* ignore */ }
    };
    const onEqStorageChanged = (e: StorageEvent) => {
      if (e.key === EQ_SETTINGS_KEY) onEqChanged();
    };
    window.addEventListener('uf-eq-changed', onEqChanged);
    window.addEventListener('storage', onEqStorageChanged);
    return () => {
      window.removeEventListener('uf-eq-changed', onEqChanged);
      window.removeEventListener('storage', onEqStorageChanged);
    };
  }, [currentSong?.audio_url]);

  // ---------------------------------------------------------------------------
  // Endless auto-queue (YouTube-style mix). When the queue ends with no manual
  // next track and repeat is off, we pull more songs from the catalog:
  //   1) same artist (not already in the queue/seen)
  //   2) same genre OR mood
  //   3) trending fallback (most-played)
  // The result is appended to the queue so playback never stops.
  // ---------------------------------------------------------------------------
  type SongRowWithArtist = {
    id: string;
    title: string;
    artist: string;
    album?: string | null;
    cover_url?: string | null;
    audio_url: string;
    duration?: number | null;
    artist_id?: string | null;
    genre?: string | null;
    mood?: string | null;
    created_at?: string | null;
    play_count?: number | null;
    artists?: { id: string; name: string; photo_url: string | null } | null;
  };

  const mapSongRow = (s: SongRowWithArtist): Song => {
    const artistData = s.artists;
    return {
      id: s.id,
      title: s.title,
      artist: s.artist,
      album: s.album || undefined,
      cover_url: s.cover_url || undefined,
      audio_url: s.audio_url,
      duration: s.duration || undefined,
      artist_id: artistData?.id || s.artist_id || undefined,
      artist_photo_url: artistData?.photo_url || undefined,
      genre: s.genre || undefined,
      mood: s.mood || undefined,
      created_at: s.created_at || undefined,
      play_count: s.play_count || undefined,
      source: 'library',
    } as Song;
  };

  const extendQueueWithMix = useCallback(async (seed: Song | null): Promise<Song[]> => {
    if (!seed || autoMixInFlightRef.current) return [];
    autoMixInFlightRef.current = true;
    try {
      const existing = new Set(queueRef.current.map((s) => s.id));
      autoMixSeenRef.current.forEach((id) => existing.add(id));
      // also avoid re-adding the seed
      existing.add(seed.id);

      const pool: Song[] = [];
      const pushUnique = (rows: SongRowWithArtist[] | null) => {
        for (const r of rows || []) {
          if (!r?.id || existing.has(r.id)) continue;
          if (!r.audio_url) continue;
          existing.add(r.id);
          pool.push(mapSongRow(r));
          if (pool.length >= 25) break;
        }
      };

      // 1) Same artist
      if (pool.length < 25) {
        const artistName = seed.artist?.trim();
        if (artistName) {
          const { data } = await supabase
            .from('songs')
            .select('*, artists(id, name, photo_url)')
            .eq('is_visible', true)
            .ilike('artist', artistName)
            .limit(30);
          pushUnique(data as SongRowWithArtist[] | null);
        }
      }

      // 2) Same genre / mood
      if (pool.length < 25 && (seed.genre || seed.mood)) {
        let q = supabase
          .from('songs')
          .select('*, artists(id, name, photo_url)')
          .eq('is_visible', true)
          .limit(40);
        if (seed.genre) q = q.eq('genre', seed.genre);
        else if (seed.mood) q = q.eq('mood', seed.mood);
        const { data } = await q;
        // shuffle a bit for variety
        const shuffled = [...((data as SongRowWithArtist[] | null) || [])].sort(() => Math.random() - 0.5);
        pushUnique(shuffled);
      }

      // 3) Trending fallback
      if (pool.length < 10) {
        const { data } = await supabase
          .from('songs')
          .select('*, artists(id, name, photo_url)')
          .eq('is_visible', true)
          .order('play_count', { ascending: false, nullsFirst: false })
          .limit(40);
        const shuffled = [...((data as SongRowWithArtist[] | null) || [])].sort(() => Math.random() - 0.5);
        pushUnique(shuffled);
      }

      // 4) YT Music Radio fallback — pulls the official "Mix" queue Innertube
      // builds for ANY video. Kicks in when local DB doesn't have enough.
      // We always try if seed is a YTM track (id "ytm-<videoId>"), and as
      // a last resort even for local tracks via title+artist resolved videoId.
      if (pool.length < 15) {
        const seedVideoId = seed.id?.startsWith('ytm-') ? seed.id.slice(4) : undefined;
        if (seedVideoId) {
          try {
            const { data } = await supabase.functions.invoke('ytm-radio', { body: { videoId: seedVideoId } });
            const tracks = Array.isArray(data?.tracks) ? data.tracks : [];
            for (const t of tracks) {
              if (!t?.videoId) continue;
              const id = `ytm-${t.videoId}`;
              if (existing.has(id)) continue;
              existing.add(id);
              pool.push({
                id,
                title: t.title,
                artist: t.artist || 'Unknown',
                cover_url: t.cover_url,
                audio_url: t.audio_url || `yt-video:${t.videoId}`,
                duration: t.duration || undefined,
                source: 'indexed',
              } as Song);
              if (pool.length >= 25) break;
            }
          } catch (e) {
            console.warn('[autoMix] ytm-radio failed', e);
          }
        }
      }

      pool.forEach((s) => autoMixSeenRef.current.add(s.id));


      if (pool.length > 0) {
        setQueueState((prev) => {
          const next = [...prev, ...pool];
          queueRef.current = next;
          return next;
        });
      }
      return pool;
    } catch (e) {
      console.warn('[autoMix] extend failed', e);
      return [];
    } finally {
      autoMixInFlightRef.current = false;
    }
  }, []);

  // Reset the auto-mix dedupe set whenever the user manually loads a new queue
  // from a different entry point (so they get fresh recommendations).
  useEffect(() => {
    autoMixSeenRef.current = new Set(queue.map((s) => s.id));
  }, [queue]);

  // Proactive YouTube-style auto-queue refill: when the user is within 2 tracks
  // of the end and repeat is off, fetch more in the background BEFORE the
  // current song finishes — no gap, infinite playback.
  useEffect(() => {
    if (repeat !== 'off') return;
    if (!isAutoplayEnabled()) return;
    if (queue.length === 0) return;
    const remaining = queue.length - currentIndex - 1;
    if (remaining > 2) return;
    if (autoMixInFlightRef.current) return;
    const seed = queue[currentIndex] || currentSong;
    if (!seed) return;
    void extendQueueWithMix(seed);
  }, [currentIndex, queue, repeat, currentSong, extendQueueWithMix, playbackSettingsVersion]);



  // Progress is pushed via the audio element's native `timeupdate` event
  // (handled in the main audio listener below). No React state interval needed.

  // Get next song index - supports shuffle properly by tracking played songs
  const shuffleHistoryRef = useRef<Set<number>>(new Set());
  
  const getNextIndex = useCallback((currentIdx: number, queueLength: number, isShuffle: boolean, repeatMode: 'off' | 'all' | 'one'): number | null => {
    if (queueLength === 0) return null;
    
    if (isShuffle) {
      // Smart shuffle: avoid repeating until all songs played
      if (shuffleHistoryRef.current.size >= queueLength) {
        shuffleHistoryRef.current.clear();
      }
      shuffleHistoryRef.current.add(currentIdx);
      
      const available = Array.from({ length: queueLength }, (_, i) => i)
        .filter(i => !shuffleHistoryRef.current.has(i));
      
      if (available.length === 0) {
        // All played, start fresh
        shuffleHistoryRef.current.clear();
        return Math.floor(Math.random() * queueLength);
      }
      
      return available[Math.floor(Math.random() * available.length)];
    }
    
    const nextIdx = (currentIdx + 1) % queueLength;
    if (nextIdx === 0 && repeatMode === 'off') {
      return null; // End of queue
    }
    return nextIdx;
  }, []);

  // Helper to check if a URL is actually playable (not empty/placeholder)
  const isPlayableUrl = useCallback((url?: string) => {
    if (!url) return false;
    if (url === '' || url === 'pending' || url === 'resolving') return false;
    if (isKnownBrokenStreamUrl(url)) return false;
    // `yt-video:` is playable only by the YouTube iframe, not by the main
    // <audio> element/WebAudio graph. Treat it as unresolved everywhere so the
    // player must first extract a real stream URL for Equalizer/effects.
    if (isYouTubeFallbackUrl(url)) return false;
    return url.startsWith('http') || url.startsWith('blob:') || url.startsWith('data:');
  }, []);

  // Resolve audio URL for indexed/stream tracks that have no real URL.
  // Pass `forceRefresh` to bypass any cached URL — used when a previously
  // cached URL just failed to play (stale Invidious link, expired token, etc).
  const resolveAudioUrl = useCallback(
    async (song: Song, opts: { forceRefresh?: boolean; skipNative?: boolean } = {}): Promise<string | null> => {
      const ytFallback = isYouTubeFallbackUrl(song.audio_url) ? song.audio_url ?? null : null;
      // Skip resolution only when we already have a real (non-YT-iframe) URL.
      if (!opts.forceRefresh && isPlayableUrl(song.audio_url) && !ytFallback) {
        return song.audio_url!;
      }

      // Single attempt that tries extract-audio (and music-indexer) once.
      const attempt = async (forceRefresh: boolean): Promise<string | null> => {
        if (ytFallback) {
          const videoId = getYouTubeFallbackVideoId(ytFallback);
          if (videoId) {
            // NATIVE-FIRST on Android: the on-device Kotlin InnerTube resolver
            // uses the phone's residential IP and returns a direct googlevideo
            // URL in ~300-600ms — no Supabase round-trip, no datacenter-IP
            // block. This is the Echo Music / NewPipe approach.
            const tryNative = async (): Promise<string | null> => {
              if (opts.skipNative || !isNativePlayerAvailable()) return null;
              try {
                const { resolveYouTubeStreamOnDevice } = await import('@/lib/nativeStreamResolver');
                const { getStreamBitrateCap } = await import('@/lib/userPrefs');
                const native = await Promise.race([
                  resolveYouTubeStreamOnDevice(videoId, { bitrateCap: getStreamBitrateCap() }),
                  new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 2500)),
                ]);
                if (native?.streamUrl && !isYouTubeFallbackUrl(native.streamUrl)) {
                  markNativeResolvedStreamUrl(native.streamUrl, videoId);
                  return native.streamUrl;
                }
              } catch { /* fall through */ }
              return null;
            };

            const firstNative = await tryNative();
            if (firstNative) return firstNative;

            // Phase B: on Android, give the on-device resolver ONE retry
            // before falling to the edge resolver. Edge URLs are signed for
            // Supabase's IP and trigger the throttling/IP-block path we are
            // trying to escape — every avoided hop counts.
            if (isNativePlayerAvailable()) {
              const secondNative = await tryNative();
              if (secondNative) return secondNative;
            }

            // FALLBACK: Supabase edge resolver + stream-proxy (web users, or
            // when on-device resolution failed twice for this particular videoId).
            try {
              if (forceRefresh) invalidateYouTubeStream(videoId);
              const resolved = await resolveYouTubeVideoStream(videoId, { forceRefresh, title: song.title, artist: song.artist });
              if (resolved?.streamUrl && !isYouTubeFallbackUrl(resolved.streamUrl)) {
                return resolved.streamUrl;
              }
            } catch { /* fall through to indexed track lookup */ }
          }
        }
        if (song.artist && song.title) {
          try {
            const result = await resolveIndexedTrack(song.artist, song.title, { forceRefresh });
            if (result?.streamUrl && !isYouTubeFallbackUrl(result.streamUrl)) {
              return result.streamUrl;
            }
          } catch { /* fall through */ }
        }
        return null;
      };


      // One resolver pass only. A forced retry is still available from the
      // audio error handler, but doing two full resolver chains on every tap made
      // cold playback feel broken and doubled extraction time.
      return await attempt(opts.forceRefresh === true);
    },
    [isPlayableUrl],
  );

  const resolveNativePlaybackUrl = useCallback(async (
    song: Song,
    offlineUrl?: string | null,
    opts: { skipNativeFastPath?: boolean } = {},
  ): Promise<string | null> => {
    if (offlineUrl) return offlineUrl;

    const directUrl = isPlayableUrl(song.audio_url) && !isYouTubeFallbackUrl(song.audio_url)
      ? song.audio_url
      : null;
    const videoId = getNativePlaybackVideoId(song as Song & { videoId?: string });

    // Echo/NewPipe-style APK path: if this is a YouTube Music item, always try
    // phone-side InnerTube FIRST. Backend/Supabase googlevideo URLs are signed
    // for the server IP and are exactly what caused slow starts/IP blocks.
    if (videoId && !opts.skipNativeFastPath) {
      try {
        const res = await Promise.race([
          InnerTubePlugin.resolveAudio({ videoId }),
          new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 5200)),
        ]);
        if (res?.url && !isYouTubeFallbackUrl(res.url)) {
          markNativeResolvedStreamUrl(res.url, videoId);
          return res.url;
        }
      } catch { /* fall through */ }
    }

    if (directUrl && !opts.skipNativeFastPath) {
      let shouldRefreshYoutubeUrl = false;
      try {
        const parsed = new URL(directUrl, window.location.href);
        shouldRefreshYoutubeUrl = Boolean(videoId)
          && parsed.hostname.endsWith('googlevideo.com')
          && !isNativeResolvedStreamUrl(directUrl);
      } catch { /* use direct URL */ }
      if (!shouldRefreshYoutubeUrl) return buildNativeExoPlayerUrl(directUrl);
    }

    if (isNativePlayerAvailable() && !opts.skipNativeFastPath && (videoId || song.title)) {
      try {
        const nativeResolved = await Promise.race([
          resolveNativeMetadataStream({ videoId: videoId || undefined, title: song.title, artist: song.artist }),
          new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 7000)),
        ]);
        if (nativeResolved && !isYouTubeFallbackUrl(nativeResolved)) {
          if (videoId) markNativeResolvedStreamUrl(nativeResolved, videoId);
          return nativeResolved;
        }
      } catch { /* fall through */ }
    }

    try {
      const fresh = await resolveAudioUrl(song, { forceRefresh: true, skipNative: true });
      if (fresh && !isYouTubeFallbackUrl(fresh)) return buildNativeExoPlayerUrl(fresh);
    } catch { /* fall through to direct URL */ }

    // Last resort for catalog uploads/direct CDN URLs. If this is a cloud-signed
    // googlevideo URL, buildStreamProxyUrl keeps the fetch on the signing side.
    return directUrl ? buildNativeExoPlayerUrl(directUrl) : null;
  }, [isPlayableUrl, resolveAudioUrl, playbackSettingsVersion]);

  // ── Preload NEXT queued track for zero-gap transitions ──
  // Whenever queue / current index changes, warm `nextAudioRef` with the upcoming
  // song so crossfade & "next" feel instantaneous.
  useEffect(() => {
    if (!nextAudioRef.current || queue.length <= 1) {
      preloadedNextIdRef.current = null;
      return;
    }
    if (!isGaplessPreloadEnabled()) {
      preloadedNextIdRef.current = null;
      return;
    }
    if (isCrossfading.current) return;

    const nextIdx = getNextIndex(currentIndex, queue.length, shuffle, repeat);
    if (nextIdx === null) {
      preloadedNextIdRef.current = null;
      return;
    }
    const upcoming = queue[nextIdx];
    if (!upcoming) return;
    if (preloadedNextIdRef.current === upcoming.id) return;

    if (isPlayableUrl(upcoming.audio_url) && !isYouTubeFallbackUrl(upcoming.audio_url)) {
      try {
        configureAudioElementSource(nextAudioRef.current, buildStreamProxyUrl(upcoming.audio_url));
        nextAudioRef.current.preload = 'auto';
        nextAudioRef.current.volume = 0;
        nextAudioRef.current.load();
        preloadedNextIdRef.current = upcoming.id;
      } catch { /* ignore preload errors */ }
    } else if (upcoming.source === 'indexed' || upcoming.audio_url === 'resolving') {
      preloadedNextIdRef.current = upcoming.id;
      const upcomingVideoId = getYouTubeFallbackVideoId(upcoming.audio_url) || (upcoming.id?.startsWith('ytm-') ? upcoming.id.slice(4) : null);
      if (upcomingVideoId) prefetchYouTubeVideoStream(upcomingVideoId, { title: upcoming.title, artist: upcoming.artist });
      else prefetchIndexedTrack(upcoming.artist, upcoming.title);
      resolveAudioUrl(upcoming).then((resolved) => {
        if (!resolved || preloadedNextIdRef.current !== upcoming.id) return;
        const activeQueue = queueRef.current;
        const idx = activeQueue.findIndex((item) => getSongIdentity(item) === getSongIdentity(upcoming));
        if (idx >= 0 && !isPlayableUrl(activeQueue[idx].audio_url)) {
          const warmed = { ...activeQueue[idx], audio_url: resolved };
          const nextQueue = [...activeQueue];
          nextQueue[idx] = warmed;
          queueRef.current = nextQueue;
          setQueueState(nextQueue);
        }
        if (nextAudioRef.current && !isYouTubeFallbackUrl(resolved)) {
          configureAudioElementSource(nextAudioRef.current, buildStreamProxyUrl(resolved));
          nextAudioRef.current.preload = 'auto';
          nextAudioRef.current.volume = 0;
          nextAudioRef.current.load();
        }
      }).catch(() => null);
    }

    // Also warm the track AFTER next so two-tap skips feel instant.
    const nextNextIdx = getNextIndex(nextIdx, queue.length, shuffle, repeat);
    if (nextNextIdx !== null && nextNextIdx !== currentIndex) {
      const afterNext = queue[nextNextIdx];
      if (afterNext && (afterNext.source === 'indexed' || afterNext.audio_url === 'resolving')) {
        const afterNextVideoId = getYouTubeFallbackVideoId(afterNext.audio_url) || (afterNext.id?.startsWith('ytm-') ? afterNext.id.slice(4) : null);
        if (afterNextVideoId) prefetchYouTubeVideoStream(afterNextVideoId, { title: afterNext.title, artist: afterNext.artist });
        else prefetchIndexedTrack(afterNext.artist, afterNext.title);
      }
    }
  }, [queue, currentIndex, shuffle, repeat, getNextIndex, isPlayableUrl, resolveAudioUrl, playbackSettingsVersion]);

  // ── YouTube IFrame fallback helpers ──
  const stopYouTubeProgressLoop = useCallback(() => {
    if (youtubeProgressRef.current) {
      window.clearInterval(youtubeProgressRef.current);
      youtubeProgressRef.current = null;
    }
  }, []);

  const startYouTubeProgressLoop = useCallback(() => {
    stopYouTubeProgressLoop();
    youtubeProgressRef.current = window.setInterval(() => {
      const player = youtubePlayerRef.current;
      if (!player || !youtubeActiveRef.current) return;
      try {
        setProgress(player.getCurrentTime() || 0);
        const dur = player.getDuration?.();
        if (dur && Number.isFinite(dur) && dur > 0) setDuration(dur);
      } catch { /* ignore */ }
    }, 500);
  }, [stopYouTubeProgressLoop]);

  const teardownYouTubePlayback = useCallback(() => {
    stopYouTubeProgressLoop();
    youtubeActiveRef.current = false;
    youtubeEndCallbackRef.current = null;
    try { youtubePlayerRef.current?.pauseVideo?.(); } catch { /* ignore */ }
  }, [stopYouTubeProgressLoop]);

  const ensureYouTubeContainer = useCallback(() => {
    let host = document.getElementById('uf-yt-fallback-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'uf-yt-fallback-host';
      host.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;';
      document.body.appendChild(host);
    }
    let mount = document.getElementById('uf-yt-fallback-mount');
    if (!mount) {
      mount = document.createElement('div');
      mount.id = 'uf-yt-fallback-mount';
      host.appendChild(mount);
    }
    return mount;
  }, []);

  const playYouTubeFallback = useCallback(async (videoId: string, onEnded: () => void, requestSeq?: number, songIdentity?: string) => {
    const isStillCurrent = () =>
      (requestSeq === undefined || requestSeq === playRequestSeqRef.current) &&
      (!songIdentity || activeSongIdentityRef.current === songIdentity);
    try {
      if (!isStillCurrent()) return;
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.removeAttribute('src');
        audioRef.current.load();
      }

      const YT = await loadYouTubeIframeApi();
      if (!YT) throw new Error('YouTube API unavailable');
      if (!isStillCurrent()) return;

      youtubeActiveRef.current = true;
      youtubeEndCallbackRef.current = onEnded;

      if (youtubePlayerRef.current) {
        try {
          youtubePlayerRef.current.loadVideoById(videoId);
          youtubePlayerRef.current.setVolume?.(Math.round(volume * 100));
          startYouTubeProgressLoop();
          if (isStillCurrent()) setIsPlaying(true);
          return;
        } catch { /* recreate below */ }
      }

      const mount = ensureYouTubeContainer();
      mount.innerHTML = '';
      const playerEl = document.createElement('div');
      playerEl.id = `uf-yt-player-${Date.now()}`;
      mount.appendChild(playerEl);

      youtubePlayerRef.current = new YT.Player(playerEl.id, {
        height: '1',
        width: '1',
        videoId,
        playerVars: { autoplay: 1, controls: 0, modestbranding: 1, playsinline: 1, rel: 0 },
        events: {
          onReady: (e: { target: YouTubePlayer }) => {
            if (!isStillCurrent()) return;
            try {
              e.target.setVolume?.(Math.round(volume * 100));
              e.target.playVideo();
              const dur = e.target.getDuration?.();
              if (dur && Number.isFinite(dur)) setDuration(dur);
            } catch { /* ignore */ }
            startYouTubeProgressLoop();
            setIsPlaying(true);
          },
          onStateChange: (e: { data: number }) => {
            if (!isStillCurrent()) return;
            const states = YT.PlayerState;
            if (e.data === states.PLAYING) setIsPlaying(true);
            else if (e.data === states.PAUSED) setIsPlaying(false);
            else if (e.data === states.ENDED) {
              setIsPlaying(false);
              youtubeEndCallbackRef.current?.();
            }
          },
          onError: () => {
            if (!isStillCurrent()) return;
            toast.info('Trying another source…');
            youtubeEndCallbackRef.current?.();
          },
        },
      } as Record<string, unknown>);
    } catch (err) {
      console.warn('YouTube fallback failed:', err);
      youtubeActiveRef.current = false;
      setIsPlaying(false);
      toast.error('Could not load this track from any source.');
    }
  }, [ensureYouTubeContainer, startYouTubeProgressLoop, volume]);

  // Play a song at specific index - with lazy URL resolution
  const playSongAtIndex = useCallback(async (index: number, songQueue: Song[]) => {
    const song = songQueue[index];
    if (!song || !audioRef.current) return;

    // Claim this play request — any earlier in-flight playback must abort.
    const mySeq = ++playRequestSeqRef.current;
    const intendedIdentity = getSongIdentity(song);
    activeSongIdentityRef.current = intendedIdentity;
    nativeRecoveryAttemptedRef.current.delete(intendedIdentity);

    // Stop whatever is currently playing IMMEDIATELY so we never have two
    // <audio> elements racing to set src and emit events.
    try {
      audioRef.current.pause();
      if (nextAudioRef.current) {
        nextAudioRef.current.pause();
        nextAudioRef.current.src = '';
      }
      preloadedNextIdRef.current = null;
    } catch { /* ignore */ }

    // Cancel any ongoing crossfade
    if (crossfadeIntervalRef.current) {
      clearInterval(crossfadeIntervalRef.current);
      crossfadeIntervalRef.current = null;
    }
    isCrossfading.current = false;
    
    if (nextAudioRef.current) {
      nextAudioRef.current.pause();
      nextAudioRef.current.src = '';
    }

    // Pick up any URL that the early-resolution step upgraded.
    const resolvedSong = songQueue[index] ?? song;

    const useNativePlayback = isNativePlayerAvailable();

    // Update state first for instant UI response. On Android, do NOT mark as
    // playing yet: ExoPlayer must confirm `isPlaying=true`. Marking buffering as
    // playing is what made the APK show fake progress around 3s with no audio.
    setCurrentSong(resolvedSong);
    setCurrentIndex(index);
    currentSongRef.current = resolvedSong;
    currentIndexRef.current = index;
    queueRef.current = songQueue;
    setDuration(resolvedSong.duration || 0);
    setProgress(0);
    // Optimistically show "playing" immediately — even on native. The native
    // startup filter (isStartingUp) blocks any spurious paused/stopped events
    // emitted while ExoPlayer transitions media items, so the UI no longer
    // flips to a pause icon for 3-5s waiting for buffer.
    setIsPlaying(true);
    wasPlayingRef.current = true;
    void publishNativeMusicControls(resolvedSong, true, resolvedSong.duration);

    // ── ANDROID NATIVE PATH ────────────────────────────────────────────────
    // Direct InnerTube → ExoPlayer. No audio element, no proxy, no WebView.
    if (useNativePlayback) {
      nativeUserPausedRef.current = false;
      markNativePlayIntent(mySeq);
      clearNativeStartupTimer();

      try {
        const canStartNativeQueue = Boolean(getNativePlaybackVideoId(resolvedSong as Song & { videoId?: string }))
          || (isPlayableUrl(resolvedSong.audio_url) && !isYouTubeFallbackUrl(resolvedSong.audio_url));

        if (canStartNativeQueue) {
          const nativeTracks = buildNativeQueuePayload(songQueue, index);
          await ExoPlayerPlugin.playQueue({ tracks: nativeTracks, startIndex: index });
        } else {
          const playUrl = await resolveNativePlaybackUrl(resolvedSong);
          if (mySeq !== playRequestSeqRef.current || activeSongIdentityRef.current !== intendedIdentity) return;
          if (!playUrl) throw new Error('no native playable url');
          const updatedSong = { ...resolvedSong, audio_url: playUrl };
          const nextQueue = [...songQueue];
          nextQueue[index] = updatedSong;
          queueRef.current = nextQueue;
          setQueueState(nextQueue);
          setCurrentSong(updatedSong);
          currentSongRef.current = updatedSong;
          await ExoPlayerPlugin.play({
            url: playUrl,
            title: updatedSong.title || '',
            artist: updatedSong.artist || '',
            artworkUrl: updatedSong.cover_url || undefined,
          });
        }
        if (mySeq !== playRequestSeqRef.current || activeSongIdentityRef.current !== intendedIdentity) return;
        clearNativeStartupTimer();
        nativeStartupTimerRef.current = window.setTimeout(() => {
          if (nativeStartupSeqRef.current !== mySeq || nativeStartedForSeqRef.current === mySeq) return;
          console.warn('[player/native] startup timeout; retrying fallback for', resolvedSong.title);
          nativeStartupSeqRef.current = null;
          window.dispatchEvent(new CustomEvent('uf-native-playback-failed', { detail: { message: 'native startup timeout' } }));
        }, 7000);
        reapplyNativeEqSoon();
      } catch (err) {
        console.warn('[player/native] failed', (err as Error)?.message);
        if (mySeq !== playRequestSeqRef.current || activeSongIdentityRef.current !== intendedIdentity) return;
        nativeStartupSeqRef.current = null;
        clearNativeStartupTimer();
        window.dispatchEvent(new CustomEvent('uf-native-playback-failed', { detail: { message: (err as Error)?.message } }));
      }
      return;
    }
    // ── END ANDROID NATIVE PATH ────────────────────────────────────────────


    // Resolve audio URL if needed
    let audioUrl = resolvedSong.audio_url;
    // `yt-video:` is only an iframe fallback marker, NOT an effect-capable
    // audio stream. The previous guard treated it as "playable", so YouTube
    // Music songs jumped straight to the iframe path and the WebAudio EQ could
    // never attach — the modal stayed stuck on "Connecting…" forever. Always
    // try to resolve it into a real audio URL first; use the iframe only as the
    // final playback fallback when every extractor fails.
    if (!isPlayableUrl(audioUrl) || isYouTubeFallbackUrl(audioUrl)) {
      try {
        const resolved = await resolveAudioUrl(resolvedSong);
        if (mySeq !== playRequestSeqRef.current || activeSongIdentityRef.current !== intendedIdentity) return; // superseded by newer tap
        if (resolved) {
          audioUrl = resolved;
          // Update the song in queue with resolved URL
          const updatedSong = { ...song, audio_url: resolved };
          setCurrentSong(updatedSong);
          const nextQueue = [...songQueue];
          nextQueue[index] = updatedSong;
          queueRef.current = nextQueue;
          setQueueState(nextQueue);
        } else {
          // Native + Web: no more YouTube iframe fallback. If every resolver
          // (JioSaavn → InnerTube native → edge extractors) fails, skip the
          // track. The iframe path triggered YouTube's bot-check and made the
          // APK feel broken. Native ExoPlayer + NativeYouTubeResolver handle
          // 100% of playback on Android.
          console.warn('Could not resolve audio for:', song.title, '— skipping to next');
          toast.error(`Skipped: ${song.title} (unavailable)`);
          setIsPlaying(false);
          const activeQueue = queueRef.current;
          const activeIndex = currentIndexRef.current;
          const nextIdx = getNextIndex(activeIndex, activeQueue.length, shuffleRef.current, repeatRef.current);
          if (nextIdx !== null) void playSongAtIndex(nextIdx, activeQueue);
          return;
        }
      } catch {
        if (mySeq !== playRequestSeqRef.current || activeSongIdentityRef.current !== intendedIdentity) return;
        setIsPlaying(false);
        return;
      }
    }

    // Final race guard before we actually touch the <audio> element.
    if (mySeq !== playRequestSeqRef.current || activeSongIdentityRef.current !== intendedIdentity) return;

    // Absolute last resort: if every direct extractor failed, keep playback
    // working with the YouTube iframe fallback instead of leaving the song dead.
    // EQ/native background playback may be unavailable on this fallback, but the
    // user still gets audio while the resolver/proxies recover.
    if (isYouTubeFallbackUrl(audioUrl)) {
      // Native + Web: never use the YouTube iframe. Skip the song.
      setIsPlaying(false);
      toast.error('Song unavailable — skipping');
      const activeQueue2 = queueRef.current;
      const activeIndex2 = currentIndexRef.current;
      const nextIdx2 = getNextIndex(activeIndex2, activeQueue2.length, shuffleRef.current, repeatRef.current);
      if (nextIdx2 !== null) void playSongAtIndex(nextIdx2, activeQueue2);
      return;
    }

    // Standard HTMLAudio path — make sure YT is torn down
    teardownYouTubePlayback();

    // Set source and play immediately
    configureAudioElementSource(audioRef.current, buildStreamProxyUrl(audioUrl));

    audioRef.current.volume = volumeRef.current;
    audioRef.current.currentTime = 0;
    
    audioRef.current.load();
    const playPromise = audioRef.current.play();
    if (playPromise) {
      playPromise.catch(err => {
        if (mySeq !== playRequestSeqRef.current || activeSongIdentityRef.current !== intendedIdentity) return;
        // In the Android APK the WebView <audio> is only a shadow while
        // ExoPlayer takes over. Some phone-signed YouTube/CDN URLs reject in
        // WebView even though ExoPlayer can play them, so never let this shadow
        // promise show a false "song can't play" or flip the UI to stopped.
        if (isNativePlayerAvailable() && false) return;
        const assignedAt = (audioRef.current as (HTMLAudioElement & { __ufAssignedAt?: number }) | null)?.__ufAssignedAt ?? 0;
        if (isNativePlayerAvailable() && assignedAt && Date.now() - assignedAt < 8000) return;
        console.warn('Playback failed:', err.message);
        setIsPlaying(false);
        toast.error('This song could not start right now.');
      });
    }
    
    // Preload next song for gapless playback
    const nextIdx = (index + 1) % songQueue.length;
    if (isGaplessPreloadEnabled() && nextIdx !== index && nextAudioRef.current) {
      const nextSong = songQueue[nextIdx];
      if (nextSong && isPlayableUrl(nextSong.audio_url) && !isYouTubeFallbackUrl(nextSong.audio_url)) {
        configureAudioElementSource(nextAudioRef.current, buildStreamProxyUrl(nextSong.audio_url));
        nextAudioRef.current.preload = 'auto';
        nextAudioRef.current.load();
      } else if (nextSong && (nextSong.source === 'indexed' || nextSong.audio_url === 'resolving')) {
        // Warm the stream cache for the next track so when user hits "next"
        // it resolves instantly from cache instead of waiting for the edge function.
        prefetchIndexedTrack(nextSong.artist, nextSong.title);
      }
    }
  }, [isPlayableUrl, resolveAudioUrl, resolveNativePlaybackUrl, teardownYouTubePlayback, publishNativeMusicControls, playYouTubeFallback, getNextIndex, clearNativeStartupTimer, markNativePlayIntent, playbackSettingsVersion]);

  // Handle song end and crossfade
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleLoadedMetadata = () => {
      setDuration(audio.duration || 0);
    };

    const handleEnded = (event?: Event) => {
      // In the APK, ExoPlayer is the real audible player and the HTML element is
      // only a muted shadow for UI state. Android WebView can fire premature
      // `ended` on that shadow stream; accepting it makes the app skip to the
      // next song while ExoPlayer is still buffering/playing. Only the dedicated
      // native event may advance the queue while the shadow is muted.
      if (isNativePlayerAvailable() && audio.muted && event?.type !== 'uf-native-ended') return;
      if (isCrossfading.current) return;
      // De-dupe: 'ended' + the timeupdate safety net could both fire for the
      // same song. Only the first wins until the next play request bumps seq.
      if (endedFiredForSeqRef.current === playRequestSeqRef.current) return;
      endedFiredForSeqRef.current = playRequestSeqRef.current;
      const activeRepeat = repeatRef.current;
      const activeShuffle = shuffleRef.current;
      const activeIndex = currentIndexRef.current;

      if (activeRepeat === 'one') {
        audio.currentTime = 0;
        audio.play().catch(console.warn);
        return;
      }

      if (!isAutoplayEnabled()) {
        wasPlayingRef.current = false;
        setIsPlaying(false);
        setProgress(audio.duration || audio.currentTime || 0);
        return;
      }

      // Move to next song immediately - no async operations
      const activeQueue = queueRef.current;
      let nextIdx = getNextIndex(activeIndex, activeQueue.length, activeShuffle, activeRepeat);
      
      // If repeat is 'all' and we hit the end, loop back
      if (nextIdx === null && activeRepeat === 'all') {
        nextIdx = 0;
      }
      
      if (nextIdx !== null && activeQueue.length > 0) {
        // Ad break — ONLY on auto-advance (never on a user tap, so tap-to-play
        // latency is untouched). Premium users are excluded inside the engine.
        if (noteSongCompleted()) {
          const nextTrack = activeQueue[nextIdx];
          if (nextTrack) {
            try { audio.pause(); } catch { /* noop */ }
            wasPlayingRef.current = false;
            setIsPlaying(false);
            setPendingSong({ song: nextTrack, offlineUrl: null, songsQueue: activeQueue });
            setAdType('end');
            setShowPrerollAd(true);
            return;
          }
        }
        playSongAtIndex(nextIdx, activeQueue);
      } else if (activeRepeat === 'off' && activeQueue.length > 0) {
        // End of queue — fire YouTube-style endless mix: pull more songs
        // (same artist → genre/mood → trending) and continue playing.
        const seed = activeQueue[activeIndex] || currentSongRef.current;
        extendQueueWithMix(seed).then((added) => {
          if (added.length > 0) {
            // Append happened via setQueueState; jump to the first new track.
            const newQueue = [...queueRef.current];
            const targetIdx = newQueue.findIndex((s) => s.id === added[0].id);
            if (targetIdx >= 0) {
              playSongAtIndex(targetIdx, newQueue);
              return;
            }
          }
          // Truly nothing to play — stop.
          wasPlayingRef.current = false;
          setIsPlaying(false);
          setProgress(0);
        });
      }
    };

    const handlePlay = () => {
      if (isNativePlayerAvailable()) return;
      wasPlayingRef.current = true;
      backgroundRecoveryAttemptsRef.current = 0;
      intentionalPauseRef.current = false;
      setIsPlaying(true);
    };

    const handlePause = () => {
      if (isNativePlayerAvailable()) return;
      if (!isCrossfading.current) {
        if (intentionalPauseRef.current) {
          wasPlayingRef.current = false;
          setIsPlaying(false);
          return;
        }

        if (document.visibilityState === 'hidden' && wasPlayingRef.current && audio.src) {
          if (backgroundRecoveryTimerRef.current) window.clearTimeout(backgroundRecoveryTimerRef.current);
          backgroundRecoveryTimerRef.current = window.setTimeout(() => {
            const a = audioRef.current;
            if (backgroundRecoveryAttemptsRef.current >= 3) {
              setIsPlaying(false);
              return;
            }
            if (wasPlayingRef.current && a?.src && a.paused) {
              backgroundRecoveryAttemptsRef.current += 1;
              resumeAudioEngine();
              a.play()
                .then(() => { backgroundRecoveryAttemptsRef.current = 0; })
                .catch(() => {
                  if (backgroundRecoveryAttemptsRef.current >= 3) setIsPlaying(false);
                });
            }
          }, 250);
          return;
        }

        setIsPlaying(false);
      }
    };

    const handleTimeUpdate = () => {
      // Push progress to the external store (no React rerender of consumers
      // that don't use usePlayerProgress()).
      if (!isCrossfading.current) {
        playerProgressStore.setProgress(audio.currentTime);
      }
      // Premium audio transitions are gated in the engine itself — never trust
      // localStorage/UI toggles because users can tamper with them in DevTools.
      // Android native uses one authoritative ExoPlayer instance. Web crossfade
      // swaps audioRef to nextAudioRef, which detaches nativeMirror and creates
      // the exact auto-change/auto-stop behavior seen in APKs. Keep advanced
      // overlaps web-only until a native ConcatenatingMediaSource/crossfade path
      // exists.
      const premiumAudioTransitions = !isNativePlayerAvailable() && getRuntimePremium() && isAutoplayEnabled();
      if (premiumAudioTransitions && crossfade && queue.length > 1 && audio.duration && !isCrossfading.current) {
        const timeLeft = audio.duration - audio.currentTime;
        if (timeLeft <= crossfadeDuration && timeLeft > 0 && crossfadeAttemptedForSeqRef.current !== playRequestSeqRef.current) {
          startCrossfade();
        }
      } else if (premiumAudioTransitions && gaplessPro && !crossfade && queue.length > 1 && audio.duration && !isCrossfading.current) {
        // Gapless Pro — fire a ~0.45s overlap right before end so the swap is
        // truly seamless even when the next track needs a beat to decode.
        const timeLeft = audio.duration - audio.currentTime;
        if (timeLeft <= GAPLESS_PRO_OVERLAP_SECONDS && timeLeft > 0 && crossfadeAttemptedForSeqRef.current !== playRequestSeqRef.current) {
          startCrossfade(GAPLESS_PRO_OVERLAP_SECONDS);
        }
      }
      // ── Auto-advance safety net for the web HTMLAudio path.
      //    If we're within 0.25s of the end and not crossfading, force the
      //    ended pipeline so playlists keep flowing when 'ended' is swallowed.
      if (
        !isNativePlayerAvailable() &&
        !isCrossfading.current &&
        audio.duration > 1 &&
        isFinite(audio.duration) &&
        audio.currentTime > 0 &&
        audio.duration - audio.currentTime <= 0.25
      ) {
        handleEnded();
      }
    };

    // ── Auto-skip on stream errors (broken/expired URLs) ──
    let lastErrorAt = 0;
    const recoveryAttempted = new Set<string>();
    const handleAudioError = async () => {
      // Debounce: avoid skip-storms if a few errors fire in a row
      const now = Date.now();
      if (now - lastErrorAt < 1500) return;
      lastErrorAt = now;

      const errorCode = audio.error?.code;
      const errorMessage = audio.error?.message ?? '';
      const assignedAt = (audio as HTMLAudioElement & { __ufAssignedAt?: number }).__ufAssignedAt ?? 0;
      if (isNativePlayerAvailable() && assignedAt && Date.now() - assignedAt < 8000) return;
      // Ignore aborts triggered by intentional source swaps / pauses
      if (errorCode === MediaError.MEDIA_ERR_ABORTED) return;
      // Ignore "Empty src attribute" — fires during teardown / before a real
      // src is assigned, and must NOT cause us to auto-skip the queue.
      if (!audio.src || audio.src === window.location.href || /empty src/i.test(errorMessage)) return;

      // Android APK: ExoPlayer owns audible playback. The HTMLAudioElement is a
      // shadow used for UI/progress and can emit WebView-only CORS/network
      // errors while ExoPlayer is still starting or already playing fine. Never
      // let that shadow show "This song could not start" or stop the queue while
      // native takeover is pending/audible; nativeMirror emits a real failure
      // event below if ExoPlayer itself cannot play the URL.
      if (isNativePlayerAvailable() && (audio.muted || false)) return;

      console.warn('[player] audio error:', errorCode, errorMessage);
      recordPerfEvent({
        event_type: 'playback_error',
        severity: 'error',
        message: `code=${errorCode} ${errorMessage}`.slice(0, 240),
        details: { code: errorCode, src_host: (() => { try { return new URL(audio.src).host; } catch { return null; } })() },
      });

      // ── First-chance recovery: stream URL likely went stale. Re-resolve
      //    once with a forced cache-bust, then retry the same song. Only skip
      //    if the refreshed URL also fails. ──
      const activeQueue = queueRef.current;
      const activeIndex = currentIndexRef.current;
      const cur = activeQueue[activeIndex];
      const activeIdentity = activeSongIdentityRef.current;
      const errorBelongsToActiveSong = cur && activeIdentity === getSongIdentity(cur);
      const looksStale =
        errorCode === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED ||
        errorCode === MediaError.MEDIA_ERR_NETWORK ||
        errorCode === MediaError.MEDIA_ERR_DECODE;
      if (
        cur &&
        errorBelongsToActiveSong &&
        looksStale &&
        cur.artist &&
        cur.title &&
        !recoveryAttempted.has(cur.id)
      ) {
        recoveryAttempted.add(cur.id);
        try {
          const seqAtRecoveryStart = playRequestSeqRef.current;
          const fresh = await resolveAudioUrl(cur, { forceRefresh: true, skipNative: true });
          if (seqAtRecoveryStart !== playRequestSeqRef.current || activeSongIdentityRef.current !== activeIdentity) return;
          if (fresh && fresh !== cur.audio_url && !isYouTubeFallbackUrl(fresh)) {
            const refreshed = { ...cur, audio_url: fresh };
            const newQueue = [...activeQueue];
            newQueue[activeIndex] = refreshed;
            queueRef.current = newQueue;
            setQueueState(newQueue);
            setCurrentSong(refreshed);
            configureAudioElementSource(audio, buildStreamProxyUrl(fresh));
            audio.load();
            await audio.play().catch(() => { /* will fall through to skip below on next error */ });
            return;
          }
        } catch { /* fall through to skip */ }
      }

      if (errorBelongsToActiveSong) {
        setIsPlaying(false);
        toast.error('This song could not start right now.');
      }
    };

    const handleNativePlaybackFailed = async (event: Event) => {
      if (!isNativePlayerAvailable()) return;
      const activeQueue = queueRef.current;
      const activeIndex = currentIndexRef.current;
      const cur = currentSongRef.current || activeQueue[activeIndex];
      if (!cur) return;

      const seqAtRecoveryStart = playRequestSeqRef.current;
      const activeIdentity = activeSongIdentityRef.current;
      const failedUrl = (event as CustomEvent<{ url?: string }>).detail?.url;
      if (activeIdentity && nativeRecoveryAttemptedRef.current.has(activeIdentity)) {
        if (seqAtRecoveryStart === playRequestSeqRef.current && activeSongIdentityRef.current === activeIdentity) {
          setIsPlaying(false);
          toast.error('This song could not start right now.');
        }
        return;
      }
      if (activeIdentity) nativeRecoveryAttemptedRef.current.add(activeIdentity);
      try {
        // If phone-signed/native playback failed, immediately fall back to the
        // edge/JioSaavn/proxy resolver for the SAME song, but keep ExoPlayer as
        // the playback engine so lock-screen/background playback still works.
        const fresh = await resolveNativePlaybackUrl(cur, null, { skipNativeFastPath: true });
        if (seqAtRecoveryStart !== playRequestSeqRef.current || activeSongIdentityRef.current !== activeIdentity) return;
        if (fresh && !isYouTubeFallbackUrl(fresh)) {
          const refreshed = { ...cur, audio_url: fresh };
          const nextQueue = [...activeQueue];
          if (activeIndex >= 0 && activeIndex < nextQueue.length) nextQueue[activeIndex] = refreshed;
          queueRef.current = nextQueue.length ? nextQueue : [refreshed];
          setQueueState(queueRef.current);
          setCurrentSong(refreshed);
          currentSongRef.current = refreshed;
          markNativePlayIntent(seqAtRecoveryStart);
          setIsPlaying(true);
          wasPlayingRef.current = true;
          await ExoPlayerPlugin.play({
            url: fresh,
            title: refreshed.title || '',
            artist: refreshed.artist || '',
            artworkUrl: refreshed.cover_url || undefined,
          });
          reapplyNativeEqSoon();
          return;
        }

        if (isNativePlayerAvailable()) {
          const q = queueRef.current;
          const i = currentIndexRef.current;
          const nextIdx = getNextIndex(i, q.length, shuffleRef.current, repeatRef.current);
          if (nextIdx !== null && q.length > 1) {
            toast.error(`Skipped: ${cur.title} (unavailable)`);
            void playSongAtIndex(nextIdx, q);
          } else {
            setIsPlaying(false);
            toast.error('This song could not start right now.');
          }
          return;
        }

        const fallbackVideoId = getYouTubeFallbackVideoId(cur.audio_url) || getNativeResolvedVideoId(failedUrl);
        if (fallbackVideoId) {
          void playYouTubeFallback(
            fallbackVideoId,
            () => {
              const q = queueRef.current;
              const i = currentIndexRef.current;
              const nextIdx = getNextIndex(i, q.length, shuffleRef.current, repeatRef.current);
              if (nextIdx !== null) void playSongAtIndex(nextIdx, q);
              else setIsPlaying(false);
            },
            seqAtRecoveryStart,
            activeIdentity || undefined,
          );
          return;
        }
      } catch { /* final failure below */ }

      if (seqAtRecoveryStart === playRequestSeqRef.current && activeSongIdentityRef.current === activeIdentity) {
        setIsPlaying(false);
        toast.error('This song could not start right now.');
      }
    };

    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('uf-native-ended', handleEnded as EventListener);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('error', handleAudioError);
    window.addEventListener('uf-native-playback-failed', handleNativePlaybackFailed as EventListener);

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('uf-native-ended', handleEnded as EventListener);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('error', handleAudioError);
      window.removeEventListener('uf-native-playback-failed', handleNativePlaybackFailed as EventListener);
    };
  }, [queue, crossfade, crossfadeDuration, gaplessPro, getNextIndex, playSongAtIndex, playYouTubeFallback, resolveAudioUrl, resolveNativePlaybackUrl, extendQueueWithMix, markNativePlayIntent, playbackSettingsVersion]);

  // ── Android: subscribe to ExoPlayer events and drive React state directly.
  useEffect(() => {
    if (!isNativePlayerAvailable()) return;
    let progressHandle: { remove: () => void } | undefined;
    let stateHandle: { remove: () => void } | undefined;
    let errorHandle: { remove: () => void } | undefined;
    let transitionHandle: { remove: () => void } | undefined;
    let cancelled = false;

    (async () => {
      try {
        const p = await ExoPlayerPlugin.addListener('playbackProgress', (d) => {
          if (nativeUserPausedRef.current) return;
          const data = d as ExoPlaybackProgress;
          const posSec = Math.max(0, (data.position || 0) / 1000);
          const durSec = Math.max(0, (data.duration || 0) / 1000);
          const posMs = Math.round(posSec * 1000);
          if (posMs !== nativeLastPositionMsRef.current) {
            nativeLastPositionMsRef.current = posMs;
            nativeLastProgressAtRef.current = Date.now();
            // Progress is genuinely advancing — if the UI slipped into a
            // paused state from a stale native event, correct it now.
            if (!isPlayingRef.current) setIsPlaying(true);
          }
          setProgress(posSec);
          if (durSec > 0) setDuration(durSec);
        });
        const s = await ExoPlayerPlugin.addListener('playbackStateChange', (d) => {
          const data = d as ExoPlaybackState;
          const startupPending = nativeStartupSeqRef.current === playRequestSeqRef.current;
          const recentPlayIntent = Date.now() - nativeLastPlayIntentAtRef.current < 15000;
          // If the native pipeline is still ticking the position forward, a
          // `paused` event is almost certainly a transient buffer/seek — the
          // player is not actually paused. Verify via ExoPlayerPlugin.isPlaying()
          // before flipping the UI.
          const progressMovingRecently = Date.now() - nativeLastProgressAtRef.current < 1500;
          if (data.state === 'playing') {
            if (nativeUserPausedRef.current) return;
            nativeStartedForSeqRef.current = playRequestSeqRef.current;
            nativeStartupSeqRef.current = null;
            clearNativeStartupTimer();
            setIsPlaying(true);
            wasPlayingRef.current = true;
            reapplyNativeEqSoon();
          }
          else if (data.state === 'buffering') {
            if (nativeUserPausedRef.current) return;
            setIsPlaying(true);
            wasPlayingRef.current = true;
          }
          else if (data.state === 'paused' || data.state === 'stopped') {
            if (data.state === 'stopped') { nativeStartupSeqRef.current = null; clearNativeStartupTimer(); }
            if (startupPending || recentPlayIntent) return;
            if (progressMovingRecently) {
              // Re-check authoritatively after a short delay; only flip if
              // ExoPlayer confirms it really is paused.
              window.setTimeout(() => {
                ExoPlayerPlugin.isPlaying()
                  .then(({ isPlaying: reallyPlaying }) => {
                    if (!reallyPlaying) {
                      setIsPlaying(false);
                      wasPlayingRef.current = false;
                    }
                  })
                  .catch(() => undefined);
              }, 450);
              return;
            }
            setIsPlaying(false);
            wasPlayingRef.current = false;
          }
          else if (data.state === 'ended') {
            nativeStartupSeqRef.current = null;
            clearNativeStartupTimer();
            const activeRepeat = repeatRef.current;
            if (activeRepeat === 'one') {
              void ExoPlayerPlugin.seekTo({ positionMs: 0 }).catch(() => undefined);
              void ExoPlayerPlugin.resume().catch(() => undefined);
              return;
            }
            const q = queueRef.current;
            const i = currentIndexRef.current;
            let nIdx = getNextIndex(i, q.length, shuffleRef.current, activeRepeat);
            if (nIdx === null && activeRepeat === 'all') nIdx = 0;
            if (nIdx !== null && q.length > 0) void playSongAtIndex(nIdx, q);
            else setIsPlaying(false);
          }
        });
        const e = await ExoPlayerPlugin.addListener('playbackError', (d) => {
          const data = d as ExoPlaybackError;
          console.warn('[player/native] ExoPlayer error:', data.message);
          nativeStartupSeqRef.current = null;
          clearNativeStartupTimer();
          setIsPlaying(false);
          wasPlayingRef.current = false;
          window.dispatchEvent(new CustomEvent('uf-native-playback-failed', { detail: { message: data.message } }));
        });
        const t = await ExoPlayerPlugin.addListener('mediaItemTransition', (d) => {
          const data = d as ExoMediaItemTransition;
          if (!data.mediaId) return;
          const q = queueRef.current;
          const nextIdx = q.findIndex((song) => getSongIdentity(song) === data.mediaId);
          if (nextIdx < 0 || nextIdx === currentIndexRef.current) return;
          const nextSong = q[nextIdx];
          if (!nextSong) return;
          activeSongIdentityRef.current = getSongIdentity(nextSong);
          currentSongRef.current = nextSong;
          currentIndexRef.current = nextIdx;
          setCurrentSong(nextSong);
          setCurrentIndex(nextIdx);
          setProgress(0);
          if (nextSong.duration) setDuration(nextSong.duration);
          void publishNativeMusicControls(nextSong, true, nextSong.duration);
          // ExoPlayer may allocate a new audio session id when transitioning
          // media items; re-push the user's EQ so it survives the swap.
          reapplyNativeEqSoon();
        });
        void ExoPlayerPlugin.getCurrentPosition()
          .then(({ position }) => {
            if (!nativeUserPausedRef.current && position > 0) setProgress(position / 1000);
          })
          .catch(() => undefined);
        void ExoPlayerPlugin.getDuration()
          .then(({ duration }) => {
            if (duration > 0) setDuration(duration / 1000);
          })
          .catch(() => undefined);
        if (cancelled) { p.remove(); s.remove(); e.remove(); t.remove(); return; }
        progressHandle = p; stateHandle = s; errorHandle = e; transitionHandle = t;
      } catch (err) {
        console.warn('[player/native] failed to attach listeners', (err as Error)?.message);
      }
    })();

    return () => {
      cancelled = true;
      try { progressHandle?.remove(); } catch { /* noop */ }
      try { stateHandle?.remove(); } catch { /* noop */ }
      try { errorHandle?.remove(); } catch { /* noop */ }
      try { transitionHandle?.remove(); } catch { /* noop */ }
    };
  }, [getNextIndex, playSongAtIndex, clearNativeStartupTimer]);


  // ── FIX 3: Proactive stream-URL refresh ──────────────────────────────────
  // YouTube-backed audio URLs expire ~6h after issue, and the OS can suspend
  // the audio element if the URL goes stale while in background. We:
  //   • Stamp when the active source was resolved.
  //   • Every 5 min check elapsed age; once > 3h, silently re-resolve and
  //     swap audio.src while preserving currentTime + play state.
  //   • Also re-check on `visibilitychange` returning to foreground after a
  //     long sleep (>15 min) — the most common cause of "song just dies".
  // The whole thing is best-effort: any failure is swallowed and the existing
  // error handler above will still recover on actual playback failure.
  const sourceResolvedAtRef = useRef<{ songId: string; at: number } | null>(null);
  useEffect(() => {
    if (!currentSong || !audioRef.current?.src) return;
    sourceResolvedAtRef.current = { songId: currentSong.id, at: Date.now() };
  }, [currentSong?.id, currentSong?.audio_url]);

  useEffect(() => {
    const refreshIfStale = async (minAgeMs: number) => {
      const audio = audioRef.current;
      const stamp = sourceResolvedAtRef.current;
      const cur = currentSong;
      if (!audio || !stamp || !cur) return;
      if (stamp.songId !== cur.id) return;
      if (Date.now() - stamp.at < minAgeMs) return;
      // Only refresh resolvable tracks (need artist/title or YT fallback id).
      if (!cur.artist || !cur.title) return;
      try {
        const fresh = await resolveAudioUrl(cur, { forceRefresh: true });
        if (!fresh || fresh === cur.audio_url || isYouTubeFallbackUrl(fresh)) return;
        // Never hot-swap the active stream while the app is hidden: Android can
        // throttle metadata/canplay events in background, leaving the element at
        // 0:00 or silent. Let the current stream continue; recover on foreground
        // or via the normal audio error path if it actually expires.
        if (document.visibilityState === 'hidden') return;

        // Hot-swap src while keeping playhead + play/pause state. Restore only
        // after metadata/canplay because Android WebView often ignores
        // currentTime writes immediately after src assignment.
        const seqAtSwap = playRequestSeqRef.current;
        const identityAtSwap = activeSongIdentityRef.current;
        const t = audio.currentTime;
        const wasPlaying = !audio.paused;
        const refreshed = { ...cur, audio_url: fresh };
        setQueueState((q) => {
          const next = [...q];
          if (next[currentIndex]?.id === cur.id) next[currentIndex] = refreshed;
          return next;
        });
        setCurrentSong(refreshed);
        configureAudioElementSource(audio, buildStreamProxyUrl(fresh));
        let restored = false;
        let restoreTimer: number | null = null;
        const restoreAfterMetadata = () => {
          if (restored) return;
          if (seqAtSwap !== playRequestSeqRef.current || activeSongIdentityRef.current !== identityAtSwap) return;
          restored = true;
          audio.removeEventListener('loadedmetadata', restoreAfterMetadata);
          audio.removeEventListener('canplay', restoreAfterMetadata);
          if (restoreTimer != null) window.clearTimeout(restoreTimer);
          try { audio.currentTime = t; } catch { /* ignore */ }
          resumeAudioEngine();
          if (wasPlaying) void audio.play().catch(() => undefined);
        };
        audio.addEventListener('loadedmetadata', restoreAfterMetadata, { once: true });
        audio.addEventListener('canplay', restoreAfterMetadata, { once: true });
        restoreTimer = window.setTimeout(restoreAfterMetadata, 1200);
        audio.load();
        sourceResolvedAtRef.current = { songId: cur.id, at: Date.now() };
        console.log('[player] proactively refreshed stream URL');
      } catch { /* swallow — error handler will catch real failures */ }
    };

    const interval = window.setInterval(() => { void refreshIfStale(3 * 60 * 60 * 1000); }, 5 * 60 * 1000);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refreshIfStale(15 * 60 * 1000);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [currentSong, currentIndex, resolveAudioUrl]);


  // Crossfade implementation
  const startCrossfade = useCallback((transitionSeconds = crossfadeDuration) => {
    if (isNativePlayerAvailable()) return;
    if (!audioRef.current || !nextAudioRef.current || isCrossfading.current) return;
    if (crossfadeAttemptedForSeqRef.current === playRequestSeqRef.current) return;
    crossfadeAttemptedForSeqRef.current = playRequestSeqRef.current;
    if (queue.length <= 1) return;

    const nextIdx = getNextIndex(currentIndex, queue.length, shuffle, repeat);
    if (nextIdx === null) return;

    const nextSong = queue[nextIdx];
    if (!nextSong) return;

    isCrossfading.current = true;

    // Prepare next audio
    if (!isPlayableUrl(nextSong.audio_url) || isYouTubeFallbackUrl(nextSong.audio_url)) {
      isCrossfading.current = false;
      return;
    }

    configureAudioElementSource(nextAudioRef.current, buildStreamProxyUrl(nextSong.audio_url));
    nextAudioRef.current.volume = 0;
    nextAudioRef.current.currentTime = 0;
    
    nextAudioRef.current.play().then(() => {
      const effectiveDuration = Math.max(0.25, transitionSeconds);
      const steps = Math.max(12, Math.min(90, Math.round(effectiveDuration * 24)));
      const stepDuration = Math.max(16, (effectiveDuration * 1000) / steps);
      let currentStep = 0;

      crossfadeIntervalRef.current = window.setInterval(() => {
        currentStep++;
        const p = currentStep / steps;

        // Equal-power = DJ standard (constant perceived loudness),
        // smooth = S-curve, exponential = power curve, linear = legacy.
        let fadeOut: number;
        let fadeIn: number;
        switch (crossfadeCurve) {
          case 'equal-power':
            fadeOut = Math.cos(p * Math.PI * 0.5);
            fadeIn = Math.sin(p * Math.PI * 0.5);
            break;
          case 'smooth': {
            const s = p * p * (3 - 2 * p);
            fadeOut = 1 - s;
            fadeIn = s;
            break;
          }
          case 'exponential':
            fadeOut = (1 - p) * (1 - p);
            fadeIn = p * p;
            break;
          default:
            fadeOut = 1 - p;
            fadeIn = p;
        }

        if (audioRef.current) {
          const masterVolume = volumeRef.current;
          audioRef.current.volume = Math.max(0, Math.min(masterVolume, masterVolume * fadeOut));
        }
        if (nextAudioRef.current) {
          const masterVolume = volumeRef.current;
          nextAudioRef.current.volume = Math.max(0, Math.min(masterVolume, masterVolume * fadeIn));
        }

        if (currentStep >= steps) {
          if (crossfadeIntervalRef.current) {
            clearInterval(crossfadeIntervalRef.current);
            crossfadeIntervalRef.current = null;
          }

        // Stop old audio
        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current.src = '';
        }

        // Swap audio references
        const temp = audioRef.current;
        audioRef.current = nextAudioRef.current;
        nextAudioRef.current = temp;
        setAudioElement(audioRef.current);

        // Update state
        setCurrentSong(nextSong);
        setCurrentIndex(nextIdx);
        setProgress(0);
        setDuration(audioRef.current?.duration || 0);

          isCrossfading.current = false;
        }
      }, stepDuration);
    }).catch(() => {
      isCrossfading.current = false;
    });
  }, [queue, currentIndex, shuffle, repeat, crossfadeDuration, crossfadeCurve, getNextIndex, isPlayableUrl]);

  const playActualSong = useCallback(async (song: Song, offlineUrl?: string | null, songsQueue?: Song[]) => {
    if (!audioRef.current) return;

    // Claim this play request. If the user taps another song before resolveAudioUrl
    // resolves, this seq will be stale and we MUST abort — otherwise the late
    // resolver wins and a different song plays than the one the user tapped.
    const mySeq = ++playRequestSeqRef.current;
    const intendedIdentity = getSongIdentity(song);
    activeSongIdentityRef.current = intendedIdentity;
    nativeRecoveryAttemptedRef.current.delete(intendedIdentity);

    // Cancel any ongoing crossfade and stale preloaded next-track audio
    if (crossfadeIntervalRef.current) {
      clearInterval(crossfadeIntervalRef.current);
      crossfadeIntervalRef.current = null;
    }
    isCrossfading.current = false;
    try {
      audioRef.current.pause();
      if (nextAudioRef.current) {
        nextAudioRef.current.pause();
        nextAudioRef.current.src = '';
      }
      preloadedNextIdRef.current = null;
    } catch { /* ignore */ }

    const useNativePlayback = isNativePlayerAvailable();

    // Update state immediately to prevent UI flicker. Android shows playback as
    // starting right away; native events will correct it only on real failure.
    setCurrentSong(song);
    currentSongRef.current = song;
    setDuration(song.duration || 0);
    setProgress(0);
    setIsPlaying(true);
    wasPlayingRef.current = true;
    void publishNativeMusicControls(song, true, song.duration);
    
    let playbackSource = offlineUrl || song.audio_url;

    // `yt-video:` can play through the YouTube iframe, but iframe audio cannot
    // be connected to WebAudio. Resolve it to a real stream before playback so
    // Premium EQ/effects can attach to the normal <audio> element.
    if (!isNativePlayerAvailable() && !offlineUrl && (!isPlayableUrl(playbackSource) || isYouTubeFallbackUrl(playbackSource))) {
      const resolved = await resolveAudioUrl(song);
      if (mySeq !== playRequestSeqRef.current || activeSongIdentityRef.current !== intendedIdentity) return; // user tapped another song first
      if (!resolved) {
        const fallbackVideoId = getYouTubeFallbackVideoId(song.audio_url);
        if (fallbackVideoId) {
          toast.info('Direct audio failed — playing fallback source.');
          void playYouTubeFallback(
            fallbackVideoId,
            () => {
              const activeQueue = queueRef.current;
              const activeIndex = currentIndexRef.current;
              const nextIdx = getNextIndex(activeIndex, activeQueue.length, shuffleRef.current, repeatRef.current);
              if (nextIdx !== null) void playSongAtIndex(nextIdx, activeQueue);
              else setIsPlaying(false);
            },
            mySeq,
            intendedIdentity,
          );
          return;
        }
        setIsPlaying(false);
        wasPlayingRef.current = false;
        toast.error('This song could not start right now.');
        return;
      }

      playbackSource = resolved;
      song = { ...song, audio_url: resolved };
      setCurrentSong(song);
    }

    // Final guard before mutating <audio> — bail if a newer tap has taken over.
    if (mySeq !== playRequestSeqRef.current || activeSongIdentityRef.current !== intendedIdentity) return;

    const normalizedQueue = songsQueue?.map((queuedSong) =>
      getSongIdentity(queuedSong) === intendedIdentity ? { ...queuedSong, audio_url: playbackSource } : queuedSong,
    );

    // Android APK: ExoPlayer is the only audible player. Do not start the
    // WebView <audio> element here; it gets suspended/killed in background and
    // fights the native session. Resolve YouTube IDs on-device, then play
    // directly through the foreground MediaSessionService.
    if (useNativePlayback) {
      nativeUserPausedRef.current = false;
      markNativePlayIntent(mySeq);
      clearNativeStartupTimer();

      try {
        const nativeQueue = normalizedQueue && normalizedQueue.length > 0 ? normalizedQueue : null;
        const nativeIndex = nativeQueue?.findIndex(s => getSongIdentity(s) === intendedIdentity) ?? -1;
        const canStartNativeQueue = !offlineUrl && nativeQueue && nativeIndex >= 0 && (
          Boolean(getNativePlaybackVideoId(song as Song & { videoId?: string }))
          || (isPlayableUrl(playbackSource) && !isYouTubeFallbackUrl(playbackSource))
        );

        if (canStartNativeQueue) {
          await ExoPlayerPlugin.playQueue({ tracks: buildNativeQueuePayload(nativeQueue, nativeIndex), startIndex: nativeIndex });
          if (mySeq !== playRequestSeqRef.current || activeSongIdentityRef.current !== intendedIdentity) return;
          queueRef.current = nativeQueue;
          setQueueState(nativeQueue);
          setCurrentIndex(nativeIndex);
          clearNativeStartupTimer();
          nativeStartupTimerRef.current = window.setTimeout(() => {
            if (nativeStartupSeqRef.current !== mySeq || nativeStartedForSeqRef.current === mySeq) return;
            console.warn('[player/native] startup timeout; retrying fallback for', song.title);
            nativeStartupSeqRef.current = null;
            window.dispatchEvent(new CustomEvent('uf-native-playback-failed', { detail: { message: 'native startup timeout' } }));
          }, 7000);
          reapplyNativeEqSoon();
          return;
        }

        const playUrl = await resolveNativePlaybackUrl({ ...song, audio_url: playbackSource }, offlineUrl);
        if (mySeq !== playRequestSeqRef.current || activeSongIdentityRef.current !== intendedIdentity) return;
        if (!playUrl || isYouTubeFallbackUrl(playUrl)) throw new Error('no native playable url');
        const refreshedSong = { ...song, audio_url: playUrl };
        await ExoPlayerPlugin.play({
          url: playUrl,
          title: refreshedSong.title || '',
          artist: refreshedSong.artist || '',
          artworkUrl: refreshedSong.cover_url || undefined,
        });
        clearNativeStartupTimer();
        nativeStartupTimerRef.current = window.setTimeout(() => {
          if (nativeStartupSeqRef.current !== mySeq || nativeStartedForSeqRef.current === mySeq) return;
          console.warn('[player/native] startup timeout; retrying fallback for', song.title);
          nativeStartupSeqRef.current = null;
          window.dispatchEvent(new CustomEvent('uf-native-playback-failed', { detail: { message: 'native startup timeout', url: playUrl } }));
        }, 7000);
        reapplyNativeEqSoon();
        if (normalizedQueue && normalizedQueue.length > 0) {
          const refreshedQueue = normalizedQueue.map((queuedSong) => getSongIdentity(queuedSong) === intendedIdentity ? refreshedSong : queuedSong);
          queueRef.current = refreshedQueue;
          setQueueState(refreshedQueue);
          setCurrentSong(refreshedSong);
          currentSongRef.current = refreshedSong;
          const songIndex = refreshedQueue.findIndex(s => getSongIdentity(s) === intendedIdentity);
          setCurrentIndex(songIndex >= 0 ? songIndex : 0);
        } else {
          const activeQueue = queueRef.current;
          const existingIndex = activeQueue.findIndex(s => getSongIdentity(s) === intendedIdentity);
          if (existingIndex === -1) {
            const next = [...activeQueue, refreshedSong];
            queueRef.current = next;
            setQueueState(next);
            setCurrentIndex(activeQueue.length);
          } else {
            const next = [...activeQueue];
            next[existingIndex] = refreshedSong;
            queueRef.current = next;
            setQueueState(next);
            setCurrentSong(refreshedSong);
            currentSongRef.current = refreshedSong;
            setCurrentIndex(existingIndex);
          }
        }
      } catch (err) {
        console.warn('[player/native] playActualSong failed', (err as Error)?.message);
        if (mySeq === playRequestSeqRef.current && activeSongIdentityRef.current === intendedIdentity) {
          nativeStartupSeqRef.current = null;
          clearNativeStartupTimer();
          window.dispatchEvent(new CustomEvent('uf-native-playback-failed', { detail: { message: (err as Error)?.message } }));
        }
      }
      return;
    }

    // ── YouTube IFrame fallback path ──
    if (!offlineUrl && isYouTubeFallbackUrl(playbackSource)) {
      const fallbackVideoId = getYouTubeFallbackVideoId(playbackSource);
      if (fallbackVideoId) {
        toast.info('Direct audio failed — playing fallback source.');
        void playYouTubeFallback(
          fallbackVideoId,
          () => {
            const activeQueue = queueRef.current;
            const activeIndex = currentIndexRef.current;
            const nextIdx = getNextIndex(activeIndex, activeQueue.length, shuffleRef.current, repeatRef.current);
            if (nextIdx !== null) void playSongAtIndex(nextIdx, activeQueue);
            else setIsPlaying(false);
          },
          mySeq,
          intendedIdentity,
        );
        return;
      }
      setIsPlaying(false);
      toast.error('Song unavailable');
      return;
    }

    teardownYouTubePlayback();

    // Set audio source - use offline URL if available
    const playbackUrl = offlineUrl || buildStreamProxyUrl(playbackSource);
    configureAudioElementSource(audioRef.current, playbackUrl);
    audioRef.current.volume = volumeRef.current;
    audioRef.current.currentTime = 0;

    // Load and play immediately
    audioRef.current.load();
    const playPromise = audioRef.current.play();
    if (playPromise) {
      playPromise.catch(err => {
        console.warn('Playback failed:', err?.message);
        if (mySeq === playRequestSeqRef.current && activeSongIdentityRef.current === intendedIdentity) {
          // Android APK: ignore WebView shadow play() rejection while native
          // ExoPlayer takeover is pending/audible. Native failure is handled by
          // uf-native-playback-failed, not this HTMLAudioElement promise.
          if (isNativePlayerAvailable() && false) return;
          const assignedAt = (audioRef.current as (HTMLAudioElement & { __ufAssignedAt?: number }) | null)?.__ufAssignedAt ?? 0;
          if (isNativePlayerAvailable() && assignedAt && Date.now() - assignedAt < 8000) return;
          setIsPlaying(false);
          toast.error('This song could not start right now.');
        }
      });
    }

    // If a queue is provided, use it
    if (normalizedQueue && normalizedQueue.length > 0) {
      queueRef.current = normalizedQueue;
      setQueueState(normalizedQueue);
      const songIndex = normalizedQueue.findIndex(s => getSongIdentity(s) === intendedIdentity);
      setCurrentIndex(songIndex >= 0 ? songIndex : 0);
    } else {
      // Update queue - add song if not exists
      const activeQueue = queueRef.current;
      const existingIndex = activeQueue.findIndex(s => getSongIdentity(s) === intendedIdentity);
      if (existingIndex === -1) {
        setQueueState(prev => {
          const next = [...prev, song];
          queueRef.current = next;
          return next;
        });
        setCurrentIndex(activeQueue.length);
      } else {
        setCurrentIndex(existingIndex);
      }
    }

    // Track recently played — DEBOUNCED: only log if user actually listens
    // for 30s. Cancels previous pending log if user skips quickly.
    // Also: only catalog UUIDs are valid for recently_played.song_id (uuid column).
    if (recentlyPlayedTimerRef.current) {
      clearTimeout(recentlyPlayedTimerRef.current);
      recentlyPlayedTimerRef.current = null;
    }
    const isCatalogUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(song.id);
    const trackIdForEvent = (song.id || `${song.artist}-${song.title}`).slice(0, 220);
    const sourceForEvent = isCatalogUuid ? 'catalog' : (song.id?.startsWith('yt-') ? 'youtube' : (song.id?.startsWith('audius-') ? 'audius' : 'external'));
    recentlyPlayedTimerRef.current = window.setTimeout(() => {
      recentlyPlayedTimerRef.current = null;
      supabase.auth.getUser().then(({ data: { user } }) => {
        if (!user) return;
        // Jump Back In is per-device only — write to localStorage, NOT the cloud.
        // Jump Back In is per-device only — write to localStorage, NOT the cloud.
        // Store snapshot for non-catalog ids (yt-…/ytm-…) so Home can rehydrate.
        if (song.id) {
          import('@/lib/localRecentlyPlayed').then((m) =>
            m.pushLocalRecent(user.id, song.id, {
              id: song.id,
              title: song.title,
              artist: song.artist,
              album: song.album,
              cover_url: song.cover_url,
              audio_url: song.audio_url,
              duration: song.duration,
            }),
          );
        }
        // Anonymized aggregate analytics only (no per-user history reveal).
        supabase.from('song_play_events').insert({
          user_id: user.id,
          track_id: trackIdForEvent,
          song_id: isCatalogUuid ? song.id : null,
          title: (song.title || 'Unknown').slice(0, 220),
          artist: (song.artist || 'Unknown').slice(0, 220),
          cover_url: song.cover_url || null,
          source: sourceForEvent,
          action: 'stream',
          score_weight: 3,
        }).then(() => {});
        // Bump artist_songs.play_count so the artist dashboard sees plays
        // arriving in real time. The RPC no-ops if the id doesn't match a
        // live artist_songs row, so it's safe for catalog/YT ids too.
        if (isCatalogUuid) {
          supabase.rpc('increment_artist_song_play', { _song_id: song.id })
            .then(() => {}, () => {});
        }

      }).catch(() => {});
    }, 30000);
  }, [isPlayableUrl, resolveAudioUrl, resolveNativePlaybackUrl, teardownYouTubePlayback, publishNativeMusicControls, playSongAtIndex, playYouTubeFallback, getNextIndex, clearNativeStartupTimer, markNativePlayIntent]);

  const playSong = useCallback((song: Song, offlineUrl?: string | null, songsQueue?: Song[]) => {
    // Spotify-like behavior: a tap must start playback immediately. Ads/premium
    // checks must never block the audio pipeline.
    playActualSong(song, offlineUrl, songsQueue);
  }, [playActualSong]);

  // NOTE: We intentionally do NOT auto-play the last song on APK launch.
  // The queue, currentSong, currentIndex, and progress are already restored
  // from localStorage (see the effect around line 531). Auto-calling
  // playActualSong() here caused songs to blast at full volume the moment the
  // APK opened, with no user gesture — the classic "instant play" bug users
  // reported. Spotify/Apple Music both restore state without auto-playing;
  // the user must tap play to resume. The `Continue listening` card on Home
  // already provides a one-tap resume with saved position.
  useEffect(() => {
    const saved = pendingNativeRestoreRef.current;
    if (!saved || nativeRestoreAttemptedRef.current) return;
    nativeRestoreAttemptedRef.current = true;
    pendingNativeRestoreRef.current = null;
    // State was already hydrated by the queue-restore effect. Nothing to do.
  }, [playActualSong]);

  const onPrerollAdComplete = useCallback(() => {
    setShowPrerollAd(false);
    if (pendingSong) {
      playActualSong(pendingSong.song, pendingSong.offlineUrl, pendingSong.songsQueue);
      setPendingSong(null);
    }
  }, [pendingSong, playActualSong]);

  // NOTE: isPlaying is the single source of truth shared by MiniPlayer +
  // FullscreenPlayer. We update it OPTIMISTICALLY here so the UI flips
  // instantly on tap (sub-frame), then the audio element's native
  // 'play'/'pause' listeners (see effect above) re-confirm the value — so
  // both surfaces stay in lockstep even if the OS, media session, or
  // hardware buttons drive the transport.
  const togglePlay = useCallback(() => {
    if (!currentSong) return;

    if (isNativePlayerAvailable()) {
      if (isPlaying) {
        nativeUserPausedRef.current = true;
        playRequestSeqRef.current += 1;
        nativeStartupSeqRef.current = null;
        nativeLastPlayIntentAtRef.current = 0;
        clearNativeStartupTimer();
        setIsPlaying(false); wasPlayingRef.current = false;
        void ExoPlayerPlugin.pause().catch(() => undefined);
      } else {
        nativeUserPausedRef.current = false;
        nativeLastPlayIntentAtRef.current = Date.now();
        // Only resume if native ExoPlayer actually started playback in this app
        // session. Restored progress alone is NOT sufficient after cold start —
        // the ExoPlayer foreground service was destroyed, so resume() is a
        // no-op and audio would stay silent while UI shows "playing".
        const hasStartedOrProgressed = nativeStartedForSeqRef.current !== null;
        markNativePlayIntent(playRequestSeqRef.current);
        setIsPlaying(true); wasPlayingRef.current = true;
        if (hasStartedOrProgressed) {
          void ExoPlayerPlugin.resume().catch(() => undefined);
        } else {
          const q = queueRef.current.length ? queueRef.current : [currentSong];
          const idx = Math.max(0, currentIndexRef.current);
          void playSongAtIndex(Math.min(idx, q.length - 1), q);
        }
      }
      return;
    }

    if (youtubeActiveRef.current && youtubePlayerRef.current) {
      try {
        if (isPlaying) { youtubePlayerRef.current.pauseVideo(); setIsPlaying(false); }
        else { youtubePlayerRef.current.playVideo(); setIsPlaying(true); }
      } catch { /* ignore */ }
      return;
    }

    if (!audioRef.current) return;
    const el = audioRef.current;
    // Guard: if the audio element has no source yet (still resolving) or is
    // mid state-transition, treat the tap as a "play intent" and let the
    // resolver's playback trigger take over — do NOT call play() on an empty
    // src (throws) or race pause() against a pending play() (AbortError).
    const hasSrc = !!el.currentSrc || !!el.src;
    if (el.paused) {
      if (!hasSrc) {
        // Nothing loaded yet — just record intent, resolver will start playback.
        setIsPlaying(true);
        wasPlayingRef.current = true;
        return;
      }
      setIsPlaying(true); // optimistic — listener will revert if play() rejects
      wasPlayingRef.current = true;
      el.play().catch(err => {
        wasPlayingRef.current = false;
        setIsPlaying(false);
        console.warn('Play failed:', err?.message);
      });
    } else {
      setIsPlaying(false);
      wasPlayingRef.current = false;
      markIntentionalPause();
      el.pause();
    }
  }, [currentSong, isPlaying, markIntentionalPause, markNativePlayIntent, clearNativeStartupTimer, playSongAtIndex]);

  const pause = useCallback(() => {
    setIsPlaying(false);
    wasPlayingRef.current = false;
    markIntentionalPause();
    if (isNativePlayerAvailable()) {
      nativeUserPausedRef.current = true;
      playRequestSeqRef.current += 1;
      nativeStartupSeqRef.current = null;
      nativeLastPlayIntentAtRef.current = 0;
      clearNativeStartupTimer();
      void ExoPlayerPlugin.pause().catch(() => undefined);
      return;
    }
    if (youtubeActiveRef.current && youtubePlayerRef.current) {
      try { youtubePlayerRef.current.pauseVideo(); } catch { /* ignore */ }
      return;
    }
    if (audioRef.current) {
      audioRef.current.pause();
    }
  }, [markIntentionalPause, clearNativeStartupTimer]);

  const play = useCallback(() => {
    if (!currentSong) return;
    setIsPlaying(true); // optimistic
    wasPlayingRef.current = true;
    if (isNativePlayerAvailable()) {
      nativeUserPausedRef.current = false;
      nativeLastPlayIntentAtRef.current = Date.now();
      // See togglePlay: restored progress alone must not trigger resume() on
      // cold start, or the destroyed ExoPlayer service will silently no-op.
      const hasStartedOrProgressed = nativeStartedForSeqRef.current !== null;
      markNativePlayIntent(playRequestSeqRef.current);
      if (hasStartedOrProgressed) {
        void ExoPlayerPlugin.resume().catch(() => undefined);
      } else {
        const q = queueRef.current.length ? queueRef.current : [currentSong];
        const idx = Math.max(0, currentIndexRef.current);
        void playSongAtIndex(Math.min(idx, q.length - 1), q);
      }
      return;
    }
    if (youtubeActiveRef.current && youtubePlayerRef.current) {
      try { youtubePlayerRef.current.playVideo(); } catch { /* ignore */ }
      return;
    }
    if (audioRef.current) {
      audioRef.current.play().catch((err) => {
        wasPlayingRef.current = false;
        setIsPlaying(false);
        console.warn('Play failed:', err?.message);
      });
    }
  }, [currentSong, playSongAtIndex]);

  const stopSong = useCallback(() => {
    if (crossfadeIntervalRef.current) {
      clearInterval(crossfadeIntervalRef.current);
      crossfadeIntervalRef.current = null;
    }
    isCrossfading.current = false;

    teardownYouTubePlayback();
    wasPlayingRef.current = false;
    nativeStartupSeqRef.current = null;
    nativeStartedForSeqRef.current = null;
    clearNativeStartupTimer();

    if (isNativePlayerAvailable()) {
      void ExoPlayerPlugin.stop().catch(() => undefined);
    }

    if (audioRef.current) {
      markIntentionalPause();
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current.src = '';
    }
    if (nextAudioRef.current) {
      nextAudioRef.current.pause();
      nextAudioRef.current.src = '';
    }

    setCurrentSong(null);
    setIsPlaying(false);
    setProgress(0);
    setDuration(0);
    setQueueState([]);
    setCurrentIndex(0);
    setExpanded(false);
    activeSongIdentityRef.current = null;
  }, [teardownYouTubePlayback, markIntentionalPause, clearNativeStartupTimer]);

  const nextSong = useCallback(async () => {
    if (queue.length === 0) return;

    // Cancel crossfade
    if (crossfadeIntervalRef.current) {
      clearInterval(crossfadeIntervalRef.current);
      crossfadeIntervalRef.current = null;
    }
    isCrossfading.current = false;

    if (nextAudioRef.current) {
      nextAudioRef.current.pause();
      nextAudioRef.current.src = '';
    }

    const nextIdx = getNextIndex(currentIndex, queue.length, shuffle, repeat);
    if (nextIdx !== null) {
      playSongAtIndex(nextIdx, queue);
    } else {
      // Loop back to start even if repeat is off when manually pressing next
      playSongAtIndex(0, queue);
    }
  }, [queue, currentIndex, shuffle, repeat, getNextIndex, playSongAtIndex]);

  const prevSong = useCallback(() => {
    if (queue.length === 0) return;

    // Cancel crossfade
    if (crossfadeIntervalRef.current) {
      clearInterval(crossfadeIntervalRef.current);
      crossfadeIntervalRef.current = null;
    }
    isCrossfading.current = false;

    if (nextAudioRef.current) {
      nextAudioRef.current.pause();
      nextAudioRef.current.src = '';
    }

    // If more than 3 seconds in, restart current song
    if (!isNativePlayerAvailable() && audioRef.current && audioRef.current.currentTime > 3) {
      audioRef.current.currentTime = 0;
      setProgress(0);
    } else {
      // Go to previous song
      const prevIdx = currentIndex === 0 ? queue.length - 1 : currentIndex - 1;
      playSongAtIndex(prevIdx, queue);
    }
  }, [queue, currentIndex, playSongAtIndex]);

  const seek = useCallback((time: number) => {
    if (isNativePlayerAvailable()) {
      void ExoPlayerPlugin.seekTo({ positionMs: Math.max(0, Math.round(time * 1000)) }).catch(() => undefined);
      setProgress(time);
      return;
    }
    if (youtubeActiveRef.current && youtubePlayerRef.current) {
      try { youtubePlayerRef.current.seekTo(time, true); } catch { /* ignore */ }
      setProgress(time);
      return;
    }
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setProgress(time);
    }
  }, []);


  // Sync volume to YT player when it changes
  useEffect(() => {
    if (youtubeActiveRef.current && youtubePlayerRef.current) {
      try { youtubePlayerRef.current.setVolume?.(Math.round(volume * 100)); } catch { /* ignore */ }
    }
    if (isNativePlayerAvailable()) {
      void ExoPlayerPlugin.setVolume({ volume }).catch(() => undefined);
    }
  }, [volume]);

  const setVolume = useCallback((vol: number) => {
    setVolumeState(vol);
  }, []);

  const setQueue = useCallback((songs: Song[]) => {
    queueRef.current = songs;
    setQueueState(songs);
    setCurrentIndex(0);
  }, []);

  const addToQueue = useCallback((song: Song) => {
    setQueueState(prev => {
      const next = [...prev, song];
      queueRef.current = next;
      return next;
    });
  }, []);

  const toggleShuffle = useCallback(() => {
    setShuffle(prev => {
      const newVal = !prev;
      // Clear shuffle history when toggling
      if (newVal) {
        shuffleHistoryRef.current.clear();
      }
      return newVal;
    });
  }, []);

  const toggleRepeat = useCallback(() => {
    setRepeat(prev => {
      const modes: ('off' | 'all' | 'one')[] = ['off', 'all', 'one'];
      const idx = modes.indexOf(prev);
      const newMode = modes[(idx + 1) % modes.length];
      return newMode;
    });
  }, []);

  const toggleCrossfade = useCallback(() => {
    if (!getRuntimePremium()) {
      setCrossfade(false);
      try { localStorage.setItem('uf_crossfade', 'false'); } catch { /* noop */ }
      toast.error('Crossfade is a Premium feature');
      return;
    }
    setCrossfade(prev => {
      const next = !prev;
      try { localStorage.setItem('uf_crossfade', String(next)); } catch { /* noop */ }
      return next;
    });
  }, []);

  const setCrossfadeDurationFn = useCallback((seconds: number) => {
    if (!getRuntimePremium()) {
      toast.error('Crossfade is a Premium feature');
      return;
    }
    const clamped = Math.max(1, Math.min(12, seconds));
    setCrossfadeDurationState(clamped);
    try { localStorage.setItem('uf_crossfade_duration', String(clamped)); } catch { /* noop */ }
  }, []);

  const setCrossfadeCurveFn = useCallback((curve: 'linear' | 'equal-power' | 'smooth' | 'exponential') => {
    if (!getRuntimePremium()) {
      toast.error('Crossfade Curve is a Premium feature');
      return;
    }
    setCrossfadeCurveState(curve);
    try { localStorage.setItem('uf_crossfade_curve', curve); } catch { /* noop */ }
  }, []);

  const toggleGaplessPro = useCallback(() => {
    if (!getRuntimePremium()) {
      setGaplessPro(false);
      try { localStorage.setItem('uf_gapless_pro', 'false'); } catch { /* noop */ }
      toast.error('Gapless Pro is a Premium feature');
      return;
    }
    setGaplessPro(prev => {
      const next = !prev;
      try { localStorage.setItem('uf_gapless_pro', String(next)); } catch { /* noop */ }
      return next;
    });
  }, []);

  // Media Session API for lock screen / notification controls
  // These callbacks must be stable refs to avoid hook count issues
  const mediaSessionCallbacks = React.useMemo(() => ({
    onPlay: () => {
      if (isNativePlayerAvailable()) {
        nativeUserPausedRef.current = false;
        setIsPlaying(true);
        wasPlayingRef.current = true;
        // Restored progress alone is not enough — cold-start ExoPlayer has no
        // media loaded, so we must go through playSongAtIndex to hydrate it.
        const hasStartedOrProgressed = nativeStartedForSeqRef.current !== null;
        if (hasStartedOrProgressed) {
          void ExoPlayerPlugin.resume().catch(() => undefined);
        } else if (currentSong) {
          const q = queueRef.current.length ? queueRef.current : [currentSong];
          const idx = Math.max(0, currentIndexRef.current);
          void playSongAtIndex(Math.min(idx, q.length - 1), q);
        }
        return;
      }
      if (audioRef.current && currentSong) {
        audioRef.current.play().catch(console.warn);
      }
    },
    onPause: () => {
      if (isNativePlayerAvailable()) {
        nativeUserPausedRef.current = true;
        playRequestSeqRef.current += 1;
        nativeStartupSeqRef.current = null;
        nativeLastPlayIntentAtRef.current = 0;
        clearNativeStartupTimer();
        setIsPlaying(false);
        wasPlayingRef.current = false;
        void ExoPlayerPlugin.pause().catch(() => undefined);
        return;
      }
      if (audioRef.current) {
        markIntentionalPause();
        audioRef.current.pause();
      }
    },
    onNext: () => {
      if (queue.length === 0) return;
      const nextIdx = getNextIndex(currentIndex, queue.length, shuffle, repeat);
      if (nextIdx !== null) {
        playSongAtIndex(nextIdx, queue);
      } else {
        playSongAtIndex(0, queue);
      }
    },
    onPrev: () => {
      if (!audioRef.current || queue.length === 0) return;
      if (audioRef.current.currentTime > 3) {
        audioRef.current.currentTime = 0;
        setProgress(0);
      } else {
        const prevIdx = currentIndex === 0 ? queue.length - 1 : currentIndex - 1;
        playSongAtIndex(prevIdx, queue);
      }
    },
    onSeek: (time: number) => {
      if (isNativePlayerAvailable()) {
        void ExoPlayerPlugin.seekTo({ positionMs: Math.max(0, Math.round(time * 1000)) }).catch(() => undefined);
        setProgress(time);
        return;
      }
      if (audioRef.current) {
        audioRef.current.currentTime = time;
        setProgress(time);
      }
    },
  }), [currentSong, queue, currentIndex, shuffle, repeat, getNextIndex, playSongAtIndex, markIntentionalPause, clearNativeStartupTimer]);

  useEffect(() => {
    initNativeBridge(mediaSessionCallbacks.onPause, mediaSessionCallbacks.onPlay);
  }, [mediaSessionCallbacks]);

  const { progress: liveProgress, duration: liveDuration } = usePlayerProgress();

  useMediaSession({
    song: currentSong,
    isPlaying,
    onPlay: mediaSessionCallbacks.onPlay,
    onPause: mediaSessionCallbacks.onPause,
    onNext: mediaSessionCallbacks.onNext,
    onPrev: mediaSessionCallbacks.onPrev,
    onSeek: mediaSessionCallbacks.onSeek,
    duration: liveDuration,
    progress: liveProgress,
  });

  // Native Android music controls (lockscreen + notification on APK).
  // No-op on web — useMediaSession handles browser/PWA controls.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { setNativeMusicHandlers, showNativeMusicControls, destroyNativeMusicControls } =
        await import('@/lib/nativeMusicControls');
      if (cancelled) return;

      setNativeMusicHandlers({
        onPlay: () => mediaSessionCallbacks.onPlay(),
        onPause: () => mediaSessionCallbacks.onPause(),
        onNext: () => mediaSessionCallbacks.onNext(),
        onPrev: () => mediaSessionCallbacks.onPrev(),
        onStop: () => mediaSessionCallbacks.onPause(),
      });

      if (currentSong) {
        await showNativeMusicControls(
          {
            title: currentSong.title,
            artist: currentSong.artist,
            cover: currentSong.cover_url,
            album: currentSong.album,
            duration: liveDuration || currentSong.duration,
          },
          isPlaying,
        );
      } else {
        await destroyNativeMusicControls();
      }
    })();
    return () => { cancelled = true; };
  }, [currentSong?.id, isPlaying, liveDuration, mediaSessionCallbacks]);

  useEffect(() => {
    if (!currentSong) return;
    let cancelled = false;
    const tick = () => {
      import('@/lib/nativeMusicControls')
        .then(({ updateNativeMusicState }) => {
          if (!cancelled) updateNativeMusicState(isPlaying, playerProgressStore.getProgress());
        })
        .catch(() => {});
    };
    tick();
    const id = window.setInterval(tick, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [currentSong?.id, isPlaying]);

  // Dynamic Island removed — relying solely on MediaNotification + lock screen.

  // Track each played song into local song-history (Spotify-style search history)
  useEffect(() => {
    if (!currentSong) return;
    import('@/lib/songHistory').then(({ addSongToHistory }) => addSongToHistory(currentSong));
  }, [currentSong?.id]);

  // Screen Wake Lock while playing — prevents mobile browsers from suspending
  // the page (and pausing audio) when the user locks their device screen.
  // Auto re-acquires on visibility change. No-op on Capacitor APK where the
  // foreground media notification service keeps audio alive.
  useEffect(() => {
    if (!isPlaying) return;
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = async () => {
      if (cancelled || sentinel) return;
      try {
        const s = await navigator.wakeLock.request('screen');
        sentinel = s;
        if (cancelled) { s.release().catch(() => {}); sentinel = null; return; }
        // Auto re-request when the system releases (screen off, tab hidden).
        s.addEventListener('release', () => {
          sentinel = null;
          if (!cancelled && document.visibilityState === 'visible') acquire();
        });
      } catch { /* ignore — user gesture or unsupported */ }
    };
    acquire();
    const onVis = () => {
      if (document.visibilityState === 'visible' && !sentinel) acquire();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      sentinel?.release().catch(() => {});
      sentinel = null;
    };
  }, [isPlaying]);

  return (
    <PlayerContext.Provider value={{
      currentSong,
      isPlaying,
      volume,
      queue,
      shuffle,
      repeat,
      isExpanded,
      crossfade,
      crossfadeDuration,
      crossfadeCurve,
      gaplessPro,
      audioElement,
      showPrerollAd,
      adType,
      playSong,
      togglePlay,
      pause,
      play,
      stopSong,
      nextSong,
      prevSong,
      seek,
      setVolume,
      setQueue,
      addToQueue,
      toggleShuffle,
      toggleRepeat,
      setExpanded,
      toggleCrossfade,
      setCrossfadeDuration: setCrossfadeDurationFn,
      setCrossfadeCurve: setCrossfadeCurveFn,
      toggleGaplessPro,
      onPrerollAdComplete,
    }}>
      {children}
    </PlayerContext.Provider>
  );
};

// Inert stub used when a component that calls usePlayer() somehow renders
// outside PlayerProvider (Sentry error-boundary fallback, portaled toast
// content, dev HMR race, etc). Throwing here spammed Sentry's weekly
// digest with the same "must be used within a PlayerProvider" a dozen
// times without any actionable component stack.
const noop = () => {};
const INERT_PLAYER: PlayerContextType = {
  currentSong: null,
  isPlaying: false,
  volume: 1,
  queue: [],
  shuffle: false,
  repeat: 'off',
  isExpanded: false,
  crossfade: false,
  crossfadeDuration: 6,
  crossfadeCurve: 'equal-power',
  gaplessPro: false,
  audioElement: null,
  showPrerollAd: false,
  adType: 'start',
  playSong: noop,
  togglePlay: noop,
  pause: noop,
  play: noop,
  stopSong: noop,
  nextSong: noop,
  prevSong: noop,
  seek: noop,
  setVolume: noop,
  setQueue: noop,
  addToQueue: noop,
  toggleShuffle: noop,
  toggleRepeat: noop,
  setExpanded: noop,
  toggleCrossfade: noop,
  setCrossfadeDuration: noop,
  setCrossfadeCurve: noop,
  toggleGaplessPro: noop,
  onPrerollAdComplete: noop,
};

let warnedMissingProvider = false;
export const usePlayer = (): PlayerContextType => {
  const context = useContext(PlayerContext);
  if (context === undefined) {
    if (!warnedMissingProvider && typeof console !== 'undefined') {
      warnedMissingProvider = true;
      console.warn('[usePlayer] rendered outside PlayerProvider; using inert stub');
    }
    return INERT_PLAYER;
  }
  return context;
};

export const useOptionalPlayer = () => useContext(PlayerContext);
