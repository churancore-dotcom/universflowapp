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

/** A song the listener actually played/liked, used to seed YouTube mixes. */
export interface MixSeed { title?: string | null; artist?: string | null; audio_url?: string | null }

/**
 * Picks up to `max` recent songs by different artists — the same way YouTube's
 * home builds mixes from what you just listened to, not from keyword searches.
 */
export function pickMixSeeds(songs: MixSeed[], max = 3): { title: string; artist: string; videoId?: string }[] {
  const artists = new Set<string>();
  const out: { title: string; artist: string; videoId?: string }[] = [];
  for (const s of songs) {
    const title = (s?.title || '').trim();
    const artist = (s?.artist || '').trim();
    if (!title || !artist) continue;
    const key = norm(artist);
    if (!key || artists.has(key)) continue;
    artists.add(key);
    const videoId = /^yt-video:([\w-]{11})/.exec(s.audio_url || '')?.[1];
    out.push(videoId ? { title, artist, videoId } : { title, artist });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Interleaves several YouTube mixes round-robin, keeping each mix's own
 * relevance order and dropping duplicates and excluded songs.
 */
export function blendMixes(
  mixes: SimilarTrack[][],
  limit: number,
  exclude: (t: SimilarTrack) => boolean = () => false,
): SimilarTrack[] {
  const seen = new Set<string>();
  const out: SimilarTrack[] = [];
  const longest = Math.max(0, ...mixes.map((m) => m.length));
  for (let i = 0; i < longest && out.length < limit; i++) {
    for (const mix of mixes) {
      const t = mix[i];
      if (!t) continue;
      const key = `${norm(t.title)}|${norm(t.artist)}`;
      if (seen.has(key) || seen.has(t.id)) continue;
      seen.add(key); seen.add(t.id);
      if (exclude(t)) continue;
      out.push(t);
      if (out.length >= limit) break;
    }
  }
  return out;
}
