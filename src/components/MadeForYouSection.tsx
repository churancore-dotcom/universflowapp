import React, { memo, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Play } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { Song, usePlayer } from '@/contexts/PlayerContext';
import OptimizedImage from './OptimizedImage';
import { triggerHaptic } from '@/hooks/useHaptics';
import { prewarmSongs, prewarmIntentProps } from '@/lib/instantPlay';
import { readLocalRecent } from '@/lib/localRecentlyPlayed';
import { searchYouTubeMusicTracks } from '@/lib/musicIndexer';
import { supabase } from '@/integrations/supabase/client';
import { isSpamSong } from '@/pages/Search';
import { useTasteProfile } from '@/hooks/useTasteProfile';
import { rerank, topTasteArtists, topTasteKeywords } from '@/lib/feedPersonalizer';

const MadeForYouSection = memo(() => {
  const { user } = useAuth();
  const { playSong, currentSong } = usePlayer();
  const taste = useTasteProfile();
  const [recentVersion, setRecentVersion] = useState(0);

  useEffect(() => {
    const refresh = () => setRecentVersion((value) => value + 1);
    window.addEventListener('universflow:recently-played-changed', refresh);
    window.addEventListener('uf:likes-changed', refresh);
    window.addEventListener('uf:artist-prefs-changed', refresh);
    return () => {
      window.removeEventListener('universflow:recently-played-changed', refresh);
      window.removeEventListener('uf:likes-changed', refresh);
      window.removeEventListener('uf:artist-prefs-changed', refresh);
    };
  }, []);

  const recentEntries = useMemo(() => {
    if (!user?.id) return [] as ReturnType<typeof readLocalRecent>;
    return readLocalRecent(user.id).slice(0, 20);
  }, [user?.id, recentVersion]);
  const recentIds = useMemo(
    () => recentEntries.map((r) => r.song_id).filter(Boolean),
    [recentEntries],
  );

  const { data: mix = [] } = useQuery({
    // Bug: keying on every recent id + the raw signal count re-created the key
    // (and refetched 3 searches) after literally every play, which is why the
    // shelf kept flickering to a different set. Key on the top seeds only and
    // bucket the signal count so it moves when taste actually changes.
    queryKey: [
      'ytm-made-for-you-v5',
      user?.id ?? 'anon',
      recentIds.slice(0, 3).join(','),
      topTasteArtists(taste, 3).join(','),
      topTasteKeywords(taste, 3).join(','),
      Math.floor(taste.signalCount / 5),
    ],
    staleTime: 5 * 60 * 1000,
    gcTime: 6 * 60 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
    queryFn: async (): Promise<Song[]> => {

      let seedQueries: string[] = [];
      // Snapshot artists from local recents cover YT/audius tracks that never
      // land in stream_songs. Prefer them, then top up from stream_songs.
      const snapshotSeeds = recentEntries
        .map((e) => (e.song?.artist || e.song?.title || '').trim())
        .filter(Boolean);
      // Strongest signal first: the artists this listener actually plays/likes
      // most over the last 30 days, then the current session's snapshot.
      let seeds: string[] = [...topTasteArtists(taste, 4), ...snapshotSeeds];
      if (user?.id) {
        const { data: eventRows } = await supabase
          .from('song_play_events')
          .select('artist, title')
          .eq('user_id', user.id)
          .eq('action', 'stream')
          .order('created_at', { ascending: false })
          .limit(12);
        seeds.push(
          ...(eventRows ?? [])
            .map((row) => (row.artist || row.title || '').trim())
            .filter(Boolean),
        );
      }
      if (recentIds.length) {
        const { data: rows } = await (supabase as unknown as {
          from: (t: string) => { select: (c: string) => { in: (col: string, vals: string[]) => { limit: (n: number) => Promise<{ data: Array<{ artist: string | null; title: string | null }> | null }> } } };
        })
          .from('stream_songs')
          .select('artist, title')
          .in('id', recentIds)
          .limit(5);
        seeds.push(
          ...(rows ?? [])
            .map((r) => (r.artist || r.title || '').trim())
            .filter(Boolean),
        );
      }
      if (seeds.length) {
        const uniq = [...new Set(seeds)].slice(0, 3);
        // "… official music mix" pulled DJ mixes / jukebox compilations into a
        // shelf that is supposed to be individual songs. Ask for songs.
        seedQueries = uniq.map((s) => `${s} songs`);

      }
      if (!seedQueries.length) {
        const kw = topTasteKeywords(taste, 2);
        if (kw.length) seedQueries = kw.map((k) => `${k} official music mix`);
      }
      if (!seedQueries.length) {
        // Rotating diverse fallback pool — no more static "india top songs".
        const currentYear = new Date().getFullYear();
        const POOL = [
          `top hits ${currentYear} official`,
          `new music this week official`,
          `viral songs ${currentYear}`,
          `indie pop mix ${currentYear}`,
          `hip hop hits ${currentYear}`,
          `chill songs official mix`,
          `latest bollywood hits ${currentYear}`,
          `punjabi hits ${currentYear}`,
          `rnb slow jams ${currentYear}`,
          `edm dance hits ${currentYear}`,
        ];
        // Rotate only the cold-start fallback. Once listening/like/follow
        // signals exist, the listener's real taste controls these queries.
        const start = Math.floor(Date.now() / (60 * 60 * 1000)) % POOL.length;
        seedQueries = [POOL[start], POOL[(start + 3) % POOL.length], POOL[(start + 7) % POOL.length]];
      }

      const perQuery = Math.max(8, Math.ceil(24 / seedQueries.length));
      const settled = await Promise.allSettled(seedQueries.map((q) => searchYouTubeMusicTracks(q, perQuery)));
      const seen = new Set<string>();
      const out: Song[] = [];
      for (const r of settled) {
        if (r.status !== 'fulfilled') continue;
        for (const t of r.value) {
          if (!t.id || seen.has(t.id) || !t.title || !t.artist) continue;
          const song = {
            id: t.id,
            title: t.title,
            artist: t.artist,
            album: t.album,
            cover_url: t.cover_url,
            audio_url: t.audio_url || (t.videoId ? `yt-video:${t.videoId}` : 'resolving'),
            duration: t.duration,
          } as Song;
          if (isSpamSong(song)) continue;
          seen.add(t.id);
          out.push(song);
          if (out.length >= 18) break;
        }
        if (out.length >= 18) break;
      }
      // Don't recommend what they just finished playing — by id AND by
      // title/artist, because the same song reaches us under several ids.
      const norm = (v?: string | null) => (v || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
      const recentSet = new Set(recentIds);
      const recentPrints = new Set(
        recentEntries.map((e) => `${norm(e.song?.title)}~${norm(e.song?.artist)}`).filter((k) => k !== '~'),
      );
      // Artists this listener keeps skipping are a real negative signal; a
      // "for you" shelf that keeps re-serving them is what made it feel dead.
      // Skip weights are keyed by trimmed lowercase artist (see feedPersonalizer).
      const mutedArtists = new Set(
        [...taste.skips.entries()]
          .filter(([artist, weight]) => weight >= 3 && (taste.artists.get(artist) ?? 0) < weight)
          .map(([artist]) => artist),
      );
      const fresh = out.filter((s) => {
        if (recentSet.has(s.id)) return false;
        if (recentPrints.has(`${norm(s.title)}~${norm(s.artist)}`)) return false;
        if (mutedArtists.has((s.artist || '').trim().toLowerCase())) return false;
        return true;
      });

      // Taste-rank the pool so the hero is the best match, not a random pick.
      return rerank(fresh.length >= 6 ? fresh : out, taste);

    },
  });

  React.useEffect(() => { prewarmSongs(mix, 2); }, [mix]);

  if (!mix.length) return null;
  const hero = mix[0];
  const rest = mix.slice(1, 5);
  const play = (s: Song) => { triggerHaptic('selection'); playSong(s, undefined, mix); };

  return (
    <section className="mb-2 pt-4">
      <div className="flex items-end justify-between mb-3 px-1">
        <div>
          <h2 className="font-display text-2xl tracking-[0.06em] uppercase text-foreground">Made For You</h2>
          <p className="text-[11px] text-muted-foreground/55 font-semibold mt-0.5">Based on your listening</p>
        </div>
      </div>

      <motion.button
        whileTap={{ scale: 0.985 }}
        onClick={() => play(hero)}
        {...prewarmIntentProps(hero)}
        className="relative w-full min-h-[150px] overflow-hidden text-left rounded-3xl border border-white/[0.06] bg-card p-4"
      >
        {hero.cover_url && (
          <OptimizedImage src={hero.cover_url} alt={hero.title} className="absolute right-0 top-0 h-full w-[46%] object-cover opacity-80" eager />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-card via-card/95 to-card/35" />
        <div className="relative z-10 max-w-[62%]">
          <span className="inline-flex bg-primary text-primary-foreground px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-[0.18em] mb-5">For You</span>
          <h3 className="text-[25px] leading-[1] text-foreground font-extrabold tracking-tight mb-2 line-clamp-2">{hero.title}</h3>
          <p className="text-[12px] text-muted-foreground truncate font-semibold mb-4">{hero.artist}</p>
          <div className="w-9 h-9 rounded-full bg-foreground flex items-center justify-center flex-shrink-0">
            <Play className="w-4 h-4 text-background ml-0.5" fill="currentColor" />
          </div>
        </div>
      </motion.button>

      <div className="mt-2 rounded-3xl border border-white/[0.06] bg-card/60 overflow-hidden">
        {rest.map((song, idx) => {
          const isPlaying = currentSong?.id === song.id;
          return (
            <button key={song.id} onClick={() => play(song)} {...prewarmIntentProps(song)} className="w-full flex items-center justify-between gap-3 px-3 py-2.5 border-b border-white/[0.05] last:border-0 text-left active:bg-white/[0.04]">
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-[10px] text-muted-foreground/50 font-mono tabular-nums w-6">{String(idx + 2).padStart(2, '0')}.</span>
                <div className="min-w-0">
                  <p className={`text-[13px] font-bold truncate leading-tight ${isPlaying ? 'text-primary' : 'text-foreground'}`}>{song.title}</p>
                  <p className="text-[10.5px] text-muted-foreground/65 truncate mt-0.5 font-medium">{song.artist}</p>
                </div>
              </div>
              {song.duration ? <span className="text-[10px] text-muted-foreground/50 font-mono tabular-nums">{Math.floor(song.duration / 60)}:{String(Math.floor(song.duration % 60)).padStart(2, '0')}</span> : null}
            </button>
          );
        })}
      </div>
    </section>
  );
});

MadeForYouSection.displayName = 'MadeForYouSection';
export default MadeForYouSection;