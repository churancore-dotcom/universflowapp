import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  ListMusic, 
  Search, 
  Star, 
  StarOff, 
  MoreVertical, 
  Edit2,
  Trash2,
  Eye,
  EyeOff,
  Music,
  User,
  Calendar
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

interface Playlist {
  id: string;
  title: string;
  description: string | null;
  cover_url: string | null;
  user_id: string | null;
  is_featured: boolean;
  is_public: boolean;
  created_at: string;
  song_count?: number;
  owner_email?: string;
}

const ManagePlaylists = () => {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingPlaylist, setEditingPlaylist] = useState<Playlist | null>(null);
  const [editForm, setEditForm] = useState({ title: '', description: '' });
  const [stats, setStats] = useState({
    total: 0,
    featured: 0,
    public: 0,
  });

  useEffect(() => {
    fetchPlaylists();

    // Realtime for playlists
    const channel = supabase
      .channel('admin-playlists-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'playlists' }, fetchPlaylists)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'playlist_songs' }, fetchPlaylists)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const fetchPlaylists = async () => {
    try {
      // Fetch playlists
      const { data: playlistsData, error: playlistsError } = await supabase
        .from('playlists')
        .select('*')
        .order('created_at', { ascending: false });

      if (playlistsError) throw playlistsError;

      // Fetch song counts
      const { data: songCounts } = await supabase
        .from('playlist_songs')
        .select('playlist_id');

      // Fetch profiles for owner emails
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, email');

      // Map counts and emails
      const countMap: Record<string, number> = {};
      const emailMap: Record<string, string> = {};

      (songCounts || []).forEach(item => {
        countMap[item.playlist_id] = (countMap[item.playlist_id] || 0) + 1;
      });

      (profiles || []).forEach(profile => {
        if (profile.email) {
          emailMap[profile.user_id] = profile.email;
        }
      });

      const playlistsWithCounts = (playlistsData || []).map(playlist => ({
        ...playlist,
        song_count: countMap[playlist.id] || 0,
        owner_email: playlist.user_id ? emailMap[playlist.user_id] : 'System',
      }));

      setPlaylists(playlistsWithCounts);

      setStats({
        total: playlistsWithCounts.length,
        featured: playlistsWithCounts.filter(p => p.is_featured).length,
        public: playlistsWithCounts.filter(p => p.is_public).length,
      });
    } catch (error) {
      console.error('Error fetching playlists:', error);
      toast.error('Failed to load playlists');
    } finally {
      setLoading(false);
    }
  };

  const toggleFeatured = async (playlist: Playlist) => {
    try {
      const { error } = await supabase
        .from('playlists')
        .update({ is_featured: !playlist.is_featured })
        .eq('id', playlist.id);

      if (error) throw error;

      toast.success(playlist.is_featured ? 'Removed from featured' : 'Added to featured');
      fetchPlaylists();
    } catch (error) {
      console.error('Error updating playlist:', error);
      toast.error('Failed to update playlist');
    }
  };

  const toggleVisibility = async (playlist: Playlist) => {
    try {
      const { error } = await supabase
        .from('playlists')
        .update({ is_public: !playlist.is_public })
        .eq('id', playlist.id);

      if (error) throw error;

      toast.success(playlist.is_public ? 'Made private' : 'Made public');
      fetchPlaylists();
    } catch (error) {
      console.error('Error updating playlist:', error);
      toast.error('Failed to update playlist');
    }
  };

  const deletePlaylist = async (playlist: Playlist) => {
    if (!confirm(`Delete "${playlist.title}"? This will also remove all songs from this playlist.`)) return;

    try {
      // Delete playlist songs first
      await supabase.from('playlist_songs').delete().eq('playlist_id', playlist.id);
      
      // Then delete the playlist
      const { error } = await supabase.from('playlists').delete().eq('id', playlist.id);

      if (error) throw error;

      toast.success('Playlist deleted');
      fetchPlaylists();
    } catch (error) {
      console.error('Error deleting playlist:', error);
      toast.error('Failed to delete playlist');
    }
  };

  const openEditDialog = (playlist: Playlist) => {
    setEditingPlaylist(playlist);
    setEditForm({
      title: playlist.title,
      description: playlist.description || '',
    });
  };

  const saveEdit = async () => {
    if (!editingPlaylist) return;

    try {
      const { error } = await supabase
        .from('playlists')
        .update({
          title: editForm.title,
          description: editForm.description || null,
        })
        .eq('id', editingPlaylist.id);

      if (error) throw error;

      toast.success('Playlist updated');
      setEditingPlaylist(null);
      fetchPlaylists();
    } catch (error) {
      console.error('Error updating playlist:', error);
      toast.error('Failed to update playlist');
    }
  };

  const filteredPlaylists = playlists.filter(playlist =>
    playlist.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    playlist.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div className="p-4 md:p-8">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <h1 className="text-2xl md:text-3xl font-display font-bold">Manage Playlists</h1>
        <p className="text-muted-foreground mt-1">View, edit, and manage all playlists</p>
      </motion.div>

      {/* Stats Cards */}
      <motion.div
        className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <div className="glass rounded-xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
            <ListMusic className="w-5 h-5 text-primary" />
          </div>
          <div>
            <p className="text-2xl font-bold">{stats.total}</p>
            <p className="text-xs text-muted-foreground">Total Playlists</p>
          </div>
        </div>
        <div className="glass rounded-xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-accent/20 flex items-center justify-center">
            <Star className="w-5 h-5 text-accent" />
          </div>
          <div>
            <p className="text-2xl font-bold">{stats.featured}</p>
            <p className="text-xs text-muted-foreground">Featured</p>
          </div>
        </div>
        <div className="glass rounded-xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
            <Eye className="w-5 h-5 text-green-500" />
          </div>
          <div>
            <p className="text-2xl font-bold">{stats.public}</p>
            <p className="text-xs text-muted-foreground">Public</p>
          </div>
        </div>
      </motion.div>

      {/* Search */}
      <motion.div
        className="mb-6"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search playlists..."
            className="pl-10 bg-muted/50 border-white/10"
          />
        </div>
      </motion.div>

      {/* Playlists Grid */}
      <motion.div
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
      >
        {loading ? (
          <div className="col-span-full p-12 text-center">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        ) : filteredPlaylists.length === 0 ? (
          <div className="col-span-full p-12 text-center text-muted-foreground">
            <ListMusic className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>{searchQuery ? 'No playlists match your search' : 'No playlists found'}</p>
          </div>
        ) : (
          <AnimatePresence>
            {filteredPlaylists.map((playlist, index) => (
              <motion.div
                key={playlist.id}
                className="glass rounded-2xl overflow-hidden hover:ring-1 hover:ring-primary/30 transition-all"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ delay: index * 0.03 }}
              >
                {/* Cover */}
                <div className="aspect-video relative bg-gradient-to-br from-primary/30 to-accent/30">
                  {playlist.cover_url ? (
                    <img 
                      src={playlist.cover_url} 
                      alt={playlist.title}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <ListMusic className="w-12 h-12 text-muted-foreground/50" />
                    </div>
                  )}
                  
                  {/* Badges */}
                  <div className="absolute top-2 left-2 flex gap-2">
                    {playlist.is_featured && (
                      <Badge className="bg-accent/90 text-accent-foreground">
                        <Star className="w-3 h-3 mr-1" />
                        Featured
                      </Badge>
                    )}
                    {!playlist.is_public && (
                      <Badge variant="secondary" className="bg-muted/80">
                        <EyeOff className="w-3 h-3 mr-1" />
                        Private
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Content */}
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="font-semibold truncate">{playlist.title}</h3>
                      {playlist.description && (
                        <p className="text-sm text-muted-foreground line-clamp-2 mt-1">{playlist.description}</p>
                      )}
                    </div>
                    
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label="Playlist actions" className="h-8 w-8 flex-shrink-0">
                          <MoreVertical className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="glass border-white/10">
                        <DropdownMenuItem onClick={() => openEditDialog(playlist)}>
                          <Edit2 className="w-4 h-4 mr-2" /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => toggleFeatured(playlist)}>
                          {playlist.is_featured ? (
                            <><StarOff className="w-4 h-4 mr-2" /> Remove Featured</>
                          ) : (
                            <><Star className="w-4 h-4 mr-2" /> Make Featured</>
                          )}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => toggleVisibility(playlist)}>
                          {playlist.is_public ? (
                            <><EyeOff className="w-4 h-4 mr-2" /> Make Private</>
                          ) : (
                            <><Eye className="w-4 h-4 mr-2" /> Make Public</>
                          )}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => deletePlaylist(playlist)} className="text-destructive">
                          <Trash2 className="w-4 h-4 mr-2" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Music className="w-3 h-3" />
                      {playlist.song_count} songs
                    </span>
                    <span className="flex items-center gap-1">
                      <User className="w-3 h-3" />
                      {playlist.owner_email?.split('@')[0] || 'System'}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {formatDate(playlist.created_at)}
                  </p>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </motion.div>

      {/* Edit Dialog */}
      <Dialog open={!!editingPlaylist} onOpenChange={() => setEditingPlaylist(null)}>
        <DialogContent className="glass border-white/10">
          <DialogHeader>
            <DialogTitle>Edit Playlist</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                value={editForm.title}
                onChange={(e) => setEditForm(prev => ({ ...prev, title: e.target.value }))}
                className="bg-muted/50 border-white/10"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={editForm.description}
                onChange={(e) => setEditForm(prev => ({ ...prev, description: e.target.value }))}
                className="bg-muted/50 border-white/10"
                rows={3}
              />
            </div>
            <div className="flex gap-3 pt-4">
              <Button variant="outline" onClick={() => setEditingPlaylist(null)} className="flex-1">
                Cancel
              </Button>
              <Button onClick={saveEdit} className="flex-1 btn-premium">
                Save Changes
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ManagePlaylists;
