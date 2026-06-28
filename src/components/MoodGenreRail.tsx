import { memo, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Sparkles } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Song, usePlayer } from '@/contexts/PlayerContext';
import { resolveIndexedTrack } from '@/lib/musicIndexer';
import { useToast } from '@/hooks/use-toast';
import { triggerHaptic } from '@/hooks/useHaptics';

interface MoodPlaylist {
  title: string;
  browseId: string;
  cover?: string;
}
interface MoodShelf {
  title: string;
  playlists: MoodPlaylist[];
}

const PALETTE = [
  ['#FF2D55', '#FF5E7E'],
  ['#7C3AED', '#A855F7'],
  ['#0EA5E9', '#22D3EE'],
  ['#F59E0B', '#FBBF24'],
  ['#10B981', '#34D399'],
  ['#EC4899', '#F472B6'],
];

/**
 * Mood/Genre rail powered by YouTube Music's `FEmusic_moods_and_genres`.
 * Tap a mood → loads its playlist tracks and starts playback in queue.
 */
const MoodGenreRail = () => {
  const [shelves, setShelves] = useState<MoodShelf[]>([]);
  const [loading, setLoading] = useState(true);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const { playSong, setQueue } = usePlayer();
  const { toast } = useToast();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const country = (localStorage.getItem('uf_country') || 'US').toUpperCase();
        // 1) List categories
        const { data: listData } = await supabase.functions.invoke('ytm-moods', {
          body: { mode: 'list', country },
        });
        if (cancelled) return;
        const cats = Array.isArray(listData?.categories) ? listData.categories : [];
        if (!cats.length) { setShelves([]); setLoading(false); return; }

        // Flatten to a single "Browse by mood" shelf with the first 12 items.
        const flat: MoodPlaylist[] = [];
        for (const c of cats) {
          for (const it of (c.items || [])) {
            // Only items with params → they expand to playlists when browsed.
            if (it.params && it.browseId) {
              flat.push({ title: it.title, browseId: it.browseId });
            }
            if (flat.length >= 12) break;
          }
          if (flat.length >= 12) break;
        }
        setShelves([{ title: 'Moods & Genres', playlists: flat }]);
      } catch (e) {
        console.warn('moods rail failed', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const openMood = async (m: MoodPlaylist) => {
    if (openingId) return;
    setOpeningId(m.browseId);
    triggerHaptic('impactLight');
    try {
      // For a mood category, ytm-moods returns playlist shelves. We grab the
      // first playlist and play its tracks.
      const { data } = await supabase.functions.invoke('ytm-moods', {
        body: { mode: 'browse', browseId: m.browseId },
      });
      const shelf = (data?.shelves || [])[0];
      const playlist = shelf?.playlists?.[0];
      if (!playlist?.browseId) throw new Error('No playlist found');

      const { data: pData } = await supabase.functions.invoke('ytm-moods', {
        body: { mode: 'playlist', browseId: playlist.browseId },
      });
      const tracks = Array.isArray(pData?.tracks) ? pData.tracks : [];
      if (!tracks.length) throw new Error('Empty playlist');

      const songs: Song[] = tracks.map((t: any) => ({
        id: `ytm-${t.videoId}`,
        title: t.title,
        artist: t.artist || 'Unknown',
        cover_url: t.cover_url,
        audio_url: t.audio_url || `yt-video:${t.videoId}`,
        duration: t.duration || undefined,
        source: 'indexed' as const,
      }));

      // Resolve the first one immediately so playback starts fast; queue the rest.
      const first = songs[0];
      try {
        const resolved = await resolveIndexedTrack(first.artist, first.title);
        if (resolved?.audio_url) first.audio_url = resolved.audio_url;
      } catch { /* fallthrough; PlayerContext will resolve on play */ }

      setQueue(songs);
      await playSong(first);

    } catch (e) {
      console.warn('open mood failed', e);
      toast({ title: 'Mood unavailable', description: 'Try another one.', variant: 'destructive' });
    } finally {
      setOpeningId(null);
    }
  };

  if (loading) {
    return (
      <section className="px-1">
        <h2 className="text-base font-bold mb-2.5 flex items-center gap-1.5">
          <Sparkles className="w-4 h-4 text-primary" /> Moods & Genres
        </h2>
        <div className="flex gap-2 overflow-x-auto hide-scrollbar">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex-shrink-0 w-28 h-16 rounded-2xl animate-pulse"
              style={{ background: 'rgba(255,255,255,0.05)' }} />
          ))}
        </div>
      </section>
    );
  }
  if (!shelves[0]?.playlists?.length) return null;

  return (
    <section className="px-1">
      <h2 className="text-base font-bold mb-2.5 flex items-center gap-1.5">
        <Sparkles className="w-4 h-4 text-primary" /> Moods & Genres
      </h2>
      <div className="grid grid-cols-2 gap-2">
        {shelves[0].playlists.map((m, i) => {
          const [c1, c2] = PALETTE[i % PALETTE.length];
          const busy = openingId === m.browseId;
          return (
            <motion.button
              key={m.browseId}
              onClick={() => openMood(m)}
              whileTap={{ scale: 0.96 }}
              className="relative h-16 rounded-2xl overflow-hidden text-left px-3 py-2 font-bold text-sm"
              style={{
                background: `linear-gradient(135deg, ${c1}, ${c2})`,
                color: 'white',
                opacity: busy ? 0.65 : 1,
              }}
            >
              <span className="relative z-10">{m.title}</span>
              {busy && (
                <span className="absolute inset-0 grid place-items-center text-xs bg-black/30 rounded-2xl">Loading…</span>
              )}
            </motion.button>
          );
        })}
      </div>
    </section>
  );
};

export default memo(MoodGenreRail);
