import React, { useEffect, useState, useCallback, useMemo, memo, useRef } from 'react';
import { motion } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Song, usePlayer } from '@/contexts/PlayerContext';
import { usePlayerProgress } from '@/lib/playerProgressStore';
import { prewarmSong } from '@/lib/instantPlay';
import { useSongCache } from '@/hooks/useSongCache';
import { useAuth } from '@/contexts/AuthContext';
import { useDownloads } from '@/contexts/DownloadContext';
import { getGeoTopTracks, getYouTubeMusicCharts } from '@/lib/musicIndexer';
import { type HomeFeedSignals } from '@/lib/homeFeedOrder';

import AllSongsSection from '@/components/AllSongsSection';
import HistoryPlaylistsSection from '@/components/HistoryPlaylistsSection';
import YourArtistsSection from '@/components/YourArtistsSection';
import BottomNav from '@/components/BottomNav';
import QueueDrawer from '@/components/QueueDrawer';
import EqualizerModal from '@/components/EqualizerModal';
import OptimizedImage from '@/components/OptimizedImage';
import { greetingForHour, recentSongs } from '@/lib/personalHome';
import { useLocalRecents } from '@/hooks/useLocalRecents';
import { useHomeInsights } from '@/hooks/useHomeInsights';
import RecapProgressCard from '@/components/RecapProgressCard';
import HomeBento from '@/components/HomeBento';

import OfflineIndicator from '@/components/OfflineIndicator';
import { TabTransition } from '@/components/PageTransition';
import { Music, Play, Pause, User, ListMusic, SlidersHorizontal } from 'lucide-react';
import { triggerHaptic } from '@/hooks/useHaptics';
import { HomeSkeleton } from '@/components/PageSkeletons';
import SEOHead from '@/components/SEOHead';
import PullToRefreshIndicator from '@/components/PullToRefresh';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { useUserCountry } from '@/hooks/useUserCountry';
import { readLocalRecent } from '@/lib/localRecentlyPlayed';
import { isSpamSong } from '@/pages/Search';
import { cleanRail, songFingerprint, claimRailSongs, claimedByOtherRails, useRailClaimVersion } from '@/lib/railQuality';

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

const fmt = (s?: number) => {
  if (!s || !Number.isFinite(s) || s <= 0) return '0:00';
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
};

const upgradeThumb = (url?: string) => {
  if (!url) return undefined;
  if (url.includes('googleusercontent.com')) return url.replace(/=w\d+-h\d+[^&]*/i, '=w544-h544-l90-rj');
  return url.replace(/\/default\.jpg/i, '/hqdefault.jpg').replace(/\/mqdefault\.jpg/i, '/hqdefault.jpg');
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
  const { currentSong, playSong, isPlaying, togglePlay } = usePlayer();
  const { progress, duration } = usePlayerProgress();
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
        window.location.replace('/artist/studio');
      }
    })();
  }, [user?.id]);

  const { data: onlineSongs = (cachedSongs || []), isLoading } = useQuery({
    queryKey: ['home', 'ytm-feed', 'v3-country', country || 'GLOBAL'],
    queryFn: () => fetchHomeSongs(country),
    initialData: cachedSongs && cachedSongs.length > 0 ? cachedSongs : undefined,
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

  const userAvatar = useMemo(() => {
    const metadata = (user?.user_metadata || {}) as Record<string, unknown>;
    return typeof metadata.avatar_url === 'string' ? metadata.avatar_url : undefined;
  }, [user]);

  const recentEntries = useLocalRecents(20);
  const history = useMemo(() => recentSongs(recentEntries), [recentEntries]);

  // ── The stage: one card, real signal only ────────────────────────────────
  const clean = useMemo(
    () => cleanRail(allSongs.filter((s) => !isSpamSong(s)), { requireCover: true }),
    [allSongs],
  );

  const stage = useMemo(() => {
    if (currentSong) {
      return { song: currentSong, at: progress, total: duration || currentSong.duration || 0, label: 'Now playing' };
    }
    if (history[0]) {
      return { song: history[0], at: 0, total: history[0].duration || 0, label: 'Pick up where you left off' };
    }
    const claimed = claimedByOtherRails('hero');
    const song = clean.find((s) => !claimed.has(songFingerprint(s))) || clean[0] || allSongs[0];
    return song ? { song, at: 0, total: song.duration || 0, label: `Top in your area` } : null;
  }, [currentSong, progress, duration, history, clean, allSongs, claimVersion]);

  useEffect(() => { if (stage?.song) claimRailSongs('hero', [stage.song]); }, [stage?.song?.id]);
  useEffect(() => { if (stage?.song) prewarmSong(stage.song); }, [stage?.song?.id]);

  const playTile = useCallback((song?: Song, queue?: Song[]) => {
    if (!song) return;
    triggerHaptic('selection');
    playSong(song, null, (queue || clean).slice(0, 40));
  }, [playSong, clean]);

  // ── Real personal stats for the header, chips and recap card ─────────────
  const insights = useHomeInsights();

  const headline = useMemo(() => {
    if (insights.loading || insights.weekPlays < 3) return null;
    const flavour = insights.weekTopArtist || insights.topGenre;
    const plural = insights.weekPlays === 1 ? 'song' : 'songs';
    return flavour
      ? `You've played ${insights.weekPlays} ${plural} this week — mostly ${flavour}.`
      : `You've played ${insights.weekPlays} ${plural} this week.`;
  }, [insights]);





  const scrollRef = useRef<HTMLElement | null>(null);

  return (
    <TabTransition>
      <div className="h-[100dvh] bg-background relative flex flex-col overflow-hidden">
        <SEOHead
          title="Univers Flow — Free Music Streaming & Playlists"
          description="Your personalized music feed: trending tracks, fresh releases and your listening history. Stream and download free."
          path="/home"
          jsonLdId="home-jsonld"
          jsonLd={{
            '@context': 'https://schema.org',
            '@type': 'CollectionPage',
            name: 'Univers Flow — Home',
            url: 'https://universflow.in/home',
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
                {insights.streak.current > 0 && (
                  <span className="text-primary"> — {insights.streak.current} day streak 🔥</span>
                )}
              </p>
              <h1 className="font-display text-[26px] leading-none tracking-[0.06em] uppercase text-foreground mt-1.5">
                Universflow
              </h1>
              {headline && (
                <p className="text-[12px] font-medium text-muted-foreground mt-1.5 truncate">{headline}</p>
              )}
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
              onClick={() => { triggerHaptic('selection'); window.location.href = '/profile'; }}
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
          className="flex-1 overflow-y-auto overflow-x-hidden pb-40 relative z-10"
          style={{ WebkitOverflowScrolling: 'touch' }}
          {...pullToRefresh.handlers}
        >
          <PullToRefreshIndicator
            pullDistance={pullToRefresh.pullDistance}
            isRefreshing={pullToRefresh.isRefreshing}
            progress={pullToRefresh.progress}
            isTriggered={pullToRefresh.isTriggered}
          />

          {loading ? (
            <div className="px-6"><HomeSkeleton /></div>
          ) : isOffline && songs.length === 0 ? (
            <EmptyState />
          ) : isOffline ? (
            <div className="px-6 pt-2"><AllSongsSection songs={allSongs} /></div>
          ) : (
            <>
              {/* ── Continue Listening + Jump Back In, both from real history ── */}
              <HomeBento songs={clean.length ? clean : allSongs} />

              {/* ── Recap progress — leads to the real recap screen ── */}
              <section className="px-6 mt-5">
                <RecapProgressCard monthPlays={insights.monthPlays} onOpen={() => { window.location.href = '/recap'; }} />
              </section>

              {/* ── Playlists + artists, built only from tracks actually played ── */}
              <div className="px-6 mt-9 space-y-11 pb-24">
                <HistoryPlaylistsSection />
                <YourArtistsSection />
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
