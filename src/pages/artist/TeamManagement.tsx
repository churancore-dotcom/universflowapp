import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { UserPlus, Copy, Check, MoreHorizontal, Shield, Loader2, X } from 'lucide-react';
import SEOHead from '@/components/SEOHead';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

type Role = 'owner' | 'admin' | 'editor' | 'analyst' | 'viewer';
const ROLES: Role[] = ['admin', 'editor', 'analyst', 'viewer'];

type Member = {
  id: string; user_id: string; role: Role; status: string;
  joined_at: string;
  profile?: { username: string | null; avatar_url: string | null; email: string | null };
};
type Invite = {
  id: string; email: string; role: Role; code: string;
  status: string; expires_at: string; created_at: string;
};

export default function TeamManagement() {
  const { user } = useAuth();
  const [artistProfileId, setArtistProfileId] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<Role | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);

  const canManage = myRole === 'owner' || myRole === 'admin';

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: mem } = await supabase
        .from('artist_team_members')
        .select('artist_profile_id, role')
        .eq('user_id', user.id).eq('status', 'active')
        .order('role', { ascending: true }).limit(1).maybeSingle();
      if (!mem) { setLoading(false); return; }
      setArtistProfileId(mem.artist_profile_id);
      setMyRole(mem.role as Role);
      await reload(mem.artist_profile_id);
      setLoading(false);
    })();
    // eslint-disable-next-line
  }, [user]);

  const reload = async (apid: string) => {
    const [{ data: ms }, { data: iv }] = await Promise.all([
      supabase.from('artist_team_members')
        .select('id, user_id, role, status, joined_at')
        .eq('artist_profile_id', apid)
        .order('joined_at', { ascending: true }),
      supabase.from('artist_team_invites')
        .select('id, email, role, code, status, expires_at, created_at')
        .eq('artist_profile_id', apid)
        .order('created_at', { ascending: false }),
    ]);
    const list = (ms ?? []) as Member[];
    if (list.length) {
      const { data: profs } = await supabase.from('profiles')
        .select('user_id, username, avatar_url, email')
        .in('user_id', list.map(m => m.user_id));
      const byId = new Map((profs ?? []).map((p: any) => [p.user_id, p]));
      list.forEach(m => { m.profile = byId.get(m.user_id); });
    }
    setMembers(list);
    setInvites((iv ?? []) as Invite[]);
  };

  const revoke = async (uid: string) => {
    if (!artistProfileId) return;
    const { error } = await supabase.rpc('revoke_artist_member', {
      _artist_profile_id: artistProfileId, _user_id: uid,
    });
    if (error) return toast.error(error.message);
    toast.success('Member revoked');
    reload(artistProfileId);
  };

  const changeRole = async (uid: string, role: Role) => {
    if (!artistProfileId) return;
    const { data, error } = await supabase.rpc('update_artist_member_role', {
      _artist_profile_id: artistProfileId, _user_id: uid, _role: role,
    });
    if (error) return toast.error(error.message);
    const res = data as any;
    if (res?.error) return toast.error(res.error);
    toast.success('Role updated');
    reload(artistProfileId);
  };

  if (loading) return <div className="p-8 text-white/60">Loading team…</div>;
  if (!artistProfileId) {
    return <div className="p-8 text-white/60">No artist profile linked to your account.</div>;
  }

  return (
    <div className="text-white">
      <SEOHead title="Team access" description="Manage your artist team." />
      <div className="max-w-3xl mx-auto px-5 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-[24px] font-bold tracking-tight">Team access</h1>
            <p className="text-white/60 text-[13px] mt-1">Invite people to manage your artist page.</p>
          </div>
          {canManage && (
            <button onClick={() => setShowInvite(true)}
              className="h-10 px-4 rounded-xl bg-[#FF2D55] font-semibold text-[13px] inline-flex items-center gap-2">
              <UserPlus className="w-4 h-4" /> Invite
            </button>
          )}
        </div>

        <section className="rounded-2xl bg-white/[0.03] border border-white/10 overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10 text-[11px] uppercase tracking-wider text-white/50">
            Members ({members.length})
          </div>
          <ul className="divide-y divide-white/5">
            {members.map(m => (
              <MemberRow key={m.id} m={m} canManage={canManage} isSelf={m.user_id === user?.id}
                onRevoke={() => revoke(m.user_id)} onRole={(r) => changeRole(m.user_id, r)} />
            ))}
          </ul>
        </section>

        {invites.length > 0 && (
          <section className="mt-6 rounded-2xl bg-white/[0.03] border border-white/10 overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10 text-[11px] uppercase tracking-wider text-white/50">
              Invites
            </div>
            <ul className="divide-y divide-white/5">
              {invites.map(iv => <InviteRow key={iv.id} iv={iv} />)}
            </ul>
          </section>
        )}

        <section className="mt-6 rounded-2xl bg-white/[0.02] border border-white/10 p-4">
          <div className="flex items-center gap-2 text-[13px] font-semibold mb-2">
            <Shield className="w-4 h-4 text-[#FF2D55]" /> Role permissions
          </div>
          <ul className="text-[12.5px] text-white/60 space-y-1">
            <li><b className="text-white/80">Owner</b> — full control, can transfer ownership, request payouts.</li>
            <li><b className="text-white/80">Admin</b> — invite team, upload, edit profile, request payouts.</li>
            <li><b className="text-white/80">Editor</b> — upload songs, edit profile.</li>
            <li><b className="text-white/80">Analyst</b> — read analytics only.</li>
            <li><b className="text-white/80">Viewer</b> — read dashboard only.</li>
          </ul>
        </section>
      </div>

      {showInvite && artistProfileId && (
        <InviteModal
          artistProfileId={artistProfileId}
          onClose={() => { setShowInvite(false); reload(artistProfileId); }}
        />
      )}
    </div>
  );
}

function MemberRow({ m, canManage, isSelf, onRevoke, onRole }: {
  m: Member; canManage: boolean; isSelf: boolean;
  onRevoke: () => void; onRole: (r: Role) => void;
}) {
  const [open, setOpen] = useState(false);
  const displayName = m.profile?.username || m.profile?.email || m.user_id.slice(0, 8);
  return (
    <li className="px-4 py-3 flex items-center gap-3">
      {m.profile?.avatar_url
        ? <img src={m.profile.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover" />
        : <div className="w-9 h-9 rounded-full bg-white/10" />}
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-medium truncate">{displayName}{isSelf && ' (you)'}</div>
        <div className="text-[11.5px] text-white/50 capitalize">{m.role} · {m.status}</div>
      </div>
      {canManage && !isSelf && m.role !== 'owner' && (
        <div className="relative">
          <button onClick={() => setOpen(o => !o)} className="w-8 h-8 rounded-lg bg-white/5 grid place-items-center">
            <MoreHorizontal className="w-4 h-4" />
          </button>
          {open && (
            <div className="absolute right-0 top-9 z-10 w-44 rounded-xl bg-[#111] border border-white/10 py-1 shadow-2xl">
              {ROLES.map(r => (
                <button key={r} onClick={() => { setOpen(false); onRole(r); }}
                  className="w-full text-left px-3 py-2 text-[12.5px] hover:bg-white/5 capitalize">
                  Set as {r}
                </button>
              ))}
              <div className="my-1 border-t border-white/10" />
              <button onClick={() => { setOpen(false); onRevoke(); }}
                className="w-full text-left px-3 py-2 text-[12.5px] hover:bg-white/5 text-red-400">
                Revoke access
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function InviteRow({ iv }: { iv: Invite }) {
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}/artist/team/join?code=${iv.code}`;
  const copy = () => { navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1200); };
  return (
    <li className="px-4 py-3 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="text-[14px] truncate">{iv.email}</div>
        <div className="text-[11.5px] text-white/50 capitalize">{iv.role} · {iv.status}</div>
      </div>
      {iv.status === 'pending' && (
        <button onClick={copy}
          className="h-8 px-3 rounded-lg bg-white/10 text-[12px] inline-flex items-center gap-1.5">
          {copied ? <><Check className="w-3.5 h-3.5" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy link</>}
        </button>
      )}
    </li>
  );
}

function InviteModal({ artistProfileId, onClose }: { artistProfileId: string; onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('editor');
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);

  const send = async () => {
    if (!email.match(/^[^@]+@[^@]+\.[^@]+$/)) { toast.error('Enter a valid email'); return; }
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc('create_artist_invite', {
        _artist_profile_id: artistProfileId, _email: email, _role: role,
      });
      if (error) throw error;
      const res = data as any;
      if (res?.error) { toast.error(res.error); return; }
      setLink(`${window.location.origin}/artist/team/join?code=${res.code}`);
      toast.success('Invite created — share the link');
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-5" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-[#111] border border-white/10 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-[18px]">Invite to team</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-white/60" /></button>
        </div>
        {!link ? (
          <>
            <label className="text-[12px] uppercase tracking-wider text-white/50 mb-1.5 block">Email</label>
            <input value={email} onChange={e => setEmail(e.target.value)} placeholder="name@email.com"
              className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-3 text-[14px] outline-none focus:border-white/30" />
            <label className="text-[12px] uppercase tracking-wider text-white/50 mt-4 mb-1.5 block">Role</label>
            <div className="grid grid-cols-2 gap-2">
              {ROLES.map(r => (
                <button key={r} onClick={() => setRole(r)}
                  className={`h-10 rounded-xl border text-[13px] capitalize ${
                    role === r ? 'bg-white text-black border-white' : 'bg-white/[0.03] border-white/10 text-white/70'
                  }`}>{r}</button>
              ))}
            </div>
            <button onClick={send} disabled={busy}
              className="mt-5 w-full h-11 rounded-xl bg-[#FF2D55] font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-40">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} Send invite
            </button>
          </>
        ) : (
          <div>
            <p className="text-[13px] text-white/70 mb-3">
              Share this link with <b>{email}</b>. It expires in 14 days.
            </p>
            <div className="rounded-xl bg-black/40 border border-white/10 p-3 text-[12px] break-all">{link}</div>
            <button onClick={() => { navigator.clipboard.writeText(link); toast.success('Copied'); }}
              className="mt-4 w-full h-11 rounded-xl bg-white text-black font-semibold">
              Copy link
            </button>
            <button onClick={onClose} className="mt-2 w-full h-11 rounded-xl bg-white/5 text-white/80">
              Done
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}
