import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Settings, LogOut, Shield, Heart, ListMusic, Crown, ChevronRight,
  Edit2, Check, X, Download, Music2, Camera, Loader2,
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
import RecapModal from '@/components/RecapModal';
import { loadPlayRecords, computeStreak } from '@/lib/listeningInsights';
import { readListenLog } from '@/lib/listenLog';

interface ProfileData {
  username: string | null;
  username_changed: boolean;
  avatar_url: string | null;
}

// The avatar must paint instantly on every visit: cache the last known URL
// per user and render it while the fresh profile row is still loading.
const avatarCacheKey = (userId: string) => `uf_avatar_${userId}`;
const readCachedAvatar = (userId?: string) => {
  if (!userId) return null;
  try { const v = localStorage.getItem(avatarCacheKey(userId)); return v && v.startsWith('data:') ? v : null; } catch { return null; }
};

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
  const [recapOpen, setRecapOpen] = useState(false);

  const [profileData, setProfileData] = useState<ProfileData>({ username: null, username_changed: false, avatar_url: null });
  const [profileReady, setProfileReady] = useState(false);
  const [isEditingUsername, setIsEditingUsername] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  // Painted instantly from cache; replaced by a fresh signed URL once loaded.
  const [avatarSrc, setAvatarSrc] = useState<string | null>(() => readCachedAvatar(user?.id));
  const [avatarUploading, setAvatarUploading] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  // Profile photos never leave the phone: shrink to a small JPEG and keep it
  // in this device's local storage only. Nothing is uploaded.
  const refreshAvatarUrl = async (_path: string | null, _userId: string) => {};

  const handleAvatarPick = async (file: File | null) => {
    if (!file || !user) return;
    if (!file.type.startsWith('image/')) { toast.error('Please pick an image'); return; }
    setAvatarUploading(true);
    try {
      const bitmapUrl = URL.createObjectURL(file);
      const img = new Image();
      await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('Could not read image')); img.src = bitmapUrl; });
      const size = 256;
      const canvas = document.createElement('canvas');
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not process image');
      const s = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      URL.revokeObjectURL(bitmapUrl);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
      localStorage.setItem(avatarCacheKey(user.id), dataUrl);
      window.dispatchEvent(new Event('uf-avatar-changed'));
      setAvatarSrc(dataUrl);
      toast.success('Profile photo updated');
    } catch (error: any) {
      toast.error(error?.message || 'Failed to set photo');
    } finally { setAvatarUploading(false); }
  };

  useEffect(() => {
    if (user) { setProfileReady(false); setStatsReady(false); fetchStats(); fetchProfile(); }
    else { setProfileReady(true); setStatsReady(true); }
  }, [user]);

  // Auth resolves after first paint, so the initial cache read often runs with
  // no user id. Hydrate the cached avatar the moment the user id is known.
  useEffect(() => {
    if (!user?.id) return;
    setAvatarSrc((prev) => prev ?? readCachedAvatar(user.id));
  }, [user?.id]);

  // Liking/unliking anywhere in the app must reflect here without a reload.
  useEffect(() => {
    if (!user) return;
    const onLikes = () => { fetchStats(); };
    window.addEventListener('uf:likes-changed', onLikes);
    return () => window.removeEventListener('uf:likes-changed', onLikes);
  }, [user]);


  useEffect(() => { setStats(prev => ({ ...prev, downloads: downloads.length })); }, [downloads.length]);

  // Minutes and streak from the FULL history (server events + device history +
  // the measured listen log). The catalog-duration estimate below only knows
  // uploaded songs, so YouTube/JioSaavn plays used to read as 0 minutes / 0d.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const records = await loadPlayRecords(user?.id ?? null);
        if (cancelled) return;
        const log = readListenLog(user?.id ?? null);
        const measured = log.days.reduce((sum, d) => sum + d.seconds, 0);
        const estimated = records.reduce((sum, r) => sum + (r.duration && r.duration > 0 ? r.duration : 0), 0);
        const seconds = Math.max(measured, estimated);
        const { current } = computeStreak(records, user?.id ?? null);
        setListenStats((prev) => ({
          minutes: Math.max(prev.minutes, Math.round(seconds / 60)),
          streak: Math.max(prev.streak, current),
          totalPlays: Math.max(prev.totalPlays, records.length),
        }));
      } catch {
        /* stats stay at whatever the server pass produced */
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

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
        .from('profiles').select('username, username_changed, avatar_url')
        .eq('user_id', user.id).single();
      if (data) {
        setProfileData({
          username: data.username,
          username_changed: data.username_changed || false,
          avatar_url: data.avatar_url || null,
        });
        setNewUsername(data.username || '');
        void refreshAvatarUrl(data.avatar_url || null, user.id);
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
  const fmt = (n: number) => (n > 0 ? n.toLocaleString() : '0');

  const Row = ({ icon, label, hint, onClick, danger }:
    { icon: React.ReactNode; label: string; hint?: string; onClick: () => void; danger?: boolean }) => (
    <button onClick={onClick}
      className="w-full flex items-center gap-3.5 px-4 py-3.5 text-left active:bg-muted/60 transition-colors">
      <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-muted ${danger ? 'text-destructive' : 'text-foreground/80'}`}>{icon}</span>
      <span className={`flex-1 min-w-0 text-[15px] ${danger ? 'text-destructive' : ''}`}>{label}</span>
      {hint && <span className="text-[13px] text-muted-foreground truncate">{hint}</span>}
      {!danger && <ChevronRight className="w-4 h-4 text-muted-foreground/50 shrink-0" />}
    </button>
  );
  const Group = ({ children }: { children: React.ReactNode }) => (
    <div className="rounded-2xl bg-card border border-border/60 overflow-hidden divide-y divide-border/60">{children}</div>
  );
  const Label = ({ children }: { children: React.ReactNode }) => (
    <h2 className="px-1 mb-2 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</h2>
  );

  return (
    <TabTransition>
      <SEOHead
        title="Your Profile — Univers Flow"
        description="Your Univers Flow profile: listening stats, library, downloads and account."
        path="/profile"
      />
      <div className="h-[100dvh] flex flex-col overflow-hidden bg-background">
        <main className="flex-1 overflow-y-auto pb-36 safe-area-pt" style={{ WebkitOverflowScrolling: 'touch' }}>
          <header className="px-5 pt-4 flex items-center justify-between">
            <h1 className="text-[28px] font-bold tracking-tight">Profile</h1>
            <button onClick={() => navigate('/settings')} aria-label="Settings"
              className="w-10 h-10 rounded-full flex items-center justify-center bg-muted active:opacity-70">
              <Settings className="w-[18px] h-[18px] text-foreground/80" />
            </button>
          </header>

          <section className="px-5 pt-5 flex items-center gap-4">
            <button
              onClick={() => avatarInputRef.current?.click()}
              disabled={avatarUploading}
              aria-label="Change profile photo"
              className="relative w-[72px] h-[72px] rounded-full bg-muted border border-border flex items-center justify-center shrink-0 overflow-hidden active:opacity-80"
            >
              {avatarSrc ? (
                <img src={avatarSrc} alt="" className="absolute inset-0 w-full h-full object-cover" draggable={false} />
              ) : (
                <span className="text-[26px] font-semibold text-foreground select-none">{initials}</span>
              )}
              <span className="absolute bottom-0 right-0 w-6 h-6 rounded-full bg-primary flex items-center justify-center border-2 border-background">
                {avatarUploading
                  ? <Loader2 className="w-3 h-3 text-primary-foreground animate-spin" />
                  : <Camera className="w-3 h-3 text-primary-foreground" />}
              </span>
            </button>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => { void handleAvatarPick(e.target.files?.[0] || null); e.target.value = ''; }}
            />
            <div className="flex-1 min-w-0">
              {!profileSettled ? (
                <div className="h-6 w-32 rounded-md bg-muted animate-pulse" />
              ) : isEditingUsername ? (
                <div className="flex items-center gap-2">
                  <Input value={newUsername} onChange={(e) => setNewUsername(e.target.value)}
                    className="h-10 rounded-xl text-base" placeholder="username" maxLength={20} autoFocus />
                  <button onClick={handleSaveUsername} disabled={isSaving} aria-label="Save"
                    className="w-10 h-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                    <Check className="w-4 h-4 text-primary" />
                  </button>
                  <button onClick={() => { setIsEditingUsername(false); setNewUsername(profileData.username || ''); }}
                    aria-label="Cancel" className="w-10 h-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                    <X className="w-4 h-4 text-muted-foreground" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <p className="text-[22px] font-semibold leading-tight truncate">{displayName}</p>
                  {canChangeUsername && (
                    <button onClick={() => setIsEditingUsername(true)} aria-label="Edit username" className="p-1 text-muted-foreground">
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}
              <p className="mt-0.5 text-[13px] text-muted-foreground truncate">
                {profileSettled ? [isPremium ? 'Premium' : 'Free plan', memberSinceLabel].filter(Boolean).join(' · ') : '\u00A0'}
              </p>
            </div>
          </section>

          <section className="px-5 pt-5 grid grid-cols-3 gap-2">
            {[
              { v: fmt(listenStats.minutes), l: 'Minutes' },
              { v: fmt(listenStats.totalPlays), l: 'Plays' },
              { v: `${listenStats.streak}d`, l: 'Streak' },
            ].map((s) => (
              <button key={s.l} onClick={() => setRecapOpen(true)} className="rounded-2xl bg-card border border-border/60 py-3 text-center active:opacity-70">
                <p className="text-[18px] font-semibold tabular-nums leading-none">{s.v}</p>
                <p className="mt-1.5 text-[11px] text-muted-foreground">{s.l}</p>
              </button>
            ))}
          </section>

          <RecapModal isOpen={recapOpen} onClose={() => setRecapOpen(false)} />
          <div className="px-5 pt-6 space-y-6">
            <EmailVerificationCard />

            {recentSongs.length > 0 && (
              <section>
                <div className="flex items-baseline justify-between mb-3 px-1">
                  <h2 className="text-[19px] font-semibold">Recently Played</h2>
                  <button onClick={() => navigate('/library')} className="text-[14px] text-primary">See All</button>
                </div>
                <div className="flex gap-3 overflow-x-auto hide-scrollbar -mx-5 px-5 pb-1">
                  {recentSongs.map((song) => (
                    <button key={song.id} onClick={() => { triggerHaptic('selection'); playSong(song, null, recentSongs); }}
                      className="shrink-0 w-[112px] text-left active:opacity-70" aria-label={`Play ${song.title}`}>
                      <div className="w-full aspect-square rounded-xl overflow-hidden bg-muted">
                        {song.cover_url ? (
                          <img src={song.cover_url} alt={song.title} className="w-full h-full object-cover" loading="lazy" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center"><Music2 className="w-6 h-6 text-muted-foreground/60" /></div>
                        )}
                      </div>
                      <p className="mt-2 text-[13px] font-medium truncate leading-tight">{song.title}</p>
                      <p className="text-[12px] text-muted-foreground truncate">{song.artist}</p>
                    </button>
                  ))}
                </div>
              </section>
            )}

            <section>
              <Label>Library</Label>
              <Group>
                <Row icon={<Heart className="w-4 h-4" />} label="Liked Songs"
                  hint={profileSettled ? String(stats.likedSongs) : undefined} onClick={() => navigate('/library?tab=liked')} />
                <Row icon={<ListMusic className="w-4 h-4" />} label="Playlists"
                  hint={profileSettled ? String(stats.playlists) : undefined} onClick={() => navigate('/library?tab=playlists')} />
                <Row icon={<Download className="w-4 h-4" />} label="Downloads"
                  hint={profileSettled ? String(stats.downloads) : undefined} onClick={() => navigate('/downloads')} />
              </Group>
            </section>

            <section>
              <Label>Account</Label>
              <Group>
                {profileSettled && (
                  <Row icon={<Crown className="w-4 h-4" />} label={isPremium ? 'Manage Premium' : 'Premium'}
                    hint={isPremium ? 'Active' : 'Upgrade'} onClick={() => navigate('/premium')} />
                )}
                {profileSettled && isAdmin && (
                  <Row icon={<Shield className="w-4 h-4" />} label="Admin" onClick={() => navigate('/admin')} />
                )}
                <Row icon={<Settings className="w-4 h-4" />} label="Settings" onClick={() => navigate('/settings')} />
                <Row icon={<LogOut className="w-4 h-4" />} label="Sign Out" onClick={handleLogout} danger />
              </Group>
            </section>

            {user?.email && <p className="text-center text-[12px] text-muted-foreground/70">{user.email}</p>}
          </div>
        </main>
        <BottomNav />
      </div>
    </TabTransition>
  );
};

export default Profile;
