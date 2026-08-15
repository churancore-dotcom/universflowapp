import React, { memo, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Play } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { Song, usePlayer } from '@/contexts/PlayerContext';
import OptimizedImage from './OptimizedImage';
import { RailSkeleton } from './PageSkeletons';
import { triggerHaptic } from '@/hooks/useHaptics';
import { prewarmSongs, prewarmIntentProps } from '@/lib/instantPlay';
import { readLocalRecent } from '@/lib/localRecentlyPlayed';
import { searchYouTubeMusicTracks } from '@/lib/musicIndexer';
import { supabase } from '@/integrations/supabase/client';
import { isSpamSong } from '@/pages/Search';
import { useTasteProfile } from '@/hooks/useTasteProfile';
import { cleanRail, diversifyByArtist } from '@/lib/railQuality';
import { useUserCountry } from '@/hooks/useUserCountry';
import { getCountryQueries } from '@/lib/countryQueries';
import { fetchCountryCharts } from '@/lib/countryCharts';

import { rerank, topTasteArtists, topTasteKeywords } from '@/lib/feedPersonalizer';

const MadeForYouSection = memo(() => {
  const { user } = useAuth();
  const { playSong, currentSong } = usePlayer();
  const taste = useTasteProfile();
  const country = useUserCountry();
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

  // Signed-out listeners keep their history under the `anon` key (same key the
  // taste profile reads). Gating this on user?.id is what made every cold /
  // signed-out visitor fall through to the generic pool.
  const recentEntries = useMemo(
    () => readLocalRecent(user?.id ?? null).slice(0, 20),
    [user?.id, recentVersion],
  );

  const recentIds = useMemo(
    () => recentEntries.map((r) => r.song_id).filter(Boolean),
    [recentEntries],
  );

  const { data: mix = [], isLoading } = useQuery({
    // Bug: keying on every recent id + the raw signal count re-created the key
    // (and refetched 3 searches) after literally every play, which is why the
    // shelf kept flickering to a different set. Key on the top seeds only and
    // bucket the signal count so it moves when taste actually changes.
    queryKey: [
      'ytm-made-for-you-v6',
      (country || 'GLOBAL').toUpperCase(),

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
        // `stream_songs` is keyed by track_id — filtering on a nonexistent `id`
        // column made this request error out, so this whole seed source was
        // silently dropped.
        const { data: rows } = await supabase
          .from('stream_songs')
          .select('artist, title')
          .in('track_id', recentIds)
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
        if (kw.length) seedQueries = kw.map((k) => `${k} songs`);
      }
      if (!seedQueries.length) {
        // Cold start: seed from the listener's OWN market chart instead of a
        // static genre list that mixed Bollywood into every region.
        const chart = await fetchCountryCharts(country, 30).catch(() => null);
        const chartSeeds = (chart?.songs ?? [])
          .slice(0, 12)
          .map((s) => (s.artist || '').trim())
          .filter(Boolean);
        const uniqueChartSeeds = [...new Set(chartSeeds)].slice(0, 2);
        const q = getCountryQueries(country);
        seedQueries = [...uniqueChartSeeds.map((a) => `${a} songs`), q.trending, q.fresh].slice(0, 3);
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
      // The YTM search path needs a session (the edge function verifies JWTs),
      // so signed-out listeners used to get an empty shelf. Fall back to the
      // aggregated chart table and let the taste profile order it — the shelf
      // still personalizes instead of disappearing.
      if (!out.length) {
        const chart = await fetchCountryCharts(country, 40).catch(() => null);
        for (const song of chart?.songs ?? []) {
          if (seen.has(song.id) || isSpamSong(song)) continue;
          seen.add(song.id);
          out.push(song);
          if (out.length >= 18) break;
        }
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
      const fresh = cleanRail(out, { requireCover: true }).filter((s) => {
        if (recentSet.has(s.id)) return false;
        if (recentPrints.has(`${norm(s.title)}~${norm(s.artist)}`)) return false;
        if (mutedArtists.has((s.artist || '').trim().toLowerCase())) return false;
        return true;
      });

      // Taste-rank the pool so the hero is the best match, not a random pick,
      // then break same-artist runs so the shelf isn't one artist five times.
      const pool = fresh.length >= 6 ? fresh : cleanRail(out, { requireCover: true });
      return diversifyByArtist(rerank(pool, taste));


    },
  });

  React.useEffect(() => { prewarmSongs(mix, 4); }, [mix]);

  if (!mix.length) return isLoading ? <RailSkeleton layout="mix" title="w-48" /> : null;
  const hero = mix[0];
  const rest = mix.slice(1, 5);
  const play = (s: Song) => { triggerHaptic('selection'); playSong(s, undefined, mix); };

  return (
    <section>
      <div className="flex items-end justify-between mb-5 px-1">
        <div>
          <h2 className="uf-shelf-title">Made For You</h2>
          <p className="text-[11px] uppercase tracking-[0.18em] font-bold text-muted-foreground/60 mt-1">
            {taste.signalCount > 0 ? 'Based on your listening' : 'Play a few songs to shape this'}
          </p>
        </div>
      </div>

      <motion.button
        whileTap={{ scale: 0.985 }}
        onClick={() => play(hero)}
        {...prewarmIntentProps(hero)}
        className="relative w-full min-h-[184px] overflow-hidden text-left uf-tile p-5"
      >
        {/* Depth: blurred artwork wash behind the glass, sharp art on the right. */}
        {hero.cover_url && (
          <OptimizedImage
            src={hero.cover_url}
            alt=""
            className="absolute inset-0 w-full h-full object-cover scale-125 blur-3xl opacity-50"
          />
        )}
        {hero.cover_url && (
          <OptimizedImage src={hero.cover_url} alt={hero.title} className="absolute right-0 top-0 h-full w-[46%] object-cover opacity-80" eager />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-card via-card/90 to-card/25 backdrop-blur-[2px]" />
        <div className="absolute inset-0 rounded-[28px] ring-1 ring-inset ring-white/[0.08]" />
        <div className="relative z-10 max-w-[62%]">
          <span className="inline-flex bg-primary text-primary-foreground px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-[0.18em] mb-5 shadow-[0_6px_18px_-6px_hsl(var(--primary))]">For You</span>
          <h3 className="text-[25px] leading-[1] text-foreground font-extrabold tracking-tight mb-2 line-clamp-2">{hero.title}</h3>
          <p className="text-[12px] text-muted-foreground truncate font-semibold mb-4">{hero.artist}</p>
          <div className="w-9 h-9 rounded-full bg-foreground flex items-center justify-center flex-shrink-0 shadow-lg">
            <Play className="w-4 h-4 text-background ml-0.5" fill="currentColor" />
          </div>
        </div>
      </motion.button>


      <div className="mt-4 rounded-[28px] overflow-hidden neu-sm">
        {rest.map((song, idx) => {
          const isPlaying = currentSong?.id === song.id;
          return (
            <button key={song.id} onClick={() => play(song)} {...prewarmIntentProps(song)} className="w-full flex items-center justify-between gap-3 px-5 py-3.5 border-b border-white/[0.05] last:border-0 text-left active:bg-white/[0.04] transition-colors">
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-[10px] text-muted-foreground/50 font-mono tabular-nums w-6">{String(idx + 2).padStart(2, '0')}.</span>
                <div className="min-w-0">
                  <p className={`text-[13px] font-bold truncate leading-tight ${isPlaying ? 'text-primary' : 'text-foreground'}`}>{song.title}</p>
                  <p className="text-[11px] text-muted-foreground/70 truncate mt-0.5 font-medium">{song.artist}</p>
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