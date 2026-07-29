import { useCallback, useState, useEffect, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Plus, Music, Check, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Song } from '@/contexts/PlayerContext';
import { toast } from 'sonner';
import { iosSpring, iosBounce } from '@/lib/animations';
import { persistStreamSong, getTrackSource } from '@/lib/streamSongs';
import { isCatalogSongId } from '@/lib/songSupport';

interface Playlist {
  id: string;
  title: string;
  cover_url?: string;
}

interface AddToPlaylistModalProps {
  isOpen: boolean;
  onClose: () => void;
  song: Song | null;
  onCreateNew: () => void;
}

const AddToPlaylistModal = memo(function AddToPlaylistModal({ 
  isOpen, 
  onClose, 
  song, 
  onCreateNew 
}: AddToPlaylistModalProps) {
  const { user } = useAuth();
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [addedTo, setAddedTo] = useState<Set<string>>(new Set());

  const fetchPlaylists = useCallback(async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('playlists')
        .select('id, title, cover_url')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      if (data) {
        setPlaylists(data as any);
      }
    } catch (error) {
      console.error('Error fetching playlists:', error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (isOpen && user) {
      fetchPlaylists();
    }
  }, [isOpen, user, fetchPlaylists]);

  const handleAddToPlaylist = async (playlistId: string) => {
    if (!song) return;

    setAddingTo(playlistId);

    try {
      if (!isCatalogSongId(song.id)) {
        await persistStreamSong(song);
      }

      const { data: existingSongs, error: fetchError } = await supabase
        .from('playlist_songs')
        .select('position')
        .eq('playlist_id', playlistId)
        .order('position', { ascending: false })
        .limit(1);

      if (fetchError) throw fetchError;

      const nextPosition = existingSongs && existingSongs.length > 0 ? existingSongs[0].position + 1 : 0;

      const { error } = await supabase
        .from('playlist_songs')
        .insert({
          playlist_id: playlistId,
          song_id: song.id,
          position: nextPosition,
          track_source: getTrackSource(song),
        });

      if (error) {
        if (error.code === '23505') {
          toast.info('Song already in this playlist');
        } else {
          throw error;
        }
      } else {
        if (!playlists.find((playlist) => playlist.id === playlistId)?.cover_url && song.cover_url) {
          await supabase
            .from('playlists')
            .update({ cover_url: song.cover_url })
            .eq('id', playlistId)
            .eq('user_id', user?.id ?? '');
          setPlaylists((prev) => prev.map((playlist) => (
            playlist.id === playlistId ? { ...playlist, cover_url: song.cover_url } : playlist
          )));
        }
        toast.success('Added to playlist! 🎵');
        setAddedTo(prev => new Set(prev).add(playlistId));
      }
    } catch (error) {
      console.error('Error adding to playlist:', error);
      toast.error('Failed to add song');
    } finally {
      setAddingTo(null);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            className="fixed inset-x-4 bottom-0 z-[60] max-w-md mx-auto pb-safe"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={iosSpring}
          >
            <div 
              className="rounded-t-3xl overflow-hidden max-h-[70vh] flex flex-col"
              style={{
                background: 'rgba(28, 28, 30, 0.98)',
                backdropFilter: 'blur(40px)',
              }}
            >
              {/* Handle */}
              <div className="w-9 h-1 rounded-full bg-white/30 mx-auto mt-3" />

              {/* Header */}
              <div className="flex items-center justify-between p-5 border-b border-white/10">
                <div className="flex items-center gap-3">
                  {song?.cover_url ? (
                    <img src={song.cover_url} alt="" className="w-10 h-10 rounded-lg object-cover" />
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center">
                      <Music className="w-5 h-5 text-white/50" />
                    </div>
                  )}
                  <div>
                    <p className="font-semibold text-sm truncate max-w-[200px]">{song?.title}</p>
                    <p className="text-xs text-muted-foreground">{song?.artist}</p>
                  </div>
                </div>
                <motion.button
                  onClick={onClose}
                  className="p-2 rounded-full hover:bg-white/10 transition-colors"
                  whileTap={{ scale: 0.9 }}
                >
                  <X className="w-5 h-5" />
                </motion.button>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto p-4">
                {/* Create new playlist button */}
                <motion.button
                  onClick={() => {
                    onClose();
                    onCreateNew();
                  }}
                  className="w-full flex items-center gap-4 p-4 rounded-2xl bg-primary/10 mb-4"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  transition={iosBounce}
                >
                  <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center">
                    <Plus className="w-6 h-6 text-primary-foreground" />
                  </div>
                  <span className="font-semibold">Create New Playlist</span>
                </motion.button>

                {loading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : playlists.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">
                    No playlists yet. Create one to get started!
                  </p>
                ) : (
                  <div className="space-y-2">
                    {playlists.map((playlist, index) => {
                      const isAdded = addedTo.has(playlist.id);
                      const isAdding = addingTo === playlist.id;

                      return (
                        <motion.button
                          key={playlist.id}
                          onClick={() => !isAdded && handleAddToPlaylist(playlist.id)}
                          className={`w-full flex items-center gap-4 p-3 rounded-xl transition-colors ${
                            isAdded ? 'bg-primary/10' : 'hover:bg-white/5'
                          }`}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: index * 0.05 }}
                          whileTap={{ scale: 0.98 }}
                          disabled={isAdded || isAdding}
                        >
                          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary/30 to-accent/30 flex items-center justify-center overflow-hidden">
                            {playlist.cover_url ? (
                              <img src={playlist.cover_url} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <Music className="w-5 h-5 text-white/50" />
                            )}
                          </div>
                          <span className="flex-1 text-left font-medium">{playlist.title}</span>
                          {isAdding ? (
                            <Loader2 className="w-5 h-5 animate-spin text-primary" />
                          ) : isAdded ? (
                            <Check className="w-5 h-5 text-primary" />
                          ) : null}
                        </motion.button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
});

export default AddToPlaylistModal;