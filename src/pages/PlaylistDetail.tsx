import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useParams, useNavigate } from '@/lib/router-compat';
import { 
  ChevronLeft, Play, Pause, Shuffle, Music, 
  Plus, Trash2, Edit2, Lock, Globe, Loader2, ListPlus
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { usePlayer, Song } from '@/contexts/PlayerContext';
import { useDownloads } from '@/contexts/DownloadContext';
import BottomNav from '@/components/BottomNav';
import LikeButton from '@/components/LikeButton';
import DownloadButton from '@/components/DownloadButton';
import DownloadAllButton from '@/components/DownloadAllButton';
import AddSongsToPlaylistModal from '@/components/AddSongsToPlaylistModal';
import { TabTransition } from '@/components/PageTransition';
import { Button } from '@/components/ui/button';
import { iosSpring, iosBounce } from '@/lib/animations';
import { toast } from 'sonner';
import { hydratePlaylistCoverUrls, loadPlaylistSongs } from '@/lib/streamSongs';
import PlaylistCover from '@/components/PlaylistCover';
import SEOHead from '@/components/SEOHead';
import RoseHero from '@/components/RoseHero';

interface Playlist {
  id: string;
  title: string;
  description: string | null;
  cover_url: string | null;
  is_public: boolean;
  user_id: string;
}

interface PlaylistSong extends Song {
  position: number;
  playlist_song_id: string;
}

const PlaylistDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { playSong, currentSong, isPlaying, setQueue } = usePlayer();
  const { getDownloadedUrl } = useDownloads();
  
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [songs, setSongs] = useState<PlaylistSong[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddSongs, setShowAddSongs] = useState(false);
  const [removingSongId, setRemovingSongId] = useState<string | null>(null);

  const isOwner = playlist?.user_id === user?.id;

  useEffect(() => {
    if (id) {
      fetchPlaylist();
    }
  }, [id]);

  const fetchPlaylist = async () => {
    if (!id) return;

    const [playlistRes, songsData] = await Promise.all([
      supabase
        .from('playlists')
        .select('*')
        .eq('id', id)
        .single(),
      loadPlaylistSongs(id),
    ]);

    if (playlistRes.data) {
      const [playlistWithCover] = await hydratePlaylistCoverUrls([playlistRes.data]);
      setPlaylist(playlistWithCover as any);
    }

    setSongs(songsData as PlaylistSong[]);

    setLoading(false);
  };

  const handlePlayAll = () => {
    if (songs.length === 0) return;
    const songsForQueue = songs.map(s => ({
      id: s.id,
      title: s.title,
      artist: s.artist,
      album: s.album,
      cover_url: s.cover_url,
      audio_url: s.audio_url,
      duration: s.duration,
    }));
    setQueue(songsForQueue);
    const offlineUrl = getDownloadedUrl(songs[0].id);
    playSong(songsForQueue[0], offlineUrl, songsForQueue);
  };

  const handleShufflePlay = () => {
    if (songs.length === 0) return;
    const shuffled = [...songs].sort(() => Math.random() - 0.5);
    const songsForQueue = shuffled.map(s => ({
      id: s.id,
      title: s.title,
      artist: s.artist,
      album: s.album,
      cover_url: s.cover_url,
      audio_url: s.audio_url,
      duration: s.duration,
    }));
    setQueue(songsForQueue);
    const offlineUrl = getDownloadedUrl(shuffled[0].id);
    playSong(songsForQueue[0], offlineUrl, songsForQueue);
  };

  const handlePlaySong = (song: PlaylistSong) => {
    const offlineUrl = getDownloadedUrl(song.id);
    playSong(song, offlineUrl, songs);
  };

  const handleRemoveSong = async (playlistSongId: string) => {
    setRemovingSongId(playlistSongId);
    
    const { error } = await supabase
      .from('playlist_songs')
      .delete()
      .eq('id', playlistSongId);

    if (error) {
      console.error('Error removing song:', error);
      toast.error('Failed to remove song');
    } else {
      setSongs(prev => prev.filter(s => s.playlist_song_id !== playlistSongId));
      toast.success('Song removed from playlist');
    }

    setRemovingSongId(null);
  };

  const handleSongsAdded = () => {
    fetchPlaylist();
    setShowAddSongs(false);
  };

  const totalDuration = songs.reduce((acc, song) => acc + (song.duration || 0), 0);
  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (hours > 0) return `${hours} hr ${mins} min`;
    return `${mins} min`;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <motion.div
          className="w-10 h-10 rounded-full border-2 border-primary border-t-transparent"
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
        />
      </div>
    );
  }

  if (!playlist) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center">
        <Music className="w-16 h-16 text-muted-foreground/50 mb-4" />
        <p className="text-muted-foreground">Playlist not found</p>
        <Button
          variant="ghost"
          className="mt-4"
          onClick={() => navigate('/library')}
        >
          Go Back
        </Button>
      </div>
    );
  }

  return (
    <TabTransition>
      <motion.div 
        className="min-h-screen bg-black pb-44"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        <SEOHead
          title={`${playlist.title} — Playlist on Univers Flow`}
          description={playlist.description?.slice(0, 155) || `Listen to "${playlist.title}" — a ${songs.length}-song playlist on Univers Flow.`}
          image={playlist.cover_url || undefined}
          path={`/playlist/${playlist.id}`}
          type="music.playlist"
          jsonLdId="playlist-jsonld"
          jsonLd={[
            {
              '@context': 'https://schema.org',
              '@type': 'MusicPlaylist',
              '@id': `https://universflow.in/playlist/${playlist.id}#playlist`,
              name: playlist.title,
              url: `https://universflow.in/playlist/${playlist.id}`,
              ...(playlist.description ? { description: playlist.description } : {}),
              ...(playlist.cover_url ? { image: playlist.cover_url } : {}),
              numTracks: songs.length,
              track: songs.slice(0, 50).map((s) => ({
                '@type': 'MusicRecording',
                name: s.title,
                ...(s.artist ? { byArtist: { '@type': 'MusicGroup', name: s.artist } } : {}),
                ...(s.album ? { inAlbum: { '@type': 'MusicAlbum', name: s.album } } : {}),
                ...(s.duration ? { duration: `PT${Math.floor(s.duration / 60)}M${s.duration % 60}S` } : {}),
              })),
            },
            {
              '@context': 'https://schema.org',
              '@type': 'BreadcrumbList',
              itemListElement: [
                { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://universflow.in/' },
                { '@type': 'ListItem', position: 2, name: 'Library', item: 'https://universflow.in/library' },
                { '@type': 'ListItem', position: 3, name: playlist.title, item: `https://universflow.in/playlist/${playlist.id}` },
              ],
            },
          ]}
        />
        {/* Header with back button */}
        <motion.header
          className="sticky top-0 z-30 px-4 py-3 safe-area-pt flex items-center gap-3"
          style={{
            background: 'rgba(0, 0, 0, 0.85)',
            backdropFilter: 'blur(40px) saturate(180%)',
            WebkitBackdropFilter: 'blur(40px) saturate(180%)',
          }}
          initial={{ opacity: 0, y: -30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={iosSpring}
        >
          <motion.button
            onClick={() => navigate(-1)}
            aria-label="Go back"
            className="p-2 -ml-2 rounded-full hover:bg-white/10 transition-colors"
            whileTap={{ scale: 0.9 }}
          >
            <ChevronLeft className="w-6 h-6" />
          </motion.button>
          <div className="flex-1 min-w-0">
            <p className="font-semibold truncate">{playlist.title}</p>
          </div>
        </motion.header>

        {/* Rose-ember hero — playlist identity */}
        <div className="px-3 pt-3 pb-2">
          <RoseHero
            eyebrow={playlist.is_public ? 'Public playlist' : 'Private playlist'}
            title={(playlist.title || 'PLAYLIST').toUpperCase()}
            subtitle={
              <span>
                {songs.length} songs{totalDuration > 0 ? ` · ${formatDuration(totalDuration)}` : ''}
                {playlist.description ? ` · ${playlist.description}` : ''}
              </span>
            }
            coverUrl={playlist.cover_url || songs.find((s) => s.cover_url)?.cover_url || null}
          />
        </div>

        {/* Spacer (preserves layout) */}
        <div className="px-6 pt-2">


          {/* Action buttons */}
          <motion.div
            className="flex items-center justify-center gap-4 mt-6 rounded-3xl bg-card border border-white/5 p-3"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...iosSpring, delay: 0.2 }}
          >
            <motion.button
              onClick={handleShufflePlay}
              aria-label="Shuffle play"
              className="p-3 rounded-full bg-white/10"
              whileTap={{ scale: 0.9 }}
              disabled={songs.length === 0}
            >
              <Shuffle className="w-5 h-5" />
            </motion.button>
            <motion.button
              onClick={handlePlayAll}
              aria-label="Play all"
              className="w-14 h-14 rounded-full uf-rose-gradient flex items-center justify-center"
              whileTap={{ scale: 0.9 }}
              disabled={songs.length === 0}
            >
              <Play className="w-7 h-7 text-black ml-1" fill="currentColor" />
            </motion.button>
            {songs.length > 0 && (
              <DownloadAllButton songs={songs} />
            )}
          </motion.div>

          {/* Add songs button for owner */}
          {isOwner && (
            <motion.button
              onClick={() => setShowAddSongs(true)}
              className="w-full mt-6 py-3 rounded-3xl bg-card border border-white/5 flex items-center justify-center gap-2 font-bold text-primary"
              whileTap={{ scale: 0.98 }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
            >
              <Plus className="w-5 h-5" />
              Add Songs
            </motion.button>
          )}
        </div>

        {/* Songs list */}
        <div className="px-4">
          {songs.length === 0 ? (
            <motion.div
              className="text-center py-12"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <ListPlus className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" />
              <p className="text-muted-foreground">No songs in this playlist</p>
              {isOwner && (
                <motion.button
                  onClick={() => setShowAddSongs(true)}
                  className="mt-4 px-6 py-2 rounded-full bg-primary text-primary-foreground font-medium"
                  whileTap={{ scale: 0.95 }}
                >
                  Add Songs
                </motion.button>
              )}
            </motion.div>
          ) : (
            <div className="space-y-1">
              {songs.map((song, index) => {
                const isActive = currentSong?.id === song.id;
                const isRemoving = removingSongId === song.playlist_song_id;

                return (
                  <motion.div
                    key={song.playlist_song_id}
                    className={`flex items-center gap-3 p-3 rounded-3xl transition-all ${
                      isActive ? 'bg-primary/10' : 'bg-card/40 active:bg-white/5'
                    } ${isRemoving ? 'opacity-50' : ''}`}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ ...iosSpring, delay: index * 0.02 }}
                  >
                    <span className="w-6 text-center text-sm text-muted-foreground">
                      {index + 1}
                    </span>
                    
                    <motion.button
                      className="flex-1 flex items-center gap-3 text-left min-w-0"
                      onClick={() => handlePlaySong(song)}
                      whileTap={{ scale: 0.98 }}
                      disabled={isRemoving}
                    >
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary/30 to-accent/30 flex items-center justify-center overflow-hidden flex-shrink-0 shadow-lg">
                        {song.cover_url ? (
                          <img src={song.cover_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full bg-gradient-to-br from-primary/20 to-accent/20" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`font-medium text-[15px] truncate ${isActive ? 'text-primary' : ''}`}>
                          {song.title}
                        </p>
                        <p className="text-[13px] text-muted-foreground truncate">{song.artist}</p>
                      </div>
                    </motion.button>
                    
                    {/* Action buttons */}
                    <div className="flex items-center gap-1">
                      {isActive && isPlaying ? (
                        <div className="flex items-end gap-[3px] h-4 mr-2">
                          {[...Array(3)].map((_, i) => (
                            <motion.div
                              key={i}
                              className="w-[3px] bg-primary rounded-full"
                              animate={{ height: [5, 14, 5] }}
                              transition={{ duration: 0.5, repeat: Infinity, delay: i * 0.12, ease: "easeInOut" }}
                            />
                          ))}
                        </div>
                      ) : (
                        <>
                          <LikeButton songId={song.id} size="sm" />
                          <DownloadButton song={song} size="sm" />
                          {isOwner && (
                            <motion.button
                              className="p-2 rounded-full text-muted-foreground hover:text-destructive transition-colors"
                              onClick={() => handleRemoveSong(song.playlist_song_id)}
                              aria-label={`Remove ${song.title} from playlist`}
                              whileTap={{ scale: 0.9 }}
                              disabled={isRemoving}
                            >
                              {isRemoving ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Trash2 className="w-4 h-4" />
                              )}
                            </motion.button>
                          )}
                        </>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>

        <BottomNav />

        {/* Add songs modal */}
        <AddSongsToPlaylistModal
          isOpen={showAddSongs}
          onClose={() => setShowAddSongs(false)}
          playlistId={id || ''}
          existingSongIds={songs.map(s => s.id)}
          onSongsAdded={handleSongsAdded}
        />
      </motion.div>
    </TabTransition>
  );
};

export default PlaylistDetail;