import { confirmAction } from '@/lib/confirmDialog';
import { useEffect, useMemo, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Smartphone, RefreshCw, Search, Send, Wifi, WifiOff, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

interface DeviceRow {
  id: string;
  user_id: string;
  token: string;
  platform: string | null;
  device_info: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  username?: string | null;
  email?: string | null;
  avatar_url?: string | null;
}

type DeviceTokenRow = Pick<DeviceRow, 'id' | 'user_id' | 'token' | 'platform' | 'device_info' | 'created_at' | 'updated_at'>;
type ProfileRow = { user_id: string; username: string | null; email: string | null; avatar_url: string | null };

const formatRelative = (iso: string): string => {
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
};

const ONLINE_THRESHOLD = 5 * 60 * 1000; // 5 min

const RegisteredDevices = () => {
  const [rows, setRows] = useState<DeviceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [sending, setSending] = useState<string | null>(null);
  const [composeFor, setComposeFor] = useState<DeviceRow | null>(null);
  const [draft, setDraft] = useState({ title: '', body: '', deep_link: '/home' });

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const { data: tokens, error } = await supabase
      .from('device_tokens')
      .select('id, user_id, token, platform, device_info, created_at, updated_at')
      .order('updated_at', { ascending: false })
      .limit(500);
    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }
    const userIds = Array.from(new Set((tokens ?? []).map((t) => t.user_id)));
    const profiles: Record<string, { username: string | null; email: string | null; avatar_url: string | null }> = {};
    if (userIds.length) {
      const { data: profs } = await supabase
        .from('profiles')
        .select('user_id, username, email, avatar_url')
        .in('user_id', userIds);
      ((profs ?? []) as ProfileRow[]).forEach((p) => {
        profiles[p.user_id] = { username: p.username, email: p.email, avatar_url: p.avatar_url };
      });
    }
    setRows(
      ((tokens ?? []) as DeviceTokenRow[]).map((t) => ({
        ...t,
        ...profiles[t.user_id],
      })),
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAll();
    const ch = supabase
      .channel('admin_devices')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'device_tokens' }, fetchAll)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [fetchAll]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => {
      const hay = [
        r.username,
        r.email,
        r.device_info?.model,
        r.device_info?.manufacturer,
        r.device_info?.os,
        r.platform,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [rows, q]);

  const onlineCount = useMemo(
    () => rows.filter((r) => Date.now() - new Date(r.updated_at).getTime() < ONLINE_THRESHOLD).length,
    [rows],
  );

  const sendToUser = async () => {
    if (!composeFor) return;
    if (!draft.title.trim() || !draft.body.trim()) {
      toast.error('Title and message required');
      return;
    }
    setSending(composeFor.id);
    const { data, error } = await supabase.functions.invoke('send-push', {
      body: {
        title: draft.title.trim(),
        body: draft.body.trim(),
        deep_link: draft.deep_link.trim() || '/home',
        target_audience: 'specific',
        target_user_ids: [composeFor.user_id],
      },
    });
    setSending(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (data?.success) {
      if ((data.failure_count ?? 0) > 0 && (data.success_count ?? 0) === 0) {
        const diagnostic = Array.isArray(data.diagnostics) && data.diagnostics[0]?.body
          ? String(data.diagnostics[0].body)
          : 'FCM rejected the registered device token.';
        toast.error('Push failed at Firebase delivery', { description: diagnostic.slice(0, 160) });
        return;
      }
      toast.success(`Sent → ${data.success_count}/${data.sent} devices`);
      setComposeFor(null);
      setDraft({ title: '', body: '', deep_link: '/home' });
    }
  };

  const removeDevice = async (id: string) => {
    if (!await confirmAction('Remove this device registration?')) return;
    const { error } = await supabase.from('device_tokens').delete().eq('id', id);
    if (error) toast.error(error.message);
    else toast.success('Removed');
  };

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Registered Devices</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every device that opened the APK and granted push permission. No external API used.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-xs">
            <span className="font-bold text-foreground">{rows.length}</span>{' '}
            <span className="text-muted-foreground">total</span>
          </div>
          <div className="px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs flex items-center gap-1.5">
            <Wifi className="w-3 h-3 text-emerald-400" />
            <span className="font-bold text-emerald-300">{onlineCount}</span>
            <span className="text-emerald-300/70">online now</span>
          </div>
          <Button size="sm" variant="outline" onClick={fetchAll}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by user, device model or OS"
          className="pl-9"
        />
      </div>

      {loading ? (
        <div className="text-center py-10 text-muted-foreground text-sm">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-white/10 rounded-2xl">
          <Smartphone className="w-8 h-8 mx-auto text-muted-foreground/40" />
          <p className="text-sm mt-3 font-semibold">No registered devices yet</p>
          <p className="text-xs text-muted-foreground mt-1 px-6">
            Users must install the APK, sign in, and grant notification permission once.
            Their device will appear here automatically.
          </p>
        </div>
      ) : (
        <div className="grid gap-2">
          {filtered.map((d) => {
            const isOnline = Date.now() - new Date(d.updated_at).getTime() < ONLINE_THRESHOLD;
            const info = d.device_info ?? {};
            const model = typeof info.model === 'string' ? info.model : 'Unknown device';
            const mfr = typeof info.manufacturer === 'string' ? info.manufacturer : '';
            const osName = typeof info.os === 'string' ? info.os : '';
            const osVersion = typeof info.os_version === 'string' ? info.os_version : '';
            const os = osName ? `${osName} ${osVersion}`.trim() : d.platform || 'unknown';
            return (
              <motion.div
                key={d.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-2xl p-3 bg-white/[0.03] border border-white/10 flex items-center gap-3"
              >
                <div className="relative">
                  {d.avatar_url ? (
                    <img src={d.avatar_url} alt="" className="w-10 h-10 rounded-full object-cover" />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-xs font-bold text-primary-foreground">
                      {(d.username || d.email || '?').slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-background ${
                      isOnline ? 'bg-emerald-400' : 'bg-muted-foreground/40'
                    }`}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold truncate">{d.username || d.email || 'Anonymous'}</p>
                    {isOnline ? (
                      <span className="text-[10px] font-bold text-emerald-400">ONLINE</span>
                    ) : (
                      <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <WifiOff className="w-2.5 h-2.5" /> {formatRelative(d.updated_at)}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {mfr} {model} · {os}
                  </p>
                  <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                    Registered {formatRelative(d.created_at)} · {d.platform ?? '—'}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => {
                      setComposeFor(d);
                      setDraft({ title: '', body: '', deep_link: '/home' });
                    }}
                  >
                    <Send className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => removeDevice(d.id)}>
                    <Trash2 className="w-3.5 h-3.5 text-destructive" />
                  </Button>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {composeFor && (
        <div
          className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-md flex items-center justify-center p-4"
          onClick={() => setComposeFor(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl bg-card border border-border/50 p-5 space-y-3"
          >
            <div>
              <h3 className="text-lg font-bold">Send push</h3>
              <p className="text-xs text-muted-foreground">
                To {composeFor.username || composeFor.email}
              </p>
            </div>
            <Input
              placeholder="Title"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
            <Textarea
              placeholder="Message"
              rows={3}
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            />
            <Input
              placeholder="Deep link (e.g. /premium)"
              value={draft.deep_link}
              onChange={(e) => setDraft({ ...draft, deep_link: e.target.value })}
            />
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => setComposeFor(null)}>
                Cancel
              </Button>
              <Button onClick={sendToUser} disabled={sending === composeFor.id}>
                <Send className="w-4 h-4 mr-1.5" />
                {sending === composeFor.id ? 'Sending…' : 'Send'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RegisteredDevices;
