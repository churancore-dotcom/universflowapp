import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useNavigate, useSearchParams } from '@/lib/router-compat';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Music, Heart, ListMusic, Download, CloudOff, Trash2, User, Plus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { usePlayer, Song } from '@/contexts/PlayerContext';
import { useDownloads } from '@/contexts/DownloadContext';
import BottomNav from '@/components/BottomNav';
import CreatePlaylistModal from '@/components/CreatePlaylistModal';

// FollowedArtistSongsSection intentionally not imported — removed from Liked tab.
import LikeButton from '@/components/LikeButton';
import DownloadButton from '@/components/DownloadButton';
import { TabTransition } from '@/components/PageTransition';
import SEOHead from '@/components/SEOHead';
import RoseHero from '@/components/RoseHero';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LibrarySkeleton, LibraryArtistsSkeleton } from '@/components/PageSkeletons';
import VirtualList from '@/components/VirtualList';
import PlaylistCover from '@/components/PlaylistCover';
import { hydratePlaylistCoverUrls, loadLibrarySongs } from '@/lib/streamSongs';
import { getUserArtistPrefs, unfollowArtist } from '@/lib/userArtistPrefs';
import { Heart as HeartIcon } from 'lucide-react';
import { toast } from 'sonner';

const formatBytes = (bytes: number) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

type LibraryArtist = { id?: string; name: string; songCount: number; photoUrl: string | null; isFollowed?: boolean };

const fetchLibraryData = async (userId: string) => {
  const [likedSongsData, userPlaylists, followedArtists] = await Promise.all([
    loadLibrarySongs(userId),
    supabase
      .from('playlists')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false }),
    getUserArtistPrefs(userId, true),
  ]);

  const playlistsWithCovers = await hydratePlaylistCoverUrls(userPlaylists.data || []);

  return {
    likedSongs: likedSongsData,
    playlists: playlistsWithCovers,
    artists: followedArtists.map(a => ({
      name: a.artist_name,
      songCount: 0,
      photoUrl: a.artist_image,
      isFollowed: true,
    })) as LibraryArtist[],
  };
};

const LIBRARY_CACHE_KEY = 'library_cache_v1';

const readLibraryCache = (userId: string) => {
  try {
    const raw = localStorage.getItem(`${LIBRARY_CACHE_KEY}:${userId}`);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    return parsed?.data;
  } catch {
    return undefined;
  }
};

type LibraryData = Awaited<ReturnType<typeof fetchLibraryData>>;
type LibraryPlaylist = LibraryData['playlists'][number];

const writeLibraryCache = (userId: string, data: LibraryData) => {
  try {
    localStorage.setItem(`${LIBRARY_CACHE_KEY}:${userId}`, JSON.stringify({ data, ts: Date.now() }));
  } catch { /* ignore quota */ }
};

const Library = () => {
  const { user, isOffline } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { playSong, currentSong } = usePlayer();
  const { downloads, removeSong, getDownloadedUrl, totalStorageUsed, clearAllDownloads } = useDownloads();
  const requestedTab = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState(isOffline ? 'downloads' : (requestedTab || 'liked'));
  const [showCreatePlaylist, setShowCreatePlaylist] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  
  const libraryQueryKey = ['library', user?.id] as const;
  const initialCached = user ? readLibraryCache(user.id) : undefined;
  const { data, isLoading } = useQuery({
    queryKey: libraryQueryKey,
    queryFn: () => fetchLibraryData(user!.id),
    enabled: !!user && !isOffline,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    initialData: initialCached,
  });

  // Persist library result for instant offline boot
  useEffect(() => {
    if (user && data) writeLibraryCache(user.id, data);
  }, [user, data]);

  // If user goes offline, snap to downloads tab
  useEffect(() => {
    if (isOffline) setActiveTab('downloads');
  }, [isOffline]);

  useEffect(() => {
    const nextTab = searchParams.get('tab');
    if (!nextTab) return;
    if (['liked', 'artists', 'downloads', 'playlists'].includes(nextTab) && nextTab !== activeTab) {
      setActiveTab(nextTab);
    }
  }, [searchParams, activeTab]);

  const likedSongs = data?.likedSongs || [];
  const playlists = data?.playlists || [];
  const artists = data?.artists || [];
  const loading = isLoading && !data;

  // Refresh on tab visibility + whenever a like is toggled anywhere in the app
  useEffect(() => {
    const refetch = () => {
      if (user) queryClient.invalidateQueries({ queryKey: libraryQueryKey });
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refetch();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('uf:likes-changed', refetch);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('uf:likes-changed', refetch);
    };
  }, [user, queryClient]);

  const handleUnfollowArtist = async (name: string) => {
    if (!user) return;
    const ok = await unfollowArtist(user.id, name);
    if (ok) {
      queryClient.setQueryData<LibraryData>(libraryQueryKey, (prev) =>

        prev ? { ...prev, artists: prev.artists.filter((a: LibraryArtist) => a.name !== name) } : prev,
      );
      toast.success(`Unfollowed ${name}`);
    } else {
      toast.error('Could not unfollow');
    }
  };


  const handlePlaySong = (song: Song) => {
    const offlineUrl = getDownloadedUrl(song.id);
    const activeQueue = activeTab === 'downloads' ? downloads : likedSongs;
    playSong(song, offlineUrl, activeQueue.length > 0 ? activeQueue : [song]);
  };

  const SongRow = ({ song, index }: { song: Song; index: number }) => {
    const isActive = currentSong?.id === song.id;
    return (
      <motion.div
        className="flex items-center gap-2.5 p-2.5 rounded-xl"
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: index * 0.03 }}
        style={{
          background: isActive ? 'hsl(var(--primary) / 0.08)' : 'transparent',
        }}
      >
        <button className="flex-1 flex items-center gap-2.5 text-left min-w-0" onClick={() => handlePlaySong(song)}>
          <div
            className="w-11 h-11 rounded-xl flex items-center justify-center overflow-hidden flex-shrink-0"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '0.5px solid rgba(255,255,255,0.06)',
            }}
          >
            {song.cover_url ? (
              <img src={song.cover_url} alt={`${song.title} cover art`} className="w-full h-full object-cover" />
            ) : (
              <Music className="w-4 h-4 text-muted-foreground" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className={`font-semibold text-sm truncate ${isActive ? 'text-primary' : 'text-foreground'}`}>{song.title}</p>
            <p className="text-xs text-muted-foreground truncate">{song.artist}</p>
          </div>
        </button>
        <div className="flex items-center gap-0.5">
          {isActive ? (
            <div className="flex items-end gap-[2px] h-3 mr-1.5">
              {[0, 1, 2].map((i) => (
                <motion.div key={i} className="w-[2px] bg-primary rounded-full" animate={{ height: [4, 10, 4] }} transition={{ duration: 0.5, repeat: Infinity, delay: i * 0.12 }} />
              ))}
            </div>
          ) : (
            <>
              <LikeButton songId={song.id} size="sm" />
              <DownloadButton song={song} size="sm" />
            </>
          )}
        </div>
      </motion.div>
    );
  };

  const EmptyState = ({ icon: Icon, text }: { icon: React.ComponentType<{ className?: string }>; text: string }) => (
    <div className="text-center py-10">
      <div
        className="w-16 h-16 rounded-2xl mx-auto mb-3 flex items-center justify-center"
        style={{ background: 'rgba(255,255,255,0.04)', border: '0.5px solid rgba(255,255,255,0.06)' }}
      >
        <Icon className="w-7 h-7 text-muted-foreground/40" />
      </div>
      <p className="text-muted-foreground text-sm">{text}</p>
    </div>
  );

  return (
    <TabTransition>
      <div className="h-[100dvh] bg-background flex flex-col overflow-hidden relative">
        <SEOHead
          title="Your Library — Liked Songs & Playlists | Univers Flow"
          description="Your liked songs, downloads, followed artists, and personal playlists — all in one place on Univers Flow."
          path="/library"
          jsonLdId="library-jsonld"
          jsonLd={{
            '@context': 'https://schema.org',
            '@type': 'CollectionPage',
            name: 'Your Library — Univers Flow',
            url: 'https://universflow.in/library',
            isPartOf: { '@type': 'WebSite', name: 'Univers Flow', url: 'https://universflow.in' },
          }}
        />
        {/* Ambient background */}
        <div className="absolute inset-0 pointer-events-none">
          <div
            className="absolute inset-0"
            style={{
              background: `
                radial-gradient(ellipse 70% 40% at 20% 10%, hsl(350 100% 60% / 0.04), transparent),
                radial-gradient(ellipse 50% 30% at 80% 60%, hsl(260 100% 65% / 0.03), transparent)
              `,
            }}
          />
        </div>

        {/* Rose-ember hero — matches Home aesthetic */}
        <header className="flex-shrink-0 z-30 px-3 pt-3 pb-2 safe-area-pt">
          
          <RoseHero
            eyebrow="Universflow"
            title="YOUR LIBRARY"
            subtitle={
              <span>
                {likedSongs.length} liked · {downloads.length} downloads · {playlists.length} playlists
              </span>
            }
            coverUrl={likedSongs[0]?.cover_url || downloads[0]?.cover_url || playlists[0]?.cover_url || null}
          />
        </header>

        <main className="flex-1 overflow-hidden px-3 pt-2.5 flex flex-col relative z-10">
          <Tabs value={activeTab} onValueChange={(value) => { setActiveTab(value); setSearchParams({ tab: value }); }} className="flex-1 flex flex-col overflow-hidden">
            {/* Tabs — bento surface */}
            <TabsList
              className="w-full h-12 p-1 mb-3 rounded-3xl grid grid-cols-4 flex-shrink-0 bg-card border border-white/5"
            >
              {[
                { value: 'liked', icon: Heart, label: 'Liked' },
                { value: 'artists', icon: User, label: 'Artists' },
                { value: 'downloads', icon: Download, label: 'Saved' },
                { value: 'playlists', icon: ListMusic, label: 'Lists' },
              ].map((tab) => {
                const Icon = tab.icon;
                const disabled = isOffline && tab.value !== 'downloads';
                return (
                  <TabsTrigger
                    key={tab.value}
                    value={tab.value}
                    disabled={disabled}
                    className={`h-full rounded-2xl gap-1 text-[10px] font-bold data-[state=active]:bg-primary data-[state=active]:text-background flex flex-col items-center justify-center py-0.5 transition-all ${disabled ? 'opacity-30 pointer-events-none' : ''}`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{tab.label}</span>
                  </TabsTrigger>
                );
              })}
            </TabsList>

            {/* Content — scrollable */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto pb-32" style={{ WebkitOverflowScrolling: 'touch' }}>
              <TabsContent value="liked" className="mt-0 h-full">
                <h2 className="sr-only">Liked Songs</h2>
                {loading ? (
                  <LibrarySkeleton />
                ) : likedSongs.length === 0 ? (
                  <EmptyState icon={Heart} text="No liked songs yet" />
                ) : (
                  <VirtualList<Song>
                    items={likedSongs}
                    estimateSize={64}
                    gap={2}
                    scrollParentRef={scrollRef as any}
                    getKey={(song, i) => `${song.id}-${i}`}
                    renderItem={(song, i) => <SongRow song={song} index={i} />}
                  />
                )}
              </TabsContent>

              <TabsContent value="artists" className="mt-0">
                <h2 className="sr-only">Followed Artists</h2>
                {loading ? (
                  <LibraryArtistsSkeleton />
                ) : artists.length === 0 ? (
                  <div className="text-center py-10">
                    <div
                      className="w-16 h-16 rounded-2xl mx-auto mb-3 flex items-center justify-center"
                      style={{ background: 'rgba(255,255,255,0.04)', border: '0.5px solid rgba(255,255,255,0.06)' }}
                    >
                      <User className="w-7 h-7 text-muted-foreground/40" />
                    </div>
                    <p className="text-muted-foreground text-sm mb-3">No followed artists yet</p>
                    <button
                      onClick={() => navigate('/artists')}
                      className="px-4 py-2 rounded-full text-xs font-semibold bg-primary/15 text-primary"
                    >
                      Discover artists
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-3">
                    {artists.map((artist: LibraryArtist, i: number) => (
                      <motion.div
                        key={artist.name}
                        className="relative flex flex-col items-center p-3 rounded-2xl"
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: i * 0.05 }}
                        style={{
                          background: 'rgba(255,255,255,0.03)',
                          border: '0.5px solid rgba(255,255,255,0.06)',
                        }}
                      >
                        <button
                          className="flex flex-col items-center w-full active:scale-95 transition-transform"
                          onClick={() => navigate(`/artists?focus=${encodeURIComponent(artist.name)}`)}
                        >
                          <div
                            className="w-16 h-16 rounded-full flex items-center justify-center overflow-hidden mb-2"
                            style={{
                              background: 'linear-gradient(135deg, hsl(var(--primary) / 0.2), hsl(var(--accent) / 0.2))',
                              border: '1.5px solid rgba(255,255,255,0.08)',
                            }}
                          >
                            {artist.photoUrl ? (
                              <img src={artist.photoUrl} alt={`${artist.name} photo`} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                            ) : (
                              <User className="w-6 h-6 text-muted-foreground" />
                            )}
                          </div>
                          <p className="text-xs font-medium text-center truncate w-full">{artist.name}</p>
                        </button>
                        <button
                          aria-label={`Unfollow ${artist.name}`}
                          onClick={(e) => { e.stopPropagation(); handleUnfollowArtist(artist.name); }}
                          className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-primary flex items-center justify-center shadow-lg"
                        >
                          <HeartIcon className="w-3 h-3 text-primary-foreground" fill="currentColor" />
                        </button>
                      </motion.div>
                    ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="downloads" className="mt-0">
                <h2 className="sr-only">Saved Downloads</h2>
                {downloads.length === 0 ? (
                  <div className="space-y-3">
                    <EmptyState icon={CloudOff} text="No downloads yet" />
                    <button
                      onClick={() => navigate('/downloads')}
                      className="w-full py-3 rounded-xl text-xs font-semibold text-primary"
                      style={{ background: 'hsl(var(--primary) / 0.1)' }}
                    >
                      Open Downloads Manager
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    <div
                      className="flex items-center justify-between p-3.5 rounded-xl"
                      style={{
                        background: 'rgba(255,255,255,0.03)',
                        border: '0.5px solid rgba(255,255,255,0.06)',
                      }}
                    >
                      <div>
                        <p className="text-xs font-semibold">{downloads.length} songs</p>
                        <p className="text-[10px] text-muted-foreground">{formatBytes(totalStorageUsed)}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold text-primary"
                          style={{ background: 'hsl(var(--primary) / 0.12)' }}
                          onClick={() => navigate('/downloads')}
                        >
                          Manage
                        </button>
                        <button
                          className="px-3 py-1.5 rounded-lg text-xs font-medium text-destructive"
                          style={{ background: 'hsl(var(--destructive) / 0.1)' }}
                          onClick={clearAllDownloads}
                        >
                          Clear All
                        </button>
                      </div>
                    </div>
                    <div className="space-y-0.5">
                      {downloads.map((song, i) => (
                        <motion.div
                          key={`dl-${song.id}-${i}`}
                          className="flex items-center gap-2.5 p-2.5 rounded-xl"
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.03 }}
                          style={{
                            background: currentSong?.id === song.id ? 'hsl(var(--primary) / 0.08)' : 'transparent',
                          }}
                        >
                          <button className="flex-1 flex items-center gap-2.5 text-left" onClick={() => handlePlaySong(song)}>
                            <div className="relative w-11 h-11 rounded-xl flex items-center justify-center overflow-hidden"
                              style={{ background: 'rgba(255,255,255,0.04)', border: '0.5px solid rgba(255,255,255,0.06)' }}
                            >
                              {song.cover_url ? <img src={song.cover_url} alt={`${song.title} cover art`} className="w-full h-full object-cover" /> : <Music className="w-4 h-4 text-muted-foreground" />}
                              <div className="absolute bottom-0.5 right-0.5 w-3.5 h-3.5 rounded-full bg-primary flex items-center justify-center">
                                <CloudOff className="w-2 h-2 text-primary-foreground" />
                              </div>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className={`font-semibold text-sm truncate ${currentSong?.id === song.id ? 'text-primary' : 'text-foreground'}`}>{song.title}</p>
                              <p className="text-xs text-muted-foreground truncate">{song.artist}</p>
                            </div>
                          </button>
                          <button className="p-2 text-muted-foreground active:scale-90 transition-transform" onClick={() => removeSong(song.id)}>
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="playlists" className="mt-0">
                <h2 className="sr-only">Your Playlists</h2>
                <div className="mb-3">
                  <motion.button
                    className="w-full flex items-center gap-3 p-3.5 rounded-xl"
                    style={{
                      background: 'rgba(255,255,255,0.03)',
                      border: '0.5px solid rgba(255,255,255,0.06)',
                    }}
                    onClick={() => setShowCreatePlaylist(true)}
                    whileTap={{ scale: 0.97 }}
                  >
                    <div
                      className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ background: 'hsl(var(--primary) / 0.15)' }}
                    >
                      <Plus className="w-5 h-5 text-primary" />
                    </div>
                    <span className="text-sm font-semibold text-left leading-tight">Create Playlist</span>
                  </motion.button>
                </div>

                {playlists.length === 0 ? (
                  <div className="text-center py-6">
                    <p className="text-muted-foreground text-xs">No playlists yet</p>
                  </div>
                ) : (
                  <div className="space-y-0.5">
                    {playlists.map((playlist: LibraryPlaylist, i: number) => (
                      <motion.div
                        key={playlist.id}
                        className="w-full flex items-center gap-2.5 p-2.5 rounded-xl active:scale-[0.98] transition-transform"
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.05 }}
                      >
                        <button
                          className="flex-1 flex items-center gap-2.5 text-left min-w-0"
                          onClick={() => navigate(`/playlist/${playlist.id}`)}
                        >
                          <PlaylistCover
                            coverUrl={playlist.cover_url}
                            coverUrls={(playlist as LibraryPlaylist & { cover_urls?: string[] }).cover_urls}
                            className="w-11 h-11 flex-shrink-0"
                            rounded="rounded-xl"
                            iconClassName="w-4 h-4 text-muted-foreground"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-sm truncate">{playlist.title}</p>
                            <p className="text-xs text-muted-foreground">Playlist</p>
                          </div>
                        </button>
                        {user && (playlist as LibraryPlaylist & { user_id?: string }).user_id === user.id && (
                          <button
                            aria-label={`Delete ${playlist.title}`}
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (!window.confirm(`Delete "${playlist.title}"? This cannot be undone.`)) return;
                              const { error } = await supabase.from('playlists').delete().eq('id', playlist.id).eq('user_id', user.id);
                              if (error) { toast.error('Could not delete playlist'); return; }
                              queryClient.setQueryData<LibraryData>(libraryQueryKey, (prev) =>
                                prev ? { ...prev, playlists: prev.playlists.filter((p) => p.id !== playlist.id) } : prev,
                              );
                              toast.success('Playlist deleted');
                            }}
                            className="w-9 h-9 rounded-full flex items-center justify-center text-destructive flex-shrink-0"
                            style={{ background: 'hsl(var(--destructive) / 0.12)' }}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </motion.div>
                    ))}
                  </div>
                )}
              </TabsContent>
            </div>
          </Tabs>
        </main>

        <BottomNav />
        {showCreatePlaylist && <CreatePlaylistModal isOpen={showCreatePlaylist} onClose={() => setShowCreatePlaylist(false)} onCreated={() => queryClient.invalidateQueries({ queryKey: libraryQueryKey })} />}
        
      </div>
    </TabTransition>
  );
};

export default Library;
