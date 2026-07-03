import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { compressImage } from './imageCompression';

export type ArtistAppStatus = 'pending' | 'approved' | 'rejected';
export type IdDocType = 'voter_id' | 'pan' | 'passport' | 'drivers_license' | 'national_id';
export type ArtistApplicationSafe = Database['public']['Views']['artist_applications_safe']['Row'] & { admin_note: string | null };

const REAPPLY_COOLDOWN_DAYS = 7;

export const ID_DOC_LABELS: Record<IdDocType, string> = {
  voter_id: 'Voter ID',
  pan: 'PAN Card',
  passport: 'Passport',
  drivers_license: "Driver's Licence",
  national_id: 'National ID',
};

export function docsForCountry(cc: string): IdDocType[] {
  const c = (cc || '').toUpperCase();
  // India — Voter ID, PAN and Passport are the documents Indians actually have
  if (c === 'IN') return ['voter_id', 'pan', 'passport'];
  // US — no national ID
  if (c === 'US') return ['drivers_license', 'passport'];
  // UK — driving licence + passport
  if (c === 'GB') return ['drivers_license', 'passport'];
  // EU & most other countries have a National ID card
  if (['DE','FR','IT','ES','NL','BE','PT','PL','SE','NO','DK','FI','AT','CH','IE','GR','CZ','RO','HU'].includes(c))
    return ['national_id', 'passport', 'drivers_license'];
  // Anglosphere without National ID
  if (['CA','AU','NZ'].includes(c)) return ['drivers_license', 'passport'];
  // Default: National ID + Passport + Driver's Licence
  return ['national_id', 'passport', 'drivers_license'];
}


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

export async function uploadKycFile(
  userId: string,
  kind: 'front' | 'back' | 'selfie',
  file: File,
): Promise<string> {
  const compressed = await compressKyc(file);
  const path = `${userId}/${Date.now()}-${uniqueUploadId()}-${kind}.jpg`;
  return uploadFile(KYC_BUCKET, path, compressed);
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
    .select('id, user_id, stage_name, real_name, phone, country_code, social_links, id_doc_type, id_doc_front_path, id_doc_back_path, selfie_path, artist_photo_path, status, reviewed_at, reviewed_by, created_at, updated_at')
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

export function getArtistReapplyAt(app: { reviewed_at?: string | null; updated_at?: string | null; created_at?: string | null }) {
  const base = app.reviewed_at || app.updated_at || app.created_at;
  if (!base) return null;
  return new Date(new Date(base).getTime() + REAPPLY_COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
}

export function getArtistReapplyState(app: { reviewed_at?: string | null; updated_at?: string | null; created_at?: string | null }) {
  const reapplyAt = getArtistReapplyAt(app);
  if (!reapplyAt) return { reapplyAt: null, canReapply: false, waitText: '' };
  const diff = reapplyAt.getTime() - Date.now();
  const canReapply = diff <= 0;
  const days = Math.ceil(diff / (24 * 60 * 60 * 1000));
  const waitText = canReapply ? 'You can re-submit now.' : `You can re-submit in ${days} day${days === 1 ? '' : 's'}.`;
  return { reapplyAt, canReapply, waitText };
}

export async function getMyArtistProfile(userId: string) {
  const { data } = await supabase
    .from('artist_profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  return data;
}
