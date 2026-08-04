import React, { useEffect, useState, useCallback, useMemo, memo } from 'react';
import { motion } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Song, usePlayer } from '@/contexts/PlayerContext';
import { useSongCache } from '@/hooks/useSongCache';
import { useAuth } from '@/contexts/AuthContext';
import { useDownloads } from '@/contexts/DownloadContext';
import { searchYouTubeMusicTracks, getYouTubeMusicCharts } from '@/lib/musicIndexer';
import MadeForYouSection from '@/components/MadeForYouSection';

import AllSongsSection from '@/components/AllSongsSection';
import HomeBento from '@/components/HomeBento';

import FeaturedArtistsSection from '@/components/FeaturedArtistsSection';
import TrendingNowSection from '@/components/TrendingNowSection';
import FreshReleasesSection from '@/components/FreshReleasesSection';
import FollowedArtistSongsSection from '@/components/FollowedArtistSongsSection';



import CountryViralSection from '@/components/CountryViralSection';



import SleepTimerModal from '@/components/SleepTimerModal';
import QueueDrawer from '@/components/QueueDrawer';
import BottomNav from '@/components/BottomNav';
import LockScreenPlayer from '@/components/LockScreenPlayer';
import EqualizerModal from '@/components/EqualizerModal';
import PremiumLockOverlay from '@/components/PremiumLockOverlay';
import OfflineIndicator from '@/components/OfflineIndicator';
import { TabTransition } from '@/components/PageTransition';
import { Music, Lock, ListMusic, Sliders, Play, User, Shuffle } from 'lucide-react';
import { triggerHaptic } from '@/hooks/useHaptics';
import { usePremium } from '@/hooks/usePremium';
// LCP hero logo is served from /public so it can be preloaded in index.html
import { HomeSkeleton } from '@/components/PageSkeletons';

import SEOHead from '@/components/SEOHead';
import PullToRefreshIndicator from '@/components/PullToRefresh';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { useUserCountry } from '@/hooks/useUserCountry';
import { getCountryQueries } from '@/lib/countryQueries';



// Simple empty state
const EmptyState = memo(() => (
  <div className="text-center py-8">
    <div 
      className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-3"
      style={{
        background: 'linear-gradient(135deg, hsl(211 100% 50% / 0.2), hsl(328 100% 54% / 0.2))',
      }}
    >
      <Music className="w-8 h-8 text-muted-foreground" />
    </div>
    <h2 className="text-base font-semibold mb-1">No music yet</h2>
    <p className="text-muted-foreground text-xs px-4">
      Music will appear here once uploaded.
    </p>
  </div>
));

EmptyState.displayName = 'EmptyState';

// Tag flags used by the existing rails (Trending/Fresh) to filter the shared pool.
type FlaggedSong = Song & { show_in_trending?: boolean; show_in_new_releases?: boolean };

const upgradeThumb = (url?: string) => {
  if (!url) return undefined;
  if (url.includes('googleusercontent.com')) return url.replace(/=w\d+-h\d+[^&]*/i, '=w544-h544-l90-rj');
  return url.replace(/\/default\.jpg/i, '/hqdefault.jpg').replace(/\/mqdefault\.jpg/i, '/hqdefault.jpg');
};

// Session-stable rotation so the home hero isn't the identical song on every
// app open, while staying stable while the user scrolls.
const HOME_SEED = Math.floor(Math.random() * 100000);
function rotate<T>(arr: T[], seed = HOME_SEED): T[] {
  if (arr.length < 2) return arr;
  const k = seed % arr.length;
  return [...arr.slice(k), ...arr.slice(0, k)];
}

// Pull one fast real pool for the hero/bento: real YouTube Music charts for the
// user's country first (never keyword-search filler), search only as backup.
const fetchHomeSongs = async (heroQuery: string, country: string): Promise<FlaggedSong[]> => {
  const [charts, searched] = await Promise.all([
    getYouTubeMusicCharts(country || 'US', 40).catch(() => ({ top: [], trending: [], videos: [], country: 'US' })),
    searchYouTubeMusicTracks(heroQuery, 24).catch(() => []),
  ]);

  const byId = new Map<string, FlaggedSong>();
  const ingest = (list: { id: string; title?: string; artist?: string; album?: string; cover_url?: string; audio_url?: string; videoId?: string; duration?: number }[], flags: Partial<FlaggedSong>) => {
    for (const t of list) {
      if (!t.id || !t.title || !t.artist) continue;
      const existing = byId.get(t.id);
      if (existing) {
        byId.set(t.id, { ...existing, ...flags });
        continue;
      }
      byId.set(t.id, {
        id: t.id,
        title: t.title,
        artist: t.artist,
        album: t.album,
        cover_url: upgradeThumb(t.cover_url),
        audio_url: t.audio_url || (t.videoId ? `yt-video:${t.videoId}` : 'resolving'),
        duration: t.duration,
        created_at: new Date().toISOString(),
        ...flags,
      });
    }
  };

  ingest(rotate(charts.top), { show_in_trending: true });
  ingest(rotate(charts.trending), { show_in_trending: true });
  ingest(rotate(charts.videos), {});
  if (byId.size < 12) ingest(searched, { show_in_trending: true });

  return [...byId.values()];
};


const Home = () => {
  const { currentSong, playSong } = usePlayer();
  const { cachedSongs, updateCache } = useSongCache();
  const { isOffline, user } = useAuth();
  const { downloads } = useDownloads();
  const { isPremium } = usePremium();
  const [showEqPremium, setShowEqPremium] = useState(false);
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

  const [showLockScreen, setShowLockScreen] = useState(false);
  const [showSleepTimer, setShowSleepTimer] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [showEqualizer, setShowEqualizer] = useState(false);

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

  // The home feed is now sourced from YouTube Music — no Realtime postgres_changes
  // listener is needed. React Query handles refresh + pull-to-refresh handles manual.

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

  const jumpBackIn = useMemo<Song[]>(
    () => allSongs.filter((s) => s.cover_url && s.id !== heroSong?.id).slice(0, 10),
    [allSongs, heroSong],
  );

  const onRepeat = useMemo<Song[]>(
    () => allSongs.filter((s) => s.id !== heroSong?.id).slice(10, 15),
    [allSongs, heroSong],
  );


  const playHero = useCallback(() => {
    if (!heroSong) return;
    triggerHaptic('selection');
    playSong(heroSong, null, allSongs.slice(0, 40));
  }, [heroSong, playSong, allSongs]);

  const playTile = useCallback((song?: Song) => {
    if (!song) return;
    triggerHaptic('selection');
    playSong(song, null, allSongs.slice(0, 40));
  }, [playSong, allSongs]);

  return (
    <TabTransition>
      <div className="h-[100dvh] bg-background relative flex flex-col overflow-hidden">
        <SEOHead
          title="Univers Flow — Free Music Streaming & Playlists"
          description="Your personalized music feed: trending tracks, featured artists, smart mixes, and your now-playing card. Stream and download free."
          path="/home"
          jsonLdId="home-jsonld"
          jsonLd={{
            '@context': 'https://schema.org',
            '@type': 'CollectionPage',
            name: 'Univers Flow — Home',
            url: 'https://universflow.in/home',
            description: 'Personalized music feed with trending tracks, featured artists, and smart mixes.',
            isPartOf: { '@type': 'WebSite', name: 'Univers Flow', url: 'https://universflow.in' },
          }}
        />

        {/* ====== SOFT-UI HEADER ====== */}
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

          {/* Soft control cluster */}
          <div className="flex items-center gap-3 mt-4">
            {[
              { icon: ListMusic, action: () => setShowQueue(true), label: 'Queue' },
              { icon: Sliders, action: () => isPremium ? setShowEqualizer(true) : setShowEqPremium(true), label: 'Equalizer' },
              { icon: Lock, action: () => setShowLockScreen(true), label: 'Lockscreen' },
            ].map(({ icon: Icon, action, label }) => (
              <motion.button
                key={label}
                onClick={() => { triggerHaptic('selection'); action(); }}
                aria-label={label}
                whileTap={{ scale: 0.95 }}
                className="flex-1 h-11 rounded-2xl neu neu-press flex items-center justify-center gap-2"
              >
                <Icon className="w-[15px] h-[15px] text-foreground/70" />
                <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
              </motion.button>
            ))}
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
              {/* ====== EXTRUDED HERO PANEL ====== */}
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
                          Today's pick
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
                        <Play className="w-4 h-4 fill-current" /> PLAY
                      </button>
                      <button
                        onClick={() => {
                          const pool = allSongs.filter((s) => s.cover_url);
                          const pick = pool[Math.floor(Math.random() * pool.length)];
                          playTile(pick);
                        }}
                        aria-label="Shuffle play"
                        className="w-14 h-14 rounded-3xl neu neu-press flex items-center justify-center"
                      >
                        <Shuffle className="w-5 h-5 text-foreground/75" />
                      </button>
                    </div>
                  </div>
                </motion.section>
              )}

              {/* ====== JUMP BACK IN — soft cover pucks ====== */}
              {jumpBackIn.length > 0 && (
                <motion.section
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
                >
                  <div className="px-5 mb-4">
                    <h3 className="font-display text-2xl tracking-[0.06em] text-foreground uppercase">Jump back in</h3>
                  </div>
                  <div className="flex gap-5 overflow-x-auto hide-scrollbar px-5 pb-3 snap-x snap-mandatory">
                    {jumpBackIn.map((song) => (
                      <motion.button
                        key={song.id}
                        onClick={() => playTile(song)}
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
              )}

              {/* ====== ON REPEAT — carved list ====== */}
              {onRepeat.length > 0 && (
                <motion.section
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
                  className="px-5"
                >
                  <h3 className="font-display text-2xl tracking-[0.06em] text-foreground uppercase mb-4">On repeat</h3>
                  <div className="rounded-[30px] neu p-3 space-y-2">
                    {onRepeat.map((song, i) => (
                      <button
                        key={song.id}
                        onClick={() => playTile(song)}
                        className="w-full flex items-center gap-3 p-2.5 rounded-2xl neu-press text-left"
                      >
                        <span className="font-display text-lg text-muted-foreground w-5 tabular-nums text-center">{i + 1}</span>
                        <div className="w-12 h-12 rounded-2xl overflow-hidden neu-inset shrink-0">
                          {song.cover_url && <img src={song.cover_url} alt="" className="w-full h-full object-cover" loading="lazy" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-foreground truncate">{song.title}</p>
                          <p className="text-[10px] text-muted-foreground truncate uppercase tracking-[0.14em]">{song.artist}</p>
                        </div>
                        <span className="w-9 h-9 rounded-full neu-sm flex items-center justify-center shrink-0">
                          <Play className="w-3.5 h-3.5 text-primary fill-current" />
                        </span>
                      </button>
                    ))}
                  </div>
                </motion.section>
              )}

              {/* Existing rails */}
              <div className="px-5 space-y-8">
                {!isOffline && <HomeBento songs={allSongs} />}
                {!isOffline && <FreshReleasesSection songs={allSongs} enabled={homeReady} />}
                {!isOffline && <FollowedArtistSongsSection songs={allSongs} />}
                {!isOffline && <TrendingNowSection songs={allSongs} enabled={homeReady} />}
                {!isOffline && <FeaturedArtistsSection />}
                {!isOffline && <MadeForYouSection />}
                {!isOffline && <CountryViralSection />}

                {/* Saved songs only when offline */}
                {isOffline && allSongs.length > 0 && (
                  <AllSongsSection songs={allSongs} />
                )}
              </div>
            </div>
          )}
        </main>



        <BottomNav />
        {showLockScreen && <LockScreenPlayer isOpen={showLockScreen} onClose={() => setShowLockScreen(false)} />}
        {showSleepTimer && <SleepTimerModal isOpen={showSleepTimer} onClose={() => setShowSleepTimer(false)} />}
        {showQueue && <QueueDrawer isOpen={showQueue} onClose={() => setShowQueue(false)} />}
        {showEqualizer && isPremium && <EqualizerModal isOpen={showEqualizer} onClose={() => setShowEqualizer(false)} />}
        {showEqPremium && (
          <PremiumLockOverlay
            title="Studio Equalizer"
            description="Unlock live 10-band EQ, vocal and instrumental controls, bass, spatial sound, and studio spaces on every track."
            onClose={() => setShowEqPremium(false)}
          />
        )}
        <OfflineIndicator />
      </div>
    </TabTransition>
  );
};

export default Home;
