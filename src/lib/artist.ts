import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { compressImage } from './imageCompression';

export type ArtistAppStatus = 'pending' | 'approved' | 'rejected';
export type ArtistApplicationSafe = Database['public']['Views']['artist_applications_safe']['Row'] & { admin_note: string | null };


const KYC_BUCKET = 'artist-kyc';
const COVERS_BUCKET = 'covers';

function uniqueUploadId() {
  const random = new Uint32Array(2);
  globalThis.crypto?.getRandomValues?.(random);
  return `${random[0].toString(36)}${random[1].toString(36)}${Math.random().toString(36).slice(2)}`;
}

async function compressKyc(file: File): Promise<File> {
  return compressImage(file, {
    maxWidth: 1200,
    maxHeight: 1200,
    quality: 0.78,
    outputType: 'image/jpeg',
  });
}

async function compressPhoto(file: File): Promise<File> {
  return compressImage(file, {
    maxWidth: 800,
    maxHeight: 800,
    quality: 0.82,
    outputType: 'image/webp',
  });
}

async function uploadFile(bucket: string, path: string, file: File) {
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    upsert: false,
    contentType: file.type,
  });
  if (error) throw error;
  return path;
}


// Uploads the single live-face liveness capture to the private KYC bucket.
// This is the only KYC-style upload the artist application flow makes now
// that government ID documents have been removed.
export async function uploadLivenessCapture(userId: string, file: File): Promise<string> {
  const compressed = await compressKyc(file);
  const path = `${userId}/${Date.now()}-${uniqueUploadId()}-liveness.jpg`;
  return uploadFile(KYC_BUCKET, path, compressed);
}

export async function uploadArtistPhoto(userId: string, file: File): Promise<string> {
  const compressed = await compressPhoto(file);
  const path = `artist-photos/${userId}/${Date.now()}-${uniqueUploadId()}.webp`;
  await uploadFile(COVERS_BUCKET, path, compressed);
  const { data } = supabase.storage.from(COVERS_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export async function uploadArtistCover(userId: string, file: File): Promise<string> {
  const compressed = await compressPhoto(file);
  const path = `artist-covers/${userId}/${Date.now()}-${uniqueUploadId()}.webp`;
  await uploadFile(COVERS_BUCKET, path, compressed);
  const { data } = supabase.storage.from(COVERS_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export function isBlockedStreamHost(url: string): string | null {
  const u = url.toLowerCase();
  if (!/^https?:\/\//.test(u)) return 'URL must start with https:// or http://';
  const blocked = [
    ['youtube.com', 'YouTube'],
    ['youtu.be', 'YouTube'],
    ['music.youtube', 'YouTube'],
    ['jiosaavn', 'JioSaavn'],
    ['spotify.com', 'Spotify'],
    ['soundcloud.com', 'SoundCloud'],
  ];
  for (const [needle, label] of blocked) {
    if (u.includes(needle)) return `${label} links are not allowed — use a direct audio URL you own.`;
  }
  return null;
}

export async function getMyApplication(userId: string): Promise<ArtistApplicationSafe | null> {
  // admin_note column is no longer SELECT-able by regular authenticated users;
  // fetch the rest of the row, then pull the owner-scoped note via RPC.
  const { data, error } = await supabase
    .from('artist_applications_safe')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  let admin_note: string | null = null;
  if (data.id) try {
    const { data: note } = await supabase.rpc('get_my_artist_application_note', { _app_id: data.id });
    admin_note = (note as string | null) ?? null;
  } catch {
    admin_note = null;
  }
  return { ...data, admin_note } as ArtistApplicationSafe;
}

// Legacy re-apply helpers. Only one artist application is allowed per account
// now, so these always return `canReapply: false`. Kept for callers that read
// the state to decide whether to show a "re-apply" affordance — they now show
// nothing, which is the intended behaviour.
export function getArtistReapplyAt(_app: { reviewed_at?: string | null; updated_at?: string | null; created_at?: string | null }) {
  return null;
}

export function getArtistReapplyState(_app: { reviewed_at?: string | null; updated_at?: string | null; created_at?: string | null }) {
  return { reapplyAt: null as Date | null, canReapply: false, waitText: '' };
}

export async function getMyArtistProfile(userId: string) {
  const { data } = await supabase
    .from('artist_profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  return data;
}

export async function uploadArtistGalleryPhoto(userId: string, file: File): Promise<string> {
  const compressed = await compressPhoto(file);
  const path = `artist-gallery/${userId}/${Date.now()}-${uniqueUploadId()}.webp`;
  await uploadFile(COVERS_BUCKET, path, compressed);
  const { data } = supabase.storage.from(COVERS_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
