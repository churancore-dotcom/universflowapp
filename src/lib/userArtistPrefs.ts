import { supabase } from '@/integrations/supabase/client';

export interface UserArtistPref {
  id: string;
  artist_name: string;
  artist_image: string | null;
  artist_source: string;
  created_at: string;
}

function portraitOnly(url?: string | null): string | null {
  if (!url) return null;
  // Third-party artist images are now sourced from Spotify's exact artist
  // result only. This prevents song/video artwork from being persisted as PFP.
  // Artist-owned uploads are still accepted from our storage.
  if (/^(?:https?:)?\/\/i\.scdn\.co\/image\/[a-z0-9]+(?:\?.*)?$/i.test(url)) return url;
  if (/\/storage\/v1\/object\//i.test(url)) return url;
  return null;
}

// In-memory cache (per session) to avoid repeated reads
let cache: { userId: string; data: UserArtistPref[]; ts: number } | null = null;
const TTL = 60 * 1000;

const notifyArtistPrefsChanged = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('uf:artist-prefs-changed'));
  }
};

export async function getUserArtistPrefs(userId: string, force = false): Promise<UserArtistPref[]> {
  if (!force && cache && cache.userId === userId && Date.now() - cache.ts < TTL) {
    return cache.data;
  }
  const { data, error } = await supabase
    .from('user_artist_preferences')
    .select('id, artist_name, artist_image, artist_source, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('Failed to load user artist prefs:', error);
    return [];
  }
  cache = { userId, data: data || [], ts: Date.now() };
  return data || [];
}

export async function followArtist(
  userId: string,
  artistName: string,
  opts: { image?: string | null; source?: 'catalog' | 'lastfm' } = {}
): Promise<boolean> {
  const { error } = await supabase
    .from('user_artist_preferences')
    .upsert(
      {
        user_id: userId,
        artist_name: artistName,
        artist_image: portraitOnly(opts.image),
        artist_source: opts.source ?? 'lastfm',
      },
      { onConflict: 'user_id,artist_name' }
    );
  if (error) {
    console.error('Failed to follow artist:', error);
    return false;
  }
  cache = null;
  notifyArtistPrefsChanged();
  return true;
}

export async function unfollowArtist(userId: string, artistName: string): Promise<boolean> {
  const { error } = await supabase
    .from('user_artist_preferences')
    .delete()
    .eq('user_id', userId)
    .eq('artist_name', artistName);
  if (error) {
    console.error('Failed to unfollow artist:', error);
    return false;
  }
  cache = null;
  notifyArtistPrefsChanged();
  return true;
}

export function clearUserArtistPrefsCache() {
  cache = null;
}
