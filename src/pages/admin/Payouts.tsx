import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, CheckCircle2, IndianRupee } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

type Row = {
  id: string;
  artist_user_id: string;
  streams_count: number;
  amount_inr: number;
  upi_id: string | null;
  status: string;
  requested_at: string;
  paid_at: string | null;
  admin_note: string | null;
  artist?: { username: string | null; avatar_url: string | null } | null;
};

const statusStyles: Record<string, string> = {
  pending: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  processing: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  paid: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  rejected: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
};

export default function AdminPayouts() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'paid'>('pending');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from('artist_payouts')
      .select('id, artist_user_id, streams_count, amount_inr, upi_id, status, requested_at, paid_at, admin_note')
      .order('requested_at', { ascending: false })
      .limit(200);
    if (filter === 'pending') q = q.in('status', ['pending', 'processing']);
    if (filter === 'paid') q = q.eq('status', 'paid');
    const { data, error } = await q;
    if (error) { toast.error(error.message); setLoading(false); return; }
    const list = (data ?? []) as Row[];
    const ids = Array.from(new Set(list.map((r) => r.artist_user_id)));
    if (ids.length) {
      const { data: profs } = await supabase
        .from('profiles').select('user_id, username, avatar_url').in('user_id', ids);
      const map = new Map((profs ?? []).map((p: any) => [p.user_id, p]));
      list.forEach((r) => { r.artist = map.get(r.artist_user_id) as any; });
    }
    setRows(list);
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const markPaid = async (row: Row) => {
    const note = window.prompt(`Confirm ₹${row.amount_inr} to ${row.upi_id ?? 'this artist'}?\n\nOptional note:`) ?? undefined;
    if (note === null) return;
    setBusy(row.id);
    const { error } = await supabase.rpc('admin_mark_payout_paid', { _payout_id: row.id, _admin_note: note || null });
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success('Payout marked as paid');
    load();
  };

  const reject = async (row: Row) => {
    const note = window.prompt('Reason for rejecting this payout?');
    if (!note) return;
    setBusy(row.id);
    const { error } = await supabase
      .from('artist_payouts')
      .update({ status: 'rejected', admin_note: note })
      .eq('id', row.id);
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success('Payout rejected');
    load();
  };

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-6 py-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-white flex items-center gap-2">
            <IndianRupee className="w-6 h-6" /> Artist payouts
          </h1>
          <p className="text-sm text-white/50 mt-1">Approve UPI transfers to verified artists.</p>
        </div>
        <div className="flex gap-1 p-1 rounded-full border border-white/10 bg-white/[0.03] text-xs">
          {(['pending', 'paid', 'all'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-full capitalize transition ${
                filter === f ? 'bg-white text-black font-semibold' : 'text-white/60 hover:text-white'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-white/40" /></div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-10 text-center text-white/40">
          No payouts in this view.
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-4 flex flex-col md:flex-row md:items-center gap-4">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                {r.artist?.avatar_url ? (
                  <img src={r.artist.avatar_url} alt="" className="w-10 h-10 rounded-full object-cover" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-white/10" />
                )}
                <div className="min-w-0">
                  <div className="text-white font-semibold text-sm truncate">{r.artist?.username ?? r.artist_user_id.slice(0, 8)}</div>
                  <div className="text-xs text-white/40 truncate">{r.upi_id ?? '—'} · {r.streams_count.toLocaleString('en-IN')} streams</div>
                </div>
              </div>
              <div className="text-white font-bold text-lg">₹{Number(r.amount_inr).toLocaleString('en-IN')}</div>
              <span className={`text-xs px-2 py-1 rounded-full border capitalize ${statusStyles[r.status] ?? ''}`}>{r.status}</span>
              <div className="text-xs text-white/40 whitespace-nowrap">{new Date(r.requested_at).toLocaleDateString()}</div>
              {(r.status === 'pending' || r.status === 'processing') && (
                <div className="flex gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === r.id}
                    onClick={() => reject(r)}
                    className="border-white/15"
                  >Reject</Button>
                  <Button
                    size="sm"
                    disabled={busy === r.id}
                    onClick={() => markPaid(r)}
                    className="bg-emerald-500 hover:bg-emerald-400 text-black font-semibold"
                  >
                    {busy === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <><CheckCircle2 className="w-3 h-3 mr-1" /> Mark paid</>}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
