import { supabase } from '@/integrations/supabase/client';

/**
 * Premium-gated catalog audio lives in the PRIVATE `music` bucket. Public
 * object URLs no longer work there, so any stored `/object/public/music/...`
 * URL must be exchanged for a short-lived signed URL. Access is still enforced
 * server-side by storage RLS (entitlement mirrors the `songs` table), so an
 * unentitled listener simply gets no signed URL.
 *
 * Anything that is not a `music` bucket object (YouTube streams, JioSaavn,
 * blobs, covers, app releases) is returned untouched.
 */
const PUBLIC_MUSIC_PREFIX = '/storage/v1/object/public/music/';
const SIGNED_TTL_SECONDS = 60 * 60; // 1 hour
const CACHE_TTL_MS = 50 * 60 * 1000; // refresh before expiry

const signedCache = new Map<string, { url: string; expiresAt: number }>();

const getMusicObjectPath = (url: string | null | undefined): string | null => {
  if (!url || typeof url !== 'string') return null;
  const idx = url.indexOf(PUBLIC_MUSIC_PREFIX);
  if (idx === -1) return null;
  const path = url.slice(idx + PUBLIC_MUSIC_PREFIX.length).split('?')[0];
  if (!path) return null;
  // App release artifacts (APK) stay publicly readable.
  if (path.startsWith('releases/')) return null;
  return decodeURIComponent(path);
};

export const signStorageAudioUrl = async (
  url: string | null | undefined,
): Promise<string | null> => {
  const path = getMusicObjectPath(url);
  if (!path) return url ?? null;

  const cached = signedCache.get(path);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  const { data, error } = await supabase.storage
    .from('music')
    .createSignedUrl(path, SIGNED_TTL_SECONDS);

  if (error || !data?.signedUrl) {
    console.warn('[storageAudio] could not sign music object', path, error?.message);
    return null;
  }

  signedCache.set(path, { url: data.signedUrl, expiresAt: Date.now() + CACHE_TTL_MS });
  return data.signedUrl;
};
