import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Crown, Crown as CrownOff, Ban, UserCheck, Clock, Mail, Music, Heart,
  ListMusic, PlayCircle, Smartphone, Globe, Calendar, ShieldCheck, Loader2,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { toast } from 'sonner';

export interface DrawerUser {
  id: string;
  user_id: string;
  email: string | null;
  username: string | null;
  avatar_url: string | null;
  is_admin: boolean;
  account_type: string;
  created_at: string;
  status: string;
  country_code?: string | null;
}

interface Subscription {
  id: string;
  subscription_type: string;
  platform: string;
  status: string;
  expires_at: string | null;
  created_at: string;
}

interface DeviceRow {
  id: string;
  platform: string;
  created_at: string;
}

interface PlayRow {
  id: string;
  song_id: string;
  played_at: string;
}

interface Props {
  user: DrawerUser | null;
  onClose: () => void;
  onStatusChange: (user: DrawerUser, status: 'active' | 'banned' | 'suspended') => void;
}

const UserDetailDrawer = ({ user, onClose, onStatusChange }: Props) => {
  const [loading, setLoading] = useState(false);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [plays, setPlays] = useState<PlayRow[]>([]);
  const [counts, setCounts] = useState({ library: 0, playlists: 0, plays: 0 });
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async (userId: string) => {
    setLoading(true);
    const [subsRes, devicesRes, playsRes, libRes, plRes, playCountRes] = await Promise.all([
      supabase.from('user_subscriptions').select('id, subscription_type, platform, status, expires_at, created_at')
        .eq('user_id', userId).order('created_at', { ascending: false }),
      supabase.from('device_tokens').select('id, platform, created_at')
        .eq('user_id', userId).order('created_at', { ascending: false }).limit(10),
      supabase.from('recently_played').select('id, song_id, played_at')
        .eq('user_id', userId).order('played_at', { ascending: false }).limit(10),
      supabase.from('user_library').select('*', { count: 'exact', head: true }).eq('user_id', userId),
      supabase.from('playlists').select('*', { count: 'exact', head: true }).eq('user_id', userId),
      supabase.from('recently_played').select('*', { count: 'exact', head: true }).eq('user_id', userId),
    ]);
    setSubs((subsRes.data as Subscription[] | null) || []);
    setDevices((devicesRes.data as DeviceRow[] | null) || []);
    setPlays((playsRes.data as PlayRow[] | null) || []);
    setCounts({
      library: libRes.count || 0,
      playlists: plRes.count || 0,
      plays: playCountRes.count || 0,
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    if (user) load(user.user_id);
    else { setSubs([]); setDevices([]); setPlays([]); }
  }, [user, load]);

  const activePremium = subs.find(
    (s) => s.status === 'active' && s.subscription_type !== 'free' &&
      (!s.expires_at || new Date(s.expires_at) > new Date()),
  );

  const grantPremium = async (days: 30 | 365) => {
    if (!user) return;
    setActing('grant');
    try {
      const expires = new Date();
      expires.setUTCDate(expires.getUTCDate() + days);
      const { error } = await supabase.from('user_subscriptions').insert({
        user_id: user.user_id,
        subscription_type: days === 30 ? 'premium_monthly' : 'premium_yearly',
        platform: 'web',
        status: 'active',
        expires_at: expires.toISOString(),
      });
      if (error) throw error;
      toast.success(`Premium granted for ${days} days`);
      await load(user.user_id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to grant Premium');
    } finally {
      setActing(null);
    }
  };

  const revokePremium = async () => {
    if (!user || !activePremium) return;
    if (!confirm(`Revoke Premium from ${user.email || user.username}?`)) return;
    setActing('revoke');
    try {
      const { error } = await supabase.from('user_subscriptions')
        .update({ status: 'cancelled' }).eq('id', activePremium.id);
      if (error) throw error;
      toast.success('Premium revoked');
      await load(user.user_id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to revoke Premium');
    } finally {
      setActing(null);
    }
  };

  const fmt = (d: string) => new Date(d).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  return (
    <AnimatePresence>
      {user && (
        <>
          <motion.div
            className="fixed inset-0 bg-black/60 z-40"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="fixed inset-y-0 right-0 w-full sm:max-w-md bg-background border-l border-white/10 z-50 overflow-y-auto"
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 260 }}
          >
            <div className="p-5 border-b border-white/5 flex items-start gap-3 sticky top-0 bg-background/95 backdrop-blur z-10">
              <Avatar className="w-12 h-12">
                <AvatarImage src={user.avatar_url || undefined} />
                <AvatarFallback className="bg-gradient-to-br from-primary to-accent text-primary-foreground">
                  {(user.username || user.email || 'U').slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="font-bold truncate">{user.username || user.email || 'Anonymous'}</p>
                {user.email && user.username && (
                  <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                )}
                <div className="flex gap-1.5 mt-1.5 flex-wrap">
                  {user.is_admin && <Badge variant="secondary" className="text-[10px]">Admin</Badge>}
                  {user.account_type === 'artist' && <Badge className="bg-primary/15 text-primary text-[10px]">Artist</Badge>}
                  <Badge variant="outline" className="text-[10px] capitalize">{user.status}</Badge>
                  {activePremium && <Badge className="bg-amber-500/20 text-amber-400 text-[10px]">Premium</Badge>}
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close user details">
                <X className="w-4 h-4" />
              </Button>
            </div>

            <div className="p-5 space-y-6">
              {/* Quick info */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="glass rounded-xl p-3 flex items-center gap-2">
                  <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                  <span>Joined {new Date(user.created_at).toLocaleDateString()}</span>
                </div>
                <div className="glass rounded-xl p-3 flex items-center gap-2">
                  <Globe className="w-3.5 h-3.5 text-muted-foreground" />
                  <span>{user.country_code || 'Unknown country'}</span>
                </div>
              </div>

              {/* Activity counts */}
              <div className="grid grid-cols-3 gap-2">
                {[
                  { icon: Heart, label: 'Liked', value: counts.library },
                  { icon: ListMusic, label: 'Playlists', value: counts.playlists },
                  { icon: PlayCircle, label: 'Plays', value: counts.plays },
                ].map((c) => (
                  <div key={c.label} className="glass rounded-xl p-3 text-center">
                    <c.icon className="w-4 h-4 mx-auto mb-1 text-primary" />
                    <p className="text-lg font-bold">{loading ? '…' : c.value}</p>
                    <p className="text-[10px] text-muted-foreground">{c.label}</p>
                  </div>
                ))}
              </div>

              {/* Premium controls */}
              {!user.is_admin && (
                <div className="glass rounded-2xl p-4">
                  <h3 className="font-semibold flex items-center gap-2 mb-3">
                    <Crown className="w-4 h-4 text-amber-400" /> Premium
                  </h3>
                  {activePremium ? (
                    <div className="space-y-3">
                      <p className="text-xs text-muted-foreground">
                        Active {activePremium.subscription_type.replace('_', ' ')} · expires{' '}
                        {activePremium.expires_at ? fmt(activePremium.expires_at) : 'never'}
                      </p>
                      <Button variant="destructive" size="sm" className="w-full"
                        onClick={revokePremium} disabled={acting !== null}>
                        {acting === 'revoke' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CrownOff className="w-4 h-4 mr-2" />}
                        Revoke Premium
                      </Button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <Button size="sm" className="flex-1" onClick={() => grantPremium(30)} disabled={acting !== null}>
                        {acting === 'grant' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Grant 30 days'}
                      </Button>
                      <Button size="sm" variant="outline" className="flex-1" onClick={() => grantPremium(365)} disabled={acting !== null}>
                        Grant 1 year
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* Subscription history */}
              {subs.length > 0 && (
                <div className="glass rounded-2xl p-4">
                  <h3 className="font-semibold flex items-center gap-2 mb-3">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" /> Subscription history
                  </h3>
                  <div className="space-y-2">
                    {subs.map((s) => (
                      <div key={s.id} className="flex items-center justify-between text-xs py-1.5 border-b border-white/5 last:border-0">
                        <span className="capitalize">{s.subscription_type.replace('_', ' ')} · {s.platform}</span>
                        <span className={s.status === 'active' ? 'text-emerald-400' : 'text-muted-foreground'}>
                          {s.status}{s.expires_at ? ` · ${fmt(s.expires_at)}` : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Devices */}
              <div className="glass rounded-2xl p-4">
                <h3 className="font-semibold flex items-center gap-2 mb-3">
                  <Smartphone className="w-4 h-4 text-violet-400" /> Devices ({devices.length})
                </h3>
                {devices.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No registered devices</p>
                ) : (
                  <div className="space-y-1.5">
                    {devices.map((d) => (
                      <div key={d.id} className="flex justify-between text-xs">
                        <span className="capitalize">{d.platform}</span>
                        <span className="text-muted-foreground">{fmt(d.created_at)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Recent plays */}
              <div className="glass rounded-2xl p-4">
                <h3 className="font-semibold flex items-center gap-2 mb-3">
                  <Music className="w-4 h-4 text-rose-400" /> Recent plays
                </h3>
                {plays.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No plays recorded</p>
                ) : (
                  <div className="space-y-1.5">
                    {plays.map((p) => (
                      <div key={p.id} className="flex justify-between text-xs gap-2">
                        <span className="truncate font-mono text-muted-foreground">{p.song_id.slice(0, 18)}…</span>
                        <span className="text-muted-foreground shrink-0">{fmt(p.played_at)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Account actions */}
              {!user.is_admin && (
                <div className="glass rounded-2xl p-4 space-y-2">
                  <h3 className="font-semibold mb-1">Account actions</h3>
                  {user.status !== 'banned' && (
                    <Button variant="outline" size="sm" className="w-full text-red-400 border-red-500/30"
                      onClick={() => onStatusChange(user, 'banned')}>
                      <Ban className="w-4 h-4 mr-2" /> Ban user
                    </Button>
                  )}
                  {user.status === 'active' && (
                    <Button variant="outline" size="sm" className="w-full text-yellow-400 border-yellow-500/30"
                      onClick={() => onStatusChange(user, 'suspended')}>
                      <Clock className="w-4 h-4 mr-2" /> Suspend user
                    </Button>
                  )}
                  {(user.status === 'banned' || user.status === 'suspended') && (
                    <Button variant="outline" size="sm" className="w-full text-emerald-400 border-emerald-500/30"
                      onClick={() => onStatusChange(user, 'active')}>
                      <UserCheck className="w-4 h-4 mr-2" /> Reactivate user
                    </Button>
                  )}
                  {user.email && (
                    <Button variant="ghost" size="sm" className="w-full"
                      onClick={() => window.open(`mailto:${user.email}`)}>
                      <Mail className="w-4 h-4 mr-2" /> Email user
                    </Button>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default UserDetailDrawer;
