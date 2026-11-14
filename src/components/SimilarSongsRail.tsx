import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Play, Sparkles, Music } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { usePlayer, type Song } from '@/contexts/PlayerContext';
import { filterSimilar, type SimilarTrack } from '@/lib/similarSongs';
import { prewarmSong } from '@/lib/instantPlay';

const cache = new Map<string, SimilarTrack[]>();

interface Props { query: string }
const cleanTitle = (t: string) => t.replace(/\s*\((from|feat|ft)[^)]*\)/gi, '').trim();

const toSong = (t: SimilarTrack): Song => ({
  id: t.id, title: t.title, artist: t.artist, cover_url: t.cover_url,
  audio_url: t.audio_url || (t.videoId ? `yt-video:${t.videoId}` : 'resolving'),
  duration: t.duration, source: 'indexed',
});

/** YouTube-style "songs like this" built from the top result's music mix. */
export default function SimilarSongsRail({ query }: Props) {
  const { playSong, currentSong } = usePlayer();
  const key = query.toLowerCase();
  const [state, setState] = useState<{ title: string; tracks: SimilarTrack[] } | null>(() => cache.get(key) ?? null);

  useEffect(() => {
    const hit = cache.get(key);
    if (hit) { setState(hit); return; }
    let cancelled = false;
    setState(null);
    const timer = window.setTimeout(async () => {
      try {
        // Seed with YouTube's own top match for the query, like YouTube does.
        const { data: found } = await supabase.functions.invoke('yt-innertube-search', { body: { query, limit: 3 } });
        const top = (found?.results ?? []).find((r: SimilarTrack) => r?.videoId);
        if (!top) throw new Error('no seed');
        const { data } = await supabase.functions.invoke('ytm-radio', { body: { videoId: top.videoId } });
        const title = cleanTitle(top.title);
        const result = { title, tracks: filterSimilar(Array.isArray(data?.tracks) ? data.tracks : [], { title, query }, 20) };
        cache.set(key, result);
        if (!cancelled) setState(result);
      } catch {
        if (!cancelled) setState({ title: '', tracks: [] });
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [key, query]);

  const tracks = state?.tracks ?? null;
  if (tracks && tracks.length < 3) return null;

  const queue = (tracks ?? []).map(toSong);
  const play = (i: number) => queue[i] && playSong(queue[i], undefined, queue);

  return (
    <motion.section initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
      <div className="flex items-end justify-between mb-3 gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary flex items-center gap-1">
            <Sparkles className="w-3 h-3" /> Similar sound
          </p>
          <h2 className="font-display text-[26px] font-black uppercase tracking-[0.04em] leading-none truncate mt-1">
            Songs like {state?.title || query}
          </h2>
        </div>
        {tracks && (
          <button
            onClick={() => play(0)}
            className="flex-shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-primary text-primary-foreground text-xs font-bold active:scale-95 transition-transform"
          >
            <Play className="w-3.5 h-3.5 fill-current" /> Play mix
          </button>
        )}
      </div>
      <div className="flex gap-3 overflow-x-auto hide-scrollbar -mx-4 px-4 snap-x">
        {(tracks ?? Array.from({ length: 5 }, () => null)).map((t, i) => t ? (
          <button
            key={t.id}
            onClick={() => play(i)}
            onPointerDown={() => prewarmSong({ id: t.id, title: t.title, artist: t.artist, videoId: t.videoId, audio_url: t.audio_url })}
            className="w-32 flex-shrink-0 text-left snap-start active:scale-[0.97] transition-transform"
          >
            <div className={`relative w-32 h-32 rounded-[18px] overflow-hidden bg-card ${currentSong?.id === t.id ? 'ring-2 ring-primary' : ''}`}>
              {t.cover_url
                ? <img src={t.cover_url} alt={`${t.title} cover art`} className="w-full h-full object-cover" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                : <div className="w-full h-full flex items-center justify-center"><Music className="w-6 h-6 text-muted-foreground" /></div>}
            </div>
            <p className="text-[13px] font-semibold text-foreground truncate mt-2">{t.title}</p>
            <p className="text-[11px] text-muted-foreground truncate">{t.artist}</p>
          </button>
        ) : (
          <div key={i} className="w-32 flex-shrink-0">
            <div className="w-32 h-32 rounded-[18px] bg-card animate-pulse" />
            <div className="h-3 w-24 bg-card rounded mt-2 animate-pulse" />
          </div>
        ))}
      </div>
    </motion.section>
  );
}
