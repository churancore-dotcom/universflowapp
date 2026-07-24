import { useEffect, useState } from 'react';
import { Loader2, CheckCircle2, XCircle, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

type Row = {
  id: string; user_id: string; target_profile_id: string; stage_name: string;
  proof_music_url: string | null; proof_social_url: string | null; proof_note: string | null;
  status: string; created_at: string;
};

export default function AdminArtistClaims() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from('artist_claim_requests').select('*').eq('status','pending').order('created_at', { ascending: false });
    setRows((data ?? []) as Row[]);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function decide(id: string, decision: 'approved' | 'rejected') {
    setBusy(id);
    const { error } = await supabase.rpc('admin_review_artist_claim', {
      _claim_id: id, _decision: decision, _admin_note: notes[id] ?? null,
    });
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success(`Claim ${decision}`);
    load();
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-1">Artist profile claims</h1>
      <p className="text-sm text-muted-foreground mb-6">Pending ownership requests for existing artist pages.</p>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">No pending claims.</div>
      ) : (
        <div className="space-y-4">
          {rows.map((r) => (
            <div key={r.id} className="border rounded-xl p-4 bg-card">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-lg">{r.stage_name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Requested by <code className="text-[11px]">{r.user_id.slice(0,8)}</code>
                    {' · '}{new Date(r.created_at).toLocaleString()}
                  </div>
                  <div className="mt-3 space-y-1.5 text-sm">
                    {r.proof_music_url && (
                      <a href={r.proof_music_url} target="_blank" rel="noreferrer"
                        className="flex items-center gap-1.5 text-primary hover:underline">
                        <ExternalLink className="w-3 h-3" /> Music proof
                      </a>
                    )}
                    {r.proof_social_url && (
                      <a href={r.proof_social_url} target="_blank" rel="noreferrer"
                        className="flex items-center gap-1.5 text-primary hover:underline">
                        <ExternalLink className="w-3 h-3" /> Social proof
                      </a>
                    )}
                    {r.proof_note && <div className="text-muted-foreground italic">"{r.proof_note}"</div>}
                  </div>
                  <Textarea placeholder="Admin note (optional)…"
                    value={notes[r.id] ?? ''} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}
                    className="mt-3 min-h-[60px]" />
                </div>
                <div className="flex flex-col gap-2 shrink-0">
                  <Button size="sm" onClick={() => decide(r.id, 'approved')} disabled={busy === r.id}
                    className="bg-green-600 hover:bg-green-700 text-white">
                    <CheckCircle2 className="w-4 h-4 mr-1" /> Approve
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => decide(r.id, 'rejected')} disabled={busy === r.id}>
                    <XCircle className="w-4 h-4 mr-1" /> Reject
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
