import { useEffect, useMemo, useState } from 'react';
import {
  Camera,
  Check,
  ChevronRight,
  Crown,
  Disc3,
  Download,
  Edit2,
  Headphones,
  Heart,
  History,
  ListMusic,
  Lock,
  LogOut,
  Mic2,
  Radio,
  Settings,
  Shield,
  SlidersHorizontal,
  User,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { usePremium } from '@/hooks/usePremium';
import BottomNav from '@/components/BottomNav';
import { TabTransition } from '@/components/PageTransition';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import AvatarPickerModal from '@/components/AvatarPickerModal';
import VideoAvatar from '@/components/VideoAvatar';
import { isPresetAvatar, resolveAvatar } from '@/lib/avatars';
import { useDownloads } from '@/contexts/DownloadContext';
import SEOHead from '@/components/SEOHead';
import { loadLibrarySongs } from '@/lib/streamSongs';

interface ProfileData {
  username: string | null;
  username_changed: boolean;
  avatar_url: string | null;
}

const meterBars = [34, 72, 48, 88, 58, 96, 42, 76, 52, 84, 64, 38];

const shortNumber = (value: number) => {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 10000) return `${Math.round(value / 1000)}K`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return value.toLocaleString();
};

const Profile = () => {
  const { user, isAdmin, isLoading: authLoading, signOut } = useAuth();
  const { isPremium, isLoading: premiumLoading } = usePremium();
  const { downloads } = useDownloads();
  const navigate = useNavigate();
  const [stats, setStats] = useState({ likedSongs: 0, playlists: 0, downloads: 0 });
  const [listenStats, setListenStats] = useState<{ minutes: number; topArtist: string | null; topSong: string | null; streak: number }>({
    minutes: 0,
    topArtist: null,
    topSong: null,
    streak: 0,
  });
  const [statsReady, setStatsReady] = useState(false);
  const [profileData, setProfileData] = useState<ProfileData>({ username: null, username_changed: false, avatar_url: null });
  const [profileReady, setProfileReady] = useState(false);
  const [isEditingUsername, setIsEditingUsername] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);

  useEffect(() => {
    if (user) {
      setProfileReady(false);
      setStatsReady(false);
      fetchStats();
      fetchProfile();
    } else {
      setProfileReady(true);
      setStatsReady(true);
    }
  }, [user]);

  useEffect(() => {
    setStats((prev) => ({ ...prev, downloads: downloads.length }));
  }, [downloads.length]);

  const fetchProfile = async () => {
    if (!user) {
      setProfileReady(true);
      return;
    }
    try {
      const { data } = await supabase.from('profiles').select('username, username_changed, avatar_url').eq('user_id', user.id).single();

      if (data) {
        setProfileData({
          username: data.username,
          username_changed: data.username_changed || false,
          avatar_url: data.avatar_url || null,
        });
        setNewUsername(data.username || '');
      }
    } finally {
      setProfileReady(true);
    }
  };

  const fetchStats = async () => {
    if (!user) {
      setStatsReady(true);
      return;
    }
    try {
      const [likedResolved, playlists, recentPlays, playEvents] = await Promise.all([
        loadLibrarySongs(user.id),
        supabase.from('playlists').select('id').eq('user_id', user.id),
        supabase.from('recently_played').select('song_id,played_at').eq('user_id', user.id).order('played_at', { ascending: false }).limit(500),
        supabase.from('song_play_events').select('title,artist,created_at,source').eq('user_id', user.id).order('created_at', { ascending: false }).limit(500),
      ]);
      setStats({
        likedSongs: likedResolved.length,
        playlists: playlists.data?.length || 0,
        downloads: downloads.length,
      });

      type RecentRow = { song_id: string; played_at: string };
      type CatalogSong = { id: string; title: string; artist: string; duration: number | null };
      type PlayEventRow = { title: string | null; artist: string | null; created_at: string };

      const recentRows = (recentPlays.data as RecentRow[] | null) || [];
      const catalogIds = [...new Set(recentRows.map((r) => r.song_id).filter(Boolean))];
      const { data: catalogSongs } = catalogIds.length
        ? await supabase.from('songs').select('id,title,artist,duration').in('id', catalogIds)
        : { data: [] as CatalogSong[] };
      const songById = new Map(((catalogSongs as CatalogSong[] | null) || []).map((song) => [song.id, song]));
      const eventRows = ((playEvents.data as PlayEventRow[] | null) || []).map((r) => ({
        title: r.title,
        artist: r.artist,
        played_at: r.created_at,
        duration: 180,
      }));
      const rows = [
        ...recentRows.map((r) => {
          const song = songById.get(r.song_id);
          return { title: song?.title, artist: song?.artist, played_at: r.played_at, duration: Number(song?.duration) || 180 };
        }),
        ...eventRows,
      ];
      const totalSeconds = rows.reduce((sum, r) => sum + (Number(r.duration) || 180), 0);
      const artistCount = new Map<string, number>();
      const songCount = new Map<string, number>();
      const dayKeys = new Set<string>();
      rows.forEach((r) => {
        if (r.artist) artistCount.set(r.artist, (artistCount.get(r.artist) || 0) + 1);
        if (r.title) songCount.set(r.title, (songCount.get(r.title) || 0) + 1);
        if (r.played_at) dayKeys.add(new Date(r.played_at).toISOString().slice(0, 10));
      });
      const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;

      let streak = 0;
      const cursor = new Date();
      for (let i = 0; i < 60; i++) {
        const key = cursor.toISOString().slice(0, 10);
        if (dayKeys.has(key)) {
          streak++;
          cursor.setDate(cursor.getDate() - 1);
        } else if (i === 0) {
          cursor.setDate(cursor.getDate() - 1);
        } else {
          break;
        }
      }

      setListenStats({
        minutes: Math.round(totalSeconds / 60),
        topArtist: top(artistCount),
        topSong: top(songCount),
        streak,
      });
    } finally {
      setStatsReady(true);
    }
  };

  const handleSaveUsername = async () => {
    if (!user || !newUsername.trim()) return;
    if (newUsername.trim().length < 3) {
      toast.error('Username must be at least 3 characters');
      return;
    }
    if (newUsername.trim().length > 20) {
      toast.error('Username must be less than 20 characters');
      return;
    }
    if (profileData.username_changed) {
      toast.error('You can only change your username once');
      return;
    }

    const confirmed = window.confirm(`Set your username to "${newUsername.trim()}"?\n\nThis can only be done once and cannot be changed later.`);
    if (!confirmed) return;

    setIsSaving(true);
    try {
      const { error } = await supabase.from('profiles').update({ username: newUsername.trim(), username_changed: true }).eq('user_id', user.id);
      if (error) throw error;
      setProfileData((prev) => ({ ...prev, username: newUsername.trim(), username_changed: true }));
      setIsEditingUsername(false);
      toast.success('Username set');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update username');
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogout = async () => {
    await signOut();
    navigate('/auth');
  };

  const displayName = profileData.username || user?.email?.split('@')[0] || 'You';
  const canChangeUsername = !profileData.username_changed;
  const profileSettled = !authLoading && !premiumLoading && profileReady && statsReady;
  const joinYear = user?.created_at ? new Date(user.created_at).getFullYear() : new Date().getFullYear();
  const signalScore = useMemo(
    () => Math.min(99, Math.max(8, Math.round((stats.likedSongs * 1.4 + stats.playlists * 6 + stats.downloads * 3 + listenStats.minutes / 30) % 100))),
    [listenStats.minutes, stats.downloads, stats.likedSongs, stats.playlists],
  );

  const profileTiles = [
    {
      label: 'Liked Songs',
      value: profileSettled ? shortNumber(stats.likedSongs) : '—',
      detail: 'saved tracks',
      icon: Heart,
      action: () => navigate('/library?tab=liked'),
      className: 'col-span-4 row-span-2 min-h-[154px]',
      featured: true,
    },
    {
      label: 'Offline',
      value: profileSettled ? shortNumber(stats.downloads) : '—',
      detail: 'downloads',
      icon: Download,
      action: () => navigate('/downloads'),
      className: 'col-span-2 min-h-[72px]',
    },
    {
      label: 'Playlists',
      value: profileSettled ? shortNumber(stats.playlists) : '—',
      detail: 'mixes',
      icon: ListMusic,
      action: () => navigate('/library?tab=playlists'),
      className: 'col-span-2 min-h-[72px]',
    },
    {
      label: 'Audio Lab',
      value: 'EQ',
      detail: 'instant effects',
      icon: SlidersHorizontal,
      action: () => navigate('/settings'),
      className: 'col-span-3 min-h-[92px]',
    },
    {
      label: 'History',
      value: profileSettled ? shortNumber(listenStats.minutes) : '—',
      detail: 'minutes',
      icon: History,
      action: () => navigate('/search'),
      className: 'col-span-3 min-h-[92px]',
    },
    {
      label: 'Artist Studio',
      value: 'Open',
      detail: 'uploads & stats',
      icon: Mic2,
      action: () => navigate('/artist'),
      className: 'col-span-3 min-h-[84px]',
    },
    {
      label: 'Privacy',
      value: 'Safe',
      detail: 'account control',
      icon: Lock,
      action: () => navigate('/settings'),
      className: 'col-span-3 min-h-[84px]',
    },
  ];

  return (
    <TabTransition>
      <SEOHead
        title="Your Profile — Univers Flow"
        description="Manage your Univers Flow profile, listening stats, liked songs, playlists, downloads and audio settings."
        path="/profile"
      />
      <div className="h-[100dvh] bg-background text-foreground flex flex-col overflow-hidden font-body">
        <main className="flex-1 overflow-y-auto pb-32 safe-area-pt" style={{ WebkitOverflowScrolling: 'touch' }}>
          <section className="px-4 pt-4 pb-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-display text-[26px] uppercase leading-none">Profile</p>
                <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-muted-foreground mt-1">Univers Flow Control</p>
              </div>
              <div className="flex items-center gap-2">
                {isAdmin && (
                  <button
                    onClick={() => navigate('/admin')}
                    className="h-10 w-10 rounded-md border border-border bg-card text-primary active:scale-95 transition"
                    aria-label="Open admin panel"
                  >
                    <Shield className="mx-auto h-4 w-4" />
                  </button>
                )}
                <button
                  onClick={() => navigate('/settings')}
                  className="h-10 w-10 rounded-md border border-border bg-card text-foreground active:scale-95 transition"
                  aria-label="Open settings"
                >
                  <Settings className="mx-auto h-4 w-4" />
                </button>
              </div>
            </div>
          </section>

          <div className="px-4 space-y-3">
            <section
              className="relative overflow-hidden rounded-md border border-border bg-card p-4"
              style={{ boxShadow: 'inset 0 1px 0 hsl(var(--foreground) / 0.05), 0 24px 80px -60px hsl(var(--primary) / 0.75)' }}
            >
              <div className="absolute inset-x-0 top-0 h-px bg-primary/70" />
              <div
                className="absolute inset-0 opacity-[0.045] pointer-events-none"
                style={{
                  backgroundImage: 'linear-gradient(90deg, hsl(var(--foreground)) 1px, transparent 1px), linear-gradient(hsl(var(--foreground)) 1px, transparent 1px)',
                  backgroundSize: '22px 22px',
                }}
              />
              <div className="relative flex items-start gap-4">
                <button
                  onClick={() => user && setShowAvatarPicker(true)}
                  className="relative h-[92px] w-[92px] shrink-0 rounded-md border border-primary/25 bg-background active:scale-[0.98] transition overflow-hidden"
                  aria-label="Change avatar"
                >
                  <div className="absolute inset-0 bg-primary/10" />
                  {isPresetAvatar(profileData.avatar_url) ? (
                    <VideoAvatar variant={profileData.avatar_url} size={92} />
                  ) : resolveAvatar(profileData.avatar_url) ? (
                    <img src={resolveAvatar(profileData.avatar_url)!} alt="Profile avatar" width={92} height={92} className="h-full w-full object-cover interactive-image" />
                  ) : (
                    <User className="absolute inset-0 m-auto h-10 w-10 text-muted-foreground" strokeWidth={1.5} />
                  )}
                  <span className="absolute bottom-1 right-1 flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
                    <Camera className="h-3.5 w-3.5" />
                  </span>
                </button>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-h-8">
                    {!profileSettled ? (
                      <div className="h-8 w-36 rounded-md bg-muted animate-pulse" />
                    ) : isEditingUsername ? (
                      <div className="flex items-center gap-1.5 w-full">
                        <Input
                          value={newUsername}
                          onChange={(e) => setNewUsername(e.target.value)}
                          className="h-9 rounded-md bg-background border-border text-sm"
                          placeholder="username"
                          maxLength={20}
                          autoFocus
                        />
                        <button onClick={handleSaveUsername} disabled={isSaving} aria-label="Save" className="h-9 w-9 rounded-md bg-primary/15 text-primary active:scale-95 transition shrink-0">
                          <Check className="mx-auto h-4 w-4" />
                        </button>
                        <button onClick={() => { setIsEditingUsername(false); setNewUsername(profileData.username || ''); }} aria-label="Cancel" className="h-9 w-9 rounded-md bg-muted text-muted-foreground active:scale-95 transition shrink-0">
                          <X className="mx-auto h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <h1 className="font-display text-[31px] uppercase leading-[0.92] truncate">{displayName}</h1>
                        {canChangeUsername && (
                          <button onClick={() => setIsEditingUsername(true)} aria-label="Edit username" className="h-7 w-7 rounded-md bg-muted text-muted-foreground active:scale-95 transition shrink-0">
                            <Edit2 className="mx-auto h-3.5 w-3.5" />
                          </button>
                        )}
                      </>
                    )}
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-md border border-primary/20 bg-primary/10 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.2em] text-primary">
                      {isPremium ? <Crown className="h-3 w-3" /> : <Radio className="h-3 w-3" />}
                      {isPremium ? 'Premium' : 'Free Signal'}
                    </span>
                    <span className="rounded-md border border-border bg-background px-2 py-1 text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Est. {joinYear}</span>
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-1">
                    <ProfileMicroStat label="Minutes" value={profileSettled ? shortNumber(listenStats.minutes) : '—'} />
                    <ProfileMicroStat label="Streak" value={profileSettled ? String(listenStats.streak) : '—'} />
                    <ProfileMicroStat label="Signal" value={`${signalScore}%`} />
                  </div>
                </div>
              </div>
            </section>

            <section className="grid grid-cols-6 gap-2.5">
              <button
                onClick={() => navigate('/search')}
                className="col-span-6 relative min-h-[128px] overflow-hidden rounded-md border border-primary/20 bg-card p-4 text-left active:scale-[0.99] transition"
              >
                <div className="absolute inset-x-0 top-0 h-px bg-primary" />
                <div className="relative flex h-full justify-between gap-3">
                  <div className="flex min-w-0 flex-col justify-between">
                    <div>
                      <p className="inline-flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.24em] text-primary">
                        <Disc3 className="h-3 w-3" /> Heavy Rotation
                      </p>
                      <p className="mt-2 font-display text-[25px] uppercase leading-none truncate">{listenStats.topSong || 'Start Listening'}</p>
                      <p className="mt-1 text-xs font-medium text-muted-foreground truncate">{listenStats.topArtist || 'Your top track will appear here'}</p>
                    </div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Open listening history</p>
                  </div>
                  <div className="flex h-[84px] w-[92px] shrink-0 items-end justify-center gap-1 rounded-md border border-border bg-background p-2">
                    {meterBars.map((height, index) => (
                      <span key={index} className="w-1 rounded-sm bg-primary/80" style={{ height: `${height}%`, animation: `uf-meter 1.${index + 2}s ease-in-out infinite alternate` }} />
                    ))}
                  </div>
                </div>
              </button>

              {profileTiles.map((tile) => (
                <ProfileTile key={tile.label} {...tile} />
              ))}
            </section>

            {!isPremium && profileSettled && (
              <button onClick={() => navigate('/premium')} className="w-full rounded-md border border-primary/20 bg-primary/10 p-4 text-left active:scale-[0.99] transition">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-md bg-primary text-primary-foreground">
                    <Crown className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-lg uppercase leading-none">Unlock Full Flow</p>
                    <p className="mt-1 text-xs text-muted-foreground truncate">Offline power · sharper audio · no friction</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </button>
            )}

            <section className="overflow-hidden rounded-md border border-border bg-card">
              {isAdmin && <ProfileRow icon={Shield} label="Admin Panel" detail="review controls" onClick={() => navigate('/admin')} />}
              <ProfileRow icon={Settings} label="Settings" detail="account, playback, app" onClick={() => navigate('/settings')} />
              <ProfileRow icon={Headphones} label="Audio Settings" detail="equalizer and playback" onClick={() => navigate('/settings')} />
              <button onClick={handleLogout} className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-muted transition">
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-destructive/10 text-destructive">
                  <LogOut className="h-4 w-4" />
                </div>
                <span className="flex-1 text-sm font-semibold text-destructive">Sign Out</span>
              </button>
            </section>
          </div>
        </main>

        <BottomNav />
        {user && (
          <AvatarPickerModal
            isOpen={showAvatarPicker}
            onClose={() => setShowAvatarPicker(false)}
            userId={user.id}
            currentAvatar={profileData.avatar_url}
            onSaved={(id) => setProfileData((prev) => ({ ...prev, avatar_url: id }))}
          />
        )}
      </div>
    </TabTransition>
  );
};

type TileProps = {
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  action: () => void;
  className: string;
  featured?: boolean;
};

const ProfileTile = ({ label, value, detail, icon: Icon, action, className, featured }: TileProps) => (
  <button
    onClick={action}
    className={`${className} relative overflow-hidden rounded-md border p-3 text-left active:scale-[0.98] transition ${featured ? 'border-primary/25 bg-primary/10' : 'border-border bg-card'}`}
  >
    <div className="flex h-full flex-col justify-between gap-3">
      <div className="flex items-center justify-between gap-2">
        <Icon className={`h-4 w-4 ${featured ? 'text-primary' : 'text-muted-foreground'}`} fill={featured ? 'currentColor' : 'none'} />
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">{value}</span>
      </div>
      <div className="min-w-0">
        <p className={`${featured ? 'font-display text-[30px] uppercase leading-none' : 'text-sm font-bold leading-none'} truncate`}>{label}</p>
        <p className="mt-1 text-[10px] font-medium text-muted-foreground truncate">{detail}</p>
      </div>
    </div>
  </button>
);

const ProfileMicroStat = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-md border border-border bg-background px-2 py-2">
    <p className="text-[8px] font-bold uppercase tracking-[0.2em] text-muted-foreground truncate">{label}</p>
    <p className="mt-1 font-display text-base uppercase leading-none truncate">{value}</p>
  </div>
);

type RowIcon = LucideIcon;

const ProfileRow = ({ icon: Icon, label, detail, onClick }: { icon: RowIcon; label: string; detail: string; onClick: () => void }) => (
  <button onClick={onClick} className="w-full flex items-center gap-3 border-b border-border px-4 py-3.5 text-left active:bg-muted transition">
    <div className="flex h-9 w-9 items-center justify-center rounded-md bg-background text-muted-foreground">
      <Icon className="h-4 w-4" />
    </div>
    <div className="min-w-0 flex-1">
      <p className="text-sm font-semibold leading-none truncate">{label}</p>
      <p className="mt-1 text-[10px] font-medium text-muted-foreground truncate">{detail}</p>
    </div>
    <ChevronRight className="h-4 w-4 text-muted-foreground" />
  </button>
);

export default Profile;