import React, { useEffect, useState, useCallback, useMemo, memo } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Song, usePlayer } from '@/contexts/PlayerContext';
import { prewarmSong } from '@/lib/instantPlay';
import { useSongCache } from '@/hooks/useSongCache';
import { useAuth } from '@/contexts/AuthContext';
import { useDownloads } from '@/contexts/DownloadContext';
import { getGeoTopTracks, getYouTubeMusicCharts } from '@/lib/musicIndexer';
import { getHomeRailOrder, heroContextLabel, type HomeFeedSignals } from '@/lib/homeFeedOrder';

import MadeForYouSection from '@/components/MadeForYouSection';
import AllSongsSection from '@/components/AllSongsSection';
import FeaturedArtistsSection from '@/components/FeaturedArtistsSection';
import TrendingNowSection from '@/components/TrendingNowSection';
import FreshReleasesSection from '@/components/FreshReleasesSection';
import BottomNav from '@/components/BottomNav';
import OfflineIndicator from '@/components/OfflineIndicator';
import { TabTransition } from '@/components/PageTransition';
import { Music, Play, Pause, User, Shuffle } from 'lucide-react';
import { triggerHaptic } from '@/hooks/useHaptics';
import { HomeSkeleton } from '@/components/PageSkeletons';
import SEOHead from '@/components/SEOHead';
import PullToRefreshIndicator from '@/components/PullToRefresh';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { useUserCountry } from '@/hooks/useUserCountry';
import { readLocalRecent } from '@/lib/localRecentlyPlayed';
import { isSpamSong } from '@/pages/Search';
import { cleanRail, songFingerprint, claimRailSongs, claimedByOtherRails, useRailClaimVersion } from '@/lib/railQuality';

// Simple empty state
const EmptyState = memo(() => (
  <div className="text-center py-8">
    <div className="w-16 h-16 rounded-2xl neu-inset flex items-center justify-center mx-auto mb-3">
      <Music className="w-8 h-8 text-muted-foreground" />
    </div>
    <h2 className="text-base font-semibold mb-1">Nothing saved offline</h2>
    <p className="text-muted-foreground text-xs px-4">
      Download songs while online to listen without a connection.
    </p>
  </div>
));

EmptyState.displayName = 'EmptyState';

const upgradeThumb = (url?: string) => {
  if (!url) return undefined;
  if (url.includes('googleusercontent.com')) return url.replace(/=w\d+-h\d+[^&]*/i, '=w544-h544-l90-rj');
  return url.replace(/\/default\.jpg/i, '/hqdefault.jpg').replace(/\/mqdefault\.jpg/i, '/hqdefault.jpg');
};

// One real pool for the hero: live regional chart sources only. A keyword
// search is not a chart and can surface old popular uploads as "trending".
const fetchHomeSongs = async (country: string): Promise<Song[]> => {
  // No country yet (or a region YouTube has no chart for) → the real GLOBAL
  // chart ('ZZ'), never the US chart. This app ships worldwide.
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

  // Charts are ranked data. Preserve the provider's order rather than rotating
  // it independently on server and client (which caused hydration mismatches
  // and made old entries look like the current #1).
  ingest(charts.top);
  ingest(charts.trending);
  ingest(charts.videos);
  if (byId.size < 12) ingest(regionalFallback);

  return [...byId.values()];
};

const Home = () => {
  const { currentSong, playSong, isPlaying, togglePlay } = usePlayer();
  const { cachedSongs, updateCache } = useSongCache();
  const { isOffline, user } = useAuth();
  const { downloads } = useDownloads();
  const queryClient = useQueryClient();
  const country = useUserCountry();
  // Re-pick the hero when a rail claims/releases fingerprints.
  const claimVersion = useRailClaimVersion();

  // Artist users land on their Studio dashboard, not the listener home.
  // We only auto-route once per session so they can browse later if they wish.
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

  // When offline → ONLY show downloaded songs. When online → full catalog.
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

  // Persist to local song cache for instant boot next time
  useEffect(() => {
    if (!isOffline && onlineSongs && onlineSongs.length > 0) updateCache(onlineSongs);
  }, [onlineSongs, updateCache, isOffline]);

  const loading = isLoading && songs.length === 0 && !isOffline;
  const homeReady = songs.length > 0 && !isOffline;
  const allSongs = useMemo(() => songs, [songs]);


  // Behavioural signals. Computed after hydration only — the clock and
  // localStorage don't exist on the server, and guessing them there would flip
  // the whole feed order right after first paint.
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

  const railOrder = useMemo(() => getHomeRailOrder(signals), [signals]);



  // Pull-to-refresh — re-fetches home feed on overscroll
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

  // The hero read from the raw chart pool, so it showed whatever the country
  // feed returned first — including junk uploads and, worse, the exact track
  // Trending/New Releases were already showing (the repeated-song complaint).
  // It now uses the same quality gate and the same cross-rail claim registry
  // as every other shelf.
  const heroSong = useMemo(() => {
    if (currentSong) return currentSong;
    const claimed = claimedByOtherRails('hero');
    const clean = cleanRail(allSongs.filter((s) => !isSpamSong(s)), { requireCover: true });
    return (
      clean.find((s) => !claimed.has(songFingerprint(s)))
      || clean[0]
      || allSongs.find((s) => s.cover_url)
      || allSongs[0]
    );
  }, [currentSong, allSongs, claimVersion]);

  useEffect(() => { if (heroSong) claimRailSongs('hero', [heroSong]); }, [heroSong]);

  // When the hero IS the current track, the button must not restart it or
  // replace the live queue — it toggles playback like any player control.
  // Warm the hero's stream as soon as Home renders — the most likely first tap.
  useEffect(() => { if (heroSong) prewarmSong(heroSong); }, [heroSong]);

  const heroIsCurrent = !!heroSong && !!currentSong && heroSong.id === currentSong.id;

  const playHero = useCallback(() => {
    if (!heroSong) return;
    triggerHaptic('selection');
    if (heroIsCurrent) { togglePlay(); return; }
    playSong(heroSong, null, allSongs.slice(0, 40));
  }, [heroSong, heroIsCurrent, togglePlay, playSong, allSongs]);

  const playTile = useCallback((song?: Song, queue?: Song[]) => {
    if (!song) return;
    triggerHaptic('selection');
    playSong(song, null, (queue || allSongs).slice(0, 40));
  }, [playSong, allSongs]);

  // Cheap scroll parallax for the hero artwork (transform-only, GPU friendly).
  const scrollRef = React.useRef<HTMLElement | null>(null);
  const { scrollY } = useScroll({ container: scrollRef as React.RefObject<HTMLElement> });
  const heroY = useTransform(scrollY, [0, 500], [0, 110]);
  const heroScale = useTransform(scrollY, [0, 500], [1, 1.12]);

  const shuffleAll = useCallback(() => {
    const pool = allSongs.filter((s) => s.cover_url);
    if (pool.length === 0) return;
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    playTile(shuffled[0], shuffled);
  }, [allSongs, playTile]);

  return (
    <TabTransition>
      <div className="h-[100dvh] bg-background relative flex flex-col overflow-hidden">
        <SEOHead
          title="Univers Flow — Free Music Streaming & Playlists"
          description="Your personalized music feed: trending tracks, fresh releases, featured artists and your listening history. Stream and download free."
          path="/home"
          jsonLdId="home-jsonld"
          jsonLd={{
            '@context': 'https://schema.org',
            '@type': 'CollectionPage',
            name: 'Univers Flow — Home',
            url: 'https://universflow.in/home',
            description: 'Personalized music feed with trending tracks, featured artists, and fresh releases.',
            isPartOf: { '@type': 'WebSite', name: 'Univers Flow', url: 'https://universflow.in' },
          }}
        />

        {/* ====== HEADER ====== */}
        <header className="flex-shrink-0 z-30 px-5 pt-5 pb-3 safe-area-pt">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
            <h1 className="font-display text-[32px] leading-none tracking-[0.06em] text-primary truncate">
              UNIVERSFLOW
              <span className="sr-only"> — Your Personal Music Feed</span>
            </h1>

            <motion.button
              onClick={() => { triggerHaptic('selection'); window.location.href = '/profile'; }}
              aria-label="Open profile"
              className="w-10 h-10 shrink-0 rounded-full overflow-hidden border border-border/60 bg-card flex items-center justify-center neu-press"
              whileTap={{ scale: 0.94 }}
            >
              {userAvatar ? (
                <img src={userAvatar} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                <User className="w-4 h-4 text-muted-foreground" />
              )}
            </motion.button>
          </div>
        </header>


        {/* Scrollable content area */}
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
            <div className="px-5"><HomeSkeleton /></div>
          ) : isOffline && songs.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="space-y-10">
              {/* ====== HERO — artwork-dominant bento tile ====== */}
              {heroSong && (
                <motion.section
                  initial={{ opacity: 0, y: 24, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ type: 'spring', stiffness: 120, damping: 18, mass: 0.9 }}
                  className="relative"
                >
                  <div className="flex items-end justify-between mb-4 px-5">
                    <h2 className="uf-shelf-title">
                      {heroContextLabel(signals, !!currentSong)}
                    </h2>
                    <button onClick={shuffleAll} className="flex items-center gap-1.5 uf-eyebrow pb-1">
                      <Shuffle className="w-3.5 h-3.5" /> Shuffle
                    </button>
                  </div>

                  {/* Full-bleed cinematic hero */}
                  <div className="relative w-full h-[74vh] min-h-[420px] max-h-[620px] overflow-hidden uf-hero-depth">
                    <motion.div className="absolute inset-0 will-change-transform" style={{ y: heroY, scale: heroScale }}>
                      {heroSong.cover_url ? (
                        <img src={heroSong.cover_url} alt="" className="absolute inset-0 w-full h-full object-cover" loading="eager" />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center bg-card"><Music className="w-10 h-10 text-muted-foreground" /></div>
                      )}
                    </motion.div>

                    {/* Layered scrim: deep bottom fade + rose bloom + top vignette */}
                    <div className="absolute inset-0 bg-gradient-to-t from-background via-background/55 to-transparent" />
                    <div className="absolute inset-0 bg-[radial-gradient(90%_60%_at_10%_100%,hsl(var(--primary)/0.35)_0%,transparent_65%)]" />
                    <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-background/85 to-transparent" />

                    <div className="absolute bottom-0 left-0 right-0 p-5 pb-8">
                      <span className="inline-block px-2.5 py-1 rounded-full uf-glow-action text-[10px] font-black uppercase tracking-[0.18em] mb-3">
                        {heroIsCurrent && isPlaying ? 'Now playing' : 'Start here'}
                      </span>
                      <h3
                        className="font-display uppercase text-foreground line-clamp-3"
                        style={{ fontSize: 'clamp(44px, 15vw, 76px)', lineHeight: 0.84, textShadow: '0 18px 50px rgba(0,0,0,0.65)' }}
                      >
                        {heroSong.title}
                      </h3>
                      <div className="flex items-center justify-between gap-4 mt-3">
                        <p className="text-foreground/70 text-[15px] font-semibold truncate">{heroSong.artist}</p>
                        <motion.button
                          onClick={playHero}
                          whileTap={{ scale: 0.9 }}
                          transition={{ type: 'spring', stiffness: 500, damping: 22 }}
                          aria-label={heroIsCurrent && isPlaying ? 'Pause' : 'Play'}
                          className="w-16 h-16 shrink-0 rounded-full uf-glow-action flex items-center justify-center"
                        >
                          {heroIsCurrent && isPlaying
                            ? <Pause className="w-7 h-7 fill-current" />
                            : <Play className="w-7 h-7 fill-current ml-0.5" />}
                        </motion.button>
                      </div>
                    </div>
                  </div>
                </motion.section>
              )}


              {/* ====== RAILS ======
                  Order is scored per listener in src/lib/homeFeedOrder.ts, not
                  hardcoded: an open listening loop outranks everything while it
                  is warm, familiarity beats novelty once we know their taste,
                  social proof leads for a stranger, and the new-release rail is
                  only promoted inside the Friday–Sunday window. Every rail
                  self-hides with no real data, so nothing renders empty. */}
              <div className="space-y-10">
                {isOffline ? (
                  allSongs.length > 0 && (
                    <div className="px-5"><AllSongsSection songs={allSongs} /></div>
                  )
                ) : (
                  railOrder.map((rail, railIdx) => {
                    const aura =
                      rail === 'trending' ? 'uf-aura uf-aura-hot'
                      : rail === 'mix' ? 'uf-aura uf-aura-cool'
                      : rail === 'fresh' ? 'uf-aura uf-aura-deep'
                      : 'uf-aura';
                    const body =
                      rail === 'mix' ? <MadeForYouSection />
                      : rail === 'trending' ? <TrendingNowSection songs={allSongs} enabled={homeReady} />
                      : rail === 'fresh' ? <FreshReleasesSection songs={allSongs} enabled={homeReady} />
                      : <FeaturedArtistsSection songs={allSongs} />;
                    return (
                      <motion.div
                        key={rail}
                        className={`px-5 ${aura}`}
                        initial={{ opacity: 0, y: 28 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true, margin: '-60px' }}
                        transition={{ type: 'spring', stiffness: 110, damping: 18, delay: 0.04 * railIdx }}
                      >
                        {body}
                      </motion.div>
                    );
                  })
                )}
              </div>


            </div>
          )}
        </main>

        <BottomNav />
        <OfflineIndicator />
      </div>
    </TabTransition>
  );
};

export default Home;
