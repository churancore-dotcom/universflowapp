import React, { useEffect, useState, useMemo, memo, useRef } from 'react';
import { motion } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Song, usePlayer } from '@/contexts/PlayerContext';
import { prewarmSong } from '@/lib/instantPlay';
import { useSongCache } from '@/hooks/useSongCache';
import { useAuth } from '@/contexts/AuthContext';
import { useDownloads } from '@/contexts/DownloadContext';
import { getGeoTopTracks, getYouTubeMusicCharts, getArtistTopTracksByName } from '@/lib/musicIndexer';
import { type HomeFeedSignals } from '@/lib/homeFeedOrder';

import AllSongsSection from '@/components/AllSongsSection';
import HistoryPlaylistsSection from '@/components/HistoryPlaylistsSection';
import TrendingNowSection from '@/components/TrendingNowSection';
import FreshReleasesSection from '@/components/FreshReleasesSection';
import MadeForYouSection from '@/components/MadeForYouSection';
import OnRepeatSection from '@/components/OnRepeatSection';
import FeaturedArtistsSection from '@/components/FeaturedArtistsSection';

import BottomNav from '@/components/BottomNav';
import QueueDrawer from '@/components/QueueDrawer';
import EqualizerModal from '@/components/EqualizerModal';
import { greetingForHour } from '@/lib/personalHome';
import { useHomeInsights } from '@/hooks/useHomeInsights';
import RecapProgressCard from '@/components/RecapProgressCard';
import HomeBento from '@/components/HomeBento';
import CrossDeviceResume from '@/components/CrossDeviceResume';
import FlowCoreSection from '@/components/FlowCoreSection';
import HomeStage from '@/components/HomeStage';
import QuickPicks from '@/components/QuickPicks';
import SongCardRail from '@/components/SongCardRail';


import OfflineIndicator from '@/components/OfflineIndicator';
import { TabTransition } from '@/components/PageTransition';
import { Music, User, ListMusic, SlidersHorizontal } from 'lucide-react';
import { triggerHaptic } from '@/hooks/useHaptics';
import { HomeSkeleton } from '@/components/PageSkeletons';
import SEOHead from '@/components/SEOHead';
import PullToRefreshIndicator from '@/components/PullToRefresh';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { useUserCountry } from '@/hooks/useUserCountry';
import { useAvatarUrl } from '@/hooks/useAvatarUrl';
import { readLocalRecent } from '@/lib/localRecentlyPlayed';
import { isSpamSong } from '@/pages/Search';
import { cleanRail, songFingerprint, claimRailSongs, claimedByOtherRails, useRailClaimVersion } from '@/lib/railQuality';
import { useNavigate } from '@/lib/router-compat';
import { useTasteProfile } from '@/hooks/useTasteProfile';
import { rerank, topTasteArtists } from '@/lib/feedPersonalizer';

const EmptyState = memo(() => (
  <div className="text-center py-16 px-8">
    <div className="w-16 h-16 rounded-[20px] bg-card border border-border/60 flex items-center justify-center mx-auto mb-4">
      <Music className="w-7 h-7 text-muted-foreground" />
    </div>
    <h2 className="text-base font-semibold mb-1">Nothing saved offline</h2>
    <p className="text-muted-foreground text-[13px]">
      Download songs while online to listen without a connection.
    </p>
  </div>
));
EmptyState.displayName = 'EmptyState';

const upgradeThumb = (url?: string) => {
  if (!url) return undefined;
  if (url.includes('googleusercontent.com')) return url.replace(/=w\d+-h\d+[^&]*/i, '=w544-h544-l90-rj');
  return url.replace(/\/(default|hqdefault|mqdefault|sddefault)\.jpg/i, '/maxresdefault.jpg');
};

const fetchHomeSongs = async (country: string): Promise<Song[]> => {
  const cc = country || 'ZZ';
  const [charts, regionalFallback] = await Promise.all([
    getYouTubeMusicCharts(cc, 40).catch(() => ({ top: [], trending: [], videos: [], country: cc })),
    country ? getGeoTopTracks(country, 30).catch(() => []) : Promise.resolve([]),
  ]);

  const byId = new Map<string, Song>();
  const ingest = (list: { id: string; title?: string; artist?: string; album?: string; cover_url?: string; audio_url?: string; videoId?: string; duration?: number }[]) => {
    for (const t of list) {
      if (!t.id || !t.title || !t.artist || byId.has(t.id)) continue;
      byId.set(t.id, {
        id: t.id,
        title: t.title,
        artist: t.artist,
        album: t.album,
        cover_url: upgradeThumb(t.cover_url),
        audio_url: t.audio_url || (t.videoId ? `yt-video:${t.videoId}` : 'resolving'),
        duration: t.duration,
        created_at: new Date().toISOString(),
      });
    }
  };

  ingest(charts.top);
  ingest(charts.trending);
  ingest(charts.videos);
  if (byId.size < 12) ingest(regionalFallback);

  return [...byId.values()];
};

const Home = () => {
  const { currentSong } = usePlayer();
  const navigate = useNavigate();
  const { cachedSongs, updateCache } = useSongCache();
  const { isOffline, user } = useAuth();
  const { downloads } = useDownloads();
  const queryClient = useQueryClient();
  const country = useUserCountry();
  const claimVersion = useRailClaimVersion();
  const [queueOpen, setQueueOpen] = useState(false);
  const [eqOpen, setEqOpen] = useState(false);


  // Artist users land on their Studio dashboard, not the listener home.
  useEffect(() => {
    if (!user?.id) return;
    const key = `uf_artist_routed_${user.id}`;
    if (sessionStorage.getItem(key)) return;
    (async () => {
      const { data: isArtist } = await supabase.rpc('has_role', { _user_id: user.id, _role: 'artist' });
      if (isArtist) {
        sessionStorage.setItem(key, '1');
        navigate('/artist/studio', { replace: true });
      }
    })();
  }, [navigate, user?.id]);

  const { data: onlineSongs = (cachedSongs || []), isLoading } = useQuery({
    queryKey: ['home', 'ytm-feed', 'v3-country', country || 'GLOBAL'],
    queryFn: () => fetchHomeSongs(country),
    initialData: cachedSongs && cachedSongs.length > 0 ? cachedSongs : undefined,
    // Cached songs may be from another country: show them, but fetch fresh now.
    initialDataUpdatedAt: 0,
    placeholderData: (prev) => prev,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    enabled: !isOffline,
  });

  const songs: Song[] = useMemo(() => {
    if (isOffline) {
      return downloads.map((d) => ({
        id: d.id,
        title: d.title,
        artist: d.artist,
        album: d.album,
        cover_url: d.cover_url,
        audio_url: d.blobUrl || d.audio_url,
        duration: d.duration,
      } as Song));
    }
    return onlineSongs;
  }, [isOffline, downloads, onlineSongs]);

  useEffect(() => {
    if (!isOffline && onlineSongs && onlineSongs.length > 0) updateCache(onlineSongs);
  }, [onlineSongs, updateCache, isOffline]);

  const loading = isLoading && songs.length === 0 && !isOffline;
  const homeReady = songs.length > 0 && !isOffline;
  const allSongs = useMemo(() => songs, [songs]);

  const [hydrated, setHydrated] = useState(false);
  const [recentVersion, setRecentVersion] = useState(0);
  useEffect(() => {
    setHydrated(true);
    const refresh = () => setRecentVersion((value) => value + 1);
    window.addEventListener('universflow:recently-played-changed', refresh);
    return () => window.removeEventListener('universflow:recently-played-changed', refresh);
  }, []);

  const signals: HomeFeedSignals = useMemo(() => {
    const now = hydrated ? new Date() : new Date(0);
    const recent = hydrated ? readLocalRecent(user?.id) : [];
    const latestPlayedAt = recent[0]?.played_at;
    return {
      recentCount: recent.length,
      msSinceLastPlay: typeof latestPlayedAt === 'number' ? Math.max(0, now.getTime() - latestPlayedAt) : null,
      hour: hydrated ? now.getHours() : 12,
      weekday: hydrated ? now.getDay() : 3,
    };
  }, [hydrated, recentVersion, user?.id]);

  const pullToRefresh = usePullToRefresh({
    onRefresh: async () => {
      triggerHaptic('impactMedium');
      await queryClient.invalidateQueries({ queryKey: ['home', 'ytm-feed', 'v3-country', country || 'GLOBAL'] });
      await queryClient.refetchQueries({ queryKey: ['home', 'ytm-feed', 'v3-country', country || 'GLOBAL'] });
    },
  });

  const userAvatar = useAvatarUrl();

  // ── The stage: one card, real signal only ────────────────────────────────
  const clean = useMemo(
    () => cleanRail(allSongs.filter((s) => !isSpamSong(s)), { requireCover: true }),
    [allSongs],
  );
  // Ranked for THIS listener (plays, likes, skips, follows). Trending keeps
  // the official chart order and only receives the cleaned list.
  const taste = useTasteProfile();
  // The personal pool is built from THIS listener's own artists first, with
  // the local chart only filling gaps — reranking chart songs alone left Home
  // looking like everyone else's Trending page.
  const seedArtists = useMemo(() => topTasteArtists(taste, 6), [taste]);
  const { data: tasteSongs = [] } = useQuery({
    queryKey: ['home', 'taste-pool-v2', user?.id ?? 'anon', seedArtists.join('|'), Math.floor(taste.signalCount / 5)],
    enabled: !isOffline && seedArtists.length > 0,
    staleTime: 30 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
    queryFn: async (): Promise<Song[]> => {
      // Like YouTube's home: YouTube Music's own mixes for the songs this
      // listener just played bring in NEW similar songs, alongside top tracks
      // of the artists they already love.
      const { readLocalRecent } = await import('@/lib/localRecentlyPlayed');
      const { fetchSongMix, pickMixSeeds } = await import('@/lib/similarSongs');
      const recentSongs = readLocalRecent(user?.id ?? null).map((e) => e.song).filter(Boolean);
      const mixSeeds = pickMixSeeds(recentSongs as { title?: string; artist?: string; audio_url?: string }[], 3);
      const [lists, mixLists] = await Promise.all([
        Promise.allSettled(seedArtists.map((a) => getArtistTopTracksByName(a, 8))),
        Promise.allSettled(mixSeeds.map((seed) => fetchSongMix(seed, 12))),
      ]);
      const perArtist = [
        ...mixLists.map((r) => (r.status === 'fulfilled' ? r.value : [])),
        ...lists.map((r) => (r.status === 'fulfilled' ? r.value : [])),
      ] as { id: string; title: string; artist: string; album?: string; cover_url?: string; audio_url?: string; videoId?: string; duration?: number }[][];
      const out: Song[] = [];
      const seenIds = new Set<string>();
      // Round-robin so one artist or one mix cannot take over the whole feed.
      for (let i = 0; i < 12; i++) {
        for (const list of perArtist) {
          const t = list[i];
          if (!t?.id || !t.title || !t.artist || seenIds.has(t.id)) continue;
          seenIds.add(t.id);
          out.push({
            id: t.id, title: t.title, artist: t.artist, album: t.album,
            cover_url: upgradeThumb(t.cover_url),
            audio_url: t.audio_url || (t.videoId ? `yt-video:${t.videoId}` : 'resolving'),
            duration: t.duration,
          } as Song);
        }
      }
      return out;
    },
  });
  const personal = useMemo(() => {
    const own = cleanRail(tasteSongs.filter((s) => !isSpamSong(s)), { requireCover: true });
    const chart = clean.length ? clean : allSongs;
    if (!own.length) return rerank(chart, taste);
    // Mostly the listener's own taste, with one local hit every third slot.
    const mixed: Song[] = [];
    let o = 0, c = 0;
    while (o < own.length || c < chart.length) {
      if (o < own.length) mixed.push(own[o++]);
      if (o < own.length) mixed.push(own[o++]);
      if (c < chart.length) mixed.push(chart[c++]);
    }
    return rerank(cleanRail(mixed), taste);
  }, [tasteSongs, clean, allSongs, taste]);

  const stage = useMemo(() => {
    if (currentSong) {
      return { song: currentSong, label: 'Now playing' };
    }
    const claimed = claimedByOtherRails('hero');
    const song = personal.find((s) => !claimed.has(songFingerprint(s))) || personal[0];
    return song ? { song, label: taste.signalCount >= 5 ? 'Picked for you' : `Top in your area` } : null;
  }, [currentSong, personal, allSongs, claimVersion]);

  useEffect(() => {
    claimRailSongs('hero', stage?.song ? [stage.song] : []);
    return () => claimRailSongs('hero', []);
  }, [stage?.song?.id]);
  useEffect(() => { if (stage?.song) prewarmSong(stage.song); }, [stage?.song?.id]);

  // Extra card rails: per favourite artist, plus deeper picks from the personal mix.
  const artistRails = useMemo(() => {
    const pool = personal.filter((s) => s.id !== stage?.song?.id);
    const by = new Map<string, Song[]>();
    for (const s of pool) {
      const key = (s.artist || '').split(/,|&| feat\.? /i)[0].trim();
      if (!key) continue;
      const list = by.get(key) || [];
      list.push(s);
      by.set(key, list);
    }
    return [...by.entries()].filter(([, l]) => l.length >= 4).sort((a, b) => b[1].length - a[1].length).slice(0, 3);
  }, [personal, stage?.song?.id]);
  const deeperPicks = useMemo(() => personal.filter((s) => s.id !== stage?.song?.id).slice(17, 40), [personal, stage?.song?.id]);

  // ── Real personal stats for the header, chips and recap card ─────────────
  const insights = useHomeInsights();





  const scrollRef = useRef<HTMLElement | null>(null);

  return (
    <TabTransition>
      <div className="h-[100dvh] bg-background relative flex flex-col overflow-hidden">
        <SEOHead
          title="Univers Flow — Free Music Streaming & Playlists"
          description="Your personalized music feed: trending tracks, fresh releases and your listening history. Stream and download free."
          path="/"
          jsonLdId="home-jsonld"
          jsonLd={{
            '@context': 'https://schema.org',
            '@type': 'CollectionPage',
            name: 'Univers Flow — Home',
            url: 'https://universflow.in/',
            description: 'Personalized music feed with trending tracks and fresh releases.',
            isPartOf: { '@type': 'WebSite', name: 'Univers Flow', url: 'https://universflow.in' },
          }}
        />

        {/* ── Header: real personal stat, no generic greeting ── */}
        <header className="flex-shrink-0 z-30 px-6 pt-6 pb-4 safe-area-pt">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground/70">
                {hydrated ? greetingForHour(signals.hour) : 'Welcome'}
              </p>
              <h1 className="font-display text-[26px] leading-none tracking-[0.06em] uppercase text-foreground mt-1.5">
                Universflow
              </h1>

            </div>


            <button
              onClick={() => { triggerHaptic('selection'); setQueueOpen(true); }}
              aria-label="Open queue"
              className="w-9 h-9 rounded-full flex items-center justify-center text-muted-foreground active:scale-90 transition-transform"
            >
              <ListMusic className="w-[18px] h-[18px]" />
            </button>
            <button
              onClick={() => { triggerHaptic('selection'); setEqOpen(true); }}
              aria-label="Open equalizer"
              className="w-9 h-9 rounded-full flex items-center justify-center text-muted-foreground active:scale-90 transition-transform"
            >
              <SlidersHorizontal className="w-[18px] h-[18px]" />
            </button>
            <motion.button
              onClick={() => { triggerHaptic('selection'); navigate('/profile'); }}
              aria-label="Open profile"
              className="w-9 h-9 shrink-0 rounded-full overflow-hidden bg-card border border-border/70 flex items-center justify-center"
              whileTap={{ scale: 0.92 }}
            >
              {userAvatar ? (
                <img src={userAvatar} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                <User className="w-4 h-4 text-muted-foreground" />
              )}
            </motion.button>
          </div>
        </header>

        <QueueDrawer isOpen={queueOpen} onClose={() => setQueueOpen(false)} />
        <EqualizerModal isOpen={eqOpen} onClose={() => setEqOpen(false)} />


        <main
          ref={scrollRef}
          data-scroll-container
          className="flex-1 overflow-y-auto overflow-x-hidden pb-40 relative z-10"
          style={{ WebkitOverflowScrolling: 'touch' }}
          {...pullToRefresh.handlers}
        >
          <PullToRefreshIndicator
            pullDistance={pullToRefresh.pullDistance}
            threshold={pullToRefresh.threshold}
            isRefreshing={pullToRefresh.isRefreshing}
            isTriggered={pullToRefresh.isTriggered}
          />

          {loading ? (
            <div className="px-6"><HomeSkeleton /></div>
          ) : isOffline && songs.length === 0 ? (
            <EmptyState />
          ) : isOffline ? (
            <div className="px-6 pt-2"><AllSongsSection songs={personal} /></div>
          ) : (
            <>
              <CrossDeviceResume />
              {/* ── Featured song + personal bento, both from real history ── */}
              {stage?.song && <HomeStage song={stage.song} label={stage.label} next={personal.filter((s) => s.id !== stage.song.id).slice(0, 30)} />}

              <div className="mt-6 relative z-10"><HomeBento songs={personal} /></div>

              <QuickPicks
                songs={personal.filter((s) => s.id !== stage?.song?.id)}
                subtitle={taste.signalCount >= 5 ? 'Based on what you play' : 'Start here — it learns as you listen'}
              />
              {artistRails[0] && <SongCardRail eyebrow="Because you listen to" title={artistRails[0][0]} songs={artistRails[0][1]} size="lg" />}
              <SongCardRail eyebrow="Keep exploring" title="More in your mix" songs={deeperPicks} />
              {artistRails.slice(1).map(([name, list]) => (
                <SongCardRail key={name} eyebrow="More from" title={name} songs={list} />
              ))}

              {/* ── Chapter 1: what the world plays right now ── */}
              <div className="uf-feed-sections px-6 space-y-12 mt-10">
                <TrendingNowSection songs={clean.length ? clean : allSongs} enabled={homeReady} />
                <FreshReleasesSection enabled={homeReady} />
              </div>

              {/* ── Chapter 2: built from your own listening ── */}
              <div className="uf-feed-sections px-6 space-y-12 mt-12">
                <RecapProgressCard monthPlays={insights.monthPlays} onOpen={() => navigate('/recap')} />
                <OnRepeatSection />
                <MadeForYouSection />
                <FlowCoreSection pool={personal} />
                <HistoryPlaylistsSection />
              </div>

              {/* ── Chapter 3: the people behind the music ── */}
              <div className="uf-feed-sections px-6 space-y-12 mt-12 pb-24">
                <FeaturedArtistsSection songs={personal} circle />
              </div>

            </>
          )}
        </main>

        <BottomNav />
        <OfflineIndicator />
      </div>
    </TabTransition>
  );
};

export default Home;
