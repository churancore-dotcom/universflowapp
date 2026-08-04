import { useState, useEffect } from 'react';
import { useParams, useNavigate } from '@/lib/router-compat';
import { motion } from 'framer-motion';
import { ArrowLeft, Play, Shuffle, Music, User } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { usePlayer, Song } from '@/contexts/PlayerContext';
import { useDownloads } from '@/contexts/DownloadContext';
import BottomNav from '@/components/BottomNav';
import LikeButton from '@/components/LikeButton';
import DownloadButton from '@/components/DownloadButton';
import FollowArtistButton from '@/components/FollowArtistButton';
import { TabTransition } from '@/components/PageTransition';
import SEOHead from '@/components/SEOHead';
import { iosSpring, iosBounce } from '@/lib/animations';

interface Artist {
  id: string;
  name: string;
  bio: string | null;
  photo_url: string | null;
  genre: string | null;
}

const ArtistDetail = () => {
  const { artistId } = useParams<{ artistId: string }>();
  const navigate = useNavigate();
  const { playSong, setQueue, currentSong, isPlaying } = usePlayer();
  const { getDownloadedUrl } = useDownloads();
  const [artist, setArtist] = useState<Artist | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (artistId) {
      fetchArtistData();
    }
  }, [artistId]);

  const fetchArtistData = async () => {
    if (!artistId) return;

    setLoading(true);
    
    // Fetch artist info
    const { data: artistData } = await supabase
      .from('artists')
      .select('*')
      .eq('id', artistId)
      .single();

    if (artistData) {
      setArtist(artistData);
    }

    // Fetch songs linked to this artist via artist_id
    const { data: songsData } = await supabase
      .from('songs')
      .select('*')
      .eq('artist_id', artistId)
      .eq('is_visible', true)
      .order('created_at', { ascending: false });

    if (songsData) {
      const mappedSongs: Song[] = songsData.map(s => ({
        id: s.id,
        title: s.title,
        artist: s.artist,
        album: s.album || undefined,
        cover_url: s.cover_url || undefined,
        audio_url: s.audio_url,
        duration: s.duration || undefined,
      }));
      setSongs(mappedSongs);
    }
    
    setLoading(false);
  };

  const handlePlayAll = () => {
    if (songs.length === 0) return;
    setQueue(songs);
    const offlineUrl = getDownloadedUrl(songs[0].id);
    playSong(songs[0], offlineUrl, songs);
  };

  const handleShufflePlay = () => {
    if (songs.length === 0) return;
    const shuffled = [...songs].sort(() => Math.random() - 0.5);
    setQueue(shuffled);
    const offlineUrl = getDownloadedUrl(shuffled[0].id);
    playSong(shuffled[0], offlineUrl, shuffled);
  };

  const handlePlaySong = (song: Song, index: number) => {
    const reorderedQueue = [...songs.slice(index), ...songs.slice(0, index)];
    setQueue(reorderedQueue);
    const offlineUrl = getDownloadedUrl(song.id);
    playSong(song, offlineUrl, reorderedQueue);
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const totalDuration = songs.reduce((acc, s) => acc + (s.duration || 0), 0);
  const totalMinutes = Math.floor(totalDuration / 60);

  return (
    <TabTransition>
      <div className="ethereal-page min-h-screen pb-52">
        {artist && (
          <SEOHead
            title={`${artist.name} — Songs, Albums & Bio | Univers Flow`}
            description={artist.bio?.slice(0, 155) || `Listen to ${artist.name} on Univers Flow. Stream ${songs.length} songs, follow the artist, and download for offline listening.`}
            image={artist.photo_url || undefined}
            path={`/artist/${artist.id}`}
            type="profile"
            jsonLdId="artist-jsonld"
            jsonLd={(() => {
              const albumMap = new Map<string, typeof songs>();
              for (const s of songs) {
                if (!s.album) continue;
                if (!albumMap.has(s.album)) albumMap.set(s.album, [] as typeof songs);
                (albumMap.get(s.album) as typeof songs).push(s);
              }
              const albums = Array.from(albumMap.entries()).slice(0, 20).map(([name, tracks]) => ({
                '@type': 'MusicAlbum',
                name,
                byArtist: { '@type': 'MusicGroup', name: artist.name },
                numTracks: tracks.length,
                ...(tracks[0]?.cover_url ? { image: tracks[0].cover_url } : {}),
                track: tracks.slice(0, 25).map((t) => ({
                  '@type': 'MusicRecording',
                  name: t.title,
                  ...(t.duration ? { duration: `PT${Math.floor(t.duration / 60)}M${t.duration % 60}S` } : {}),
                  byArtist: { '@type': 'MusicGroup', name: artist.name },
                })),
              }));
              return [
                {
                  '@context': 'https://schema.org',
                  '@type': 'MusicGroup',
                  '@id': `https://universflow.in/artist/${artist.id}#musicgroup`,
                  name: artist.name,
                  url: `https://universflow.in/artist/${artist.id}`,
                  ...(artist.photo_url ? { image: artist.photo_url } : {}),
                  ...(artist.bio ? { description: artist.bio } : {}),
                  ...(artist.genre ? { genre: artist.genre } : {}),
                  ...(albums.length ? { album: albums } : {}),
                  ...(songs.length
                    ? {
                        track: songs.slice(0, 25).map((s) => ({
                          '@type': 'MusicRecording',
                          name: s.title,
                          byArtist: { '@type': 'MusicGroup', name: artist.name },
                          ...(s.album ? { inAlbum: { '@type': 'MusicAlbum', name: s.album } } : {}),
                        })),
                      }
                    : {}),
                },
                {
                  '@context': 'https://schema.org',
                  '@type': 'BreadcrumbList',
                  itemListElement: [
                    { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://universflow.in/' },
                    { '@type': 'ListItem', position: 2, name: 'Artists', item: 'https://universflow.in/artists' },
                    { '@type': 'ListItem', position: 3, name: artist.name, item: `https://universflow.in/artist/${artist.id}` },
                  ],
                },
              ];
            })()}
          />
        )}
        {/* Hero Header */}
        <motion.div
          className="relative h-72 overflow-hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5 }}
        >
          {/* Background blur */}
          <div 
            className="absolute inset-0 bg-gradient-to-b from-primary/30 via-primary/10 to-black"
            style={{
              backgroundImage: artist?.photo_url ? `url(${artist.photo_url})` : undefined,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              filter: 'blur(60px)',
              opacity: 0.5,
            }}
          />
          
          {/* Back button */}
          <motion.button
            className="absolute top-4 left-4 z-10 p-2 rounded-full bg-black/30 backdrop-blur-xl"
            onClick={() => navigate(-1)}
            whileTap={{ scale: 0.9 }}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={iosSpring}
          >
            <ArrowLeft className="w-6 h-6" />
          </motion.button>

          {/* Artist info */}
          <div className="absolute inset-0 flex flex-col items-center justify-center px-6 pt-8">
            <motion.div
              className="w-28 h-28 rounded-full bg-gradient-to-br from-primary/50 to-accent/50 flex items-center justify-center overflow-hidden shadow-2xl mb-4"
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ ...iosBounce, delay: 0.1 }}
            >
              {artist?.photo_url ? (
                <img src={artist.photo_url} alt={artist?.name || 'Artist'} className="w-full h-full object-cover" />
              ) : (
                <User className="w-14 h-14 text-white/70" />
              )}
            </motion.div>
            
            <motion.h1
              className="text-2xl font-bold text-center"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...iosSpring, delay: 0.2 }}
            >
              {artist?.name || 'Unknown Artist'}
            </motion.h1>
            
            <motion.p
              className="text-sm text-muted-foreground mt-1"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
            >
              {songs.length} {songs.length === 1 ? 'song' : 'songs'} • {totalMinutes} min
            </motion.p>

            {artist?.name && (
              <motion.div
                className="mt-3"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...iosSpring, delay: 0.35 }}
              >
                <FollowArtistButton
                  artistName={artist.name}
                  artistImage={artist.photo_url}
                  source="catalog"
                  size="md"
                />
              </motion.div>
            )}
          </div>
        </motion.div>

        {/* Action buttons */}
        <motion.div
          className="flex items-center justify-center gap-4 px-6 -mt-6 relative z-10"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...iosSpring, delay: 0.3 }}
        >
          <motion.button
            className="flex items-center gap-2 px-6 py-3 rounded-full bg-white/10 backdrop-blur-xl font-semibold"
            onClick={handleShufflePlay}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            disabled={songs.length === 0}
          >
            <Shuffle className="w-5 h-5" />
            Shuffle
          </motion.button>
          
          <motion.button
            className="flex items-center gap-2 px-8 py-3 rounded-full bg-primary text-primary-foreground font-semibold shadow-lg shadow-primary/30"
            onClick={handlePlayAll}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            disabled={songs.length === 0}
          >
            <Play className="w-5 h-5 fill-current" />
            Play All
          </motion.button>
        </motion.div>

        {/* Songs list */}
        <div className="px-5 pt-8">
          <motion.h2
            className="text-lg font-semibold mb-4"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ ...iosSpring, delay: 0.4 }}
          >
            Songs
          </motion.h2>

          {loading ? (
            <div className="flex justify-center py-16">
              <motion.div 
                className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent"
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
              />
            </div>
          ) : songs.length === 0 ? (
            <motion.div
              className="text-center py-16"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <Music className="w-16 h-16 mx-auto mb-4 text-muted-foreground/30" />
              <p className="text-muted-foreground">No songs found for this artist</p>
            </motion.div>
          ) : (
            <div className="space-y-1">
              {songs.map((song, index) => {
                const isActive = currentSong?.id === song.id;
                return (
                  <motion.div
                    key={song.id}
                    className={`flex items-center gap-3 p-3 rounded-3xl transition-all ${
                      isActive ? 'bg-primary/10' : 'active:bg-white/5'
                    }`}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ ...iosSpring, delay: 0.4 + index * 0.03 }}
                  >
                    {/* Track number or playing indicator */}
                    <div className="w-8 text-center flex-shrink-0">
                      {isActive && isPlaying ? (
                        <div className="flex items-end justify-center gap-[2px] h-4">
                          {[...Array(3)].map((_, i) => (
                            <motion.div
                              key={i}
                              className="w-[3px] bg-primary rounded-full"
                              animate={{ height: [4, 12, 4] }}
                              transition={{ duration: 0.5, repeat: Infinity, delay: i * 0.12, ease: "easeInOut" }}
                            />
                          ))}
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">{index + 1}</span>
                      )}
                    </div>

                    <motion.button
                      className="flex-1 flex items-center gap-3 text-left min-w-0"
                      onClick={() => handlePlaySong(song, index)}
                      whileTap={{ scale: 0.98 }}
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
                        <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                          {song.album && <span className="truncate">{song.album}</span>}
                          {song.duration && (
                            <span className="flex-shrink-0">{formatDuration(song.duration)}</span>
                          )}
                        </div>
                      </div>
                    </motion.button>
                    
                    <div className="flex items-center gap-1">
                      <LikeButton songId={song.id} size="sm" />
                      <DownloadButton song={song} size="sm" />
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>

        <BottomNav />
      </div>
    </TabTransition>
  );
};

export default ArtistDetail;
