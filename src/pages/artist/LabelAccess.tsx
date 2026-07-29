import { useEffect, useState } from 'react';
import { useNavigate } from '@/lib/router-compat';
import { motion } from 'framer-motion';
import { ArrowLeft, Building2, Plus, Trash2, Loader2 } from 'lucide-react';
import SEOHead from '@/components/SEOHead';
import { FadeTransition } from '@/components/PageTransition';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import ArtistLoading from './ArtistLoading';

export default function LabelAccess() {
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();
  const [label, setLabel] = useState('');
  const [website, setWebsite] = useState('');
  const [contact, setContact] = useState(user?.email ?? '');
  const [proof, setProof] = useState('');
  const [roster, setRoster] = useState<string[]>(['']);
  const [busy, setBusy] = useState(false);
  const [existing, setExisting] = useState<any>(null);

  useEffect(() => {
    if (isLoading) return;
    if (!user) { navigate('/artist/auth', { replace: true }); return; }
    (async () => {
      const { data } = await supabase.from('label_access_requests')
        .select('*').eq('user_id', user.id)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      setExisting(data);
      if (!contact) setContact(user.email ?? '');
    })();
    // eslint-disable-next-line
  }, [user, isLoading]);

  const submit = async () => {
    if (label.trim().length < 2) { toast.error('Label name required'); return; }
    const cleanRoster = roster.map(r => r.trim()).filter(Boolean);
    if (cleanRoster.length === 0) { toast.error('Add at least one artist'); return; }
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc('submit_label_access_request', {
        _label_name: label.trim(),
        _roster: cleanRoster.map(name => ({ name })) as any,
        _proof_url: proof.trim() || '',
        _website: website.trim() || '',
        _contact_email: contact.trim() || '',
      });
      if (error) throw error;
      const res = data as any;
      if (res?.error) { toast.error(res.error); return; }
      toast.success('Request submitted. We\'ll review within 3–5 days.');
      navigate('/artist/onboarding');
    } catch (e: any) { toast.error(e.message ?? 'Failed'); }
    finally { setBusy(false); }
  };

  if (isLoading || !user) return <ArtistLoading />;

  return (
    <FadeTransition>
      <SEOHead title="Request label access" description="Univers Flow for Labels — request roster-wide access." />
      <div className="min-h-[100dvh] bg-[#0A0A0C] text-white">
        <div className="max-w-xl mx-auto px-5 pt-6 pb-24">
          <button onClick={() => navigate('/artist/onboarding')}
            className="inline-flex items-center gap-2 text-white/60 hover:text-white text-sm mb-8">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>

          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.18em]
                            text-[#FF2D55] bg-[#FF2D55]/10 border border-[#FF2D55]/25
                            px-2.5 py-1 rounded-full mb-4">
              <Building2 className="w-3 h-3" /> Label & Distributor
            </div>
            <h1 className="text-[28px] font-bold tracking-tight">Request label access</h1>
            <p className="text-white/60 mt-2 text-[14px]">
              We'll grant you admin seats on each artist profile in your roster after verification.
            </p>
          </motion.div>

          {existing && existing.status === 'pending' && (
            <div className="mt-6 rounded-xl bg-yellow-500/10 border border-yellow-500/25 p-4 text-[13px] text-yellow-200">
              You have a pending request for <b>{existing.label_name}</b>. Submit again to update it.
            </div>
          )}
          {existing && existing.status === 'approved' && (
            <div className="mt-6 rounded-xl bg-emerald-500/10 border border-emerald-500/25 p-4 text-[13px] text-emerald-200">
              Approved. Your label access is active.
            </div>
          )}

          <div className="mt-6 space-y-4">
            <Field label="Label name">
              <input value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Univers Records"
                className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-3 text-[14px] outline-none focus:border-white/30" />
            </Field>
            <Field label="Website">
              <input value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://…"
                className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-3 text-[14px] outline-none focus:border-white/30" />
            </Field>
            <Field label="Contact email">
              <input value={contact} onChange={e => setContact(e.target.value)} type="email"
                className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-3 text-[14px] outline-none focus:border-white/30" />
            </Field>
            <Field label="Proof (distributor dashboard, catalog page, etc.)">
              <input value={proof} onChange={e => setProof(e.target.value)} placeholder="https://…"
                className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-3 text-[14px] outline-none focus:border-white/30" />
            </Field>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[12px] uppercase tracking-wider text-white/50">Artists on your roster</label>
                <button onClick={() => setRoster([...roster, ''])}
                  className="text-[12px] inline-flex items-center gap-1 text-[#FF2D55]">
                  <Plus className="w-3 h-3" /> Add
                </button>
              </div>
              <div className="space-y-2">
                {roster.map((r, i) => (
                  <div key={i} className="flex gap-2">
                    <input value={r} onChange={e => {
                      const next = [...roster]; next[i] = e.target.value; setRoster(next);
                    }} placeholder="Artist stage name"
                      className="flex-1 bg-black/40 border border-white/10 rounded-xl px-3 py-3 text-[14px] outline-none focus:border-white/30" />
                    {roster.length > 1 && (
                      <button onClick={() => setRoster(roster.filter((_, j) => j !== i))}
                        className="w-11 h-11 rounded-xl bg-white/5 border border-white/10 grid place-items-center">
                        <Trash2 className="w-4 h-4 text-white/60" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <button onClick={submit} disabled={busy}
              className="w-full h-12 rounded-xl bg-[#FF2D55] font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-40">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              Submit request
            </button>
            <p className="text-[11px] text-white/40 text-center">
              Verification typically takes 3–5 business days.
            </p>
          </div>
        </div>
      </div>
    </FadeTransition>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[12px] uppercase tracking-wider text-white/50 mb-1.5 block">{label}</label>
      {children}
    </div>
  );
}
