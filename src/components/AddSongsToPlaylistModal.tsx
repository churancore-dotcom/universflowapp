import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Search, Music, Check, Loader2, Plus, Radio } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Song } from '@/contexts/PlayerContext';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { iosSpring, iosBounce } from '@/lib/animations';
import { searchIndexedTracks, type IndexedTrack } from '@/lib/musicIndexer';
import { persistStreamSong } from '@/lib/streamSongs';

interface AddSongsToPlaylistModalProps {
  isOpen: boolean;
  onClose: () => void;
  playlistId: string;
  existingSongIds: string[];
  onSongsAdded: () => void;
}

const AddSongsToPlaylistModal = ({ 
  isOpen, 
  onClose, 
  playlistId, 
  existingSongIds,
  onSongsAdded 
}: AddSongsToPlaylistModalProps) => {
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSongs, setSelectedSongs] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);

  const searchRequestRef = useRef(0);
  const knownSongsRef = useRef(new Map<string, any>());
  const fetchSongs = useCallback(async (term: string) => {
    const requestId = ++searchRequestRef.current;
    setLoading(true);
    const data = await searchIndexedTracks(term.trim() || 'top songs', 40).catch(() => [] as IndexedTrack[]);
    // A slower, older search must never replace newer results.
    if (requestId !== searchRequestRef.current) return;
    const mapped = data.map(s => ({
      id: s.id,
      title: s.title,
      artist: s.artist,
      album: s.album,
      cover_url: s.cover_url,
      audio_url: 'resolving',
      duration: s.duration,
      source: 'indexed' as const,
    }));
    // Remember every shown song so picks survive later searches.
    for (const song of mapped) knownSongsRef.current.set(song.id, song);
    setSongs(mapped);
    setLoading(false);
  }, []);

  // Selections reset only when the window opens, not on every keystroke.
  useEffect(() => {
    if (isOpen) setSelectedSongs(new Set());
  }, [isOpen]);

  // One debounced search (runs immediately on open).
  useEffect(() => {
    if (!isOpen) return;
    const id = setTimeout(() => { void fetchSongs(searchQuery); }, searchQuery ? 350 : 0);
    return () => clearTimeout(id);
  }, [isOpen, searchQuery, fetchSongs]);

  const toggleSong = (songId: string) => {
    setSelectedSongs(prev => {
      const newSet = new Set(prev);
      if (newSet.has(songId)) {
        newSet.delete(songId);
      } else {
        newSet.add(songId);
      }
      return newSet;
    });
  };

  const handleAddSongs = async () => {
    if (selectedSongs.size === 0) return;

    setAdding(true);

    // Get current max position
    const { data: existingSongs } = await supabase
      .from('playlist_songs')
      .select('position')
      .eq('playlist_id', playlistId)
      .order('position', { ascending: false })
      .limit(1);

    const nextPosition = existingSongs && existingSongs.length > 0 ? existingSongs[0].position + 1 : 0;

    const selected = [...selectedSongs].map((id) => knownSongsRef.current.get(id)).filter(Boolean) as typeof songs;
    await Promise.all(selected.map((song) => persistStreamSong(song)));

    const songsToAdd = selected.map((song, index) => ({
      playlist_id: playlistId,
      song_id: song.id,
      position: nextPosition + index,
      track_source: 'indexed',
    }));

    const { error } = await supabase
      .from('playlist_songs')
      .insert(songsToAdd);

    if (error) {
      console.error('Error adding songs:', error);
      toast.error('Failed to add songs');
    } else {
      const firstCover = selected.find((song) => song.cover_url)?.cover_url;
      if (firstCover) {
        const { data: playlist } = await supabase
          .from('playlists')
          .select('cover_url')
          .eq('id', playlistId)
          .maybeSingle();
        if (!playlist?.cover_url) {
          await supabase.from('playlists').update({ cover_url: firstCover }).eq('id', playlistId);
        }
      }
      toast.success(`Added ${selectedSongs.size} song${selectedSongs.size > 1 ? 's' : ''} to playlist! 🎵`);
      onSongsAdded();
    }

    setAdding(false);
  };

  const filteredSongs = songs.filter(song => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      song.title.toLowerCase().includes(query) ||
      song.artist.toLowerCase().includes(query)
    );
  });

  // Filter out songs already in the playlist
  const availableSongs = filteredSongs.filter(song => !existingSongIds.includes(song.id));

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
            className="fixed inset-x-4 top-20 bottom-20 z-[60] max-w-lg mx-auto"
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={iosSpring}
          >
            <div 
              className="h-full rounded-3xl overflow-hidden flex flex-col"
              style={{
                background: 'rgba(28, 28, 30, 0.98)',
                backdropFilter: 'blur(40px)',
              }}
            >
              {/* Header */}
              <div className="flex items-center justify-between p-5 border-b border-white/10">
                <h2 className="text-lg font-semibold">Add Songs</h2>
                <motion.button
                  onClick={onClose}
                  className="p-2 rounded-full hover:bg-white/10 transition-colors"
                  whileTap={{ scale: 0.9 }}
                >
                  <X className="w-5 h-5" />
                </motion.button>
              </div>

              {/* Search */}
              <div className="p-4 border-b border-white/10">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search songs..."
                    className="pl-10 bg-white/5 border-white/10 rounded-xl h-11"
                  />
                </div>
                {selectedSongs.size > 0 && (
                  <motion.p
                    className="mt-3 text-sm text-primary font-medium"
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    {selectedSongs.size} song{selectedSongs.size > 1 ? 's' : ''} selected
                  </motion.p>
                )}
              </div>

              {/* Songs list */}
              <div className="flex-1 overflow-y-auto p-4">
                {loading ? (
                  <div className="flex justify-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                  </div>
                ) : availableSongs.length === 0 ? (
                  <div className="text-center py-12">
                    <Music className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" />
                    <p className="text-muted-foreground">
                      {searchQuery ? 'No songs found' : 'All songs already added'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {availableSongs.map((song, index) => {
                      const isSelected = selectedSongs.has(song.id);

                      return (
                        <motion.button
                          key={song.id}
                          onClick={() => toggleSong(song.id)}
                          className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all ${
                            isSelected ? 'bg-primary/15' : 'hover:bg-white/5'
                          }`}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: index * 0.02 }}
                          whileTap={{ scale: 0.98 }}
                        >
                          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary/30 to-accent/30 flex items-center justify-center overflow-hidden flex-shrink-0">
                            {song.cover_url ? (
                              <img src={song.cover_url} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <Music className="w-5 h-5 text-muted-foreground" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0 text-left">
                            <p className="font-medium text-[15px] truncate">{song.title}</p>
                            <p className="text-[13px] text-muted-foreground truncate">{song.artist}</p>
                          </div>
                          <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                            isSelected 
                              ? 'bg-primary border-primary' 
                              : 'border-muted-foreground/30'
                          }`}>
                            {isSelected && <Check className="w-4 h-4 text-primary-foreground" />}
                          </div>
                        </motion.button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="p-4 border-t border-white/10">
                <motion.button
                  onClick={handleAddSongs}
                  disabled={adding || selectedSongs.size === 0}
                  className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  transition={iosBounce}
                >
                  {adding ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      <Plus className="w-5 h-5" />
                      Add {selectedSongs.size > 0 ? `${selectedSongs.size} Song${selectedSongs.size > 1 ? 's' : ''}` : 'Songs'}
                    </>
                  )}
                </motion.button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default AddSongsToPlaylistModal;