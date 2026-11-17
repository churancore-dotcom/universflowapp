import { isAiGeneratedTrack } from '@/lib/aiSlopFilter';

export interface SimilarTrack {
  id: string;
  videoId?: string;
  title: string;
  artist: string;
  cover_url?: string;
  audio_url: string;
  duration?: number;
}

const norm = (v: string) =>
  v.toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\b(feat|ft)\.?\b.*$/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * "Songs like this" must be different songs with a similar sound, never
 * covers/remixes/versions that merely share the searched title.
 */
export function filterSimilar(
  tracks: SimilarTrack[],
  seed: { title: string; query: string },
  limit = 20,
): SimilarTrack[] {
  const seedTitle = norm(seed.title);
  const queryNorm = norm(seed.query);
  const seen = new Set<string>();
  const out: SimilarTrack[] = [];
  for (const t of tracks) {
    if (!t?.title || !t.artist) continue;
    const title = norm(t.title);
    if (!title) continue;
    if (seedTitle && (title.includes(seedTitle) || seedTitle.includes(title))) continue;
    if (queryNorm.length >= 3 && title.includes(queryNorm)) continue;
    if (isAiGeneratedTrack({ title: t.title, artist: t.artist })) continue;
    const key = `${title}|${norm(t.artist)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * YouTube Music "up next" mix for a song: different songs with a similar sound.
 * Songs without a YouTube id are first matched to YouTube's top result.
 */
export async function fetchSongMix(song: { title: string; artist: string; videoId?: string }, limit = 25): Promise<SimilarTrack[]> {
  const { supabase } = await import('@/integrations/supabase/client');
  let videoId = song.videoId;
  if (!videoId) {
    const { data, error } = await supabase.functions.invoke('yt-innertube-search', { body: { query: `${song.title} ${song.artist}`, limit: 3 } });
    if (error) throw error;
    videoId = (data?.results ?? []).find((r: SimilarTrack) => r?.videoId)?.videoId;
  }
  if (!videoId) return [];
  const { data, error } = await supabase.functions.invoke('ytm-radio', { body: { videoId } });
  if (error) throw error;
  const title = song.title.replace(/\s*\((from|feat|ft)[^)]*\)/gi, '').trim();
  return filterSimilar(Array.isArray(data?.tracks) ? data.tracks : [], { title, query: title }, limit);
}
