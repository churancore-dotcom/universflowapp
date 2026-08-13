import { useState, useEffect, useMemo } from 'react';
import {
  Settings, LogOut, Shield, Heart, ListMusic, Crown, ChevronRight,
  Edit2, Check, X, Download, Music2, Play,
} from 'lucide-react';
import { useNavigate } from '@/lib/router-compat';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { usePremium } from '@/hooks/usePremium';
import { Song, usePlayer } from '@/contexts/PlayerContext';

import BottomNav from '@/components/BottomNav';
import { TabTransition } from '@/components/PageTransition';
import EmailVerificationCard from '@/components/EmailVerificationCard';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { useDownloads } from '@/contexts/DownloadContext';
import SEOHead from '@/components/SEOHead';
import { loadLibrarySongs } from '@/lib/streamSongs';
import { readLocalRecent } from '@/lib/localRecentlyPlayed';
import { triggerHaptic } from '@/hooks/useHaptics';

interface ProfileData {
  username: string | null;
  username_changed: boolean;
}

/** Deterministic gradient per user id for the initials avatar */
function gradientFromSeed(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const a = h % 360;
  const b = (a + 42) % 360;
  return `linear-gradient(135deg, hsl(${a} 78% 58%), hsl(${b} 82% 42%))`;
}

const Profile = () => {
  const { user, isAdmin, isLoading: authLoading, signOut } = useAuth();
  const { isPremium, isLoading: premiumLoading } = usePremium();
  const { downloads } = useDownloads();
  const { playSong } = usePlayer();
  const navigate = useNavigate();

  const [stats, setStats] = useState({ likedSongs: 0, playlists: 0, downloads: 0 });
  const [listenStats, setListenStats] = useState<{ minutes: number; streak: number; totalPlays: number }>({ minutes: 0, streak: 0, totalPlays: 0 });
  const [recentSongs, setRecentSongs] = useState<Song[]>([]);
  const [memberSinceLabel, setMemberSinceLabel] = useState<string>('');
  const [statsReady, setStatsReady] = useState(false);

  const [profileData, setProfileData] = useState<ProfileData>({ username: null, username_changed: false });
  const [profileReady, setProfileReady] = useState(false);
  const [isEditingUsername, setIsEditingUsername] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (user) { setProfileReady(false); setStatsReady(false); fetchStats(); fetchProfile(); }
    else { setProfileReady(true); setStatsReady(true); }
  }, [user]);

  // Liking/unliking anywhere in the app must reflect here without a reload.
  useEffect(() => {
    if (!user) return;
    const onLikes = () => { fetchStats(); };
    window.addEventListener('uf:likes-changed', onLikes);
    return () => window.removeEventListener('uf:likes-changed', onLikes);
  }, [user]);


  useEffect(() => { setStats(prev => ({ ...prev, downloads: downloads.length })); }, [downloads.length]);

  // Recently played comes from the same per-device history the player writes,
  // so every tile carries a real playable snapshot.
  useEffect(() => {
    const load = () => {
      const entries = readLocalRecent(user?.id).filter((e) => e.song?.title && e.song?.artist);
       setRecentSongs(entries.slice(0, 30).map((e) => ({
        id: e.song_id,
        title: e.song!.title as string,
        artist: e.song!.artist as string,
        album: e.song?.album ?? undefined,
        cover_url: e.song?.cover_url ?? undefined,
        audio_url: e.song?.audio_url ?? 'resolving',
        duration: e.song?.duration ?? undefined,
      } as Song)));
    };
    load();
    window.addEventListener('universflow:recently-played-changed', load);
    return () => window.removeEventListener('universflow:recently-played-changed', load);
  }, [user?.id]);

  useEffect(() => {
    if (!user?.created_at) { setMemberSinceLabel(''); return; }
    const created = new Date(user.created_at);
    const now = new Date();
    const months = Math.max(0, (now.getFullYear() - created.getFullYear()) * 12 + (now.getMonth() - created.getMonth()));
    if (months < 1) setMemberSinceLabel('New member');
    else if (months < 12) setMemberSinceLabel(`${months} month${months === 1 ? '' : 's'}`);
    else {
      const years = Math.floor(months / 12);
      setMemberSinceLabel(`${years} year${years === 1 ? '' : 's'}`);
    }
  }, [user?.created_at]);

  const fetchProfile = async () => {
    if (!user) { setProfileReady(true); return; }
    try {
      const { data } = await supabase
        .from('profiles').select('username, username_changed')
        .eq('user_id', user.id).single();
      if (data) {
        setProfileData({
          username: data.username,
          username_changed: data.username_changed || false,
        });
        setNewUsername(data.username || '');
      }
    } finally { setProfileReady(true); }
  };

  const fetchStats = async () => {
    if (!user) { setStatsReady(true); return; }
    try {
      const [likedResolved, playlists, recentPlays, playEvents] = await Promise.all([
        loadLibrarySongs(user.id),
        supabase.from('playlists').select('id').eq('user_id', user.id),
        supabase.from('recently_played').select('song_id,played_at').eq('user_id', user.id).order('played_at', { ascending: false }).limit(500),
        supabase.from('song_play_events').select('artist,song_id,created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(500),
      ]);
      setStats({ likedSongs: likedResolved.length, playlists: playlists.data?.length || 0, downloads: downloads.length });

      type PlayRow = { song_id: string | null; artist: string | null; played_at: string };
      const rawRows: PlayRow[] = [
        ...(((recentPlays.data as { song_id: string; played_at: string }[] | null) || [])
          .map(r => ({ song_id: r.song_id, artist: null, played_at: r.played_at }))),
        ...(((playEvents.data as { artist: string | null; song_id: string | null; created_at: string }[] | null) || [])
          .map(r => ({ song_id: r.song_id, artist: r.artist, played_at: r.created_at }))),
      ];

      // The two tables overlap: the same play is logged in both. Dedupe on
      // song + minute so plays and minutes aren't double-counted.
      const dedup = new Map<string, PlayRow>();
      for (const r of rawRows) {
        const key = `${r.song_id || 'unknown'}|${(r.played_at || '').slice(0, 16)}`;
        const existing = dedup.get(key);
        dedup.set(key, existing ? { ...existing, artist: existing.artist || r.artist } : r);
      }
      const rows = [...dedup.values()];

      // Real durations only — from the catalog where the song exists.
      const catalogIds = [...new Set(rows.map(r => r.song_id).filter(Boolean) as string[])];
      const { data: catalogSongs } = catalogIds.length
        ? await supabase.from('songs').select('id,artist,duration').in('id', catalogIds)
        : { data: [] as { id: string; artist: string | null; duration: number | null }[] };
      const songById = new Map(((catalogSongs as { id: string; artist: string | null; duration: number | null }[] | null) || []).map(s => [s.id, s]));

      let totalSeconds = 0;
      const dayKeys = new Set<string>();
      rows.forEach(r => {
        const cat = r.song_id ? songById.get(r.song_id) : undefined;
        const seconds = Number(cat?.duration);
        if (Number.isFinite(seconds) && seconds > 0) totalSeconds += seconds;
        if (r.played_at) dayKeys.add(new Date(r.played_at).toISOString().slice(0, 10));
      });

      let streak = 0;
      const cursor = new Date();
      for (let i = 0; i < 60; i++) {
        const key = cursor.toISOString().slice(0, 10);
        if (dayKeys.has(key)) { streak++; cursor.setDate(cursor.getDate() - 1); }
        else if (i === 0) { cursor.setDate(cursor.getDate() - 1); }
        else break;
      }

      setListenStats({
        minutes: Math.round(totalSeconds / 60),
        streak,
        totalPlays: rows.length,
      });
    } finally { setStatsReady(true); }
  };

  const handleSaveUsername = async () => {
    if (!user || !newUsername.trim()) return;
    if (newUsername.trim().length < 3) { toast.error('Username must be at least 3 characters'); return; }
    if (newUsername.trim().length > 20) { toast.error('Username must be less than 20 characters'); return; }
    if (profileData.username_changed) { toast.error('You can only change your username once'); return; }
    const confirmed = window.confirm(`Set your username to "${newUsername.trim()}"?\n\nThis can only be done once and cannot be changed later.`);
    if (!confirmed) return;
    setIsSaving(true);
    try {
      const { error } = await supabase.from('profiles')
        .update({ username: newUsername.trim(), username_changed: true }).eq('user_id', user.id);
      if (error) throw error;
      setProfileData(prev => ({ ...prev, username: newUsername.trim(), username_changed: true }));
      setIsEditingUsername(false);
      toast.success('Username set!');
    } catch (error: any) { toast.error(error.message || 'Failed to update username'); }
    finally { setIsSaving(false); }
  };

  const handleLogout = async () => { await signOut(); navigate('/auth'); };

  const displayName = profileData.username || user?.email?.split('@')[0] || 'You';
  const canChangeUsername = !profileData.username_changed;
  const profileSettled = !authLoading && !premiumLoading && profileReady && statsReady;
  const initials = useMemo(() => {
    const src = (profileData.username || user?.email || 'U').replace(/[^a-zA-Z0-9]/g, '');
    return (src.slice(0, 2) || 'U').toUpperCase();
  }, [profileData.username, user?.email]);
  const avatarGradient = useMemo(() => gradientFromSeed(user?.id || 'guest'), [user?.id]);
  const fmt = (n: number) => (n > 0 ? n.toLocaleString() : '0');

  return (
    <TabTransition>
      <SEOHead
        title="Your Profile — Univers Flow"
        description="Your Univers Flow profile: listening stats, library, downloads and account."
        path="/profile"
      />
      <div className="h-[100dvh] flex flex-col overflow-hidden" style={{ background: 'hsl(var(--neu-bg))' }}>
        <main
          className="flex-1 overflow-y-auto pb-36 safe-area-pt"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          {/* ============ HEADER ============ */}
          <header className="px-5 pt-4 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground/70">Univers Flow</p>
              <p className="font-display text-[20px] leading-tight tracking-wide">PROFILE</p>
            </div>
            <button
              onClick={() => navigate('/settings')}
              aria-label="Settings"
              className="neu-sm neu-press w-11 h-11 rounded-2xl flex items-center justify-center"
            >
              <Settings className="w-[18px] h-[18px] text-muted-foreground" />
            </button>
          </header>

          {/* ============ IDENTITY PANEL ============ */}
          <section className="px-5 pt-6">
            <div className="neu rounded-[30px] p-6 flex flex-col items-center text-center">
              <div className="neu-inset rounded-full p-3">
                <div
                  className="w-[92px] h-[92px] rounded-full flex items-center justify-center"
                  style={{ background: avatarGradient, boxShadow: '0 8px 20px hsl(var(--neu-dark) / 0.9)' }}
                >
                  <span
                    className="font-display font-bold select-none text-white"
                    style={{ fontSize: 36, lineHeight: 1, textShadow: '0 2px 6px rgba(0,0,0,0.4)' }}
                  >
                    {initials}
                  </span>
                </div>
              </div>

              {/* Name */}
              <div className="mt-5 w-full">
                {!profileSettled ? (
                  <div className="neu-inset h-8 w-40 mx-auto rounded-lg animate-pulse" />
                ) : isEditingUsername ? (
                  <div className="flex items-center gap-2">
                    <Input
                      value={newUsername}
                      onChange={(e) => setNewUsername(e.target.value)}
                      className="neu-inset h-11 rounded-2xl border-0 text-center text-base"
                      placeholder="username" maxLength={20} autoFocus
                    />
                    <button onClick={handleSaveUsername} disabled={isSaving} aria-label="Save"
                      className="neu-sm neu-press w-11 h-11 rounded-2xl flex items-center justify-center shrink-0">
                      <Check className="w-4 h-4 text-green-400" />
                    </button>
                    <button onClick={() => { setIsEditingUsername(false); setNewUsername(profileData.username || ''); }}
                      aria-label="Cancel" className="neu-sm neu-press w-11 h-11 rounded-2xl flex items-center justify-center shrink-0">
                      <X className="w-4 h-4 text-muted-foreground" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-2">
                    <h1 className="font-display text-[28px] leading-tight tracking-wide truncate">
                      {displayName.toUpperCase()}
                    </h1>
                    {canChangeUsername && (
                      <button onClick={() => setIsEditingUsername(true)} aria-label="Edit username"
                        className="neu-sm neu-press w-8 h-8 rounded-xl flex items-center justify-center shrink-0">
                        <Edit2 className="w-3 h-3 text-muted-foreground" />
                      </button>
                    )}
                  </div>
                )}
                {user?.email && (
                  <p className="mt-1.5 text-[11.5px] text-muted-foreground/80 truncate">{user.email}</p>
                )}
              </div>

              {/* Badges */}
              {profileSettled && (
                <div className="mt-5 flex items-center justify-center gap-2 flex-wrap">
                  {isPremium ? (
                    <span className="neu-sm inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10.5px] font-bold uppercase tracking-wider text-amber-300">
                      <Crown className="w-3 h-3" /> Premium
                    </span>
                  ) : (
                    <span className="neu-inset inline-flex items-center px-3 py-1.5 rounded-full text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground/80">
                      Free
                    </span>
                  )}
                  {isAdmin && (
                    <span className="neu-sm inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10.5px] font-bold uppercase tracking-wider text-sky-300">
                      <Shield className="w-3 h-3" /> Admin
                    </span>
                  )}
                  {memberSinceLabel && (
                    <span className="neu-inset inline-flex items-center px-3 py-1.5 rounded-full text-[10.5px] font-semibold text-muted-foreground/80">
                      {memberSinceLabel}
                    </span>
                  )}
                </div>
              )}
            </div>
          </section>

          <div className="px-5 pt-6 space-y-7">
            <EmailVerificationCard />

            {/* ============ STATS ============ */}
            {profileSettled && user && listenStats.totalPlays > 0 && (
              <section className="neu rounded-[28px] p-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-muted-foreground/70 mb-4 px-1">Listening</p>
                <div className="grid grid-cols-3 gap-3">
                  <Dial value={fmt(listenStats.minutes)} label="Minutes" />
                  <Dial value={fmt(listenStats.totalPlays)} label="Plays" />
                  <Dial value={`${listenStats.streak}d`} label="Streak" />
                </div>

              </section>
            )}

            {/* ============ RECENTLY PLAYED ============ */}
            {recentSongs.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-[10px] font-bold uppercase tracking-[0.28em] text-muted-foreground/70">Recently played</h2>
                  <button onClick={() => navigate('/library')} className="neu-sm neu-press px-3 py-1.5 rounded-full text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
                    Library
                  </button>
                </div>
                <div className="flex gap-4 overflow-x-auto hide-scrollbar -mx-5 px-5 pb-2">
                  {recentSongs.map((song) => (
                    <button
                      key={song.id}
                      onClick={() => { triggerHaptic('selection'); playSong(song, null, recentSongs); }}
                      className="shrink-0 w-[104px] text-left"
                      aria-label={`Play ${song.title}`}
                    >
                      <div className="neu neu-press rounded-3xl p-2">
                        <div className="neu-inset w-full aspect-square rounded-2xl overflow-hidden">
                          {song.cover_url ? (
                            <img src={song.cover_url} alt={song.title} className="w-full h-full object-cover rounded-2xl" loading="lazy" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center"><Music2 className="w-6 h-6 text-muted-foreground/60" /></div>
                          )}
                        </div>
                      </div>
                      <p className="mt-2.5 px-1 text-[12px] font-semibold text-foreground truncate leading-tight">{song.title}</p>
                      <p className="px-1 text-[11px] text-muted-foreground/70 truncate">{song.artist}</p>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* ============ LIBRARY ============ */}
            <section>
              <h2 className="text-[10px] font-bold uppercase tracking-[0.28em] text-muted-foreground/70 mb-4">Your library</h2>
              <div className="space-y-3">
                <Key icon={<Heart className="w-[18px] h-[18px] text-primary" fill="currentColor" />}
                  label="Liked Songs"
                  hint={profileSettled ? `${stats.likedSongs} ${stats.likedSongs === 1 ? 'song' : 'songs'}` : '—'}
                  onClick={() => navigate('/library?tab=liked')} />
                <Key icon={<ListMusic className="w-[18px] h-[18px] text-muted-foreground" />}
                  label="Playlists"
                  hint={profileSettled ? `${stats.playlists} ${stats.playlists === 1 ? 'playlist' : 'playlists'}` : '—'}
                  onClick={() => navigate('/library?tab=playlists')} />
                <Key icon={<Download className="w-[18px] h-[18px] text-muted-foreground" />}
                  label="Downloads"
                  hint={profileSettled ? `${stats.downloads} offline` : '—'}
                  onClick={() => navigate('/downloads')} />
              </div>
            </section>

            {/* ============ PREMIUM ============ */}
            {profileSettled && !isPremium && (
              <button
                onClick={() => navigate('/premium')}
                className="neu neu-press w-full rounded-[28px] p-5 text-left flex items-center gap-4"
              >
                <div className="neu-accent w-12 h-12 rounded-2xl flex items-center justify-center shrink-0">
                  <Crown className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-display text-[17px] tracking-wide">GO PREMIUM</p>
                  <p className="text-[11.5px] text-muted-foreground/80 mt-0.5">Ad-free · Offline · Studio EQ · Lossless</p>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground/60" />
              </button>
            )}

            {/* ============ ACCOUNT ============ */}
            <section>
              <h2 className="text-[10px] font-bold uppercase tracking-[0.28em] text-muted-foreground/70 mb-4">Account</h2>
              <div className="space-y-3">
                {profileSettled && isAdmin && (
                  <Key icon={<Shield className="w-[18px] h-[18px] text-primary" />} label="Admin Panel"
                    hint="Manage the platform"
                    onClick={() => navigate('/admin')} />
                )}
                <button onClick={handleLogout}
                  className="neu neu-press w-full flex items-center gap-4 px-4 py-4 rounded-3xl text-left">
                  <div className="neu-inset w-11 h-11 rounded-2xl flex items-center justify-center shrink-0">
                    <LogOut className="w-[18px] h-[18px] text-destructive" />
                  </div>
                  <span className="flex-1 text-[14px] font-semibold text-destructive">Sign Out</span>
                </button>
              </div>
            </section>

            <p className="text-center text-[9.5px] uppercase tracking-[0.35em] text-muted-foreground/60 pt-2 pb-1">
              Univers Flow
            </p>
          </div>
        </main>

        <BottomNav />
      </div>
    </TabTransition>
  );
};

function Dial({ value, label }: { value: string; label: string }) {
  return (
    <div className="neu-inset rounded-2xl px-3 py-4 text-center">
      <p className="font-display font-bold text-[22px] leading-none tracking-wide">{value}</p>
      <p className="mt-2 text-[9.5px] uppercase tracking-[0.2em] text-muted-foreground/70 font-bold">{label}</p>
    </div>
  );
}

function Key({ icon, label, hint, onClick }:
  { icon: React.ReactNode; label: string; hint?: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="neu neu-press w-full flex items-center gap-4 px-4 py-4 rounded-3xl text-left">
      <div className="neu-inset w-11 h-11 rounded-2xl flex items-center justify-center shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-semibold leading-none">{label}</p>
        {hint && <p className="text-[11px] text-muted-foreground/70 mt-1.5 truncate">{hint}</p>}
      </div>
      <ChevronRight className="w-4 h-4 text-muted-foreground/60" />
    </button>
  );
}

export default Profile;
