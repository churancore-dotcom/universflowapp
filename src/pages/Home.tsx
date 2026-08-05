import React, { useEffect, useState, useCallback, useMemo, memo } from 'react';
import { motion } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Song, usePlayer } from '@/contexts/PlayerContext';
import { useSongCache } from '@/hooks/useSongCache';
import { useAuth } from '@/contexts/AuthContext';
import { useDownloads } from '@/contexts/DownloadContext';
import { searchYouTubeMusicTracks, getYouTubeMusicCharts } from '@/lib/musicIndexer';
import { readLocalRecent } from '@/lib/localRecentlyPlayed';
import { getHomeRailOrder, heroContextLabel, type HomeFeedSignals } from '@/lib/homeFeedOrder';

import MadeForYouSection from '@/components/MadeForYouSection';
import AllSongsSection from '@/components/AllSongsSection';
import FeaturedArtistsSection from '@/components/FeaturedArtistsSection';
import TrendingNowSection from '@/components/TrendingNowSection';
import FreshReleasesSection from '@/components/FreshReleasesSection';
import FollowedArtistSongsSection from '@/components/FollowedArtistSongsSection';
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
import { getCountryQueries } from '@/lib/countryQueries';

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

// Session-stable rotation so the home hero isn't the identical song on every
// app open, while staying stable while the user scrolls. Deterministic during
// SSR — a random module-scope value would differ between the server render and
// hydration and flip the hero right after first paint.
const HOME_SEED = typeof window === 'undefined' ? 0 : Math.floor(Math.random() * 100000);
function rotate<T>(arr: T[], seed = HOME_SEED): T[] {
  if (arr.length < 2) return arr;
  const k = seed % arr.length;
  return [...arr.slice(k), ...arr.slice(0, k)];
}

// One real pool for the hero: YouTube Music charts for the user's country,
// keyword search only as a backup when the region has no charts.
const fetchHomeSongs = async (heroQuery: string, country: string): Promise<Song[]> => {
  const [charts, searched] = await Promise.all([
    getYouTubeMusicCharts(country || 'US', 40).catch(() => ({ top: [], trending: [], videos: [], country: 'US' })),
    searchYouTubeMusicTracks(heroQuery, 24).catch(() => []),
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

  ingest(rotate(charts.top));
  ingest(rotate(charts.trending));
  ingest(rotate(charts.videos));
  if (byId.size < 12) ingest(searched);

  return [...byId.values()];
};

const Home = () => {
  const { currentSong, playSong, isPlaying, togglePlay } = usePlayer();
  const { cachedSongs, updateCache } = useSongCache();
  const { isOffline, user } = useAuth();
  const { downloads } = useDownloads();
  const queryClient = useQueryClient();
  const country = useUserCountry();
  const countryQueries = useMemo(() => getCountryQueries(country), [country]);

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
    queryFn: () => fetchHomeSongs(countryQueries.hero, country || 'US'),
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


  // Real per-device listening history — no invented "on repeat" filler.
  const [recent, setRecent] = useState<Song[]>([]);
  const [lastPlayedAt, setLastPlayedAt] = useState<number | null>(null);
  useEffect(() => {
    if (isOffline) { setRecent([]); setLastPlayedAt(null); return; }
    const load = () => {
      const all = readLocalRecent(user?.id);
      const entries = all.filter((e) => e.song?.title && e.song?.artist);
      setLastPlayedAt(all.length > 0 ? Math.max(...all.map((e) => e.played_at)) : null);
      setRecent(
        entries.slice(0, 12).map((e) => ({
          id: e.song_id,
          title: e.song!.title as string,
          artist: e.song!.artist as string,
          album: e.song?.album ?? undefined,
          cover_url: e.song?.cover_url ?? undefined,
          audio_url: e.song?.audio_url ?? 'resolving',
          duration: e.song?.duration ?? undefined,
        } as Song)),
      );
    };
    load();
    window.addEventListener('universflow:recently-played-changed', load);
    return () => window.removeEventListener('universflow:recently-played-changed', load);
  }, [user?.id, isOffline]);

  // Behavioural signals. Computed after hydration only — the clock and
  // localStorage don't exist on the server, and guessing them there would flip
  // the whole feed order right after first paint.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { setHydrated(true); }, []);

  const signals: HomeFeedSignals = useMemo(() => {
    const now = hydrated ? new Date() : new Date(0);
    return {
      recentCount: recent.length,
      msSinceLastPlay: hydrated && lastPlayedAt ? Date.now() - lastPlayedAt : null,
      hour: hydrated ? now.getHours() : 12,
      weekday: hydrated ? now.getDay() : 3,
    };
  }, [hydrated, recent.length, lastPlayedAt]);

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

  const heroSong = useMemo(() => {
    if (currentSong) return currentSong;
    return allSongs.find((s) => s.cover_url) || allSongs[0];
  }, [currentSong, allSongs]);

  // When the hero IS the current track, the button must not restart it or
  // replace the live queue — it toggles playback like any player control.
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
        <header className="flex-shrink-0 z-30 px-5 pt-5 pb-4 safe-area-pt">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                {new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 18 ? 'Good afternoon' : 'Good evening'}
              </p>
              <h1 className="font-display text-[30px] leading-[0.95] tracking-[0.05em] text-foreground mt-1">
                UNIVERS <span className="text-primary">FLOW</span>
              </h1>
            </div>
            <motion.button
              onClick={() => { triggerHaptic('selection'); window.location.href = '/profile'; }}
              aria-label="Open profile"
              className="w-12 h-12 rounded-full neu neu-press flex items-center justify-center overflow-hidden"
              whileTap={{ scale: 0.94 }}
            >
              <div className="w-9 h-9 rounded-full overflow-hidden neu-inset flex items-center justify-center">
                {userAvatar ? (
                  <img src={userAvatar} alt="Profile" className="w-full h-full object-cover" />
                ) : (
                  <User className="w-4 h-4 text-muted-foreground" />
                )}
              </div>
            </motion.button>
          </div>
        </header>

        {/* Scrollable content area */}
        <main
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
            <div className="space-y-8">
              {/* ====== HERO ====== */}
              {heroSong && (
                <motion.section
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                  className="px-5"
                >
                  <div className="rounded-[34px] neu p-5">
                    <div className="flex items-center gap-4">
                      <div className="w-[104px] h-[104px] rounded-3xl neu-inset p-2 shrink-0">
                        <div className="w-full h-full rounded-2xl overflow-hidden">
                          {heroSong.cover_url ? (
                            <img src={heroSong.cover_url} alt="" className="w-full h-full object-cover" loading="eager" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center"><Music className="w-6 h-6 text-muted-foreground" /></div>
                          )}
                        </div>
                      </div>
                      <div className="min-w-0">
                        <span className="inline-block px-3 py-1 rounded-full neu-inset text-[9px] uppercase tracking-[0.2em] text-primary font-semibold">
                          {heroContextLabel(signals, !!currentSong)}
                        </span>
                        <h2 className="font-display text-[30px] leading-[0.95] tracking-[0.03em] text-foreground uppercase mt-2 line-clamp-2">
                          {heroSong.title}
                        </h2>
                        <p className="text-muted-foreground text-[11px] mt-1.5 uppercase tracking-[0.16em] truncate">{heroSong.artist}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 mt-5">
                      <button
                        onClick={playHero}
                        className="flex-1 h-14 rounded-3xl neu-accent neu-press flex items-center justify-center gap-2 font-display text-xl tracking-[0.1em]"
                      >
                        {heroIsCurrent && isPlaying
                          ? <><Pause className="w-4 h-4 fill-current" /> PAUSE</>
                          : <><Play className="w-4 h-4 fill-current" /> PLAY</>}
                      </button>
                      <button
                        onClick={shuffleAll}
                        aria-label="Shuffle play"
                        className="w-14 h-14 rounded-3xl neu neu-press flex items-center justify-center"
                      >
                        <Shuffle className="w-5 h-5 text-foreground/75" />
                      </button>
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
              <div className="space-y-8">
                {isOffline ? (
                  allSongs.length > 0 && (
                    <div className="px-5"><AllSongsSection songs={allSongs} /></div>
                  )
                ) : (
                  railOrder.map((rail) => {
                    if (rail === 'continue') {
                      if (recent.length === 0) return null;
                      return (
                        <motion.section
                          key="continue"
                          initial={{ opacity: 0, y: 14 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                        >
                          <div className="px-5 mb-4">
                            <h2 className="font-display text-2xl tracking-[0.06em] text-foreground uppercase">
                              {signals.msSinceLastPlay !== null && signals.msSinceLastPlay < 6 * 60 * 60 * 1000
                                ? 'Continue listening'
                                : 'Jump back in'}
                            </h2>
                          </div>
                          <div className="flex gap-5 overflow-x-auto hide-scrollbar px-5 pb-3 snap-x snap-mandatory">
                            {recent.map((song) => (
                              <motion.button
                                key={song.id}
                                onClick={() => playTile(song, recent)}
                                whileTap={{ scale: 0.95 }}
                                className="snap-start shrink-0 w-[132px] text-left"
                              >
                                <div className="w-[132px] h-[132px] rounded-[28px] neu neu-press p-2.5">
                                  <div className="w-full h-full rounded-[20px] overflow-hidden neu-inset">
                                    {song.cover_url ? (
                                      <img src={song.cover_url} alt={song.title} className="w-full h-full object-cover" loading="lazy" />
                                    ) : (
                                      <div className="w-full h-full flex items-center justify-center"><Music className="w-6 h-6 text-muted-foreground" /></div>
                                    )}
                                  </div>
                                </div>
                                <p className="text-[13px] text-foreground mt-3 truncate font-medium px-1">{song.title}</p>
                                <p className="text-[10px] text-muted-foreground truncate uppercase tracking-[0.14em] px-1">{song.artist}</p>
                              </motion.button>
                            ))}
                          </div>
                        </motion.section>
                      );
                    }
                    const body =
                      rail === 'followed' ? <FollowedArtistSongsSection songs={allSongs} />
                      : rail === 'mix' ? <MadeForYouSection />
                      : rail === 'trending' ? <TrendingNowSection songs={allSongs} enabled={homeReady} />
                      : rail === 'fresh' ? <FreshReleasesSection songs={allSongs} enabled={homeReady} />
                      : <FeaturedArtistsSection />;
                    return <div key={rail} className="px-5">{body}</div>;
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
