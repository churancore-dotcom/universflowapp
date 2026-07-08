import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileCheck2,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { useNavigate, useParams } from 'react-router-dom';
import { Copy } from 'lucide-react';

type Status = 'pending' | 'approved' | 'rejected';

type App = {
  id: string;
  user_id: string;
  stage_name: string;
  real_name: string;
  phone: string;
  country_code: string;
  social_links: (Record<string, unknown> & { face_shots?: unknown }) | null;
  music_platform_url: string | null;
  ownership_code: string | null;
  ownership_verified_at: string | null;
  ownership_check_at: string | null;
  platform_photo_url: string | null;
  face_match_platform_status: string | null;
  face_match_platform_score: number | null;
  social_verified_url: string | null;
  social_verified_status: string | null;
  selfie_path: string | null;
  artist_photo_path: string | null;
  status: Status;
  admin_note: string | null;
  created_at: string;
  reviewed_at: string | null;
  face_match_score: number | null;
  face_match_status: string | null;
  auto_check_warnings: string[] | null;
  auto_checks_at: string | null;
};


type PreviewMap = {
  selfie?: string;
  center?: string;
  left?: string;
  right?: string;
  up?: string;
};

async function signed(path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data } = await supabase.storage.from('artist-kyc').createSignedUrl(path, 60 * 10);
  return data?.signedUrl ?? null;
}

export default function ArtistApplications() {
  const [apps, setApps] = useState<App[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Status | 'all'>('pending');
  const navigate = useNavigate();
  const { status: routeStatus } = useParams<{ status?: string }>();
  const [active, setActive] = useState<App | null>(null);
  const [activeEmail, setActiveEmail] = useState<string | null>(null);
  const [activeUsername, setActiveUsername] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [previews, setPreviews] = useState<PreviewMap>({});

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('artist_applications')
      .select('id, user_id, stage_name, real_name, phone, country_code, social_links, music_platform_url, ownership_code, ownership_verified_at, ownership_check_at, platform_photo_url, face_match_platform_status, face_match_platform_score, social_verified_url, social_verified_status, selfie_path, artist_photo_path, status, reviewed_at, created_at, face_match_score, face_match_status, auto_check_warnings, auto_checks_at')
      .order('created_at', { ascending: false });
    if (error) toast.error(error.message);
    setApps(((data ?? []) as unknown as Omit<App, 'admin_note'>[]).map((a) => ({ ...a, admin_note: null })));

    setLoading(false);
  };

  useEffect(() => {
    if (routeStatus === 'all' || routeStatus === 'pending' || routeStatus === 'approved' || routeStatus === 'rejected') {
      setFilter(routeStatus);
    }
  }, [routeStatus]);

  useEffect(() => {
    load();
    const ch = supabase
      .channel('admin-artist-applications-review')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'artist_applications' }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const counts = useMemo(() => ({
    all: apps.length,
    pending: apps.filter((a) => a.status === 'pending').length,
    approved: apps.filter((a) => a.status === 'approved').length,
    rejected: apps.filter((a) => a.status === 'rejected').length,
  }), [apps]);

  const filtered = filter === 'all' ? apps : apps.filter((a) => a.status === filter);

  const openReview = async (app: App) => {
    setActive(app);
    setActiveEmail(null);
    setActiveUsername(null);
    // admin_note is fetched on demand via the admin RPC so the column stays
    // hidden from regular signed-in users at the database level.
    let currentNote: string | null = null;
    try {
      const { data: note } = await supabase.rpc('admin_get_artist_application_note', { _app_id: app.id });
      currentNote = (note as string | null) ?? null;
    } catch { /* ignore */ }
    setNote(currentNote ?? '');
    setPreviews({});
    supabase.from('profiles').select('email, username').eq('user_id', app.user_id).maybeSingle()
      .then(({ data }) => {
        if (data) {
          setActiveEmail(data.email ?? null);
          setActiveUsername(data.username ?? null);
        }
      });
    const faceShots = app.social_links?.face_shots;
    const face = Array.isArray(faceShots) ? faceShots.filter((path): path is string => typeof path === 'string') : [];
    const [selfie, center, left, right, up] = await Promise.all([
      signed(app.selfie_path),
      signed(face[0]),
      signed(face[1]),
      signed(face[2]),
      signed(face[3]),
    ]);
    setPreviews({
      selfie: selfie ?? undefined,
      center: center ?? undefined,
      left: left ?? undefined,
      right: right ?? undefined,
      up: up ?? undefined,
    });
  };

  const review = async (status: Exclude<Status, 'pending'>) => {
    if (!active) return;
    if (status === 'rejected' && note.trim().length < 10) {
      toast.error('Add a clear rejection reason first — the artist must know what to fix.');
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase
        .from('artist_applications')
        .update({ status, admin_note: note.trim() || null })
        .eq('id', active.id)
        .select('id, status')
        .maybeSingle();
      if (error) {
        toast.error(error.message || 'Update failed — check your admin role.');
        return;
      }
      if (!data) {
        toast.error('Nothing was updated. You may have lost admin access — sign out and back in.');
        return;
      }
      toast.success(status === 'approved' ? 'Artist verified and dashboard unlocked' : 'Application rejected');
      setActive(null);
      load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Unexpected error while updating the application.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 text-primary px-3 py-1 text-xs font-medium mb-3">
            <ShieldCheck className="w-3.5 h-3.5" /> Artist verification desk
          </div>
          <h1 className="text-2xl md:text-3xl font-display font-bold">Artist Applications</h1>
          <p className="text-sm text-muted-foreground mt-1">Review platform ownership proof, live face check, and social handles — no government ID.</p>
        </div>
        <Button variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Metric icon={<Clock className="w-4 h-4" />} label="Pending" value={counts.pending} active={filter === 'pending'} onClick={() => navigate('/admin/artist-applications/pending')} />
        <Metric icon={<UserCheck className="w-4 h-4" />} label="Approved" value={counts.approved} active={filter === 'approved'} onClick={() => navigate('/admin/artist-applications/approved')} />
        <Metric icon={<XCircle className="w-4 h-4" />} label="Rejected" value={counts.rejected} active={filter === 'rejected'} onClick={() => navigate('/admin/artist-applications/rejected')} />
        <Metric icon={<FileCheck2 className="w-4 h-4" />} label="All" value={counts.all} active={filter === 'all'} onClick={() => navigate('/admin/artist-applications/all')} />
      </div>

      {loading ? (
        <div className="py-24 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-5 items-start">
          <section className="rounded-2xl border border-white/[0.06] bg-white/[0.03] overflow-hidden">
            <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                {filter === 'all' ? 'All applications' : `${filter} applications`} · {filtered.length}
              </h2>
            </div>
            <div className="divide-y divide-white/[0.06]">
              {filtered.length === 0 && (
                <div className="p-10 text-center text-sm text-muted-foreground">No applications in this queue.</div>
              )}
              {filtered.map((a) => <Row key={a.id} app={a} onClick={() => openReview(a)} />)}
            </div>
          </section>

          <aside className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4 space-y-4">
            <h3 className="font-semibold flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-primary" /> Review checklist</h3>
            <ChecklistItem label="Music platform artist page opens and matches stage name" />
            <ChecklistItem label="Ownership code appears in the platform bio" />
            <ChecklistItem label="Live face check selfie looks like a real human" />
            <ChecklistItem label="Instagram + YouTube handles are consistent" />
            <ChecklistItem label="Profile photo is clean and public-ready" />
            <div className="pt-3 border-t border-white/[0.06] text-xs text-muted-foreground leading-relaxed">
              Approval grants the artist role, creates/updates the artist profile, verifies the public profile, and unlocks Artist Studio pages. Only one application per account is allowed.
            </div>
          </aside>
        </div>
      )}

      <Sheet open={!!active} onOpenChange={(o) => !o && setActive(null)}>
        <SheetContent side="right" className="w-full sm:max-w-3xl overflow-y-auto p-0 border-l border-white/[0.08]">
          <SheetHeader className="px-5 pt-5 pb-4 border-b border-white/[0.06] bg-gradient-to-b from-primary/[0.08] to-transparent">
            <SheetTitle className="flex items-center gap-3 text-left">
              {active?.artist_photo_path ? <img src={active.artist_photo_path} alt="" className="w-12 h-12 rounded-xl object-cover" /> : <div className="w-12 h-12 rounded-xl bg-white/[0.05] flex items-center justify-center"><ImageIcon className="w-5 h-5 text-muted-foreground" /></div>}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="truncate">{active?.stage_name}</span>
                  {active ? <StatusBadge status={active.status} /> : null}
                </div>
                <SheetDescription className="text-xs mt-0.5">
                  {active ? `${active.real_name} · Submitted ${new Date(active.created_at).toLocaleString()}` : ''}
                </SheetDescription>
              </div>
            </SheetTitle>
            {active && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3 text-[11px]">
                <ContextChip label="Email" value={activeEmail ?? '—'} copy={activeEmail ?? undefined} />
                <ContextChip label="Username" value={activeUsername ?? '—'} />
                <ContextChip label="User ID" value={active.user_id.slice(0, 8) + '…'} copy={active.user_id} />
                <ContextChip label="Application" value={active.id.slice(0, 8) + '…'} copy={active.id} />
              </div>
            )}
          </SheetHeader>
          {active && (
            <div className="px-5 py-5 space-y-5">
              <section className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
                <h3 className="font-semibold mb-3">Identity details</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <Info label="Legal name" value={active.real_name} />
                  <Info label="Phone" value={active.phone} />
                  <Info label="Country" value={active.country_code} />
                  <Info label="Ownership code" value={active.ownership_code || '—'} />
                </div>
              </section>

              <section className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
                <h3 className="font-semibold mb-3 flex items-center gap-2"><FileCheck2 className="w-4 h-4" /> Music platform proof</h3>
                {active.music_platform_url ? (
                  <div className="space-y-2 text-sm">
                    <a href={active.music_platform_url} target="_blank" rel="noreferrer" className="text-primary underline inline-flex items-center gap-1 break-all">
                      Open artist page <ExternalLink className="w-3 h-3" />
                    </a>
                    <p className="text-[12px] text-muted-foreground leading-relaxed">
                      Look for <code className="font-mono text-primary">{active.ownership_code || '—'}</code> in the artist bio.
                      {active.ownership_verified_at
                        ? ` ✓ Auto-check confirmed the code on ${new Date(active.ownership_verified_at).toLocaleString()}.`
                        : active.ownership_check_at
                          ? ` Auto-check ran ${new Date(active.ownership_check_at).toLocaleString()} but did not find the code — please re-verify manually.`
                          : ' Auto-check has not run yet.'}
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No music-platform URL submitted.</p>
                )}
              </section>

              <AutoChecksPanel app={active} />

              <section className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
                <h3 className="font-semibold mb-3 flex items-center gap-2"><Camera className="w-4 h-4" /> Live face check</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <DocPreview label="Liveness capture" url={previews.selfie ?? previews.center} />
                </div>
                <p className="mt-3 text-[11px] text-muted-foreground">Signed URL valid 10 min.</p>
              </section>

              <section className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
                <h3 className="font-semibold mb-3">Artist profile preview</h3>
                <div className="flex items-start gap-4">
                  {active.artist_photo_path ? <img src={active.artist_photo_path} alt="Artist profile" className="w-28 h-28 rounded-2xl object-cover shrink-0" /> : <div className="w-28 h-28 rounded-2xl bg-white/[0.04] flex items-center justify-center shrink-0"><ImageIcon className="w-8 h-8 text-muted-foreground" /></div>}
                  <div className="min-w-0">
                    <p className="text-lg font-semibold truncate">{active.stage_name}</p>
                    <p className="text-xs text-muted-foreground">{active.country_code}</p>
                    <p className="text-xs text-muted-foreground mt-1">Submitted {new Date(active.created_at).toLocaleString()}</p>
                  </div>
                </div>
              </section>

              <section className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
                <h3 className="font-semibold mb-3">Social proof</h3>
                {Object.entries(active.social_links || {}).filter(([k, v]) => !!v && k !== 'face_shots').length === 0 ? (
                  <p className="text-xs text-muted-foreground">No social links submitted.</p>
                ) : (
                  <ul className="text-sm space-y-2">
                    {Object.entries(active.social_links || {}).filter(([k, v]) => !!v && k !== 'face_shots').map(([k, v]) => (
                      <li key={k} className="flex items-start gap-2">
                        <span className="text-muted-foreground capitalize min-w-20">{k.replace('_', ' ')}</span>
                        {String(v).startsWith('http') ? (
                          <a href={String(v)} target="_blank" rel="noreferrer" className="text-primary underline inline-flex items-center gap-1 break-all">Open <ExternalLink className="w-3 h-3" /></a>
                        ) : <span className="break-words">{String(v)}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Admin note</p>
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} placeholder="Required if rejecting. Tell the artist exactly what failed and what to upload next time." />
                <p className="mt-2 text-[11px] text-muted-foreground">Visible on the artist rejection screen. Keep it direct and useful.</p>
              </section>

              {active.status === 'pending' ? (
                <div className="sticky bottom-0 -mx-5 -mb-5 px-5 py-4 bg-background/95 backdrop-blur border-t border-white/[0.06] grid grid-cols-2 gap-2">
                  <Button variant="outline" disabled={busy} onClick={() => review('rejected')}>
                    {busy ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <XCircle className="w-4 h-4 mr-1.5" />} Reject
                  </Button>
                  <Button disabled={busy} onClick={() => review('approved')}>
                    {busy ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-1.5" />} Approve
                  </Button>
                </div>
              ) : (
                <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4 text-sm text-muted-foreground">
                  Reviewed {active.reviewed_at ? new Date(active.reviewed_at).toLocaleString() : 'earlier'} · {active.status}
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Metric({ icon, label, value, active, onClick }: { icon: React.ReactNode; label: string; value: number; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`text-left rounded-2xl border p-4 transition ${active ? 'border-primary/40 bg-primary/10' : 'border-white/[0.06] bg-white/[0.03] hover:bg-white/[0.05]'}`}>
      <div className="flex items-center justify-between text-muted-foreground text-xs uppercase tracking-wider">
        <span>{label}</span>{icon}
      </div>
      <p className="text-2xl font-semibold mt-2 tabular-nums">{value}</p>
    </button>
  );
}

function ChecklistItem({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center"><CheckCircle2 className="w-3.5 h-3.5" /></div>
      <span>{label}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`text-xs px-2 py-1 rounded-full ${status === 'pending' ? 'bg-amber-500/20 text-amber-300' : status === 'approved' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'}`}>{status}</span>
  );
}

function Row({ app, onClick }: { app: App; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full text-left p-4 hover:bg-white/[0.04] transition">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl overflow-hidden bg-black/40 shrink-0">
          {app.artist_photo_path ? <img src={app.artist_photo_path} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center"><ImageIcon className="w-4 h-4 text-muted-foreground" /></div>}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium truncate">{app.stage_name} <span className="text-muted-foreground text-xs">· {app.country_code}</span></p>
          <p className="text-xs text-muted-foreground truncate">{app.real_name} · {new Date(app.created_at).toLocaleString()}</p>
        </div>
        <div className="hidden md:flex items-center gap-2 text-xs text-muted-foreground">
          <FileCheck2 className="w-4 h-4" /> Platform
          <Camera className="w-4 h-4 ml-2" /> Face
        </div>
        <StatusBadge status={app.status} />
      </div>
    </button>
  );
}

function ContextChip({ label, value, copy }: { label: string; value: string; copy?: string }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5 min-w-0">
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="flex items-center gap-1.5">
        <p className="truncate text-[11px] font-medium">{value}</p>
        {copy && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(copy); toast.success('Copied'); }}
            className="text-muted-foreground hover:text-foreground shrink-0"
            aria-label={`Copy ${label}`}
          >
            <Copy className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="break-words">{value}</p>
    </div>
  );
}

function DocPreview({ label, url }: { label: string; url?: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">{label}</p>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer">
          <img src={url} alt={label} className="w-full aspect-square object-cover rounded-xl border border-white/10" />
        </a>
      ) : (
        <div className="w-full aspect-square rounded-xl bg-white/[0.03] border border-white/10 flex items-center justify-center text-xs text-muted-foreground text-center px-2">deleted / none</div>
      )}
    </div>
  );
}

function AutoChecksPanel({ app }: { app: App }) {
  const ran = !!app.auto_checks_at;
  const ownershipStatus = app.ownership_verified_at
    ? 'PASS'
    : app.ownership_check_at
      ? 'NOT FOUND'
      : 'PENDING';
  const ownershipColor = app.ownership_verified_at
    ? 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30'
    : app.ownership_check_at
      ? 'text-rose-300 bg-rose-500/15 border-rose-500/30'
      : 'text-amber-300 bg-amber-500/15 border-amber-500/30';
  const platformFaceStatus = app.face_match_platform_status;
  const platformFaceScorePct = app.face_match_platform_score == null
    ? null
    : Math.round(app.face_match_platform_score * 100);
  const platformFaceColor =
    platformFaceStatus === 'passed' ? 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30'
    : platformFaceStatus === 'failed' ? 'text-rose-300 bg-rose-500/15 border-rose-500/30'
    : 'text-amber-300 bg-amber-500/15 border-amber-500/30';
  const warnings = Array.isArray(app.auto_check_warnings) ? app.auto_check_warnings : [];
  return (
    <section className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
      <h3 className="font-semibold mb-3 flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-primary" /> Automated verification
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground ml-1">
          {ran ? `ran ${new Date(app.auto_checks_at!).toLocaleString()}` : 'pending'}
        </span>
      </h3>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className={`rounded-xl border p-3 ${ownershipColor}`}>
          <p className="text-[10px] uppercase tracking-wider opacity-70">Ownership code</p>
          <p className="text-lg font-semibold mt-0.5">{ownershipStatus}</p>
          <p className="text-[11px] opacity-80 break-words">
            {app.ownership_verified_at
              ? `Found in artist bio on ${new Date(app.ownership_verified_at).toLocaleDateString()}`
              : app.ownership_check_at
                ? 'Code not found on artist page — verify by hand.'
                : 'Fetches the artist page and looks for the code.'}
          </p>
        </div>
        <div className={`rounded-xl border p-3 ${platformFaceColor}`}>
          <p className="text-[10px] uppercase tracking-wider opacity-70">Platform photo match</p>
          <p className="text-lg font-semibold mt-0.5">
            {platformFaceStatus?.toUpperCase() ?? 'PENDING'}
            {platformFaceScorePct != null && <span className="text-xs ml-2 opacity-80">{platformFaceScorePct}%</span>}
          </p>
          <p className="text-[11px] opacity-80">Liveness selfie vs artist-page photo</p>
        </div>
      </div>
      {warnings.length > 0 ? (
        <ul className="space-y-1.5">
          {warnings.map((w, i) => (
            <li key={i} className="text-[12px] rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-200 px-3 py-2">{w}</li>
          ))}
        </ul>
      ) : ran ? (
        <p className="text-[12px] text-emerald-300/90">✓ No automated warnings — applicant looks clean.</p>
      ) : (
        <p className="text-[12px] text-muted-foreground">Checks will run automatically right after submission.</p>
      )}
    </section>
  );
}

