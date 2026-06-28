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
