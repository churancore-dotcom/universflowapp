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

interface ExoPlayerPluginShape {
  play: (opts: { url: string; title: string; artist: string; artworkUrl?: string }) => Promise<void>;
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
    event: 'playbackStateChange' | 'playbackProgress' | 'playbackError',
    cb: (data: ExoPlaybackState | ExoPlaybackProgress | ExoPlaybackError) => void,
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
 */
export async function pushNativeEQFromWebBands(
  webBands: number[],
  webFrequenciesHz: number[],
): Promise<void> {
  if (!isNativePlayerAvailable()) return;
  const info = await getNativeEQBands();
  if (!info?.available || info.numberOfBands === 0) return;
  await setNativeEQEnabled(true);
  for (const native of info.bands) {
    const target = native.centerFrequencyHz;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < webFrequenciesHz.length; i++) {
      // log-distance for fairness across octaves
      const d = Math.abs(Math.log2(Math.max(1, webFrequenciesHz[i] / Math.max(1, target))));
      if (d < bestDist) { bestDist = d; best = i; }
    }
    const dB = webBands[best] ?? 0;
    const mb = Math.max(info.minLevel, Math.min(info.maxLevel, Math.round(dB * 100)));
    await setNativeEQBand(native.index, mb);
  }
}
