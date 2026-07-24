import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Search as SearchIcon, ShieldCheck, Loader2, CheckCircle2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import SEOHead from '@/components/SEOHead';
import { FadeTransition } from '@/components/PageTransition';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import ArtistLoading from './ArtistLoading';

type SearchRow = {
  id: string; stage_name: string; slug: string; avatar_url: string | null;
  is_claimed: boolean; total_plays: number | null;
};

export default function ArtistClaimProfile() {
  const { user, isLoading: loading } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<SearchRow | null>(null);
  const [proofMusic, setProofMusic] = useState('');
  const [proofSocial, setProofSocial] = useState('');
  const [proofNote, setProofNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [existingClaim, setExistingClaim] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user) { navigate('/artist/auth', { replace: true }); return; }
    (async () => {
      const { data } = await supabase
        .from('artist_claim_requests')
        .select('status').eq('user_id', user.id).eq('status','pending').maybeSingle();
      if (data?.status) setExistingClaim(data.status);
    })();
  }, [user, loading, navigate]);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      const { data, error } = await supabase
        .rpc('search_unclaimed_artist_profiles', { _query: query.trim(), _limit: 15 });
      setSearching(false);
      if (error) { toast.error('Search failed'); return; }
      setResults((data ?? []) as SearchRow[]);
    }, 220);
    return () => clearTimeout(t);
  }, [query]);

  const canSubmit = useMemo(
    () => !!selected && (proofMusic.trim().length > 4 || proofSocial.trim().length > 4),
    [selected, proofMusic, proofSocial],
  );

  async function submit() {
    if (!selected || !canSubmit || submitting) return;
    setSubmitting(true);
    const { error } = await supabase.rpc('submit_artist_claim', {
      _target_profile_id: selected.id,
      _proof_music_url: proofMusic.trim(),
      _proof_social_url: proofSocial.trim(),
      _proof_note: proofNote.trim(),
    });
    setSubmitting(false);
    if (error) { toast.error(error.message || 'Could not submit claim'); return; }
    toast.success('Claim sent! We\'ll review within 48 hours.');
    navigate('/artist/status', { replace: true });
  }

  if (loading) return <ArtistLoading />;

  if (existingClaim) {
    return (
      <FadeTransition>
        <div className="min-h-[100dvh] bg-[#0A0A0C] text-white grid place-items-center px-6">
          <div className="max-w-md text-center">
            <div className="w-14 h-14 rounded-2xl bg-[#FF2D55]/15 grid place-items-center mx-auto mb-4">
              <ShieldCheck className="w-6 h-6 text-[#FF2D55]" />
            </div>
            <h1 className="text-xl font-semibold">Claim already submitted</h1>
            <p className="text-white/60 text-sm mt-2">
              You have a pending claim under review. We'll notify you as soon as a decision is made.
            </p>
            <Button className="mt-6" onClick={() => navigate('/artist/status')}>View status</Button>
          </div>
        </div>
      </FadeTransition>
    );
  }

  return (
    <FadeTransition>
      <SEOHead title="Claim your artist profile — Univers Flow"
        description="Find and claim your existing artist page on Univers Flow. Verified within 48 hours." />
      <div className="min-h-[100dvh] bg-[#0A0A0C] text-white">
        <div className="max-w-2xl mx-auto px-5 pt-6 pb-28">
          <button onClick={() => navigate('/artist/onboarding')}
            className="inline-flex items-center gap-2 text-white/60 hover:text-white text-sm mb-6">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>

          <h1 className="text-[28px] font-bold tracking-tight">Claim your artist page</h1>
          <p className="text-white/60 text-sm mt-2">
            Find your name below. If you already have music on Universflow, we'll transfer the profile after a quick ownership check.
          </p>

          <div className="mt-6 relative">
            <SearchIcon className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => { setQuery(e.target.value); setSelected(null); }}
              placeholder="Search by stage name…"
              className="pl-10 h-12 bg-white/5 border-white/10 text-white placeholder:text-white/30"
            />
            {searching && <Loader2 className="w-4 h-4 absolute right-3.5 top-1/2 -translate-y-1/2 animate-spin text-white/40" />}
          </div>

          {!selected && (
            <div className="mt-3 space-y-1.5">
              {results.map((r) => (
                <motion.button
                  key={r.id}
                  whileTap={{ scale: 0.99 }}
                  onClick={() => { if (!r.is_claimed) setSelected(r); }}
                  disabled={r.is_claimed}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl border transition text-left
                              ${r.is_claimed
                                ? 'bg-white/[0.02] border-white/5 opacity-50 cursor-not-allowed'
                                : 'bg-white/[0.03] border-white/10 hover:border-white/25 hover:bg-white/[0.06]'}`}
                >
                  <div className="w-10 h-10 rounded-full bg-white/10 overflow-hidden shrink-0">
                    {r.avatar_url && <img src={r.avatar_url} alt="" className="w-full h-full object-cover" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-[15px] truncate">{r.stage_name}</div>
                    <div className="text-[12px] text-white/50">
                      {(r.total_plays ?? 0).toLocaleString()} plays
                      {r.is_claimed && <span className="ml-2 text-white/40">· claimed</span>}
                    </div>
                  </div>
                  {!r.is_claimed && <span className="text-[11px] text-[#FF2D55]">Claim →</span>}
                </motion.button>
              ))}
              {query.trim() && !searching && results.length === 0 && (
                <div className="text-center py-10">
                  <p className="text-white/50 text-sm">No matches. Not on Universflow yet?</p>
                  <Button variant="ghost" className="mt-2 text-[#FF2D55]" onClick={() => navigate('/artist/apply')}>
                    Distribute your music with us →
                  </Button>
                </div>
              )}
            </div>
          )}

          {selected && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              className="mt-5 rounded-2xl bg-white/[0.03] border border-white/10 p-5">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-white/10 overflow-hidden">
                  {selected.avatar_url && <img src={selected.avatar_url} alt="" className="w-full h-full object-cover" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold">{selected.stage_name}</div>
                  <button onClick={() => setSelected(null)} className="text-[11px] text-white/40 hover:text-white/80">
                    Choose different profile
                  </button>
                </div>
              </div>

              <div className="mt-5 space-y-4">
                <Field label="Link to your music on Spotify / Apple / YouTube Music"
                  placeholder="https://open.spotify.com/artist/…" value={proofMusic} onChange={setProofMusic} />
                <Field label="Link to your official social account"
                  placeholder="https://instagram.com/…" value={proofSocial} onChange={setProofSocial} />
                <div>
                  <label className="text-[12px] uppercase tracking-wider text-white/50">Notes to reviewer (optional)</label>
                  <Textarea value={proofNote} onChange={(e) => setProofNote(e.target.value.slice(0, 500))}
                    placeholder="Anything that helps prove this is you…"
                    className="mt-1.5 bg-white/5 border-white/10 text-white placeholder:text-white/30 min-h-[80px]" />
                  <div className="text-[10.5px] text-white/40 text-right mt-0.5">{proofNote.length}/500</div>
                </div>
              </div>

              <Button onClick={submit} disabled={!canSubmit || submitting}
                className="w-full mt-5 h-11 bg-[#FF2D55] hover:bg-[#FF2D55]/90 text-white font-semibold">
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : (<><CheckCircle2 className="w-4 h-4 mr-2" /> Send claim</>)}
              </Button>
              <p className="text-[11px] text-white/40 text-center mt-3">
                Reviewed within 48 hours. False claims permanently ban the account.
              </p>
            </motion.div>
          )}

          {!selected && !query.trim() && (
            <div className="mt-8 rounded-2xl bg-white/[0.03] border border-white/10 p-4 flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-white/10 grid place-items-center shrink-0">
                <Upload className="w-4 h-4" />
              </div>
              <div className="flex-1 text-sm">
                <div className="font-medium">Not on Universflow yet?</div>
                <div className="text-white/50 text-[13px] mt-0.5">Distribute your first single or EP — we're your distributor.</div>
              </div>
              <Button size="sm" variant="ghost" className="text-[#FF2D55]" onClick={() => navigate('/artist/apply')}>
                Start
              </Button>
            </div>
          )}
        </div>
      </div>
    </FadeTransition>
  );
}

function Field({ label, placeholder, value, onChange }:
  { label: string; placeholder: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-[12px] uppercase tracking-wider text-white/50">{label}</label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="mt-1.5 bg-white/5 border-white/10 text-white placeholder:text-white/30 h-11" />
    </div>
  );
}
