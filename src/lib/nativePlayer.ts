// Capacitor wrappers for the on-device InnerTube resolver and ExoPlayer
// MediaSessionService. Both no-op on web — callers must check
// `isNativePlayerAvailable()` first.

import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface InnerTubeResult {
  url: string;
  itag: number;
  client: string;
}

interface InnerTubePluginShape {
  resolveAudio: (opts: { videoId: string }) => Promise<InnerTubeResult>;
}

interface StreamResolverResult {
  url: string;
  source?: string;
  client?: string;
  expiresAt?: number;
}

interface StreamResolverPluginShape {
  resolve: (opts: { videoId?: string; title?: string; artist?: string }) => Promise<StreamResolverResult>;
  resolveStream: (opts: { videoId?: string; title?: string; artist?: string }) => Promise<StreamResolverResult>;
  invalidate: (opts: { videoId: string }) => Promise<void>;
  prefetch: (opts: { tracks: Array<{ videoId?: string; title?: string; artist?: string }>; limit?: number }) => Promise<void>;
}

export interface ExoPlaybackState {
  state: 'playing' | 'paused' | 'buffering' | 'stopped' | 'ended' | 'unknown';
}

export interface ExoPlaybackProgress {
  position: number; // ms
  duration: number; // ms
}

export interface ExoPlaybackError {
  message: string;
}

export interface ExoMediaItemTransition {
  mediaId: string;
  reason?: number;
}

export interface NativeQueueTrack {
  id: string;
  title: string;
  artist: string;
  artworkUrl?: string;
  url?: string;
  videoId?: string;
}

interface ExoPlayerPluginShape {
  play: (opts: { url: string; title: string; artist: string; artworkUrl?: string }) => Promise<void>;
  playQueue: (opts: { tracks: NativeQueueTrack[]; startIndex: number }) => Promise<void>;
  preloadQueue: (opts: { tracks: NativeQueueTrack[]; limit?: number }) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  stop: () => Promise<void>;
  seekTo: (opts: { positionMs: number }) => Promise<void>;
  setVolume: (opts: { volume: number }) => Promise<void>;
  getCurrentPosition: () => Promise<{ position: number }>;
  getDuration: () => Promise<{ duration: number }>;
  isPlaying: () => Promise<{ isPlaying: boolean }>;
  getAudioSessionId: () => Promise<{ sessionId: number }>;
  setEQEnabled: (opts: { enabled: boolean }) => Promise<void>;
  setEQBand: (opts: { band: number; levelMillibels: number }) => Promise<void>;
  getEQBands: () => Promise<NativeEQBandsInfo>;
  setBassBoost: (opts: { strength: number }) => Promise<void>;
  setVirtualizer: (opts: { strength: number }) => Promise<void>;
  setLoudnessEnhancer: (opts: { gainMb: number }) => Promise<void>;
  addListener: (
    event: 'playbackStateChange' | 'playbackProgress' | 'playbackError' | 'mediaItemTransition',
    cb: (data: ExoPlaybackState | ExoPlaybackProgress | ExoPlaybackError | ExoMediaItemTransition) => void,
  ) => Promise<PluginListenerHandle>;
}

export interface NativeEQBandInfo {
  index: number;
  centerFrequencyHz: number;
  minFrequencyHz: number;
  maxFrequencyHz: number;
}
export interface NativeEQBandsInfo {
  available: boolean;
  numberOfBands: number;
  minLevel: number; // millibels
  maxLevel: number; // millibels
  bands: NativeEQBandInfo[];
}


export const InnerTubePlugin = registerPlugin<InnerTubePluginShape>('InnerTube');
export const ExoPlayerPlugin = registerPlugin<ExoPlayerPluginShape>('ExoPlayer');
export const StreamResolverPlugin = registerPlugin<StreamResolverPluginShape>('StreamResolver');

export function isNativePlayerAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

export async function resolveOnDevice(videoId: string): Promise<string | null> {
  if (!isNativePlayerAvailable()) return null;
  try {
    const res = await InnerTubePlugin.resolveAudio({ videoId });
    if (res?.url) {
      console.log('[InnerTube/native] ✓', videoId, 'via', res.client, 'itag', res.itag);
      return res.url;
    }
  } catch (e) {
    console.warn('[InnerTube/native] failed', videoId, (e as Error)?.message);
  }
  return null;
}

export async function resolveNativeMetadataStream(opts: { videoId?: string; title?: string; artist?: string }): Promise<string | null> {
  if (!isNativePlayerAvailable()) return null;
  try {
    const res = await StreamResolverPlugin.resolve(opts);
    return res?.url || null;
  } catch {
    try {
      const res = await StreamResolverPlugin.resolveStream(opts);
      return res?.url || null;
    } catch {
      return null;
    }
  }
}

// ---------------- Native EQ helpers (Android-only) ----------------

let cachedNativeEQ: NativeEQBandsInfo | null = null;

export async function getNativeEQBands(): Promise<NativeEQBandsInfo | null> {
  if (!isNativePlayerAvailable()) return null;
  if (cachedNativeEQ?.available) return cachedNativeEQ;
  try {
    const info = await ExoPlayerPlugin.getEQBands();
    cachedNativeEQ = info;
    return info;
  } catch {
    return null;
  }
}

export async function setNativeEQEnabled(enabled: boolean): Promise<void> {
  if (!isNativePlayerAvailable()) return;
  try { await ExoPlayerPlugin.setEQEnabled({ enabled }); } catch {}
}

export async function setNativeEQBand(band: number, levelMillibels: number): Promise<void> {
  if (!isNativePlayerAvailable()) return;
  try { await ExoPlayerPlugin.setEQBand({ band, levelMillibels: Math.round(levelMillibels) }); } catch {}
}

export async function setNativeBassBoost(strength: number): Promise<void> {
  if (!isNativePlayerAvailable()) return;
  try { await ExoPlayerPlugin.setBassBoost({ strength: Math.max(0, Math.min(1000, Math.round(strength))) }); } catch {}
}

export async function setNativeVirtualizer(strength: number): Promise<void> {
  if (!isNativePlayerAvailable()) return;
  try { await ExoPlayerPlugin.setVirtualizer({ strength: Math.max(0, Math.min(1000, Math.round(strength))) }); } catch {}
}

export async function setNativeLoudnessEnhancer(gainMb: number): Promise<void> {
  if (!isNativePlayerAvailable()) return;
  try { await ExoPlayerPlugin.setLoudnessEnhancer({ gainMb: Math.max(0, Math.min(2000, Math.round(gainMb))) }); } catch {}
}

/**
 * Map a 10-band web EQ (centers in Hz, gains in dB ±12) onto the device's
 * native AudioEffect Equalizer (typically 5 bands). For each native band we
 * pick the nearest web band by center frequency and convert dB → millibels.
 *
 * Robustness: when the native Equalizer hasn't bound yet (no audio session
 * id — happens BEFORE first play), we still push levels using a canonical
 * 5-band layout. The plugin caches them in `savedEqBands` and re-applies
 * the instant effects bind — so tweaking EQ before hitting play works.
 */
const FALLBACK_NATIVE_BANDS: NativeEQBandInfo[] = [
  { index: 0, centerFrequencyHz: 60,    minFrequencyHz: 30,    maxFrequencyHz: 120 },
  { index: 1, centerFrequencyHz: 230,   minFrequencyHz: 120,   maxFrequencyHz: 460 },
  { index: 2, centerFrequencyHz: 910,   minFrequencyHz: 460,   maxFrequencyHz: 1800 },
  { index: 3, centerFrequencyHz: 3600,  minFrequencyHz: 1800,  maxFrequencyHz: 7000 },
  { index: 4, centerFrequencyHz: 14000, minFrequencyHz: 7000,  maxFrequencyHz: 20000 },
];

export async function pushNativeEQFromWebBands(
  webBands: number[],
  webFrequenciesHz: number[],
): Promise<void> {
  if (!isNativePlayerAvailable()) return;
  const info = await getNativeEQBands();
  const usable = info?.available && info.numberOfBands > 0 ? info : null;
  const nativeBands = usable ? usable.bands : FALLBACK_NATIVE_BANDS;
  const minLevel = usable ? usable.minLevel : -1500;
  const maxLevel = usable ? usable.maxLevel : 1500;
  await setNativeEQEnabled(true);
  for (const native of nativeBands) {
    const target = native.centerFrequencyHz;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < webFrequenciesHz.length; i++) {
      const d = Math.abs(Math.log2(Math.max(1, webFrequenciesHz[i] / Math.max(1, target))));
      if (d < bestDist) { bestDist = d; best = i; }
    }
    const dB = webBands[best] ?? 0;
    const mb = Math.max(minLevel, Math.min(maxLevel, Math.round(dB * 100)));
    await setNativeEQBand(native.index, mb);
  }
}
