import { useEffect, useMemo, useState, memo } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from '@/lib/router-compat';
import {
  LayoutDashboard, Upload, Music2, BarChart3, Users, UserCog, LogOut,
  Menu, X, ExternalLink, CheckCircle2, Bell, Activity as ActivityIcon, Megaphone, IndianRupee, Shield,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useArtistLive } from './_shared';
import ArtistLoading from './ArtistLoading';

const nav = [
  { to: '/artist/studio', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/artist/studio/upload', label: 'Upload song', icon: Upload },
  { to: '/artist/studio/songs', label: 'My music', icon: Music2 },
  { to: '/artist/studio/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/artist/studio/earnings', label: 'Earnings', icon: IndianRupee },
  { to: '/artist/studio/team', label: 'Team access', icon: Shield },
  { to: '/artist/studio/promote', label: 'Promote', icon: Megaphone },
  { to: '/artist/studio/followers', label: 'Followers', icon: Users },
  { to: '/artist/studio/activity', label: 'Activity', icon: ActivityIcon },
  { to: '/artist/studio/notifications', label: 'Notifications', icon: Bell, badge: true as const },
  { to: '/artist/studio/profile', label: 'Edit profile', icon: UserCog },
];

const READ_KEY = 'uf_artist_notifs_read_at';

const SidebarBody = memo(function SidebarBody({
  pathname, onClose, onLogout, stageName, avatarUrl, slug, followers, hasUnread,
}: {
  pathname: string;
  onClose: () => void;
  onLogout: () => void;
  stageName: string;
  avatarUrl: string | null;
  slug: string;
  followers: number;
  hasUnread: boolean;
}) {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-white/5 flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl overflow-hidden bg-black/40 shrink-0">
          {avatarUrl ? (
            <img src={avatarUrl} alt={stageName} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground">
              <Music2 className="w-5 h-5" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <p className="font-semibold text-sm truncate">{stageName}</p>
            <CheckCircle2 className="w-3.5 h-3.5 text-primary shrink-0" fill="currentColor" stroke="#fff" />
          </div>
          <p className="text-[11px] text-muted-foreground tabular-nums">{followers} followers</p>
        </div>
        <button onClick={onClose} className="md:hidden p-2 -mr-2" aria-label="Close">
          <X className="w-5 h-5" />
        </button>
      </div>

      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {nav.map(({ to, label, icon: Icon, end, badge }) => {
          const active = end ? pathname === to : pathname.startsWith(to);
          const showDot = badge && hasUnread;
          return (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={onClose}
              className={`relative w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition ${
                active
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-white/5 hover:text-foreground active:scale-[0.98]'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="flex-1">{label}</span>
              {showDot && <span className="w-2 h-2 rounded-full bg-primary" />}
            </NavLink>
          );
        })}
      </nav>

      <div className="p-3 border-t border-white/5 space-y-1">
        <button
          onClick={() => { onClose(); navigate(`/a/${slug}`); }}
          className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-white/5"
        >
          <ExternalLink className="w-4 h-4" /> View public page
        </button>
        <button
          onClick={onLogout}
          className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm text-rose-300 hover:bg-rose-500/10"
        >
          <LogOut className="w-4 h-4" /> Sign out
        </button>
      </div>
    </div>
  );
});

export default function ArtistLayout() {
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [authorized, setAuthorized] = useState(() => peekAccess<boolean>(user?.id, 'artist-access') ?? false);
  const { profile, songs, followers, loading } = useArtistLive(user?.id ?? null);

  useEffect(() => {
    if (isLoading) return;
    if (!user) { navigate('/artist/auth', { replace: true }); return; }
    let cancelled = false;
    // Cached per user so re-entering the studio doesn't re-run has_role and
    // flash the loading screen on every navigation.
    getAccess<boolean>(user.id, 'artist-access', async () => {
      const { data } = await supabase.rpc('has_role', { _user_id: user.id, _role: 'artist' });
      return !!data;
    }).then((hasArtist) => {
      if (cancelled) return;
      if (!hasArtist) { navigate('/artist/status', { replace: true }); return; }
      setAuthorized(true);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [user, isLoading, navigate]);


  useEffect(() => { setOpen(false); }, [location.pathname]);

  // Compute unread badge for sidebar
  const hasUnread = useMemo(() => {
    const readAt = +(typeof window !== 'undefined' ? localStorage.getItem(READ_KEY) ?? '0' : '0');
    const latestFollower = 0;
    // Lightweight signal — followers count increase since read is hard without a feed;
    // fall back to "unread if any follower exists and never marked read".
    return followers > 0 && readAt === 0 ? true : latestFollower > readAt;
  }, [followers, location.pathname]);

  if (!authorized || loading || !profile) {
    return <ArtistLoading label="Opening Artist Studio…" />;
  }

  const ctx = { profile, songs, followers, user };

  return (
    <div className="min-h-[100dvh] bg-background text-foreground flex">
      {/* Mobile top bar */}
      <header className="md:hidden fixed top-0 inset-x-0 z-30 bg-background/85 backdrop-blur-xl border-b border-white/5">
        <div className="flex items-center gap-3 px-3 py-3">
          <button
            onClick={() => setOpen(true)}
            className="w-9 h-9 rounded-full flex items-center justify-center bg-white/[0.05] active:scale-95"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
            {hasUnread && <span className="absolute -mt-5 ml-5 w-2 h-2 rounded-full bg-primary" />}
          </button>
          <h1 className="text-[15px] font-semibold tracking-tight">Artist Studio</h1>
          <span className="ml-1 inline-flex items-center gap-1 text-[10px] font-semibold tracking-wider uppercase text-emerald-300/90">
            <span className="relative flex w-1.5 h-1.5">
              <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-75" />
              <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-emerald-400" />
            </span>
            Live
          </span>
        </div>
      </header>

      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-72 shrink-0 border-r border-white/5 bg-black/30 sticky top-0 h-[100dvh]">
        <SidebarBody
          pathname={location.pathname}
          onClose={() => {}}
          onLogout={async () => { await supabase.auth.signOut(); navigate('/auth', { replace: true }); }}
          stageName={profile.stage_name}
          avatarUrl={profile.avatar_url}
          slug={profile.slug}
          followers={followers}
          hasUnread={hasUnread}
        />
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="md:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 bg-[#0b0b0e] border-r border-white/10">
            <SidebarBody
              pathname={location.pathname}
              onClose={() => setOpen(false)}
              onLogout={async () => { await supabase.auth.signOut(); navigate('/auth', { replace: true }); }}
              stageName={profile.stage_name}
              avatarUrl={profile.avatar_url}
              slug={profile.slug}
              followers={followers}
              hasUnread={hasUnread}
            />
          </div>
        </div>
      )}

      <main className="flex-1 min-w-0 pt-14 md:pt-0 pb-32">
        <Outlet context={ctx} />
      </main>
    </div>
  );
}
