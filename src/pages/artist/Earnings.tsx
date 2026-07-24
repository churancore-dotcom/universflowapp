import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { IndianRupee, TrendingUp, Wallet, Clock, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

type Summary = {
  total_streams: number;
  paid_streams: number;
  pending_streams: number;
  unpaid_streams: number;
  unpaid_amount_inr: number;
  unpaid_amount_usd: number;
  lifetime_amount_inr: number;
  lifetime_amount_usd: number;
  min_payout_inr: number;
  rate_per_1000_inr: number;
};

type Payout = {
  id: string;
  streams_count: number;
  amount_inr: number;
  status: 'pending' | 'processing' | 'paid' | 'rejected';
  upi_id: string | null;
  requested_at: string;
  paid_at: string | null;
  admin_note: string | null;
};

const statusStyles: Record<string, string> = {
  pending: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  processing: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  paid: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  rejected: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
};

export default function ArtistEarnings() {
  const { user } = useAuth();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [upi, setUpi] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [{ data: sum }, { data: rows }] = await Promise.all([
      supabase.rpc('get_artist_earnings_summary', { _artist_user_id: user.id }),
      supabase
        .from('artist_payouts')
        .select('id, streams_count, amount_inr, status, upi_id, requested_at, paid_at, admin_note')
        .eq('artist_user_id', user.id)
        .order('requested_at', { ascending: false })
        .limit(50),
    ]);
    if (sum) setSummary(sum as unknown as Summary);
    if (rows) setPayouts(rows as unknown as Payout[]);
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const canRequest = summary && summary.unpaid_amount_inr >= summary.min_payout_inr
    && !payouts.some((p) => p.status === 'pending' || p.status === 'processing');

  const submitPayout = async () => {
    const clean = upi.trim();
    if (!/^[a-zA-Z0-9._-]{2,64}@[a-zA-Z]{2,32}$/.test(clean)) {
      toast.error('Enter a valid UPI id (e.g. name@bank)');
      return;
    }
    setSubmitting(true);
    const { data, error } = await supabase.rpc('request_artist_payout', { _upi_id: clean });
    setSubmitting(false);
    if (error) {
      toast.error(error.message.replace('P0001: ', ''));
      return;
    }
    toast.success('Payout requested. We\'ll process it shortly.');
    setOpen(false);
    setUpi('');
    load();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="w-6 h-6 animate-spin text-white/40" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-6 py-6 md:py-10 space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-white">Earnings</h1>
        <p className="text-sm text-white/50 mt-1">
          ₹{summary?.rate_per_1000_inr ?? 25} per 1,000 verified streams · Minimum payout ₹{summary?.min_payout_inr ?? 500}
        </p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI icon={<Wallet className="w-4 h-4" />} label="Available" value={`₹${summary?.unpaid_amount_inr.toLocaleString('en-IN') ?? 0}`} accent="text-emerald-300" />
        <KPI icon={<Clock className="w-4 h-4" />} label="In progress" value={`${summary?.pending_streams.toLocaleString('en-IN') ?? 0} streams`} />
        <KPI icon={<CheckCircle2 className="w-4 h-4" />} label="Paid out" value={`${summary?.paid_streams.toLocaleString('en-IN') ?? 0} streams`} />
        <KPI icon={<TrendingUp className="w-4 h-4" />} label="Lifetime" value={`₹${summary?.lifetime_amount_inr.toLocaleString('en-IN') ?? 0}`} />
      </div>

      {/* Request payout */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 md:p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-white font-semibold">
              <IndianRupee className="w-4 h-4" /> Request a payout
            </div>
            <p className="text-sm text-white/50 mt-1">
              {canRequest
                ? `You have ₹${summary?.unpaid_amount_inr.toLocaleString('en-IN')} ready to withdraw.`
                : payouts.some((p) => p.status === 'pending' || p.status === 'processing')
                ? 'You already have a payout in progress. It will be processed within 3–5 business days.'
                : `Reach ₹${summary?.min_payout_inr} in available earnings to request your first payout.`}
            </p>
          </div>
          <button
            disabled={!canRequest}
            onClick={() => setOpen(true)}
            className="px-5 py-2.5 rounded-full bg-rose-500 text-white font-semibold text-sm hover:bg-rose-400 transition disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          >
            Request payout
          </button>
        </div>
      </div>

      {/* History */}
      <div>
        <h2 className="text-lg font-semibold text-white mb-3">Payout history</h2>
        {payouts.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-8 text-center text-sm text-white/40">
            No payouts yet. Keep making great music.
          </div>
        ) : (
          <div className="space-y-2">
            {payouts.map((p) => (
              <div key={p.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="text-white font-semibold text-sm">₹{Number(p.amount_inr).toLocaleString('en-IN')}</div>
                  <div className="text-xs text-white/40 mt-0.5">
                    {p.streams_count.toLocaleString('en-IN')} streams · {p.upi_id ?? 'UPI pending'} · {new Date(p.requested_at).toLocaleDateString()}
                  </div>
                  {p.admin_note && <div className="text-xs text-white/50 mt-1">Note: {p.admin_note}</div>}
                </div>
                <span className={`text-xs px-2 py-1 rounded-full border capitalize ${statusStyles[p.status] ?? ''}`}>
                  {p.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="text-xs text-white/30 flex items-start gap-2">
        <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <p>Earnings are calculated from verified streams only. Suspicious activity, duplicate plays, and streams under 30 seconds are excluded. Payouts are transferred manually via UPI within 3–5 business days.</p>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Request payout</DialogTitle>
            <DialogDescription>
              We'll send ₹{summary?.unpaid_amount_inr.toLocaleString('en-IN')} to your UPI id within 3–5 business days.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label className="text-sm text-white/70">UPI id</label>
            <Input
              value={upi}
              onChange={(e) => setUpi(e.target.value)}
              placeholder="yourname@bank"
              autoFocus
            />
            <Button
              onClick={submitPayout}
              disabled={submitting}
              className="w-full bg-rose-500 hover:bg-rose-400"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirm request'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function KPI({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex items-center gap-2 text-xs text-white/50">{icon}<span>{label}</span></div>
      <div className={`mt-2 text-lg md:text-xl font-bold ${accent ?? 'text-white'}`}>{value}</div>
    </div>
  );
}
