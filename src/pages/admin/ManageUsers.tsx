import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLocation } from '@/lib/router-compat';
import { 
  Users, Search, MoreVertical, Mail, Calendar,
  Music, Heart, Clock, Crown, Ban, PlayCircle, UserCheck, Trash2
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

interface UserProfile {
  id: string;
  user_id: string;
  email: string | null;
  username: string | null;
  avatar_url: string | null;
  is_admin: boolean;
  account_type: 'listener' | 'artist' | string;
  created_at: string;
  status: string;
  library_count?: number;
  playlist_count?: number;
  play_count?: number;
}

const ManageUsers = () => {
  const location = useLocation();
  const artistSignupView = location.pathname.includes('artist-signups');
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'banned' | 'suspended'>('all');

  useEffect(() => {
    fetchUsers();
    const channel = supabase
      .channel('admin-users-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, fetchUsers)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const fetchUsers = async () => {
    try {
      const { data: profiles, error } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;

      const { data: adminRoles } = await supabase.from('user_roles').select('user_id, role').eq('role', 'admin');
      const adminUserIds = new Set((adminRoles || []).map(r => r.user_id));

      const { data: libraryCounts } = await supabase.from('user_library').select('user_id');
      const { data: playlistCounts } = await supabase.from('playlists').select('user_id');
      const { data: playCounts } = await supabase.from('recently_played').select('user_id');

      const libraryMap: Record<string, number> = {};
      const playlistMap: Record<string, number> = {};
      const playMap: Record<string, number> = {};

      (libraryCounts || []).forEach(i => { libraryMap[i.user_id] = (libraryMap[i.user_id] || 0) + 1; });
      (playlistCounts || []).forEach(i => { if (i.user_id) playlistMap[i.user_id] = (playlistMap[i.user_id] || 0) + 1; });
      (playCounts || []).forEach(i => { playMap[i.user_id] = (playMap[i.user_id] || 0) + 1; });

      const usersWithCounts = (profiles || []).map(profile => ({
        ...profile,
        status: (profile as { status?: string }).status || 'active',
        account_type: (profile as { account_type?: string }).account_type || 'listener',
        is_admin: adminUserIds.has(profile.user_id),
        library_count: libraryMap[profile.user_id] || 0,
        playlist_count: playlistMap[profile.user_id] || 0,
        play_count: playMap[profile.user_id] || 0,
      }));

      setUsers(usersWithCounts);

    } catch (error) {
      console.error('Error fetching users:', error);
      toast.error('Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  const deleteUser = async (user: UserProfile) => {
    if (user.is_admin) { toast.error('Cannot delete the admin account.'); return; }
    const label = user.email || user.username || user.user_id;
    if (!confirm(`Permanently delete ${label}? This wipes their profile, library, playlists, plays, subscriptions and all uploads. This cannot be undone.`)) return;
    try {
      const { data, error } = await supabase.functions.invoke('admin-delete-user', {
        body: { user_id: user.user_id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success('User deleted everywhere');
      setUsers((prev) => prev.filter((u) => u.user_id !== user.user_id));
    } catch (err) {
      console.error('Delete user error:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to delete user');
    }
  };

  const updateUserStatus = async (user: UserProfile, newStatus: 'active' | 'banned' | 'suspended') => {
    const action = newStatus === 'banned' ? 'ban' : newStatus === 'suspended' ? 'suspend' : 'activate';
    if (!confirm(`${action} ${user.email || user.username}?`)) return;
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ status: newStatus })
        .eq('user_id', user.user_id);
      if (error) throw error;
      toast.success(`User ${action === 'ban' ? 'banned' : action === 'suspend' ? 'suspended' : 'activated'} successfully`);
      fetchUsers();
    } catch (err) {
      console.error('Status update error:', err);
      toast.error('Failed to update user status');
    }
  };

  const accountScopedUsers = users.filter((user) =>
    artistSignupView ? user.account_type === 'artist' : user.account_type !== 'artist',
  );

  const filteredUsers = accountScopedUsers.filter(user => {
    const matchesSearch = user.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.username?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = filterStatus === 'all' || user.status === filterStatus;
    return matchesSearch && matchesFilter;
  });

  const now = new Date();
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const stats = {
    total: accountScopedUsers.length,
    admins: accountScopedUsers.filter(u => u.is_admin).length,
    artists: accountScopedUsers.filter(u => u.account_type === 'artist').length,
    thisMonth: accountScopedUsers.filter(u => new Date(u.created_at) >= thisMonth).length,
    banned: accountScopedUsers.filter(u => u.status === 'banned').length,
    active: accountScopedUsers.filter(u => u.status === 'active').length,
  };

  const statCards = [
    { label: 'Total', value: stats.total, icon: Users, iconWrap: 'bg-primary/20', iconText: 'text-primary' },
    { label: 'Active', value: stats.active, icon: UserCheck, iconWrap: 'bg-green-500/20', iconText: 'text-green-500' },
    { label: 'Artist Signups', value: stats.artists, icon: Music, iconWrap: 'bg-primary/20', iconText: 'text-primary' },
    { label: 'Admins', value: stats.admins, icon: Crown, iconWrap: 'bg-accent/20', iconText: 'text-accent' },
    { label: 'Banned', value: stats.banned, icon: Ban, iconWrap: 'bg-red-500/20', iconText: 'text-red-500' },
    { label: 'New This Month', value: stats.thisMonth, icon: Calendar, iconWrap: 'bg-blue-500/20', iconText: 'text-blue-500' },
  ];

  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  const getInitials = (email: string | null, username: string | null) => {
    if (username) return username.slice(0, 2).toUpperCase();
    if (email) return email.slice(0, 2).toUpperCase();
    return 'U';
  };

  return (
    <div className="p-4 md:p-8">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <h1 className="text-2xl md:text-3xl font-display font-bold">
          {artistSignupView ? 'Artist Signups' : 'Manage Users'}
        </h1>
        <p className="text-muted-foreground mt-1">
          {artistSignupView
            ? 'Accounts created through the artist signup flow — separate from normal listeners.'
            : 'Listener accounts only. Artist signups are separated into their own admin view.'}
        </p>
      </motion.div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
        {statCards.map(s => (
          <div key={s.label} className="glass rounded-xl p-4 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg ${s.iconWrap} flex items-center justify-center`}>
              <s.icon className={`w-5 h-5 ${s.iconText}`} />
            </div>
            <div>
              <p className="text-xl font-bold">{s.value}</p>
              <p className="text-[10px] text-muted-foreground">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filter + Search */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="flex gap-2">
          {(['all', 'active', 'banned', 'suspended'] as const).map(f => (
            <Button key={f} variant={filterStatus === f ? 'default' : 'outline'} size="sm" onClick={() => setFilterStatus(f)} className="capitalize text-xs">
              {f}
            </Button>
          ))}
        </div>
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search users..." className="pl-10 bg-muted/50 border-white/10" />
        </div>
      </div>

      {/* Users Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
          <div className="col-span-full p-12 text-center">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="col-span-full p-12 text-center text-muted-foreground">
            <Users className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No users found</p>
          </div>
        ) : (
          <AnimatePresence>
            {filteredUsers.map((u, i) => (
              <motion.div
                key={u.id}
                className={`glass rounded-2xl p-4 hover:ring-1 hover:ring-primary/30 transition-all ${u.status === 'banned' ? 'opacity-60 border-red-500/20' : u.status === 'suspended' ? 'opacity-75 border-yellow-500/20' : ''}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.02 }}
              >
                <div className="flex items-start gap-4">
                  <Avatar className="w-12 h-12">
                    <AvatarImage src={u.avatar_url || undefined} />
                    <AvatarFallback className="bg-gradient-to-br from-primary to-accent text-primary-foreground">
                      {getInitials(u.email, u.username)}
                    </AvatarFallback>
                  </Avatar>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium truncate">{u.username || u.email || 'Anonymous'}</p>
                      {u.is_admin && (
                        <Badge variant="secondary" className="bg-accent/20 text-accent text-[10px]">
                          <Crown className="w-2.5 h-2.5 mr-0.5" /> Admin
                        </Badge>
                      )}
                      {u.account_type === 'artist' && (
                        <Badge className="bg-primary/15 text-primary border border-primary/20 text-[10px]">
                          <Music className="w-2.5 h-2.5 mr-0.5" /> Artist signup
                        </Badge>
                      )}
                      {u.status === 'banned' && (
                        <Badge variant="destructive" className="text-[10px]">Banned</Badge>
                      )}
                      {u.status === 'suspended' && (
                        <Badge className="bg-yellow-500/20 text-yellow-400 text-[10px]">Suspended</Badge>
                      )}
                    </div>
                    {u.email && u.username && (
                      <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                    )}
                    <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Heart className="w-3 h-3" />{u.library_count}</span>
                      <span className="flex items-center gap-1"><Music className="w-3 h-3" />{u.playlist_count}</span>
                      <span className="flex items-center gap-1"><PlayCircle className="w-3 h-3" />{u.play_count} plays</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
                      <Clock className="w-3 h-3" /> Joined {formatDate(u.created_at)}
                    </p>
                  </div>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label="User actions" className="h-8 w-8">
                        <MoreVertical className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="glass border-white/10">
                      <DropdownMenuItem onClick={() => u.email && window.open(`mailto:${u.email}`)}>
                        <Mail className="w-4 h-4 mr-2" /> Send Email
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {u.status !== 'banned' && (
                        <DropdownMenuItem onClick={() => updateUserStatus(u, 'banned')} className="text-red-400">
                          <Ban className="w-4 h-4 mr-2" /> Ban User
                        </DropdownMenuItem>
                      )}
                      {u.status !== 'suspended' && u.status !== 'banned' && (
                        <DropdownMenuItem onClick={() => updateUserStatus(u, 'suspended')} className="text-yellow-400">
                          <Clock className="w-4 h-4 mr-2" /> Suspend User
                        </DropdownMenuItem>
                      )}
                      {(u.status === 'banned' || u.status === 'suspended') && (
                        <DropdownMenuItem onClick={() => updateUserStatus(u, 'active')} className="text-green-400">
                          <UserCheck className="w-4 h-4 mr-2" /> Activate User
                        </DropdownMenuItem>
                      )}
                      {!u.is_admin && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => deleteUser(u)} className="text-red-500 focus:text-red-500">
                            <Trash2 className="w-4 h-4 mr-2" /> Delete User Permanently
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
};

export default ManageUsers;
