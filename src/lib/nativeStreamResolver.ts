// FIX 2 — On-device YouTube stream resolution.
//
// WHY: Supabase edge functions get LOGIN_REQUIRED ("Sign in to confirm you're
// not a bot") because YouTube blocks datacenter IP ranges. The user's phone
// uses a residential IP and is treated as a real client, so we hit YouTube's
// internal Innertube /player endpoint directly from the device.
//
// HOW: On Capacitor native (Android/iOS) we use @capacitor/core's CapacitorHttp
// which bypasses WebView CORS by routing requests through the native HTTP
// stack. On web we no-op and let the edge function chain handle resolution.
//
// SAFETY: Any failure returns null; the caller falls back to the existing
// extract-audio edge function — we never break playback.

import { Capacitor, CapacitorHttp } from '@capacitor/core';

const INNERTUBE_URL = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';

const ANDROID_VR_CTX = {
  client: {
    clientName: 'ANDROID_VR',
    clientVersion: '1.60.19',
    deviceMake: 'Oculus',
    deviceModel: 'Quest 3',
    androidSdkVersion: 32,
    osName: 'Android',
    osVersion: '12L',
    hl: 'en',
    gl: 'US',
    userAgent: 'com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L) gzip',
  },
};

const IOS_CTX = {
  client: {
    clientName: 'IOS',
    clientVersion: '20.10.4',
    deviceMake: 'Apple',
    deviceModel: 'iPhone16,2',
    osName: 'iPhone',
    osVersion: '18.3.2.22D82',
    hl: 'en',
    gl: 'US',
    userAgent: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X)',
  },
};

interface AdaptiveFormat {
  mimeType?: string;
  bitrate?: number;
  url?: string;
}

interface PlayerResponse {
  playabilityStatus?: { status?: string; reason?: string };
  streamingData?: { adaptiveFormats?: AdaptiveFormat[] };
}

export interface NativeStreamResult {
  streamUrl: string;
  source: 'native-innertube';
}

export const isNativeStreamResolverAvailable = (): boolean => {
  if (!Capacitor.isNativePlatform()) return false;
  // CapacitorHttp ships with @capacitor/core ≥ 6 but guard anyway.
  return typeof CapacitorHttp?.post === 'function';
};

async function fetchPlayer(videoId: string, ctx: { client: Record<string, unknown> & { userAgent: string; clientName: string } }): Promise<PlayerResponse | null> {
  try {
    const res = await CapacitorHttp.post({
      url: INNERTUBE_URL,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': ctx.client.userAgent,
        Origin: 'https://www.youtube.com',
        'X-Goog-Api-Format-Version': '2',
      },
      data: {
        context: ctx,
        videoId,
        playbackContext: { contentPlaybackContext: { html5Preference: 'HTML5_PREF_WANTS' } },
        contentCheckOk: true,
        racyCheckOk: true,
      },
      connectTimeout: 6000,
      readTimeout: 6000,
    });
    if (res.status < 200 || res.status >= 300) return null;
    return typeof res.data === 'string' ? JSON.parse(res.data) : (res.data as PlayerResponse);
  } catch (e) {
    console.warn('[native-resolver]', ctx.client.clientName, 'failed:', (e as Error).message);
    return null;
  }
}

function pickBestAudio(data: PlayerResponse): string | null {
  const adaptive = data.streamingData?.adaptiveFormats ?? [];
  const audio = adaptive.filter(
    (f) => typeof f.mimeType === 'string' && f.mimeType.startsWith('audio/') && !!f.url,
  );
  if (!audio.length) return null;
  audio.sort((a, b) => {
    const aM4a = a.mimeType?.includes('mp4') ? 1 : 0;
    const bM4a = b.mimeType?.includes('mp4') ? 1 : 0;
    if (aM4a !== bM4a) return bM4a - aM4a;
    return (b.bitrate ?? 0) - (a.bitrate ?? 0);
  });
  return audio[0].url ?? null;
}

export async function resolveYouTubeStreamOnDevice(videoId: string): Promise<NativeStreamResult | null> {
  if (!videoId || videoId.length !== 11) return null;

  // PRIMARY: Kotlin OkHttp-based InnerTube plugin (no CORS, native HTTP stack,
  // residential IP -> bypasses YouTube's datacenter blocks).
  try {
    const { resolveOnDevice } = await import('./nativePlayer');
    const url = await resolveOnDevice(videoId);
    if (url) return { streamUrl: url, source: 'native-innertube' };
  } catch (e) {
    console.warn('[native-resolver] kotlin plugin unavailable:', (e as Error)?.message);
  }

  // FALLBACK: CapacitorHttp (also residential IP, just slower path).
  if (!isNativeStreamResolverAvailable()) return null;

  const [vr, ios] = await Promise.all([
    fetchPlayer(videoId, ANDROID_VR_CTX),
    fetchPlayer(videoId, IOS_CTX),
  ]);

  for (const data of [vr, ios]) {
    if (!data) continue;
    const status = data.playabilityStatus?.status;
    if (status && status !== 'OK') continue;
    const url = pickBestAudio(data);
    if (url) {
      console.log('[native-resolver] ✓ CapacitorHttp fallback', videoId);
      return { streamUrl: url, source: 'native-innertube' };
    }
  }
  return null;
}
