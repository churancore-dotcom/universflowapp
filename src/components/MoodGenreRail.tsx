import { memo, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Song, usePlayer } from '@/contexts/PlayerContext';
import { resolveIndexedTrack } from '@/lib/musicIndexer';
import { useToast } from '@/hooks/use-toast';
import { triggerHaptic } from '@/hooks/useHaptics';

interface MoodPlaylist {
  title: string;
  browseId: string;
}

// Deterministic tint per tile — deep onyx base with a single hue lift.
const TINTS = [
  '#FF2D55', // rose (brand)
  '#A855F7', // violet
  '#22D3EE', // cyan
  '#F59E0B', // amber
  '#34D399', // emerald
  '#F472B6', // pink
  '#818CF8', // indigo
  '#FB7185', // coral
];

// Stable per-title hash → tint index. So "Pop" is always the same color.
const tintFor = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return TINTS[h % TINTS.length];
};

// Split a title onto two lines around the midpoint for editorial feel.
const splitTitle = (t: string): [string, string?] => {
  const words = t.trim().split(/\s+/);
  if (words.length === 1) return [words[0]];
  const mid = Math.ceil(words.length / 2);
  return [words.slice(0, mid).join(' '), words.slice(mid).join(' ')];
};

const MoodGenreRail = () => {
  const [items, setItems] = useState<MoodPlaylist[]>([]);
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
        const flat: MoodPlaylist[] = [];
        const seen = new Set<string>();
        for (const c of cats) {
          for (const it of (c.items || [])) {
            if (it.params && it.browseId && !seen.has(it.browseId)) {
              seen.add(it.browseId);
              flat.push({ title: it.title, browseId: it.browseId });
            }
            if (flat.length >= 9) break;
          }
          if (flat.length >= 9) break;
        }
        setItems(flat);
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

  const Header = (
    <div className="flex items-center justify-between px-1 mb-4">
      <h2 className="text-[20px] font-extrabold tracking-tight text-white/95">Explore Moods</h2>
      <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">Curated</span>
    </div>
  );

  if (loading) {
    return (
      <section>
        {Header}
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 h-24 rounded-[1.5rem] animate-pulse" style={{ background: 'rgba(255,255,255,0.04)' }} />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="aspect-[1/1.15] rounded-[1.5rem] animate-pulse"
              style={{ background: 'rgba(255,255,255,0.04)' }} />
          ))}
        </div>
      </section>
    );
  }
  if (!items.length) return null;

  const [hero, ...rest] = items;
  const heroTint = tintFor(hero.title);

  return (
    <section>
      {Header}
      <div className="grid grid-cols-2 gap-3">
        {/* Hero banner — full-width editorial card */}
        <motion.button
          key={hero.browseId}
          onClick={() => openMood(hero)}
          whileTap={{ scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 380, damping: 26 }}
          className="col-span-2 relative h-28 rounded-[1.5rem] overflow-hidden text-left isolate border border-white/[0.06]"
          style={{
            background:
              'linear-gradient(135deg, #0d0d0f 0%, #131316 60%, #0a0a0c 100%)',
            boxShadow: `0 18px 40px -22px ${heroTint}55, 0 1px 0 rgba(255,255,255,0.04) inset`,
          }}
          aria-label={`Play ${hero.title}`}
        >
          <span
            aria-hidden
            className="absolute -left-10 -top-10 w-44 h-44 rounded-full blur-3xl opacity-40"
            style={{ background: heroTint }}
          />
          <span
            aria-hidden
            className="absolute inset-0 opacity-[0.05]"
            style={{
              backgroundImage:
                'repeating-linear-gradient(115deg, rgba(255,255,255,1) 0 1px, transparent 1px 18px)',
            }}
          />
          <div className="relative z-10 h-full flex items-center justify-between px-5">
            <div className="min-w-0">
              <div
                className="h-[2px] w-6 rounded-full mb-2"
                style={{ background: heroTint }}
              />
              <p className="text-[22px] font-extrabold tracking-tight text-white leading-[1.05] truncate">
                {hero.title}
              </p>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40 mt-1.5">
                Tap to play
              </p>
            </div>
            <div
              className="w-10 h-10 rounded-full grid place-items-center shrink-0"
              style={{ background: `${heroTint}1F`, border: `1px solid ${heroTint}55` }}
            >
              <ChevronRight className="w-4 h-4" style={{ color: heroTint }} />
            </div>
          </div>
          {openingId === hero.browseId && (
            <span className="absolute inset-0 grid place-items-center bg-black/40 backdrop-blur-[2px]">
              <span className="w-5 h-5 rounded-full border-2 border-white/80 border-t-transparent animate-spin" />
            </span>
          )}
        </motion.button>

        {/* Grid tiles */}
        {rest.map((m) => {
          const tint = tintFor(m.title);
          const busy = openingId === m.browseId;
          const [l1, l2] = splitTitle(m.title);
          return (
            <motion.button
              key={m.browseId}
              onClick={() => openMood(m)}
              whileTap={{ scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 380, damping: 26 }}
              className="group relative aspect-[1/1.15] rounded-[1.5rem] overflow-hidden text-left isolate border border-white/[0.06]"
              style={{
                background:
                  'linear-gradient(160deg, #111114 0%, #0b0b0d 100%)',
                boxShadow: `0 14px 30px -20px ${tint}66, 0 1px 0 rgba(255,255,255,0.04) inset`,
              }}
              aria-label={`Play ${m.title}`}
            >
              {/* Corner halo */}
              <span
                aria-hidden
                className="absolute -top-8 -right-8 w-28 h-28 rounded-full blur-2xl opacity-50"
                style={{ background: tint }}
              />
              {/* Oversized faded glyph */}
              <span
                aria-hidden
                className="absolute -bottom-4 -right-2 text-[88px] font-black leading-none select-none pointer-events-none"
                style={{
                  color: tint,
                  opacity: 0.08,
                  letterSpacing: '-0.05em',
                }}
              >
                {m.title.charAt(0).toUpperCase()}
              </span>
              {/* Content */}
              <div className="absolute inset-0 p-4 flex flex-col justify-between">
                <div
                  className="h-[2px] w-5 rounded-full"
                  style={{ background: tint }}
                />
                <div>
                  <p className="text-white font-extrabold text-[15px] leading-[1.1] tracking-tight">
                    {l1}
                    {l2 && <><br />{l2}</>}
                  </p>
                </div>
              </div>
              {busy && (
                <span className="absolute inset-0 grid place-items-center bg-black/45 backdrop-blur-[2px]">
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
