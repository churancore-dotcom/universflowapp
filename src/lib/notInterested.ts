import { supabase } from '@/integrations/supabase/client';

/** Stable identity for "this exact song" across sources (title + artist). */
export function notInterestedKey(title?: string | null, artist?: string | null): string {
  const norm = (v?: string | null) => (v || '').toLowerCase().replace(/\s+/g, ' ').trim();
  return `${norm(title)}|${norm(artist)}`;
}

/** Saves the choice for this account and refreshes the feed. Throws on failure. */
export async function markNotInterested(userId: string, song: { title?: string | null; artist?: string | null }) {
  const title = (song.title || '').trim().slice(0, 220);
  const artist = (song.artist || '').trim().slice(0, 220);
  if (!title || !artist) throw new Error('Song details missing');
  const { error } = await supabase
    .from('feed_not_interested')
    .upsert({ user_id: userId, title, artist }, { onConflict: 'user_id,title,artist', ignoreDuplicates: true });
  if (error) throw error;
  const { invalidateTasteProfile } = await import('@/lib/feedPersonalizer');
  invalidateTasteProfile();
  window.dispatchEvent(new Event('uf:likes-changed'));
}
