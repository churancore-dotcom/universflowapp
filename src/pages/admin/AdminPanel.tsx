import { useEffect, useState, useCallback, type ReactNode } from 'react';
import { Navigate } from '@/lib/router-compat';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { toast } from 'sonner';

type ConfirmState = {
  title: string;
  description?: string;
  requireReason?: boolean;
  reasonLabel?: string;
  action: (reason: string) => Promise<void> | void;
} | null;

const fmtDate = (v?: string | null) =>
  v ? new Date(v).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '—';
const fmtRupees = (paise?: number | null) =>
  paise == null ? '—' : '₹' + (paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });

const AdminPanel = () => {
  const { user, isLoading } = useAuth();
  const [isAdmin, setIsAdmin] = useState<null | boolean>(null);
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [confirmReason, setConfirmReason] = useState('');
  const [confirmBusy, setConfirmBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user) { setIsAdmin(false); return; }
      const { data, error } = await supabase
        .from('profiles').select('is_admin').eq('user_id', user.id).maybeSingle();
      if (!cancelled) setIsAdmin(!error && !!data?.is_admin);
    })();
    return () => { cancelled = true; };
  }, [user]);

  const askConfirm = (c: NonNullable<ConfirmState>) => { setConfirmReason(''); setConfirm(c); };
  const runConfirm = async () => {
    if (!confirm) return;
    if (confirm.requireReason && !confirmReason.trim()) {
      toast.error('Please provide a reason'); return;
    }
    setConfirmBusy(true);
    try {
      await confirm.action(confirmReason.trim());
      setConfirm(null);
    } catch (e) {
      toast.error((e as Error).message || 'Action failed');
    } finally {
      setConfirmBusy(false);
    }
  };

  if (isLoading || isAdmin === null) return <div className="min-h-screen bg-background" />;
  if (!isAdmin) return <Navigate to="/" replace />;

  return (
    <div className="min-h-screen bg-background text-foreground p-4 md:p-6">
      <div className="max-w-7xl mx-auto">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold">Admin Console</h1>
          <p className="text-sm text-muted-foreground">Internal tools · read-write against RLS-guarded tables</p>
        </header>

        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="flex flex-wrap h-auto gap-1 mb-4 justify-start">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="support">Support</TabsTrigger>
            <TabsTrigger value="reports">Reports</TabsTrigger>
            <TabsTrigger value="artists">Artists</TabsTrigger>
            <TabsTrigger value="payments">Payments</TabsTrigger>
            <TabsTrigger value="users">Users</TabsTrigger>
            <TabsTrigger value="announcements">Announcements</TabsTrigger>
            <TabsTrigger value="audit">Audit</TabsTrigger>
          </TabsList>

          <TabsContent value="overview"><OverviewTab /></TabsContent>
          <TabsContent value="support"><SupportTab adminId={user!.id} askConfirm={askConfirm} /></TabsContent>
          <TabsContent value="reports"><ReportsTab askConfirm={askConfirm} /></TabsContent>
          <TabsContent value="artists"><ArtistAppsTab askConfirm={askConfirm} /></TabsContent>
          <TabsContent value="payments"><PaymentsTab askConfirm={askConfirm} /></TabsContent>
          <TabsContent value="users"><UsersTab askConfirm={askConfirm} /></TabsContent>
          <TabsContent value="announcements"><AnnouncementsTab askConfirm={askConfirm} /></TabsContent>
          <TabsContent value="audit"><AuditTab /></TabsContent>
        </Tabs>
      </div>

      <Dialog open={!!confirm} onOpenChange={(o) => !o && !confirmBusy && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirm?.title}</DialogTitle>
            {confirm?.description && <DialogDescription>{confirm.description}</DialogDescription>}
          </DialogHeader>
          {confirm?.requireReason && (
            <div className="space-y-2">
              <Label>{confirm.reasonLabel ?? 'Reason'}</Label>
              <Textarea
                value={confirmReason}
                onChange={(e) => setConfirmReason(e.target.value)}
                rows={3}
                placeholder="Required"
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(null)} disabled={confirmBusy}>Cancel</Button>
            <Button onClick={runConfirm} disabled={confirmBusy}>
              {confirmBusy ? 'Working…' : 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

/* ---------------- OVERVIEW ---------------- */
const OverviewTab = () => {
  const [stats, setStats] = useState({
    users: 0, unreadChats: 0, pendingReports: 0, pendingArtists: 0, pendingPayments: 0,
  });
  const [topSongs, setTopSongs] = useState<Array<{ id: string; title: string; artist: string; play_count: number | null }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [userCount, chats, reports, artists, payments, songs] = await Promise.all([
        supabase.rpc('get_user_count'),
        supabase.from('support_chats').select('id', { count: 'exact', head: true }).gt('unread_for_admin', 0),
        supabase.from('content_reports').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('artist_applications').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('payment_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('songs').select('id, title, artist, play_count').order('play_count', { ascending: false, nullsFirst: false }).limit(10),
      ]);
      setStats({
        users: Number(userCount.data ?? 0),
        unreadChats: chats.count ?? 0,
        pendingReports: reports.count ?? 0,
        pendingArtists: artists.count ?? 0,
        pendingPayments: payments.count ?? 0,
      });
      setTopSongs((songs.data ?? []) as never);
      setLoading(false);
    })();
  }, []);

  const cards = [
    { label: 'Total users', value: stats.users },
    { label: 'Unread support chats', value: stats.unreadChats },
    { label: 'Pending reports', value: stats.pendingReports },
    { label: 'Pending artist apps', value: stats.pendingArtists },
    { label: 'Pending payments', value: stats.pendingPayments },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {cards.map((c) => (
          <Card key={c.label} className="p-4">
            <div className="text-xs text-muted-foreground">{c.label}</div>
            <div className="text-2xl font-semibold mt-1">{loading ? '…' : c.value.toLocaleString()}</div>
          </Card>
        ))}
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b text-sm font-medium">Top 10 songs by plays</div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Artist</TableHead>
              <TableHead className="text-right">Plays</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {topSongs.map((s, i) => (
              <TableRow key={s.id}>
                <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                <TableCell className="font-medium">{s.title}</TableCell>
                <TableCell>{s.artist}</TableCell>
                <TableCell className="text-right tabular-nums">{(s.play_count ?? 0).toLocaleString()}</TableCell>
              </TableRow>
            ))}
            {!loading && topSongs.length === 0 && (
              <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No songs</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
};

/* ---------------- SUPPORT ---------------- */
type Chat = { id: string; user_id: string; last_message_at: string | null; unread_for_admin: number; status: string | null };
type Msg = { id: string; sender_role: string; sender_id: string | null; body: string; created_at: string };

const SupportTab = ({ adminId, askConfirm }: { adminId: string; askConfirm: (c: NonNullable<ConfirmState>) => void }) => {
  const [chats, setChats] = useState<Chat[]>([]);
  const [selected, setSelected] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [reply, setReply] = useState('');

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('support_chats')
      .select('id, user_id, last_message_at, unread_for_admin, status')
      .gt('unread_for_admin', 0)
      .order('last_message_at', { ascending: false });
    setChats((data ?? []) as Chat[]);
  }, []);
  useEffect(() => { load(); }, [load]);

  const openChat = async (c: Chat) => {
    setSelected(c);
    const { data } = await supabase
      .from('support_messages').select('*').eq('chat_id', c.id).order('created_at', { ascending: true });
    setMessages((data ?? []) as Msg[]);
  };

  const sendReply = () => {
    if (!selected || !reply.trim()) return;
    askConfirm({
      title: 'Send reply?',
      description: 'This message will be delivered to the user.',
      action: async () => {
        const body = reply.trim();
        const { error: e1 } = await supabase.from('support_messages').insert({
          chat_id: selected.id, sender_role: 'admin', sender_id: adminId, body,
        });
        if (e1) throw e1;
        const { error: e2 } = await supabase.from('support_chats').update({
          last_message_at: new Date().toISOString(), unread_for_user: 1, unread_for_admin: 0,
        }).eq('id', selected.id);
        if (e2) throw e2;
        toast.success('Reply sent');
        setReply('');
        await openChat(selected);
        await load();
      },
    });
  };

  return (
    <div className="grid md:grid-cols-[320px,1fr] gap-4">
      <Card className="p-0 overflow-hidden">
        <div className="px-3 py-2 border-b text-xs font-medium text-muted-foreground">
          Unread chats ({chats.length})
        </div>
        <div className="max-h-[70vh] overflow-y-auto">
          {chats.map((c) => (
            <button
              key={c.id}
              onClick={() => openChat(c)}
              className={`w-full text-left px-3 py-2 border-b hover:bg-muted/40 ${selected?.id === c.id ? 'bg-muted/60' : ''}`}
            >
              <div className="flex justify-between items-center text-xs">
                <span className="font-mono truncate">{c.user_id.slice(0, 8)}</span>
                <Badge variant="secondary">{c.unread_for_admin}</Badge>
              </div>
              <div className="text-xs text-muted-foreground mt-1">{fmtDate(c.last_message_at)}</div>
            </button>
          ))}
          {chats.length === 0 && <div className="p-6 text-center text-sm text-muted-foreground">No unread chats</div>}
        </div>
      </Card>

      <Card className="p-0 overflow-hidden flex flex-col min-h-[70vh]">
        {selected ? (
          <>
            <div className="px-4 py-3 border-b text-sm">
              <div className="font-medium">Chat with <span className="font-mono">{selected.user_id.slice(0, 8)}</span></div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {messages.map((m) => (
                <div key={m.id} className={`text-sm ${m.sender_role === 'admin' ? 'text-right' : ''}`}>
                  <div className={`inline-block max-w-[80%] px-3 py-2 rounded-lg ${m.sender_role === 'admin' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                    {m.body}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{fmtDate(m.created_at)}</div>
                </div>
              ))}
            </div>
            <div className="p-3 border-t flex gap-2">
              <Textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={2} placeholder="Type reply…" />
              <Button onClick={sendReply}>Send</Button>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">Select a chat</div>
        )}
      </Card>
    </div>
  );
};

/* ---------------- REPORTS ---------------- */
type Report = { id: string; content_type: string; content_id: string; reason: string | null; reporter_id: string | null; created_at: string };

const ReportsTab = ({ askConfirm }: { askConfirm: (c: NonNullable<ConfirmState>) => void }) => {
  const [rows, setRows] = useState<Report[]>([]);
  const load = useCallback(async () => {
    const { data } = await supabase.from('content_reports')
      .select('id, content_type, content_id, reason, reporter_id, created_at')
      .eq('status', 'pending').order('created_at', { ascending: false });
    setRows((data ?? []) as Report[]);
  }, []);
  useEffect(() => { load(); }, [load]);

  const resolve = (r: Report) => askConfirm({
    title: 'Resolve report',
    description: `${r.content_type} · ${r.content_id}`,
    requireReason: true,
    reasonLabel: 'Action taken',
    action: async (reason) => {
      const { error } = await supabase.from('content_reports').update({
        status: 'resolved', action_taken: reason, reviewed_at: new Date().toISOString(),
      }).eq('id', r.id);
      if (error) throw error;
      toast.success('Report resolved');
      await load();
    },
  });

  return (
    <Card className="p-0 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Type</TableHead>
            <TableHead>Content ID</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead>Reporter</TableHead>
            <TableHead>Created</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell><Badge variant="outline">{r.content_type}</Badge></TableCell>
              <TableCell className="font-mono text-xs">{r.content_id}</TableCell>
              <TableCell className="max-w-xs truncate">{r.reason}</TableCell>
              <TableCell className="font-mono text-xs">{r.reporter_id?.slice(0, 8)}</TableCell>
              <TableCell className="text-xs">{fmtDate(r.created_at)}</TableCell>
              <TableCell className="text-right">
                <Button size="sm" onClick={() => resolve(r)}>Resolve</Button>
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No pending reports</TableCell></TableRow>}
        </TableBody>
      </Table>
    </Card>
  );
};

/* ---------------- ARTIST APPLICATIONS ---------------- */
type ArtistApp = {
  id: string; stage_name: string | null; real_name: string | null; country_code: string | null;
  face_match_status: string | null; social_verified_status: string | null; created_at: string;
};

const ArtistAppsTab = ({ askConfirm }: { askConfirm: (c: NonNullable<ConfirmState>) => void }) => {
  const [rows, setRows] = useState<ArtistApp[]>([]);
  const load = useCallback(async () => {
    const { data } = await supabase.from('artist_applications')
      .select('id, stage_name, real_name, country_code, face_match_status, social_verified_status, created_at')
      .eq('status', 'pending').order('created_at', { ascending: false });
    setRows((data ?? []) as ArtistApp[]);
  }, []);
  useEffect(() => { load(); }, [load]);

  const approve = (a: ArtistApp) => askConfirm({
    title: 'Approve artist',
    description: `Approve "${a.stage_name}"? They will gain artist access.`,
    action: async () => {
      const { error } = await supabase.from('artist_applications')
        .update({ status: 'approved', reviewed_at: new Date().toISOString() }).eq('id', a.id);
      if (error) throw error;
      toast.success('Artist approved');
      await load();
    },
  });
  const reject = (a: ArtistApp) => askConfirm({
    title: 'Reject artist',
    description: `Reject "${a.stage_name}"?`,
    requireReason: true, reasonLabel: 'Rejection reason (admin note)',
    action: async (reason) => {
      const { error } = await supabase.from('artist_applications')
        .update({ status: 'rejected', admin_note: reason, reviewed_at: new Date().toISOString() }).eq('id', a.id);
      if (error) throw error;
      toast.success('Artist rejected');
      await load();
    },
  });

  return (
    <Card className="p-0 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Stage name</TableHead>
            <TableHead>Real name</TableHead>
            <TableHead>Country</TableHead>
            <TableHead>Face</TableHead>
            <TableHead>Social</TableHead>
            <TableHead>Created</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((a) => (
            <TableRow key={a.id}>
              <TableCell className="font-medium">{a.stage_name}</TableCell>
              <TableCell>{a.real_name}</TableCell>
              <TableCell>{a.country_code}</TableCell>
              <TableCell><Badge variant="outline">{a.face_match_status ?? '—'}</Badge></TableCell>
              <TableCell><Badge variant="outline">{a.social_verified_status ?? '—'}</Badge></TableCell>
              <TableCell className="text-xs">{fmtDate(a.created_at)}</TableCell>
              <TableCell className="text-right space-x-2">
                <Button size="sm" onClick={() => approve(a)}>Approve</Button>
                <Button size="sm" variant="destructive" onClick={() => reject(a)}>Reject</Button>
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No pending applications</TableCell></TableRow>}
        </TableBody>
      </Table>
    </Card>
  );
};

/* ---------------- PAYMENTS ---------------- */
type Payment = { id: string; user_id: string; plan: string | null; amount_paise: number | null; utr_number: string | null; payer_upi: string | null; created_at: string };

const PaymentsTab = ({ askConfirm }: { askConfirm: (c: NonNullable<ConfirmState>) => void }) => {
  const [rows, setRows] = useState<Payment[]>([]);
  const load = useCallback(async () => {
    const { data } = await supabase.from('payment_requests')
      .select('id, user_id, plan, amount_paise, utr_number, payer_upi, created_at')
      .eq('status', 'pending').order('created_at', { ascending: false });
    setRows((data ?? []) as Payment[]);
  }, []);
  useEffect(() => { load(); }, [load]);

  const review = (p: Payment, status: 'approved' | 'rejected') => askConfirm({
    title: status === 'approved' ? 'Approve payment' : 'Reject payment',
    description: `${p.plan} · ${fmtRupees(p.amount_paise)} · UTR ${p.utr_number ?? '—'}`,
    action: async () => {
      const { error } = await supabase.rpc('admin_review_payment_request', {
        p_request_id: p.id, p_status: status,
      });
      if (error) throw error;
      toast.success(`Payment ${status}`);
      await load();
    },
  });

  return (
    <Card className="p-0 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>User</TableHead>
            <TableHead>Plan</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>UTR</TableHead>
            <TableHead>Payer UPI</TableHead>
            <TableHead>Created</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((p) => (
            <TableRow key={p.id}>
              <TableCell className="font-mono text-xs">{p.user_id.slice(0, 8)}</TableCell>
              <TableCell>{p.plan}</TableCell>
              <TableCell className="tabular-nums">{fmtRupees(p.amount_paise)}</TableCell>
              <TableCell className="font-mono text-xs">{p.utr_number}</TableCell>
              <TableCell className="text-xs">{p.payer_upi}</TableCell>
              <TableCell className="text-xs">{fmtDate(p.created_at)}</TableCell>
              <TableCell className="text-right space-x-2">
                <Button size="sm" onClick={() => review(p, 'approved')}>Approve</Button>
                <Button size="sm" variant="destructive" onClick={() => review(p, 'rejected')}>Reject</Button>
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No pending payments</TableCell></TableRow>}
        </TableBody>
      </Table>
    </Card>
  );
};

/* ---------------- USERS ---------------- */
type Profile = {
  user_id: string; username: string | null; email: string | null; account_type: string | null;
  status: string | null; is_admin: boolean | null; email_verified: boolean | null; created_at: string;
};

const UsersTab = ({ askConfirm }: { askConfirm: (c: NonNullable<ConfirmState>) => void }) => {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Profile[]>([]);
  const [busy, setBusy] = useState(false);

  const search = async () => {
    const term = q.trim();
    if (!term) return;
    setBusy(true);
    const cols = 'user_id, username, email, account_type, status, is_admin, email_verified, created_at';
    const uuidLike = /^[0-9a-f-]{6,}$/i.test(term);
    const query = uuidLike
      ? supabase.from('profiles').select(cols).or(`user_id.eq.${term},username.ilike.%${term}%`)
      : supabase.from('profiles').select(cols).ilike('username', `%${term}%`);
    const { data, error } = await query.limit(25);
    if (error) toast.error(error.message);
    setRows((data ?? []) as Profile[]);
    setBusy(false);
  };

  const suspend = (u: Profile) => askConfirm({
    title: 'Suspend user',
    description: `Suspend ${u.username || u.user_id.slice(0, 8)}?`,
    requireReason: true, reasonLabel: 'Suspension reason',
    action: async (reason) => {
      const { error } = await supabase.from('profiles').update({ status: 'suspended' }).eq('user_id', u.user_id);
      if (error) throw error;
      await supabase.rpc('admin_log_event', {
        p_event_type: 'user_suspended', p_severity: 'warning',
        p_details: { user_id: u.user_id, reason } as never,
      });
      toast.success('User suspended');
      await search();
    },
  });
  const reinstate = (u: Profile) => askConfirm({
    title: 'Reinstate user',
    description: `Reinstate ${u.username || u.user_id.slice(0, 8)}?`,
    action: async () => {
      const { error } = await supabase.from('profiles').update({ status: 'active' }).eq('user_id', u.user_id);
      if (error) throw error;
      toast.success('User reinstated');
      await search();
    },
  });

  return (
    <div className="space-y-4">
      <Card className="p-4 flex gap-2">
        <Input placeholder="Search by user_id or username" value={q}
          onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} />
        <Button onClick={search} disabled={busy}>{busy ? 'Searching…' : 'Search'}</Button>
      </Card>

      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Username</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Admin</TableHead>
              <TableHead>Verified</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((u) => (
              <TableRow key={u.user_id}>
                <TableCell className="font-medium">{u.username || <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell className="text-xs">{u.email}</TableCell>
                <TableCell>{u.account_type}</TableCell>
                <TableCell>
                  <Badge variant={u.status === 'suspended' ? 'destructive' : 'outline'}>{u.status ?? 'active'}</Badge>
                </TableCell>
                <TableCell>{u.is_admin ? 'Yes' : '—'}</TableCell>
                <TableCell>{u.email_verified ? 'Yes' : '—'}</TableCell>
                <TableCell className="text-xs">{fmtDate(u.created_at)}</TableCell>
                <TableCell className="text-right space-x-2">
                  {u.status === 'suspended'
                    ? <Button size="sm" onClick={() => reinstate(u)}>Reinstate</Button>
                    : <Button size="sm" variant="destructive" onClick={() => suspend(u)}>Suspend</Button>}
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">No results</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
};

/* ---------------- ANNOUNCEMENTS ---------------- */
type Announcement = { id: string; title: string; message: string; target_audience: string | null; is_active: boolean; created_at: string };

const AnnouncementsTab = ({ askConfirm }: { askConfirm: (c: NonNullable<ConfirmState>) => void }) => {
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [audience, setAudience] = useState<'all' | 'premium' | 'free'>('all');
  const [rows, setRows] = useState<Announcement[]>([]);

  const load = useCallback(async () => {
    const { data } = await supabase.from('announcements')
      .select('id, title, message, target_audience, is_active, created_at')
      .eq('is_active', true).order('created_at', { ascending: false });
    setRows((data ?? []) as Announcement[]);
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = () => {
    if (!title.trim() || !message.trim()) { toast.error('Title and message required'); return; }
    askConfirm({
      title: 'Publish announcement?',
      description: `Target: ${audience}`,
      action: async () => {
        const { error } = await supabase.from('announcements').insert({
          title: title.trim(), message: message.trim(), target_audience: audience, is_active: true,
        } as never);
        if (error) throw error;
        toast.success('Announcement published');
        setTitle(''); setMessage(''); setAudience('all');
        await load();
      },
    });
  };
  const deactivate = (a: Announcement) => askConfirm({
    title: 'Deactivate announcement?',
    description: a.title,
    action: async () => {
      const { error } = await supabase.from('announcements').update({ is_active: false }).eq('id', a.id);
      if (error) throw error;
      toast.success('Deactivated');
      await load();
    },
  });

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <div className="text-sm font-medium">New announcement</div>
        <div className="grid md:grid-cols-3 gap-3">
          <div className="md:col-span-2 space-y-2">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Target audience</Label>
            <Select value={audience} onValueChange={(v) => setAudience(v as never)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All users</SelectItem>
                <SelectItem value="premium">Premium</SelectItem>
                <SelectItem value="free">Free</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-2">
          <Label>Message</Label>
          <Textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
        </div>
        <div className="flex justify-end"><Button onClick={create}>Publish</Button></div>
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b text-sm font-medium">Active announcements</div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Audience</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="font-medium">{a.title}</TableCell>
                <TableCell><Badge variant="outline">{a.target_audience}</Badge></TableCell>
                <TableCell className="text-xs">{fmtDate(a.created_at)}</TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="destructive" onClick={() => deactivate(a)}>Deactivate</Button>
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No active announcements</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
};

/* ---------------- AUDIT ---------------- */
type AuditRow = { id: string; event_type: string; severity: string | null; user_email: string | null; created_at: string };

const AuditTab = () => {
  const [rows, setRows] = useState<AuditRow[]>([]);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('audit_logs')
        .select('id, event_type, severity, user_email, created_at')
        .order('created_at', { ascending: false }).limit(30);
      setRows((data ?? []) as AuditRow[]);
    })();
  }, []);

  const sevColor: Record<string, string> = {
    info: 'outline', warn: 'secondary', warning: 'secondary', error: 'destructive', critical: 'destructive',
  };

  return (
    <Card className="p-0 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            <TableHead>Event</TableHead>
            <TableHead>Severity</TableHead>
            <TableHead>User</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="text-xs whitespace-nowrap">{fmtDate(r.created_at)}</TableCell>
              <TableCell className="font-mono text-xs">{r.event_type}</TableCell>
              <TableCell>
                <Badge variant={(sevColor[r.severity ?? 'info'] ?? 'outline') as never}>{r.severity ?? 'info'}</Badge>
              </TableCell>
              <TableCell className="text-xs">{r.user_email ?? '—'}</TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No events</TableCell></TableRow>}
        </TableBody>
      </Table>
    </Card>
  );
};

export default AdminPanel;
