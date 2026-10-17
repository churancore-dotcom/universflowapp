import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Music, Edit2, Trash2, Eye, EyeOff, Search, MoreVertical, Play, Save, HardDrive, Clock, Download, ChevronLeft, ChevronRight, RefreshCw, ShieldAlert } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import CatalogBulkActions from '@/components/admin/CatalogBulkActions';
import { sortCatalog, duplicateIds, bulkVisibilityTargets, type CatalogSort } from '@/lib/catalogQuality';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { filterCatalog, csvCell, type CatalogFilter } from '@/lib/adminCatalog';
import { isAiGeneratedTrack } from '@/lib/aiSlopFilter';

interface Song {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  genre: string | null;
  cover_url: string | null;
  audio_url: string;
  is_visible: boolean;
  show_in_trending: boolean;
  show_in_new_releases: boolean;
  play_count: number;
  created_at: string;
  file_size: number;
  duration: number;
  download_count: number;
}

const ManageSongs = () => {
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<CatalogFilter>('all');
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<CatalogSort>('newest');
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [editingSong, setEditingSong] = useState<Song | null>(null);
  const [editForm, setEditForm] = useState({ title: '', artist: '', album: '', genre: '' });
  const [totalStats, setTotalStats] = useState({ size: 0, duration: 0, downloads: 0 });

  useEffect(() => {
    fetchSongs();

    // Realtime for songs - but we don't update play_count in realtime to avoid flicker
    const channel = supabase
      .channel('admin-songs-manage')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'songs' 
      }, (payload) => {
        // Only refresh if it's not just a play_count update
        if (payload.eventType === 'INSERT' || payload.eventType === 'DELETE') {
          fetchSongs();
        } else if (payload.eventType === 'UPDATE') {
          // Check if only play_count changed - if so, skip refresh
          const newData = payload.new as Record<string, unknown>;
          const oldData = payload.old as Record<string, unknown>;
          const onlyPlayCountChanged = 
            newData.play_count !== oldData.play_count &&
            newData.title === oldData.title &&
            newData.artist === oldData.artist &&
            newData.is_visible === oldData.is_visible;
          
          if (!onlyPlayCountChanged) {
            fetchSongs();
          }
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const fetchSongs = async () => {
    setFetchError(false);
    try {
      const all: Song[] = [];
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await supabase.from('songs').select('id,title,artist,album,genre,cover_url,audio_url,is_visible,show_in_trending,show_in_new_releases,play_count,created_at,file_size,duration,download_count').order('created_at', { ascending: false }).order('id').range(offset, offset + 499);
        if (error) throw error;
        const batch = (data || []).map(s => ({ ...s, file_size: s.file_size || 0, duration: s.duration || 0, download_count: s.download_count || 0 }));
        all.push(...batch);
        if (batch.length < 500) break;
      }
      setSongs(all);
      setSelected(prev => prev.filter(id => all.some(song => song.id === id)));
      setTotalStats({ size: all.reduce((n, s) => n + s.file_size, 0), duration: all.reduce((n, s) => n + s.duration, 0), downloads: all.reduce((n, s) => n + s.download_count, 0) });
    } catch { setFetchError(true); toast.error('Could not load the song catalog'); }
    finally { setLoading(false); }
  };

  const formatFileSize = (bytes: number) => {
    if (!bytes || bytes === 0) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  const formatDuration = (seconds: number) => {
    if (!seconds || seconds === 0) return '-';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatTotalDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins} min`;
  };

  const toggleVisibility = async (song: Song) => {
    const { error } = await supabase
      .from('songs')
      .update({ is_visible: !song.is_visible })
      .eq('id', song.id);

    if (error) {
      toast.error('Failed to update visibility');
    } else {
      setSongs(prev => prev.map(s => s.id === song.id ? { ...s, is_visible: !song.is_visible } : s));
      toast.success(song.is_visible ? 'Song hidden' : 'Song visible');
    }
  };

  const deleteSong = async (song: Song) => {
    if (!confirm(`Delete "${song.title}"? This cannot be undone.`)) return;

    const { error } = await supabase.from('songs').delete().eq('id', song.id);

    if (error) {
      toast.error('Failed to delete song');
    } else {
      toast.success('Song deleted');
    }
  };

  const openEditDialog = (song: Song) => {
    setEditingSong(song);
    setEditForm({
      title: song.title,
      artist: song.artist,
      album: song.album || '',
      genre: song.genre || '',
    });
  };

  const saveEdit = async () => {
    if (!editingSong || saving) return;
    if (!editForm.title.trim() || !editForm.artist.trim()) { toast.error('Song title and artist are required'); return; }
    setSaving(true);

    const { error } = await supabase
      .from('songs')
      .update({
        title: editForm.title,
        artist: editForm.artist,
        album: editForm.album || null,
        genre: editForm.genre || null,
      })
      .eq('id', editingSong.id);
    setSaving(false);

    if (error) {
      toast.error('Failed to update song');
    } else {
      toast.success('Song updated');
      setEditingSong(null);
      void fetchSongs();
    }
  };

  const duplicateSongs = duplicateIds(songs);
  const filteredSongs = sortCatalog(filterCatalog(songs, searchQuery, filter), sort);
  const applyBulkVisibility = async (visible: boolean) => {
    if (bulkBusy) return;
    const targets = bulkVisibilityTargets(songs, selected, visible);
    if (!targets.length) { toast.info('Selected songs already have this visibility'); setSelected([]); return; }
    setBulkBusy(true);
    let changed = 0;
    try {
      for (let offset = 0; offset < targets.length; offset += 100) {
        const ids = targets.slice(offset, offset + 100).map(song => song.id);
        const { data, error } = await supabase.from('songs').update({ is_visible: visible }).in('id', ids).select('id');
        if (error) throw error;
        const updated = new Set((data || []).map(song => song.id));
        changed += updated.size;
        setSongs(prev => prev.map(song => updated.has(song.id) ? { ...song, is_visible: visible } : song));
        if (updated.size !== ids.length) throw new Error('Some selected songs were not updated');
      }
      toast.success(`${changed} songs ${visible ? 'shown' : 'hidden'}`);
      setSelected([]);
    } catch { toast.error(`${changed} songs updated; remaining changes failed. Refresh before retrying.`); await fetchSongs(); }
    finally { setBulkBusy(false); }
  };
  const pages = Math.max(1, Math.ceil(filteredSongs.length / 50));
  const currentPage = Math.min(page, pages - 1);
  const visibleSongs = filteredSongs.slice(currentPage * 50, currentPage * 50 + 50);
  const exportCatalog = () => {
    const columns = ['title', 'artist', 'album', 'is_visible', 'play_count'] as const;
    const csv = [columns.map(csvCell).join(','), ...filteredSongs.map(song => columns.map(key => csvCell(song[key])).join(','))].join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'universflow-song-catalog.csv'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="p-4 md:p-8">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <h1 className="text-3xl font-display font-bold">Manage Songs</h1>
        <p className="text-muted-foreground mt-1">Edit, hide, or delete songs from your library</p>
      </motion.div>

      {/* Quick Stats */}
      <motion.div
        className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <div className="glass rounded-xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
            <Music className="w-5 h-5 text-primary" />
          </div>
          <div>
            <p className="text-2xl font-bold">{songs.length}</p>
            <p className="text-xs text-muted-foreground">Total Songs</p>
          </div>
        </div>
        <div className="glass rounded-xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-accent/20 flex items-center justify-center">
            <HardDrive className="w-5 h-5 text-accent" />
          </div>
          <div>
            <p className="text-2xl font-bold">{formatFileSize(totalStats.size)}</p>
            <p className="text-xs text-muted-foreground">Total Size</p>
          </div>
        </div>
        <div className="glass rounded-xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
            <Clock className="w-5 h-5 text-green-500" />
          </div>
          <div>
            <p className="text-2xl font-bold">{formatTotalDuration(totalStats.duration)}</p>
            <p className="text-xs text-muted-foreground">Total Duration</p>
          </div>
        </div>
        <div className="glass rounded-xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-orange-500/20 flex items-center justify-center">
            <Download className="w-5 h-5 text-orange-500" />
          </div>
          <div>
            <p className="text-2xl font-bold">{totalStats.downloads.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">Downloads</p>
          </div>
        </div>
      </motion.div>

      {/* Search */}
      <motion.div
        className="mb-6 flex flex-wrap gap-3 items-center"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setPage(0); }}
            placeholder="Search songs..."
            className="pl-10 bg-muted/50 border-white/10"
          />
        </div>
        <Select value={filter} onValueChange={(v) => { setFilter(v as CatalogFilter); setPage(0); }}>
          <SelectTrigger className="w-44" aria-label="Filter song catalog"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All songs</SelectItem><SelectItem value="visible">Visible</SelectItem><SelectItem value="hidden">Hidden</SelectItem><SelectItem value="ai-review">AI disclosure review</SelectItem><SelectItem value="missing-audio">Missing audio</SelectItem><SelectItem value="missing-cover">Missing artwork</SelectItem><SelectItem value="duplicates">Potential duplicates</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={value => { setSort(value as CatalogSort); setPage(0); }}>
          <SelectTrigger className="w-44" aria-label="Sort song catalog"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="newest">Newest first</SelectItem><SelectItem value="oldest">Oldest first</SelectItem><SelectItem value="title">Title A–Z</SelectItem><SelectItem value="plays">Most played</SelectItem></SelectContent>
        </Select>
        <Button variant="outline" size="icon" title="Refresh catalog" aria-label="Refresh catalog" onClick={() => { setLoading(true); void fetchSongs(); }} disabled={loading}><RefreshCw /></Button>
        <Button variant="outline" onClick={exportCatalog} disabled={!filteredSongs.length}><Download /> Export CSV</Button>
      </motion.div>
      {fetchError && <p role="alert" className="text-destructive mb-4">Catalog unavailable. Refresh to try again.</p>}

      <div className="flex flex-wrap gap-2 mb-4">
        {(['missing-audio', 'missing-cover', 'duplicates', 'ai-review'] as const).map(value => <Button key={value} variant={filter === value ? 'secondary' : 'outline'} onClick={() => { setFilter(value); setPage(0); }}>
          {value === 'missing-audio' ? 'Missing audio' : value === 'missing-cover' ? 'Missing artwork' : value === 'duplicates' ? 'Potential duplicates' : 'AI disclosure'} · {filterCatalog(songs, '', value).length}
        </Button>)}
      </div>
      <CatalogBulkActions count={selected.length} busy={bulkBusy} clear={() => setSelected([])} apply={applyBulkVisibility} />
      {/* Songs Table */}
      <motion.div
        className="glass rounded-2xl overflow-hidden"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
      >
        {loading ? (
          <div className="p-12 text-center">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        ) : filteredSongs.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">
            <Music className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>{songs.length ? 'No songs match these filters' : 'No songs uploaded yet'}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="p-3 w-12"><input type="checkbox" aria-label="Select current page" disabled={bulkBusy} checked={visibleSongs.length > 0 && visibleSongs.every(song => selected.includes(song.id))} onChange={event => setSelected(prev => event.target.checked ? [...new Set([...prev, ...visibleSongs.map(song => song.id)])] : prev.filter(id => !visibleSongs.some(song => song.id === id)))} /></th>
                  <th className="text-left p-4 text-sm font-medium text-muted-foreground">Song</th>
                  <th className="text-left p-4 text-sm font-medium text-muted-foreground hidden md:table-cell">Album</th>
                  <th className="text-left p-4 text-sm font-medium text-muted-foreground hidden lg:table-cell">Duration</th>
                  <th className="text-left p-4 text-sm font-medium text-muted-foreground hidden xl:table-cell">Size</th>
                  <th className="text-left p-4 text-sm font-medium text-muted-foreground hidden sm:table-cell">Plays</th>
                  <th className="text-left p-4 text-sm font-medium text-muted-foreground">Status</th>
                  <th className="text-right p-4 text-sm font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence>
                  {visibleSongs.map((song, index) => (
                    <motion.tr
                      key={song.id}
                      className="border-b border-white/5 hover:bg-white/5 transition-colors"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      transition={{ delay: Math.min(index * 0.01, 0.15) }}
                    >
                      <td className="p-3"><input type="checkbox" aria-label={`Select ${song.title}`} disabled={bulkBusy} checked={selected.includes(song.id)} onChange={event => setSelected(prev => event.target.checked ? [...prev, song.id] : prev.filter(id => id !== song.id))} /></td>
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary/30 to-accent/30 flex items-center justify-center overflow-hidden flex-shrink-0">
                            {song.cover_url ? (
                              <img src={song.cover_url} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <Music className="w-4 h-4 text-muted-foreground" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium truncate">{song.title}</p>
                            <p className="text-sm text-muted-foreground truncate">{song.artist}</p>
                            {(!song.audio_url?.trim() || !song.cover_url?.trim() || duplicateSongs.has(song.id)) && <p className="text-xs text-muted-foreground">{[!song.audio_url?.trim() && 'Missing audio', !song.cover_url?.trim() && 'Missing artwork', duplicateSongs.has(song.id) && 'Potential duplicate'].filter(Boolean).join(' · ')}</p>}
                            {isAiGeneratedTrack(song) && <p className="text-xs text-destructive flex items-center gap-1"><ShieldAlert className="w-3 h-3" />AI disclosure detected</p>}
                          </div>
                        </div>
                      </td>
                      <td className="p-4 text-muted-foreground hidden md:table-cell">{song.album || '-'}</td>
                      <td className="p-4 text-muted-foreground hidden lg:table-cell">{formatDuration(song.duration)}</td>
                      <td className="p-4 text-muted-foreground hidden xl:table-cell">{formatFileSize(song.file_size)}</td>
                      <td className="p-4 text-muted-foreground hidden sm:table-cell">{song.play_count.toLocaleString()}</td>
                      <td className="p-4">
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
                          song.is_visible
                            ? 'bg-green-500/20 text-green-400'
                            : 'bg-yellow-500/20 text-yellow-400'
                        }`}>
                          {song.is_visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                          {song.is_visible ? 'Visible' : 'Hidden'}
                        </span>
                      </td>
                      <td className="p-4 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label="Song actions" className="h-8 w-8">
                              <MoreVertical className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="glass border-white/10">
                            <DropdownMenuItem onClick={() => window.open(song.audio_url, '_blank')}>
                              <Play className="w-4 h-4 mr-2" /> Play
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => openEditDialog(song)}>
                              <Edit2 className="w-4 h-4 mr-2" /> Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => toggleVisibility(song)}>
                              {song.is_visible ? (
                                <><EyeOff className="w-4 h-4 mr-2" /> Hide</>
                              ) : (
                                <><Eye className="w-4 h-4 mr-2" /> Show</>
                              )}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => deleteSong(song)} className="text-destructive">
                              <Trash2 className="w-4 h-4 mr-2" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        )}
      </motion.div>
      <div className="flex items-center justify-between gap-3 py-4">
        <span className="text-sm text-muted-foreground">{filteredSongs.length} songs · Page {currentPage + 1} of {pages}</span>
        <div className="flex gap-2"><Button variant="outline" size="icon" aria-label="Previous catalog page" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft /></Button><Button variant="outline" size="icon" aria-label="Next catalog page" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}><ChevronRight /></Button></div>
      </div>

      {/* Edit Dialog */}
      <Dialog open={!!editingSong} onOpenChange={() => setEditingSong(null)}>
        <DialogContent className="glass border-white/10">
          <DialogHeader>
            <DialogTitle>Edit Song</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-4">
            <div>
              <label className="text-sm font-medium">Title</label>
              <Input
                value={editForm.title}
                onChange={(e) => setEditForm(prev => ({ ...prev, title: e.target.value }))}
                className="mt-1.5 bg-muted/50 border-white/10"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Artist</label>
              <Input
                value={editForm.artist}
                onChange={(e) => setEditForm(prev => ({ ...prev, artist: e.target.value }))}
                className="mt-1.5 bg-muted/50 border-white/10"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Album</label>
              <Input
                value={editForm.album}
                onChange={(e) => setEditForm(prev => ({ ...prev, album: e.target.value }))}
                className="mt-1.5 bg-muted/50 border-white/10"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Genre</label>
              <Input
                value={editForm.genre}
                onChange={(e) => setEditForm(prev => ({ ...prev, genre: e.target.value }))}
                className="mt-1.5 bg-muted/50 border-white/10"
              />
            </div>
            <div className="flex gap-3 pt-4">
              <Button variant="outline" onClick={() => setEditingSong(null)} className="flex-1">
                Cancel
              </Button>
              <Button onClick={saveEdit} disabled={saving} className="flex-1 btn-premium">
                <Save className="w-4 h-4 mr-2" /> {saving ? 'Saving…' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ManageSongs;