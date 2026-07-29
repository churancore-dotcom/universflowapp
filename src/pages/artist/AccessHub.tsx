import { useEffect, useState } from 'react';
import { Link, useNavigate } from '@/lib/router-compat';
import { motion } from 'framer-motion';
import { ArrowRight, ArrowLeft, Search, Users, Building2, CheckCircle2, Music2 } from 'lucide-react';
import SEOHead from '@/components/SEOHead';
import { FadeTransition } from '@/components/PageTransition';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import ArtistLoading from './ArtistLoading';

/**
 * Univers Flow Access Hub — Spotify for Artists parity.
 *   1) Claim your artist profile     → /artist/claim  (or /artist/apply if none exists)
 *   2) I'm on an artist's team       → /artist/team/join
 *   3) I'm a label / distributor     → /artist/label/access
 */
export default function AccessHub() {
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (isLoading) return;
    if (!user) { navigate('/artist/auth', { replace: true }); return; }
    let alive = true;
    (async () => {
      const { data: mem } = await supabase
        .from('artist_team_members')
        .select('artist_profile_id, role, status')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle();
      if (!alive) return;
      if (mem?.artist_profile_id) { navigate('/artist/studio', { replace: true }); return; }

      const { data: app } = await supabase
        .from('artist_applications_safe').select('status').eq('user_id', user.id).maybeSingle();
      if (!alive) return;
      if (app?.status && app.status !== 'rejected') {
        navigate('/artist/status', { replace: true }); return;
      }
      setChecking(false);
    })();
    return () => { alive = false; };
  }, [user, isLoading, navigate]);

  if (isLoading || checking) return <ArtistLoading />;

  return (
    <FadeTransition>
      <SEOHead
        title="Get access to Univers Flow for Artists"
        description="Claim your artist profile, join an artist's team, or request label access on Univers Flow."
      />
      <div className="min-h-[100dvh] bg-[#0A0A0C] text-white overflow-x-hidden">
        <div className="max-w-2xl mx-auto px-5 pt-6 pb-24">
          <button onClick={() => navigate(-1)}
            className="inline-flex items-center gap-2 text-white/60 hover:text-white text-sm mb-8">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>

          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mb-10">
            <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.18em]
                            text-[#FF2D55] bg-[#FF2D55]/10 border border-[#FF2D55]/25
                            px-2.5 py-1 rounded-full mb-4">
              <Music2 className="w-3 h-3" /> Univers Flow for Artists
            </div>
            <h1 className="text-[34px] leading-[1.05] font-bold tracking-tight">
              Get access to<br/>your artist tools.
            </h1>
            <p className="text-white/60 mt-4 text-[15px] leading-relaxed">
              How would you like to connect? Pick the option that fits you — artist, team, or label.
            </p>
          </motion.div>

          <div className="space-y-3">
            <BranchCard
              onClick={() => navigate('/artist/claim')}
              icon={<Search className="w-5 h-5" />}
              title="I'm an artist"
              subtitle="Claim your artist page on Univers Flow, or become one if your music isn't here yet."
              chip="Most common"
              accent
            />
            <BranchCard
              onClick={() => navigate('/artist/team/join')}
              icon={<Users className="w-5 h-5" />}
              title="I'm on an artist's team"
              subtitle="You were invited as a manager, editor, or analyst. Enter your invite code."
            />
            <BranchCard
              onClick={() => navigate('/artist/label/access')}
              icon={<Building2 className="w-5 h-5" />}
              title="I'm a label or distributor"
              subtitle="Request org-level access for multiple artists on your roster."
            />
          </div>

          <div className="grid grid-cols-2 gap-2 mt-8">
            {[
              { t: '100% of royalties', s: 'No revenue share. Ever.' },
              { t: 'Real-time analytics', s: 'Streams, saves, skips, listeners.' },
              { t: 'Role-based access', s: 'Team seats. Fine-grained control.' },
              { t: 'Weekly payouts', s: 'Min ₹500 → straight to UPI.' },
            ].map((it) => (
              <div key={it.t} className="rounded-xl bg-white/[0.03] border border-white/10 p-3">
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#FF2D55]" />
                  <span className="text-[13px] font-semibold">{it.t}</span>
                </div>
                <p className="text-[11.5px] text-white/50 mt-1 leading-snug">{it.s}</p>
              </div>
            ))}
          </div>

          <p className="text-[11px] text-white/40 text-center mt-10 leading-relaxed">
            By continuing you agree to the <Link to="/legal/artist-terms" className="underline">Artist Terms</Link>
            {' '}and <Link to="/legal/artist-privacy" className="underline">Artist Privacy Policy</Link>.
          </p>
        </div>
      </div>
    </FadeTransition>
  );
}

function BranchCard({
  onClick, icon, title, subtitle, chip, accent,
}: { onClick: () => void; icon: React.ReactNode; title: string; subtitle: string; chip?: string; accent?: boolean }) {
  return (
    <motion.button
      whileTap={{ scale: 0.985 }}
      onClick={onClick}
      className={`group w-full text-left rounded-2xl p-5 border transition
                  ${accent
                    ? 'bg-gradient-to-br from-[#FF2D55]/15 to-[#FF2D55]/5 border-[#FF2D55]/40 hover:border-[#FF2D55]/70'
                    : 'bg-white/[0.03] border-white/10 hover:bg-white/[0.06] hover:border-white/20'}`}
    >
      <div className="flex items-start gap-4">
        <div className={`w-10 h-10 rounded-xl grid place-items-center shrink-0
                        ${accent ? 'bg-[#FF2D55] text-white' : 'bg-white/10 text-white'}`}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-[15.5px] leading-tight">{title}</h3>
            {chip && (
              <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-md
                                ${accent ? 'bg-white/20 text-white' : 'bg-white/10 text-white/70'}`}>
                {chip}
              </span>
            )}
          </div>
          <p className="text-[13px] text-white/60 mt-1 leading-relaxed">{subtitle}</p>
        </div>
        <ArrowRight className="w-4 h-4 text-white/40 group-hover:text-white transition mt-2 shrink-0" />
      </div>
    </motion.button>
  );
}
