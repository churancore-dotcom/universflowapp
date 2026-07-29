import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from '@/lib/router-compat';
import { motion } from 'framer-motion';
import { ArrowLeft, KeyRound, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import SEOHead from '@/components/SEOHead';
import { FadeTransition } from '@/components/PageTransition';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import ArtistLoading from './ArtistLoading';

type InviteInfo = {
  role: string;
  artist_profile_id: string;
  stage_name?: string;
  avatar_url?: string | null;
  expires_at: string;
  status: string;
  email: string;
};

export default function JoinTeam() {
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [code, setCode] = useState(sp.get('code') ?? '');
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      const next = encodeURIComponent(`/artist/team/join${code ? `?code=${code}` : ''}`);
      navigate(`/artist/auth?next=${next}`, { replace: true });
    }
  }, [user, isLoading, code, navigate]);

  const lookup = async (c: string) => {
    if (!c || c.length < 6) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('artist_team_invites')
        .select('role, artist_profile_id, expires_at, status, email')
        .eq('code', c.trim().toLowerCase())
        .maybeSingle();
      if (error || !data) { toast.error('Invite not found or not for this account.'); setInvite(null); return; }
      let stage_name: string | undefined; let avatar_url: string | null | undefined;
      const { data: p } = await supabase
        .from('artist_profiles').select('stage_name, avatar_url').eq('id', data.artist_profile_id).maybeSingle();
      stage_name = p?.stage_name; avatar_url = p?.avatar_url;
      setInvite({ ...data, stage_name, avatar_url });
    } finally { setLoading(false); }
  };

  useEffect(() => { if (code) lookup(code); /* eslint-disable-next-line */ }, []);

  const accept = async () => {
    if (!invite) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc('accept_artist_invite', { _code: code.trim().toLowerCase() });
      if (error) throw error;
      const res = data as any;
      if (res?.error) { toast.error(humanize(res.error)); return; }
      toast.success(`You joined ${invite.stage_name ?? 'the team'} as ${invite.role}`);
      navigate('/artist/studio', { replace: true });
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to accept invite');
    } finally { setBusy(false); }
  };

  const decline = async () => {
    setBusy(true);
    try {
      const { error } = await supabase.rpc('decline_artist_invite', { _code: code.trim().toLowerCase() });
      if (error) throw error;
      toast.success('Invite declined');
      setInvite(null); setCode(''); setSp({});
    } catch (e: any) { toast.error(e.message ?? 'Failed'); }
    finally { setBusy(false); }
  };

  if (isLoading || !user) return <ArtistLoading />;

  return (
    <FadeTransition>
      <SEOHead title="Join an artist's team" description="Accept your Univers Flow team invite." />
      <div className="min-h-[100dvh] bg-[#0A0A0C] text-white">
        <div className="max-w-lg mx-auto px-5 pt-6 pb-24">
          <button onClick={() => navigate('/artist/onboarding')}
            className="inline-flex items-center gap-2 text-white/60 hover:text-white text-sm mb-8">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>

          <motion.h1 initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            className="text-[28px] font-bold tracking-tight mb-2">
            Join an artist's team
          </motion.h1>
          <p className="text-white/60 text-[14px] mb-8">
            Paste the invite code you received. Invites are tied to your email.
          </p>

          {!invite && (
            <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-5">
              <label className="text-[12px] uppercase tracking-wider text-white/50 mb-2 block">Invite code</label>
              <div className="flex gap-2">
                <div className="flex-1 flex items-center gap-2 rounded-xl bg-black/40 border border-white/10 px-3">
                  <KeyRound className="w-4 h-4 text-white/40" />
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="e.g. 2f9a1b7c…"
                    className="flex-1 bg-transparent py-3 outline-none text-[14px]"
                  />
                </div>
                <button
                  onClick={() => lookup(code)}
                  disabled={loading || !code}
                  className="px-4 rounded-xl bg-white text-black font-semibold disabled:opacity-40">
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Look up'}
                </button>
              </div>
            </div>
          )}

          {invite && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl bg-white/[0.03] border border-white/10 p-5">
              <div className="flex items-center gap-4">
                {invite.avatar_url
                  ? <img src={invite.avatar_url} alt="" className="w-14 h-14 rounded-full object-cover" />
                  : <div className="w-14 h-14 rounded-full bg-white/10" />}
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-wider text-white/50">Invitation to join</div>
                  <div className="font-semibold text-[17px] truncate">{invite.stage_name ?? 'Artist team'}</div>
                  <div className="text-[13px] text-white/60">as {invite.role}</div>
                </div>
              </div>
              <div className="mt-4 text-[12.5px] text-white/60">
                Invited email: <span className="text-white/80">{invite.email}</span>
              </div>
              {invite.status !== 'pending' && (
                <div className="mt-4 text-[12.5px] text-yellow-300/80">
                  This invite is {invite.status}.
                </div>
              )}
              <div className="flex gap-2 mt-6">
                <button
                  onClick={accept}
                  disabled={busy || invite.status !== 'pending'}
                  className="flex-1 h-11 rounded-xl bg-[#FF2D55] font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-40">
                  <CheckCircle2 className="w-4 h-4" /> Accept
                </button>
                <button
                  onClick={decline}
                  disabled={busy || invite.status !== 'pending'}
                  className="h-11 px-4 rounded-xl bg-white/10 border border-white/15 font-semibold inline-flex items-center gap-2 disabled:opacity-40">
                  <XCircle className="w-4 h-4" /> Decline
                </button>
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </FadeTransition>
  );
}

function humanize(err: string) {
  const map: Record<string,string> = {
    unauthorized: 'Please sign in first.',
    invite_not_found: 'That invite code does not exist.',
    invite_expired: 'This invite has expired.',
    invite_declined: 'This invite was declined.',
    invite_revoked: 'This invite was revoked.',
    invite_active: 'This invite was already accepted.',
    email_mismatch: 'Your email does not match the invite.',
  };
  return map[err] ?? err;
}
