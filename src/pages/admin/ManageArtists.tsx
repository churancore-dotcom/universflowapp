import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, Loader2, BadgeCheck, Music, Users, Play, Heart, Trash2,
  ShieldOff, ExternalLink, Globe, Mail, Calendar, MoreVertical,
} from 'lucide-react';
import { safeHref } from '@/lib/safeHref';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { Link } from '@/lib/router-compat';

interface ArtistRow {
  id: string;
  user_id: string;
  stage_name: string;
  slug: string;
  bio: string | null;
  avatar_url: string | null;
  banner_url: string | null;
  country_code: string | null;
  social_links: Record<string, string>;
  is_verified: boolean;
  total_plays: number;
  total_likes: number;
  total_followers: number;
  created_at: string;
  email?: string | null;
  username?: string | null;
  song_count?: number;
}

const ManageArtists = () => {
  const [artists, setArtists] = useState<ArtistRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'verified' | 'unverified'>('all');
  const [selected, setSelected] = useState<ArtistRow | null>(null);
  const [selectedSongs, setSelectedSongs] = useState<Array<{ id: string; title: string; play_count: number; like_count: number; status: string; created_at: string }>>([]);

  useEffect(() => {
    load();
    const channel = supabase
      .channel('admin-artist-profiles')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'artist_profiles' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'artist_songs' }, load)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const load = async () => {
    try {
      const [{ data: profiles, error }, { data: songs }] = await Promise.all([
        supabase.from('artist_profiles').select('*').order('total_followers', { ascending: false }),
        supabase.from('artist_songs').select('artist_user_id'),
      ]);
      if (error) throw error;

      const countMap: Record<string, number> = {};
      (songs || []).forEach((s) => {
        if (s.artist_user_id) countMap[s.artist_user_id] = (countMap[s.artist_user_id] || 0) + 1;
      });

      const userIds = (profiles || []).map((p) => p.user_id);
      const { data: profileRows } = userIds.length
        ? await supabase.from('profiles').select('user_id, email, username').in('user_id', userIds)
        : { data: [] as Array<{ user_id: string; email: string | null; username: string | null }> };
      const pMap = new Map((profileRows || []).map((r) => [r.user_id, r]));

      const rows: ArtistRow[] = (profiles || []).map((p) => ({
        ...p,
        social_links: (p.social_links as Record<string, string>) || {},
        email: pMap.get(p.user_id)?.email ?? null,
        username: pMap.get(p.user_id)?.username ?? null,
        song_count: countMap[p.user_id] || 0,
      }));
      setArtists(rows);
    } catch (err) {
      console.error('ManageArtists load error:', err);
      toast.error('Failed to load artists');
    } finally {
      setLoading(false);
    }
  };

  const stats = useMemo(() => {
    const verified = artists.filter((a) => a.is_verified).length;
    const plays = artists.reduce((s, a) => s + (a.total_plays || 0), 0);
    const followers = artists.reduce((s, a) => s + (a.total_followers || 0), 0);
    const songs = artists.reduce((s, a) => s + (a.song_count || 0), 0);
    return { total: artists.length, verified, plays, followers, songs };
  }, [artists]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return artists.filter((a) => {
      if (filter === 'verified' && !a.is_verified) return false;
      if (filter === 'unverified' && a.is_verified) return false;
      if (!q) return true;
      return (
        a.stage_name.toLowerCase().includes(q) ||
        a.slug.toLowerCase().includes(q) ||
        (a.email || '').toLowerCase().includes(q) ||
        (a.username || '').toLowerCase().includes(q)
      );
    });
  }, [artists, search, filter]);

  const openDetails = async (a: ArtistRow) => {
    setSelected(a);
    setSelectedSongs([]);
    const { data } = await supabase
      .from('artist_songs')
      .select('id, title, play_count, like_count, status, created_at')
      .eq('artist_user_id', a.user_id)
      .order('created_at', { ascending: false });
    setSelectedSongs(data || []);
  };

  const toggleVerified = async (a: ArtistRow) => {
    try {
      const { error } = await supabase.from('artist_profiles').update({ is_verified: !a.is_verified }).eq('id', a.id);
      if (error) throw error;
      toast.success(!a.is_verified ? 'Verified badge granted' : 'Verified badge removed');
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update');
    }
  };

  const deleteArtist = async (a: ArtistRow) => {
    if (!confirm(`Delete artist "${a.stage_name}" and ALL their uploaded songs? This cannot be undone.`)) return;
    try {
      await supabase.from('artist_songs').delete().eq('artist_user_id', a.user_id);
      const { error } = await supabase.from('artist_profiles').delete().eq('id', a.id);
      if (error) throw error;
      await supabase.from('user_roles').delete().eq('user_id', a.user_id).eq('role', 'artist');
      toast.success('Artist removed');
      setSelected(null);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  const fmt = (n: number) => Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n || 0);

  return (
    <div className="p-4 md:p-8">
      <div className="mb-6">
        <h1 className="text-2xl md:text-3xl font-display font-bold">Manage Artists</h1>
        <p className="text-muted-foreground text-sm mt-1">Real Universflow verified artists · live data</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        {[
          { label: 'Total Artists', value: stats.total, icon: Users, color: 'from-primary to-accent' },
          { label: 'Verified', value: stats.verified, icon: BadgeCheck, color: 'from-emerald-500 to-teal-400' },
          { label: 'Songs', value: stats.songs, icon: Music, color: 'from-blue-500 to-cyan-400' },
          { label: 'Total Plays', value: fmt(stats.plays), icon: Play, color: 'from-fuchsia-500 to-pink-400' },
          { label: 'Total Followers', value: fmt(stats.followers), icon: Heart, color: 'from-rose-500 to-orange-400' },
        ].map((s) => (
          <div key={s.label} className="glass rounded-2xl p-4">
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${s.color} flex items-center justify-center mb-2`}>
              <s.icon className="w-5 h-5 text-white" />
            </div>
            <div className="text-xs text-muted-foreground">{s.label}</div>
            <div className="text-xl font-bold">{s.value}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="flex gap-2">
          {(['all', 'verified', 'unverified'] as const).map((f) => (
            <Button key={f} variant={filter === f ? 'default' : 'outline'} size="sm" onClick={() => setFilter(f)} className="capitalize text-xs">
              {f}
            </Button>
          ))}
        </div>
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, slug, email…" className="pl-10 bg-muted/50 border-white/10" />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {loading ? (
          <div className="col-span-full flex justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>
        ) : filtered.length === 0 ? (
          <div className="col-span-full text-center py-16 text-muted-foreground">
            <Users className="w-12 h-12 mx-auto mb-3 opacity-50" /><p>No artists match this filter.</p>
          </div>
        ) : (
          <AnimatePresence>
            {filtered.map((a, i) => (
              <motion.div
                key={a.id}
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                transition={{ delay: i * 0.02 }}
                className="glass rounded-2xl p-4 hover:ring-1 hover:ring-primary/30 transition-all"
              >
                <div className="flex items-start gap-3">
                  <Avatar className="w-14 h-14">
                    <AvatarImage src={a.avatar_url || undefined} />
                    <AvatarFallback>{a.stage_name.slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="font-semibold truncate">{a.stage_name}</p>
                      {a.is_verified && <BadgeCheck className="w-4 h-4 text-primary shrink-0" />}
                      {a.country_code && <Badge variant="secondary" className="text-[10px]">{a.country_code}</Badge>}
                    </div>
                    <p className="text-[11px] text-muted-foreground truncate">/{a.slug}</p>
                    {a.email && <p className="text-[11px] text-muted-foreground truncate">{a.email}</p>}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label="Artist actions" className="h-8 w-8"><MoreVertical className="w-4 h-4" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="glass border-white/10">
                      <DropdownMenuItem onClick={() => openDetails(a)}><ExternalLink className="w-4 h-4 mr-2" /> View Details</DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link to={`/artist/${a.slug}`}><Globe className="w-4 h-4 mr-2" /> Open Public Page</Link>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => toggleVerified(a)}>
                        {a.is_verified ? <><ShieldOff className="w-4 h-4 mr-2" /> Remove Verified</> : <><BadgeCheck className="w-4 h-4 mr-2" /> Mark Verified</>}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => deleteArtist(a)} className="text-red-500 focus:text-red-500">
                        <Trash2 className="w-4 h-4 mr-2" /> Delete Artist
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div className="grid grid-cols-4 gap-2 mt-4 pt-3 border-t border-white/5 text-center">
                  <Stat icon={Music} value={a.song_count || 0} label="Songs" />
                  <Stat icon={Play} value={fmt(a.total_plays)} label="Plays" />
                  <Stat icon={Heart} value={fmt(a.total_likes)} label="Likes" />
                  <Stat icon={Users} value={fmt(a.total_followers)} label="Fans" />
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>

      {/* Details Drawer */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto glass border-white/10">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Avatar className="w-10 h-10"><AvatarImage src={selected.avatar_url || undefined} /><AvatarFallback>{selected.stage_name.slice(0, 2)}</AvatarFallback></Avatar>
                  <span>{selected.stage_name}</span>
                  {selected.is_verified && <BadgeCheck className="w-5 h-5 text-primary" />}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-2">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {selected.email && <Info icon={Mail} label="Email" value={selected.email} />}
                  {selected.username && <Info icon={Users} label="Username" value={`@${selected.username}`} />}
                  {selected.country_code && <Info icon={Globe} label="Country" value={selected.country_code} />}
                  <Info icon={Calendar} label="Joined" value={new Date(selected.created_at).toLocaleDateString()} />
                </div>
                {selected.bio && <p className="text-sm text-muted-foreground bg-muted/30 rounded-lg p-3 whitespace-pre-wrap">{selected.bio}</p>}
                {Object.keys(selected.social_links).length > 0 && (
                  <div>
                    <h4 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Social</h4>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(selected.social_links).map(([k, v]) =>
                        safeHref(v) ? (
                          <a key={k} href={safeHref(v)!} target="_blank" rel="noopener noreferrer" className="text-xs px-2 py-1 rounded-md bg-muted/50 hover:bg-muted">
                            {k} <ExternalLink className="w-3 h-3 inline" />
                          </a>
                        ) : null,
                      )}
                    </div>
                  </div>
                )}
                <div>
                  <h4 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Songs ({selectedSongs.length})</h4>
                  <div className="space-y-1 max-h-64 overflow-y-auto">
                    {selectedSongs.map((s) => (
                      <div key={s.id} className="flex items-center justify-between text-sm py-2 border-b border-white/5">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{s.title}</p>
                          <p className="text-[11px] text-muted-foreground">{new Date(s.created_at).toLocaleDateString()} · {s.status}</p>
                        </div>
                        <div className="flex gap-3 text-xs text-muted-foreground shrink-0">
                          <span><Play className="w-3 h-3 inline mr-0.5" />{fmt(s.play_count)}</span>
                          <span><Heart className="w-3 h-3 inline mr-0.5" />{fmt(s.like_count)}</span>
                        </div>
                      </div>
                    ))}
                    {selectedSongs.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No songs uploaded yet.</p>}
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

const Stat = ({ icon: Icon, value, label }: { icon: typeof Music; value: number | string; label: string }) => (
  <div>
    <Icon className="w-3.5 h-3.5 text-muted-foreground mx-auto mb-1" />
    <div className="text-sm font-semibold">{value}</div>
    <div className="text-[10px] text-muted-foreground">{label}</div>
  </div>
);

const Info = ({ icon: Icon, label, value }: { icon: typeof Mail; label: string; value: string }) => (
  <div className="flex items-center gap-2 bg-muted/30 rounded-lg px-3 py-2 min-w-0">
    <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
    <div className="min-w-0">
      <p className="text-[10px] text-muted-foreground uppercase">{label}</p>
      <p className="text-sm truncate">{value}</p>
    </div>
  </div>
);

export default ManageArtists;
