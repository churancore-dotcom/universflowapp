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
import { Music, Lock, ListMusic, Sliders, Play, User } from 'lucide-react';
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

  const quickTiles = useMemo(() => {
    const tiles: { title: string; subtitle: string; cover?: string; song?: Song; gradient: string }[] = [];
    const first = allSongs.find((s) => s.cover_url);
    const second = allSongs.filter((s) => s.cover_url && s.id !== first?.id)[0];
    if (first) {
      tiles.push({
        title: first.title,
        subtitle: first.artist,
        cover: first.cover_url,
        song: first,
        gradient: 'from-rose-500/20 to-transparent',
      });
    }
    if (second) {
      tiles.push({
        title: second.title,
        subtitle: second.artist,
        cover: second.cover_url,
        song: second,
        gradient: 'from-violet-500/20 to-transparent',
      });
    }
    return tiles;
  }, [allSongs]);

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

        {/* Ethereal ambient orbs */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="ethereal-orb ethereal-orb-rose" />
          <div className="ethereal-orb ethereal-orb-violet" />
          <div className="ethereal-orb ethereal-orb-peach" />
        </div>

        {/* Ethereal Header */}
        <header className="flex-shrink-0 z-30 px-6 pt-4 pb-3 safe-area-pt">
          <div className="flex items-center justify-between">
            <div className="text-[26px] font-semibold tracking-tighter text-foreground">
              Univers<span className="text-primary">.</span>
            </div>
            <motion.button
              onClick={() => { triggerHaptic('selection'); window.location.href = '/profile'; }}
              aria-label="Open profile"
              className="w-10 h-10 rounded-full p-[1.5px] bg-gradient-to-tr from-primary to-primary/60 overflow-hidden"
              whileTap={{ scale: 0.92 }}
            >
              <div className="w-full h-full rounded-full bg-background overflow-hidden flex items-center justify-center">
                {userAvatar ? (
                  <img src={userAvatar} alt="Profile" className="w-full h-full object-cover" />
                ) : (
                  <User className="w-5 h-5 text-muted-foreground" />
                )}
              </div>
            </motion.button>
          </div>
        </header>

        {/* Scrollable content area */}
        <main 
          className="flex-1 overflow-y-auto overflow-x-hidden px-5 pt-2 pb-40 relative z-10"
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
            <HomeSkeleton />
          ) : isOffline && songs.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="space-y-6">
              {/* ====== ETHEREAL FEATURED CARD ====== */}
              {heroSong && (
                <motion.section
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                  className="relative group"
                >
                  <div className="absolute -inset-0.5 rounded-[32px] bg-gradient-to-b from-white/20 to-transparent blur-sm opacity-50" />
                  <button
                    onClick={playHero}
                    className="relative w-full h-80 rounded-[30px] overflow-hidden text-left block active:scale-[0.985] transition-transform ethereal-glass iridescent-rim border border-white/10"
                  >
                    {heroSong.cover_url && (
                      <>
                        <img
                          src={heroSong.cover_url}
                          alt=""
                          className="absolute inset-0 w-full h-full object-cover opacity-70"
                          loading="eager"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />
                      </>
                    )}
                    <div className="absolute top-5 left-5 z-20">
                      <span className="px-3 py-1.5 rounded-full bg-white/10 backdrop-blur-md border border-white/20 text-[10px] uppercase tracking-[0.18em] text-white/90 font-semibold">
                        Exclusively For You
                      </span>
                    </div>
                    <div className="absolute bottom-7 left-6 right-6 z-20">
                      <h2 className="text-[32px] font-light text-white leading-[1.05]">
                        {heroSong.title.split(' ').slice(0, 2).join(' ')}
                        <br />
                        <span className="font-semibold">{heroSong.title.split(' ').slice(2, 4).join(' ') || 'Echoes'}</span>
                      </h2>
                      <p className="text-white/50 text-sm mt-2">{heroSong.artist}</p>
                      <div className="mt-4 flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center shadow-lg">
                          <Play className="w-4 h-4 text-white fill-white ml-0.5" />
                        </div>
                        <span className="text-white/80 text-sm font-medium">Listen now</span>
                      </div>
                    </div>
                  </button>
                </motion.section>
              )}

              {/* ====== QUICK SELECT GRID ====== */}
              {quickTiles.length > 0 && (
                <motion.section
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
                  className="space-y-3"
                >
                  <div className="flex justify-between items-end px-1">
                    <h3 className="text-lg font-medium text-foreground/90">Recent Vibes</h3>
                    <span className="text-xs text-primary font-semibold tracking-wide">VIEW ALL</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    {quickTiles.map((tile, idx) => (
                      <motion.button
                        key={tile.title + idx}
                        onClick={() => playTile(tile.song)}
                        whileTap={{ scale: 0.96 }}
                        className="aspect-square rounded-2xl bg-card border border-white/5 p-4 flex flex-col justify-end relative overflow-hidden text-left"
                      >
                        <div className={`absolute inset-0 bg-gradient-to-br ${tile.gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                        <div className="w-10 h-10 rounded-full bg-white/10 backdrop-blur-lg border border-white/20 mb-3 flex items-center justify-center relative z-10">
                          <Play className="w-4 h-4 text-white fill-white ml-0.5" />
                        </div>
                        <p className="text-sm text-white font-medium relative z-10 truncate">{tile.title}</p>
                        <p className="text-[10px] text-white/40 uppercase tracking-tighter relative z-10 truncate">{tile.subtitle}</p>
                      </motion.button>
                    ))}
                  </div>
                </motion.section>
              )}

              {/* Existing bento + rails, now with ethereal spacing */}
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
