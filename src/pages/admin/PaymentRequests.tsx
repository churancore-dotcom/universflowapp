import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Check, X, Loader2, RefreshCw, Search, Crown } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

interface PaymentRequest {
  id: string;
  user_id: string;
  amount_paise: number;
  utr_number: string;
  status: 'pending' | 'approved' | 'rejected' | 'auto_approved';
  plan: string;
  notes: string | null;
  reviewed_at: string | null;
  created_at: string;
  user_email?: string | null;
}

const STATUS_TABS: Array<PaymentRequest['status'] | 'all'> = ['pending', 'approved', 'rejected', 'all'];

export default function PaymentRequests() {
  const [requests, setRequests] = useState<PaymentRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tab, setTab] = useState<PaymentRequest['status'] | 'all'>('pending');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase.from('payment_requests')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);
    if (tab !== 'all') q = q.eq('status', tab);
    const { data, error } = await q;
    if (error) {
      toast({ title: 'Failed to load', description: error.message, variant: 'destructive' });
      setLoading(false);
      return;
    }
    // Fetch emails
    const userIds = [...new Set((data ?? []).map(r => r.user_id))];
    let emailMap: Record<string, string> = {};
    if (userIds.length) {
      const { data: profs } = await supabase
        .from('profiles').select('user_id, email').in('user_id', userIds);
      emailMap = Object.fromEntries((profs ?? []).map(p => [p.user_id, p.email ?? '']));
    }
    setRequests((data ?? []).map(r => ({ ...r, user_email: emailMap[r.user_id] ?? null })) as PaymentRequest[]);
    setLoading(false);
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  // Realtime
  useEffect(() => {
    const ch = supabase
      .channel('payment_requests_admin')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_requests' }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const updateStatus = async (id: string, status: 'approved' | 'rejected') => {
    setBusyId(id);
    const req = requests.find(r => r.id === id);

    const { error } = await (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }>)('admin_review_payment_request', {
      p_request_id: id,
      p_status: status,
    });

    if (error) {
      setBusyId(null);
      toast({ title: 'Update failed', description: error.message, variant: 'destructive' });
      return;
    }

    setBusyId(null);
    toast({ title: status === 'approved' ? '✓ Premium granted' : 'Rejected' });
    // Telegram notify
    if (req) {
      supabase.functions.invoke('telegram-notify', {
        body: {
          event: status === 'approved' ? 'premium_granted' : 'payment_rejected',
          email: req.user_email ?? undefined,
          user_id: req.user_id,
          plan: req.plan,
          amount_inr: Math.round(req.amount_paise / 100),
          utr: req.utr_number,
        },
      }).catch(() => {});
    }
    load();
  };

  const filtered = requests.filter(r => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return r.utr_number.toLowerCase().includes(s)
      || (r.user_email ?? '').toLowerCase().includes(s)
      || r.user_id.toLowerCase().includes(s);
  });

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
            <Crown className="w-6 h-6 text-primary" />
            Payment Requests
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Verify UPI payments → approve grants premium based on plan (1 month or 3 months)
          </p>
        </div>
        <button onClick={load} className="p-2 rounded-lg bg-muted hover:bg-muted/70">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4 overflow-x-auto">
        {STATUS_TABS.map(s => (
          <button
            key={s}
            onClick={() => setTab(s)}
            className={`px-4 py-2 rounded-full text-sm font-medium capitalize whitespace-nowrap transition-colors ${
              tab === s
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/70'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by UTR, email, or user ID"
          className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-muted/40 border border-border text-sm outline-none focus:border-primary"
        />
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <p className="text-sm">No {tab === 'all' ? '' : tab} payment requests yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(r => (
            <motion.div
              key={r.id}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              className="rounded-xl p-4 border border-border bg-card"
            >
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[20px] font-bold">
                      ₹{(r.amount_paise / 100).toFixed(2)}
                    </span>
                    <StatusBadge status={r.status} />
                  </div>
                  <div className="text-[12px] space-y-0.5">
                    <p><span className="text-muted-foreground">Plan:</span> <span className="font-semibold">{({ monthly: '30 days', bimonthly: '60 days', quarterly: '90 days' } as Record<string, string>)[r.plan] ?? r.plan}</span> — approving grants exactly this</p>
                    <p><span className="text-muted-foreground">UTR:</span> <span className="font-mono">{r.utr_number}</span></p>
                    <p><span className="text-muted-foreground">User:</span> {r.user_email || r.user_id.slice(0, 12) + '…'}</p>
                    <p className="text-muted-foreground">
                      {new Date(r.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                    </p>
                  </div>
                </div>

                {r.status === 'pending' && (
                  <div className="flex gap-2">
                    <button
                      disabled={busyId === r.id}
                      onClick={() => updateStatus(r.id, 'approved')}
                      className="px-4 py-2 rounded-lg bg-green-500/15 text-green-500 hover:bg-green-500/25 text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {busyId === r.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      Approve
                    </button>
                    <button
                      disabled={busyId === r.id}
                      onClick={() => updateStatus(r.id, 'rejected')}
                      className="px-4 py-2 rounded-lg bg-red-500/15 text-red-500 hover:bg-red-500/25 text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50"
                    >
                      <X className="w-4 h-4" />
                      Reject
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

const StatusBadge = ({ status }: { status: PaymentRequest['status'] }) => {
  const map = {
    pending: { bg: 'bg-amber-500/15', fg: 'text-amber-500', label: 'Pending' },
    approved: { bg: 'bg-green-500/15', fg: 'text-green-500', label: 'Approved' },
    auto_approved: { bg: 'bg-green-500/15', fg: 'text-green-500', label: 'Auto-approved' },
    rejected: { bg: 'bg-red-500/15', fg: 'text-red-500', label: 'Rejected' },
  }[status];
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${map.bg} ${map.fg}`}>
      {map.label}
    </span>
  );
};
