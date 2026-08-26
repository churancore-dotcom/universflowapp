import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Building2, Check, X, Loader2 } from 'lucide-react';
import { safeHref } from '@/lib/safeHref';

type Req = {
  id: string; user_id: string; label_name: string; roster: any;
  proof_url: string | null; website: string | null; contact_email: string | null;
  status: string; admin_note: string | null; created_at: string;
};

export default function LabelRequests() {
  const [list, setList] = useState<Req[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    const { data } = await supabase.from('label_access_requests')
      .select('*').order('created_at', { ascending: false });
    setList((data ?? []) as Req[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const review = async (id: string, decision: 'approved' | 'rejected') => {
    setBusy(id);
    try {
      const { error } = await supabase.rpc('admin_review_label_access', {
        _id: id, _decision: decision, _admin_note: note[id] ?? null,
      });
      if (error) throw error;
      toast.success(`Marked ${decision}`);
      load();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(null); }
  };

  if (loading) return <div className="p-8 text-white/60">Loading…</div>;

  return (
    <div className="p-6 text-white">
      <h1 className="text-[24px] font-bold flex items-center gap-2 mb-6">
        <Building2 className="w-6 h-6 text-[#FF2D55]" /> Label Access Requests
      </h1>
      <div className="space-y-3">
        {list.length === 0 && <div className="text-white/50">No requests yet.</div>}
        {list.map(r => {
          const roster: any[] = Array.isArray(r.roster) ? r.roster : [];
          return (
            <div key={r.id} className="rounded-2xl bg-white/[0.03] border border-white/10 p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-[17px] font-bold">{r.label_name}</div>
                  <div className="text-[12px] text-white/50">
                    {new Date(r.created_at).toLocaleString()} · {r.status}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusPill s={r.status} />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[13px] text-white/70">
                {r.website && <div>Web: {safeHref(r.website) ? <a href={safeHref(r.website)!} target="_blank" rel="noreferrer" className="text-[#FF2D55] underline">{r.website}</a> : <span className="break-all">{r.website}</span>}</div>}
                {r.proof_url && <div>Proof: {safeHref(r.proof_url) ? <a href={safeHref(r.proof_url)!} target="_blank" rel="noreferrer" className="text-[#FF2D55] underline">{r.proof_url}</a> : <span className="break-all">{r.proof_url}</span>}</div>}
                {r.contact_email && <div>Contact: {r.contact_email}</div>}
                <div>Artists: {roster.map((a: any) => a.name).join(', ') || '—'}</div>
              </div>
              {r.status === 'pending' && (
                <div className="mt-4">
                  <input value={note[r.id] ?? ''} onChange={e => setNote({ ...note, [r.id]: e.target.value })}
                    placeholder="Admin note (optional)"
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-[13px]" />
                  <div className="flex gap-2 mt-3">
                    <button onClick={() => review(r.id, 'approved')} disabled={busy === r.id}
                      className="flex-1 h-10 rounded-xl bg-emerald-500 text-black font-semibold inline-flex items-center justify-center gap-1.5">
                      {busy === r.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Approve
                    </button>
                    <button onClick={() => review(r.id, 'rejected')} disabled={busy === r.id}
                      className="flex-1 h-10 rounded-xl bg-white/10 border border-white/15 font-semibold inline-flex items-center justify-center gap-1.5">
                      <X className="w-4 h-4" /> Reject
                    </button>
                  </div>
                </div>
              )}
              {r.admin_note && r.status !== 'pending' && (
                <div className="mt-3 text-[12px] text-white/60">Note: {r.admin_note}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusPill({ s }: { s: string }) {
  const map: Record<string, string> = {
    pending: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/25',
    approved: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
    rejected: 'bg-red-500/15 text-red-300 border-red-500/25',
  };
  return <span className={`text-[11px] uppercase tracking-wider px-2 py-1 rounded-md border ${map[s] ?? ''}`}>{s}</span>;
}
