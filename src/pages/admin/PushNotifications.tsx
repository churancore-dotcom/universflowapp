import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, Send, Users, Clock, Target, BarChart3, Plus, Trash2, RefreshCw, Smartphone, Link as LinkIcon, Search, X, UserCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

type Audience = 'all' | 'premium' | 'free' | 'specific';
type NotifType = 'info' | 'success' | 'warning';
type Channel = 'in_app' | 'push' | 'both';

interface Announcement {
  id: string;
  title: string;
  message: string;
  type: NotifType;
  target_audience: Audience;
  is_active: boolean;
  starts_at: string;
  ends_at: string | null;
  created_at: string;
}

interface PushHistoryItem {
  id: string;
  title: string;
  body: string;
  deep_link: string | null;
  target_audience: string;
  sent_count: number;
  success_count: number;
  failure_count: number;
  created_at: string;
}

const audienceLabels: Record<Audience, string> = {
  all: 'All Users',
  premium: 'Premium Only',
  free: 'Free Users',
  specific: 'Specific User',
};

interface UserHit {
  user_id: string;
  email: string | null;
  username: string | null;
  avatar_url: string | null;
}

interface KPI { delivered: number; opened: number; clicked: number; }
interface AnnouncementEventRow { announcement_id: string; event_type: string; }

const getFunctionErrorMessage = async (error: unknown) => {
  const context = (error as { context?: Response })?.context;
  if (context) {
    try {
      const payload = await context.clone().json();
      if (typeof payload?.error === 'string') return payload.error;
    } catch {
      // Fall back to the SDK error message below.
    }
  }
  return error instanceof Error ? error.message : 'Push notification failed';
};

const PushNotifications = () => {
  const [items, setItems] = useState<Announcement[]>([]);
  const [pushHistory, setPushHistory] = useState<PushHistoryItem[]>([]);
  const [deviceCount, setDeviceCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [reach, setReach] = useState({ all: 0, premium: 0, free: 0 });
  const [kpi, setKpi] = useState<Record<string, KPI>>({});
  const [draft, setDraft] = useState({
    title: '',
    message: '',
    target_audience: 'all' as Audience,
    type: 'info' as NotifType,
    channel: 'push' as Channel,
    deep_link: '/home',
  });

  // Specific-user picker state
  const [userQuery, setUserQuery] = useState('');
  const [userHits, setUserHits] = useState<UserHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserHit | null>(null);

  useEffect(() => {
    if (draft.target_audience !== 'specific') return;
    const q = userQuery.trim();
    if (q.length < 2) { setUserHits([]); return; }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('profiles')
        .select('user_id, email, username, avatar_url')
        .or(`email.ilike.%${q}%,username.ilike.%${q}%`)
        .limit(10);
      if (!cancelled) {
        setUserHits((data ?? []) as UserHit[]);
        setSearching(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [userQuery, draft.target_audience]);

  const fetchKPIs = useCallback(async () => {
    const { data } = await supabase.from('announcement_events').select('announcement_id, event_type');
    const map: Record<string, KPI> = {};
    ((data || []) as AnnouncementEventRow[]).forEach((row) => {
      const k = map[row.announcement_id] ||= { delivered: 0, opened: 0, clicked: 0 };
      if (row.event_type === 'delivered') k.delivered++;
      else if (row.event_type === 'opened') k.opened++;
      else if (row.event_type === 'clicked') k.clicked++;
    });
    setKpi(map);
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [annRes, profilesRes, premiumRes, devicesRes, pushRes] = await Promise.all([
      supabase.from('announcements').select('*').order('created_at', { ascending: false }),
      supabase.from('profiles').select('*', { count: 'exact', head: true }),
      supabase.from('user_subscriptions').select('user_id, status, subscription_type, expires_at')
        .neq('subscription_type', 'free').eq('status', 'active'),
      supabase.from('device_tokens').select('id', { count: 'exact', head: true }),
      supabase.from('push_history').select('*').order('created_at', { ascending: false }).limit(20),
    ]);
    if (annRes.error) toast.error('Failed to load notifications');
    setItems((annRes.data ?? []) as Announcement[]);
    setPushHistory((pushRes.data ?? []) as PushHistoryItem[]);
    setDeviceCount(devicesRes.count ?? 0);

    const totalUsers = profilesRes.count ?? 0;
    const premiumActive = (premiumRes.data ?? []).filter(s =>
      !s.expires_at || new Date(s.expires_at) > new Date()
    ).length;
    setReach({
      all: totalUsers, premium: premiumActive,
      free: Math.max(totalUsers - premiumActive, 0),
    });
    await fetchKPIs();
    setLoading(false);
  }, [fetchKPIs]);

  useEffect(() => {
    fetchAll();
    const ch = supabase.channel('announcements_admin')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements' }, fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'push_history' }, fetchAll)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'announcement_events' }, fetchKPIs)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [fetchAll, fetchKPIs]);

  const sendInFlight = useRef(false);

  const send = async () => {
    if (sendInFlight.current) return;
    if (!draft.title.trim() || !draft.message.trim()) {
      toast.error('Title and message are required');
      return;
    }
    if (draft.target_audience === 'specific' && !selectedUser) {
      toast.error('Pick a user to send to');
      return;
    }
    // Specific user can only receive push (in-app banners are audience-wide)
    const effectiveChannel: Channel =
      draft.target_audience === 'specific' ? 'push' : draft.channel;

    setSaving(true);
    sendInFlight.current = true;

    let inAppOk = true;
    let pushOk = true;

    try {
      // 1) In-app banner
      if (effectiveChannel === 'in_app' || effectiveChannel === 'both') {
        const { error } = await supabase.from('announcements').insert({
          title: draft.title.trim(),
          message: draft.message.trim(),
          type: draft.type,
          target_audience: draft.target_audience,
          is_active: true,
          deep_link: draft.deep_link.trim() || '/home',
        });
        if (error) {
          inAppOk = false;
          toast.error(`In-app: ${error.message}`);
        }
      }

      // 2) Real push via FCM
      if (effectiveChannel === 'push' || effectiveChannel === 'both') {
        const { data, error } = await supabase.functions.invoke('send-push', {
          body: {
            title: draft.title.trim(),
            body: draft.message.trim(),
            deep_link: draft.deep_link.trim() || '/home',
            target_audience: draft.target_audience,
            target_user_ids:
              draft.target_audience === 'specific' && selectedUser
                ? [selectedUser.user_id]
                : undefined,
          },
        });
        if (error) {
          pushOk = false;
          toast.error(`Push: ${await getFunctionErrorMessage(error)}`);
        } else if (data?.success) {
          const who =
            draft.target_audience === 'specific' && selectedUser
              ? ` to ${selectedUser.username || selectedUser.email || 'user'}`
              : '';
          if (data.sent === 0) {
            pushOk = false;
            toast.error(
              'Push not delivered: 0 devices registered for this audience',
              { description: 'Users must open the Android app at least once before they can receive push notifications.' },
            );
          } else if ((data.failure_count ?? 0) > 0 && (data.success_count ?? 0) === 0) {
            pushOk = false;
            const diagnostic = Array.isArray(data.diagnostics) && data.diagnostics[0]?.body
              ? String(data.diagnostics[0].body)
              : 'FCM rejected the registered device token.';
            toast.error('Push failed at Firebase delivery', { description: diagnostic.slice(0, 160) });
          } else {
            toast.success(
              `Push delivered${who} → ${data.success_count}/${data.sent} devices` +
                (data.invalid_removed ? ` · cleaned ${data.invalid_removed} stale` : ''),
            );
          }
        }
      }

      if (inAppOk && pushOk) {
        if (effectiveChannel === 'in_app' && draft.target_audience !== 'specific') {
          toast.success(`Banner sent to ${reach[draft.target_audience]?.toLocaleString?.() ?? '?'} users`);
        }
        setDraft({
          title: '', message: '', target_audience: 'all', type: 'info',
          channel: 'push', deep_link: '/home',
        });
        setSelectedUser(null);
        setUserQuery('');
        setUserHits([]);
        setShowCompose(false);
      }
    } finally {
      sendInFlight.current = false;
      setSaving(false);
    }
  };

  const toggleActive = async (n: Announcement) => {
    const { error } = await supabase.from('announcements')
      .update({ is_active: !n.is_active }).eq('id', n.id);
    if (error) toast.error(error.message);
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this notification?')) return;
    const { error } = await supabase.from('announcements').delete().eq('id', id);
    if (error) toast.error(error.message); else toast.success('Deleted');
  };

  const removePushHistory = async (id: string) => {
    if (!confirm('Delete this push history entry?')) return;
    const { error } = await supabase.from('push_history').delete().eq('id', id);
    if (error) toast.error(error.message); else toast.success('Push deleted');
  };

  const clearAllPushHistory = async () => {
    if (!confirm('Delete ALL push history entries? This cannot be undone.')) return;
    const { error } = await supabase.from('push_history').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) toast.error(error.message); else toast.success('Push history cleared');
  };

  const totalReach = items
    .filter(n => n.is_active)
    .reduce((sum, n) => sum + ((reach as Record<string, number>)[n.target_audience] ?? 0), 0);

  const stats = [
    { label: 'In-App Banners', value: items.length.toLocaleString(), icon: Send },
    { label: 'Push Sent (recent)', value: pushHistory.length.toLocaleString(), icon: Bell },
    { label: 'Registered Devices', value: deviceCount.toLocaleString(), icon: Smartphone },
    { label: 'Total Users', value: reach.all.toLocaleString(), icon: Users },
  ];

  return (
    <div className="p-4 md:p-8">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-display font-bold flex items-center gap-3">
              <Bell className="w-8 h-8 text-primary" />
              Notifications
            </h1>
            <p className="text-muted-foreground mt-1">
              Send one clean Android push by default. Use in-app banners only when you intentionally want an on-screen app banner.
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                const t = toast.loading('Enabling auto messages…');
                try {
                  const { data, error } = await supabase.functions.invoke('bootstrap-system-push');
                  if (error) throw error;
                  toast.success('Auto premium messages enabled', { id: t, description: data?.message });
                } catch (e) {
                  toast.error('Failed to enable', { id: t, description: e instanceof Error ? e.message : String(e) });
                }
              }}
            >
              Enable Auto Messages
            </Button>
            <Button variant="outline" size="sm" onClick={fetchAll} disabled={loading}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            <Button onClick={() => setShowCompose(true)} className="gap-2">
              <Plus className="w-4 h-4" /> New
            </Button>
          </div>
        </div>
      </motion.div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {stats.map((stat, i) => (
          <motion.div key={stat.label} className="glass rounded-xl p-4"
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
            <stat.icon className="w-5 h-5 text-primary mb-2" />
            <p className="text-xs text-muted-foreground">{stat.label}</p>
            <p className="text-xl font-bold">{stat.value}</p>
          </motion.div>
        ))}
      </div>

      <AnimatePresence>
        {showCompose && (
          <motion.div className="glass rounded-2xl p-6 mb-8"
            initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
              <Send className="w-5 h-5 text-primary" /> Compose
            </h2>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-1.5 block">Title</label>
                <Input placeholder="Notification title" value={draft.title}
                  onChange={(e) => setDraft(p => ({ ...p, title: e.target.value }))} />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Message</label>
                <Textarea placeholder="Notification message" rows={3} value={draft.message}
                  onChange={(e) => setDraft(p => ({ ...p, message: e.target.value }))} />
              </div>

              <div>
                <label className="text-sm font-medium mb-1.5 block">Channel</label>
                <div className="flex gap-2 flex-wrap">
                  {([
                    { key: 'in_app' as Channel, label: 'In-App Banner' },
                    { key: 'push' as Channel, label: 'Push Notification' },
                    { key: 'both' as Channel, label: 'Both (push + banner)' },
                  ]).map(c => (
                    <button key={c.key} onClick={() => setDraft(p => ({ ...p, channel: c.key }))}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                        draft.channel === c.key ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'
                      }`}>
                      {c.label}
                    </button>
                  ))}
                </div>
                {(draft.channel === 'push' || draft.channel === 'both') && deviceCount === 0 && (
                  <p className="text-xs text-amber-400 mt-2">
                    ⚠ No devices registered yet. Push will be logged but no one will receive it.
                  </p>
                )}
              </div>

              {(draft.channel === 'push' || draft.channel === 'both') && (
                <div>
                  <label className="text-sm font-medium mb-1.5 flex items-center gap-2">
                    <LinkIcon className="w-4 h-4" /> Deep link (where the tap opens)
                  </label>
                  <Input
                    placeholder="/home, /song/abc, /playlist/xyz, /artist/name"
                    value={draft.deep_link}
                    onChange={(e) => setDraft(p => ({ ...p, deep_link: e.target.value }))}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Use a path like <code>/song/abc123</code> or a full URL.
                  </p>
                </div>
              )}

              <div>
                <label className="text-sm font-medium mb-1.5 block">Audience</label>
                <div className="flex gap-2 flex-wrap">
                  {(Object.keys(audienceLabels) as Audience[]).map((key) => (
                    <button key={key} onClick={() => setDraft(p => ({ ...p, target_audience: key }))}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                        draft.target_audience === key ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'
                      }`}>
                      {audienceLabels[key]}
                      {key !== 'specific' && (
                        <span className="opacity-60"> ({reach[key]?.toLocaleString?.() ?? 0})</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {draft.target_audience === 'specific' && (
                <div className="space-y-2">
                  <label className="text-sm font-medium flex items-center gap-2">
                    <UserCircle2 className="w-4 h-4" /> Send to user
                  </label>
                  {selectedUser ? (
                    <div className="flex items-center justify-between gap-3 p-3 rounded-lg bg-primary/10 border border-primary/30">
                      <div className="flex items-center gap-3 min-w-0">
                        {selectedUser.avatar_url ? (
                          <img src={selectedUser.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover" />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                            <UserCircle2 className="w-5 h-5 text-primary" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="font-medium truncate">
                            {selectedUser.username || selectedUser.email || selectedUser.user_id}
                          </p>
                          {selectedUser.username && selectedUser.email && (
                            <p className="text-xs text-muted-foreground truncate">{selectedUser.email}</p>
                          )}
                        </div>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => setSelectedUser(null)}>
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  ) : (
                    <>
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                          className="pl-9"
                          placeholder="Search by email or username (min 2 chars)"
                          value={userQuery}
                          onChange={(e) => setUserQuery(e.target.value)}
                        />
                      </div>
                      {searching && (
                        <p className="text-xs text-muted-foreground">Searching…</p>
                      )}
                      {!searching && userQuery.trim().length >= 2 && userHits.length === 0 && (
                        <p className="text-xs text-muted-foreground">No users match "{userQuery}".</p>
                      )}
                      {userHits.length > 0 && (
                        <div className="max-h-56 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                          {userHits.map((u) => (
                            <button
                              key={u.user_id}
                              onClick={() => { setSelectedUser(u); setUserQuery(''); setUserHits([]); }}
                              className="w-full text-left p-3 hover:bg-muted transition-colors flex items-center gap-3"
                            >
                              {u.avatar_url ? (
                                <img src={u.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover" />
                              ) : (
                                <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                                  <UserCircle2 className="w-5 h-5 text-muted-foreground" />
                                </div>
                              )}
                              <div className="min-w-0">
                                <p className="font-medium truncate">{u.username || u.email || u.user_id}</p>
                                {u.username && u.email && (
                                  <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                                )}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Specific-user notifications are push-only and require the recipient to have opened the Android app at least once.
                  </p>
                </div>
              )}
              <div>
                <label className="text-sm font-medium mb-1.5 block">Style (in-app banner)</label>
                <div className="flex gap-2 flex-wrap">
                  {(['info', 'success', 'warning'] as NotifType[]).map(t => (
                    <button key={t} onClick={() => setDraft(p => ({ ...p, type: t }))}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                        draft.type === t ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'
                      }`}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <Button variant="outline" onClick={() => setShowCompose(false)} className="flex-1">Cancel</Button>
                <Button onClick={send} disabled={saving} className="flex-1 gap-2">
                  <Send className="w-4 h-4" /> {saving ? 'Sending…' : 'Send Now'}
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {pushHistory.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Smartphone className="w-5 h-5 text-primary" /> Push History
            </h2>
            <Button variant="ghost" size="sm" onClick={clearAllPushHistory} className="text-destructive">
              <Trash2 className="w-4 h-4 mr-1.5" /> Clear all
            </Button>
          </div>
          <div className="space-y-3">
            {pushHistory.map((p) => (
              <div key={p.id} className="glass rounded-xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold">{p.title}</h3>
                    <p className="text-sm text-muted-foreground line-clamp-2">{p.body}</p>
                    {p.deep_link && (
                      <p className="text-xs text-primary mt-1 flex items-center gap-1">
                        <LinkIcon className="w-3 h-3" /> {p.deep_link}
                      </p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-muted-foreground">
                      {new Date(p.created_at).toLocaleString()}
                    </p>
                    <p className="text-sm font-semibold mt-1">
                      <span className="text-emerald-400">{p.success_count}</span>
                      <span className="text-muted-foreground"> / {p.sent_count}</span>
                      {p.failure_count > 0 && (
                        <span className="text-destructive"> · {p.failure_count} failed</span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground capitalize">{p.target_audience}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removePushHistory(p.id)}
                    className="text-destructive shrink-0 self-start"
                    aria-label="Delete push entry"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 className="text-xl font-bold mb-4">In-App Banners</h2>
        <div className="space-y-4">
          {loading ? (
            <p className="text-center text-muted-foreground py-12">Loading…</p>
          ) : items.length === 0 ? (
            <p className="text-center text-muted-foreground py-12">No banners yet.</p>
          ) : items.map((n, index) => (
            <motion.div key={n.id} className="glass rounded-2xl p-5"
              initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}
              transition={{ delay: Math.min(index * 0.03, 0.3) }}>
              <div className="flex items-start justify-between mb-3 gap-3">
                <div className="min-w-0">
                  <h3 className="font-bold text-lg">{n.title}</h3>
                  <p className="text-muted-foreground text-sm mt-1">{n.message}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    n.is_active ? 'bg-emerald-500/20 text-emerald-400' : 'bg-muted text-muted-foreground'
                  }`}>
                    {n.is_active ? 'Active' : 'Disabled'}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => toggleActive(n)}>
                    {n.is_active ? 'Disable' : 'Enable'}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => remove(n.id)} className="text-destructive">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <div className="flex items-center gap-4 text-xs flex-wrap mb-2">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Users className="w-3.5 h-3.5" /> {audienceLabels[n.target_audience as Audience] ?? n.target_audience}
                </span>
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Send className="w-3.5 h-3.5" /> Reach ~{((reach as Record<string, number>)[n.target_audience] ?? 0).toLocaleString()}
                </span>
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Clock className="w-3.5 h-3.5" /> {new Date(n.created_at).toLocaleString()}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-2 pt-3 border-t border-border/40">
                {(['delivered','opened','clicked'] as const).map(k => {
                  const v = kpi[n.id]?.[k] ?? 0;
                  const denom = k === 'delivered' ? Math.max((reach as Record<string, number>)[n.target_audience] ?? 0, 1) : Math.max(kpi[n.id]?.delivered ?? 0, 1);
                  const pct = Math.min(100, Math.round((v / denom) * 100));
                  const colors = { delivered: 'hsl(195 100% 55%)', opened: 'hsl(145 80% 50%)', clicked: 'hsl(var(--primary))' } as const;
                  return (
                    <div key={k} className="rounded-lg p-2 bg-muted/30">
                      <p className="text-[10px] uppercase text-muted-foreground tracking-wide">{k}</p>
                      <p className="text-lg font-bold" style={{ color: colors[k] }}>{v.toLocaleString()}</p>
                      <p className="text-[10px] text-muted-foreground">{pct}%</p>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default PushNotifications;
