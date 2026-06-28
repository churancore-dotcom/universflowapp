import { memo, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { Song, usePlayer } from '@/contexts/PlayerContext';
import { resolveIndexedTrack } from '@/lib/musicIndexer';
import { useToast } from '@/hooks/use-toast';
import { triggerHaptic } from '@/hooks/useHaptics';

interface MoodPlaylist {
  title: string;
  browseId: string;
}
interface MoodShelf {
  title: string;
  playlists: MoodPlaylist[];
}

// Editorial gradient pairs — hand-tuned, no two adjacent tiles share a hue.
const GRADIENTS: Array<[string, string, string]> = [
  ['#FF2D55', '#FF6B8A', '#3A0A18'], // rose
  ['#7C3AED', '#C084FC', '#1A0B33'], // violet
  ['#0EA5E9', '#7DD3FC', '#062436'], // sky
  ['#F59E0B', '#FCD34D', '#3A1F02'], // amber
  ['#10B981', '#6EE7B7', '#022C1F'], // emerald
  ['#EC4899', '#F9A8D4', '#3A0B22'], // pink
  ['#6366F1', '#A5B4FC', '#0C1233'], // indigo
  ['#EF4444', '#FCA5A5', '#3A0A0A'], // red
];

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
        const { data: listData } = await supabase.functions.invoke('ytm-moods', {
          body: { mode: 'list', country },
        });
        if (cancelled) return;
        const cats = Array.isArray(listData?.categories) ? listData.categories : [];
        if (!cats.length) { setShelves([]); setLoading(false); return; }

        const flat: MoodPlaylist[] = [];
        const seen = new Set<string>();
        for (const c of cats) {
          for (const it of (c.items || [])) {
            if (it.params && it.browseId && !seen.has(it.browseId)) {
              seen.add(it.browseId);
              flat.push({ title: it.title, browseId: it.browseId });
            }
            if (flat.length >= 10) break;
          }
          if (flat.length >= 10) break;
        }
        setShelves([{ title: 'Browse', playlists: flat }]);
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

      const first = songs[0];
      try {
        const resolved = await resolveIndexedTrack(first.artist, first.title);
        if (resolved?.streamUrl) first.audio_url = resolved.streamUrl;
      } catch { /* PlayerContext will resolve */ }

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
      <section>
        <div className="flex items-baseline justify-between mb-3 px-1">
          <h2 className="text-[15px] font-semibold tracking-tight">Browse</h2>
          <span className="text-[11px] text-muted-foreground uppercase tracking-[0.12em]">Moods & Genres</span>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="aspect-[16/10] rounded-2xl animate-pulse"
              style={{ background: 'rgba(255,255,255,0.04)' }} />
          ))}
        </div>
      </section>
    );
  }
  if (!shelves[0]?.playlists?.length) return null;

  return (
    <section>
      <div className="flex items-baseline justify-between mb-3 px-1">
        <h2 className="text-[15px] font-semibold tracking-tight">Browse</h2>
        <span className="text-[11px] text-muted-foreground uppercase tracking-[0.12em]">Moods & Genres</span>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        {shelves[0].playlists.map((m, i) => {
          const [c1, c2, deep] = GRADIENTS[i % GRADIENTS.length];
          const busy = openingId === m.browseId;
          return (
            <motion.button
              key={m.browseId}
              onClick={() => openMood(m)}
              whileTap={{ scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 400, damping: 28 }}
              className="group relative aspect-[16/10] rounded-2xl overflow-hidden text-left isolate"
              style={{
                background: `linear-gradient(135deg, ${deep} 0%, ${c1} 55%, ${c2} 100%)`,
                boxShadow: `0 1px 0 rgba(255,255,255,0.06) inset, 0 8px 24px -10px ${c1}66`,
              }}
              aria-label={`Play ${m.title}`}
            >
              {/* Soft top-right halo */}
              <span
                aria-hidden
                className="absolute -top-6 -right-6 w-24 h-24 rounded-full blur-2xl opacity-60"
                style={{ background: c2 }}
              />
              {/* Diagonal sheen */}
              <span
                aria-hidden
                className="absolute inset-0 opacity-[0.07] mix-blend-overlay"
                style={{
                  backgroundImage:
                    'repeating-linear-gradient(115deg, rgba(255,255,255,1) 0 1px, transparent 1px 14px)',
                }}
              />
              {/* Bottom vignette for text legibility */}
              <span
                aria-hidden
                className="absolute inset-x-0 bottom-0 h-2/3"
                style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.45), transparent)' }}
              />
              {/* Title */}
              <div className="absolute inset-0 p-3 flex flex-col justify-end">
                <span
                  className="text-white font-bold text-[15px] leading-[1.15] tracking-tight line-clamp-2 drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]"
                  style={{ fontFamily: 'inherit' }}
                >
                  {m.title}
                </span>
              </div>
              {busy && (
                <span className="absolute inset-0 grid place-items-center bg-black/40 backdrop-blur-[2px]">
                  <span className="w-5 h-5 rounded-full border-2 border-white/80 border-t-transparent animate-spin" />
                </span>
              )}
            </motion.button>
          );
        })}
      </div>
    </section>
  );
};

export default memo(MoodGenreRail);
