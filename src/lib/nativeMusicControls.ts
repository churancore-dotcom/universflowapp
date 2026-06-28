// Native music controls bridge — talks to our custom Android plugin
// `MediaNotificationPlugin` on legacy Android builds only.
// On web, no-ops. The Web Media Session in useMediaSession.ts handles
// browser/PWA controls.
//
// IMPORTANT: New Android APKs use the ExoPlayer MediaSessionService instead of
// this legacy WebView foreground service. Starting both services can crash some
// Android builds with ForegroundServiceDidNotStartInTimeException, so every
// function below is intentionally a no-op on Android.

import { Capacitor, registerPlugin } from '@capacitor/core';

interface MediaNotificationPluginShape {
  create(opts: {
    title: string;
    artist: string;
    album?: string;
    cover?: string;
    duration?: number; // seconds
    isPlaying: boolean;
  }): Promise<void>;
  update(opts: { isPlaying: boolean; position?: number /* seconds */ }): Promise<void>;
  destroy(): Promise<void>;
  requestPermission(): Promise<{ granted: boolean }>;
  addListener(
    eventName: 'controlsNotification',
    cb: (e: { message: string }) => void,
  ): Promise<{ remove: () => Promise<void> }> | { remove: () => void };
}

// registerPlugin returns a proxy on web that throws "not implemented" — we
// guard every call with isNative() so web stays silent.
const MediaNotification = registerPlugin<MediaNotificationPluginShape>('MediaNotification');

function isNative() {
  try {
    return Capacitor.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

function isAndroid() {
  try {
    return Capacitor.getPlatform?.() === 'android';
  } catch {
    return false;
  }
}

export interface NativeTrack {
  title: string;
  artist: string;
  cover?: string;
  album?: string;
  duration?: number; // seconds
}

let listenerAttached = false;
let permissionRequested = false;
let currentHandlers: {
  onPlay?: () => void;
  onPause?: () => void;
  onNext?: () => void;
  onPrev?: () => void;
  onStop?: () => void;
} = {};

export function setNativeMusicHandlers(h: typeof currentHandlers) {
  currentHandlers = h;
  attachListenerOnce();
}

async function attachListenerOnce() {
  if (listenerAttached || !isNative() || isAndroid()) return;
  try {
    await MediaNotification.addListener('controlsNotification', (e) => {
      switch (e.message) {
        case 'music-controls-play':
          currentHandlers.onPlay?.();
          break;
        case 'music-controls-pause':
          currentHandlers.onPause?.();
          break;
        case 'music-controls-next':
          currentHandlers.onNext?.();
          break;
        case 'music-controls-previous':
          currentHandlers.onPrev?.();
          break;
        case 'music-controls-destroy':
          currentHandlers.onStop?.();
          break;
      }
    });
    listenerAttached = true;
  } catch (e) {
    console.warn('[MediaNotification] addListener failed:', e);
  }
}

/**
 * Ask for POST_NOTIFICATIONS on Android 13+ (no-op on older Android & iOS & web).
 * Safe to call multiple times — only the first call shows the system dialog.
 *
 * NOTE: This is also called by usePushRegistration; calling it from both is
 * harmless because the OS only prompts once.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  // ExoPlayerService owns Android's notification permission/media session now.
  // Do not touch the legacy MediaNotification plugin on Android.
  if (isAndroid()) return true;
  if (permissionRequested) return true;
  permissionRequested = true;
  try {
    const { granted } = await MediaNotification.requestPermission();
    return !!granted;
  } catch (e) {
    console.warn('[MediaNotification] requestPermission failed:', e);
    return false;
  }
}

export async function showNativeMusicControls(track: NativeTrack, isPlaying: boolean) {
  if (!isNative() || isAndroid()) return;
  // Best-effort permission grant, but NEVER block playback startup on the
  // Android 13+ permission dialog. The foreground service can still keep the
  // WebView alive even if the drawer notification is hidden by OS policy.
  void ensureNotificationPermission();
  try {
    await MediaNotification.create({
      title: track.title || 'Unknown',
      artist: track.artist || 'Unknown Artist',
      album: track.album,
      cover: track.cover,
      duration: track.duration ? Math.floor(track.duration) : 0,
      isPlaying,
    });
    attachListenerOnce();
  } catch (e) {
    console.warn('[MediaNotification] create failed:', e);
  }
}

export async function updateNativeMusicState(isPlaying: boolean, position?: number) {
  if (!isNative() || isAndroid()) return;
  try {
    await MediaNotification.update({
      isPlaying,
      position: typeof position === 'number' ? Math.floor(position) : undefined,
    });
  } catch {
    // Ignore — service may not be running yet.
  }
}

export async function destroyNativeMusicControls() {
  if (!isNative() || isAndroid()) return;
  try {
    await MediaNotification.destroy();
  } catch {
    // Ignore
  }
}
