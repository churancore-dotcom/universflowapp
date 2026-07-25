import React, { useEffect, useState, useCallback, useMemo, memo } from 'react';
import { motion } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Song, usePlayer } from '@/contexts/PlayerContext';
import { useSongCache } from '@/hooks/useSongCache';
import { useAuth } from '@/contexts/AuthContext';
import { useDownloads } from '@/contexts/DownloadContext';
import { searchYouTubeMusicTracks } from '@/lib/musicIndexer';
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
import OfflineIndicator from '@/components/OfflineIndicator';
import { TabTransition } from '@/components/PageTransition';
import { Music, Lock, ListMusic, Sliders } from 'lucide-react';
import { triggerHaptic } from '@/hooks/useHaptics';
import { usePremium } from '@/hooks/usePremium';
import appLogo from '@/assets/app-logo.webp';
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

// Pull one fast real YouTube Music pool for the hero/bento. Query is
// country-aware so a US user never sees a Bollywood hero on first launch.
const fetchHomeSongs = async (heroQuery: string): Promise<FlaggedSong[]> => {
  const trending = await searchYouTubeMusicTracks(heroQuery, 24);

  const byId = new Map<string, FlaggedSong>();
  const ingest = (list: typeof trending, flags: Partial<FlaggedSong>) => {
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

  ingest(trending, { show_in_trending: true });

  return [...byId.values()];
};

const Home = () => {
  const { currentSong, playSong } = usePlayer();
  const { cachedSongs, updateCache } = useSongCache();
  const { isOffline, user } = useAuth();
  const { downloads } = useDownloads();
  const { isPremium } = usePremium();
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
    queryFn: () => fetchHomeSongs(countryQueries.hero),
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

  const greeting = useCallback(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  }, []);

  // Pull-to-refresh — re-fetches home feed on overscroll
  const pullToRefresh = usePullToRefresh({
    onRefresh: async () => {
      triggerHaptic('impactMedium');
      await queryClient.invalidateQueries({ queryKey: ['home', 'ytm-feed', 'v3-country', country || 'GLOBAL'] });
      await queryClient.refetchQueries({ queryKey: ['home', 'ytm-feed', 'v3-country', country || 'GLOBAL'] });

    },
  });

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
        
        {/* Ambient background — cinematic */}
        <div className="absolute inset-0 pointer-events-none">
          <div 
            className="absolute inset-0"
            style={{
              background: `
                radial-gradient(ellipse 80% 50% at 50% 0%, hsl(350 100% 60% / 0.08), transparent),
                radial-gradient(ellipse 60% 40% at 80% 20%, hsl(280 100% 65% / 0.05), transparent),
                radial-gradient(ellipse 40% 30% at 10% 60%, hsl(210 100% 60% / 0.04), transparent)
              `,
            }}
          />
        </div>

        {/* Premium Header */}
        <header
          className="flex-shrink-0 z-30 px-4 pt-3 pb-3 safe-area-pt"
          style={{
            background: 'rgba(0, 0, 0, 0.7)',
            backdropFilter: 'blur(40px) saturate(180%)',
            WebkitBackdropFilter: 'blur(40px) saturate(180%)',
            borderBottom: '0.5px solid rgba(255, 255, 255, 0.06)',
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-full overflow-hidden flex-shrink-0"
                style={{
                  boxShadow: '0 2px 12px hsl(var(--primary) / 0.25)',
                  border: '1.5px solid hsl(var(--primary) / 0.3)',
                }}
              >
                <img src={appLogo} alt="Universflow app logo" width={40} height={40} {...({ fetchpriority: "high" } as React.ImgHTMLAttributes<HTMLImageElement>)} decoding="async" className="w-full h-full rounded-full object-cover" />
              </div>
              <div>
                <p className="text-[19px] leading-none text-foreground font-extrabold tracking-tight">
                  {greeting()}
                </p>
                <p className="text-[10px] text-[#FFB199]/70 font-bold tracking-[0.2em] uppercase mt-1">
                  Universflow
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-1.5">
              {[
                { icon: ListMusic, action: () => setShowQueue(true), label: 'Open queue' },
                ...(isPremium ? [{ icon: Sliders, action: () => setShowEqualizer(true), label: 'Open equalizer' }] : []),
                { icon: Lock, action: () => setShowLockScreen(true), label: 'Open lock screen player' },
              ].map(({ icon: Icon, action, label }, i) => (
                <motion.button
                  key={i}
                  onClick={() => { triggerHaptic('selection'); action(); }}
                  aria-label={label}
                  className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{
                    background: 'rgba(255,255,255,0.06)',
                    border: '0.5px solid rgba(255,255,255,0.10)',
                  }}
                  whileTap={{ scale: 0.85 }}
                >
                  <Icon className="w-4 h-4 text-foreground/60" />
                </motion.button>
              ))}
            </div>
          </div>
        </header>

        {/* Scrollable content area */}
        <main 
          className="flex-1 overflow-y-auto overflow-x-hidden px-3 pt-4 pb-36 relative z-10"
          style={{ WebkitOverflowScrolling: 'touch' }}
          {...pullToRefresh.handlers}
        >
        <h2 className="px-1 pt-1 pb-2 text-[13px] font-medium text-muted-foreground/80 tracking-tight">
          Universflow — Stream and download free music
        </h2>
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
            <div className="space-y-3">
              {/* New Bento Hero — Continue Listening + quick tiles */}
              {!isOffline && <HomeBento songs={allSongs} />}





              {!isOffline && <FreshReleasesSection songs={allSongs} enabled={homeReady} />}
              {/* Followed artists rail — restored above Trending */}
              {!isOffline && <FollowedArtistSongsSection songs={allSongs} />}
              {!isOffline && <TrendingNowSection songs={allSongs} enabled={homeReady} />}
              {/* Discovery — Featured Artists */}
              {!isOffline && <FeaturedArtistsSection />}
              {!isOffline && <MadeForYouSection />}
              {/* Viral Now Rail — live country chart, real data */}
              {!isOffline && <CountryViralSection />}

              {/* Saved songs only when offline — uploaded catalog is hidden from online Home */}
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
        <OfflineIndicator />
      </div>
    </TabTransition>
  );
};

export default Home;
