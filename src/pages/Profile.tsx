import { useState, useEffect } from 'react';
import { User, Settings, LogOut, Shield, Heart, ListMusic, ChevronRight, Crown, Edit2, Check, X, Star, Headphones, Download, Flame, Radio, Music2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { usePremium } from '@/hooks/usePremium';
import { usePlayer } from '@/contexts/PlayerContext';
import BottomNav from '@/components/BottomNav';
import PremiumBadge from '@/components/PremiumBadge';
import ReviewModal from '@/components/ReviewModal';
import ReviewsSheet from '@/components/ReviewsSheet';
import { TabTransition } from '@/components/PageTransition';
import EmailVerificationCard from '@/components/EmailVerificationCard';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import AvatarPickerModal from '@/components/AvatarPickerModal';
import VideoAvatar from '@/components/VideoAvatar';
import { resolveAvatar, isPresetAvatar } from '@/lib/avatars';
import { useDownloads } from '@/contexts/DownloadContext';
import { Camera } from 'lucide-react';
import SEOHead from '@/components/SEOHead';
import { loadLibrarySongs } from '@/lib/streamSongs';

interface ProfileData {
  username: string | null;
  username_changed: boolean;
  avatar_url: string | null;
}

type RecentCover = { id: string; title: string; artist: string; cover_url: string | null };

const Profile = () => {
  const { user, isAdmin, isLoading: authLoading, signOut } = useAuth();
  const { isPremium, isLoading: premiumLoading } = usePremium();
  const { downloads } = useDownloads();
  const { playSong } = usePlayer();
  const navigate = useNavigate();
  const [stats, setStats] = useState({ likedSongs: 0, playlists: 0, downloads: 0 });
  const [listenStats, setListenStats] = useState<{ minutes: number; topArtist: string | null; topSong: string | null; streak: number; totalPlays: number; topGenre: string | null }>({ minutes: 0, topArtist: null, topSong: null, streak: 0, totalPlays: 0, topGenre: null });
  const [recentCovers, setRecentCovers] = useState<RecentCover[]>([]);
  const [memberSinceLabel, setMemberSinceLabel] = useState<string>('');
  const [statsReady, setStatsReady] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [showReviewsList, setShowReviewsList] = useState(false);

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
    setStats(prev => ({ ...prev, downloads: downloads.length }));
  }, [downloads.length]);

  const fetchProfile = async () => {
    if (!user) { setProfileReady(true); return; }
    try {
      const { data } = await supabase
        .from('profiles')
        .select('username, username_changed, avatar_url')
        .eq('user_id', user.id)
        .single();

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
    if (!user) { setStatsReady(true); return; }
    try {
      const [likedResolved, playlists, recentPlays, playEvents, followersRes, followingRes] = await Promise.all([
        loadLibrarySongs(user.id),
        supabase.from('playlists').select('id').eq('user_id', user.id),
        supabase.from('recently_played').select('song_id,played_at').eq('user_id', user.id).order('played_at', { ascending: false }).limit(500),
        supabase.from('song_play_events').select('title,artist,created_at,source').eq('user_id', user.id).order('created_at', { ascending: false }).limit(500),
        supabase.from('friends').select('id', { count: 'exact', head: true }).eq('friend_id', user.id).eq('status', 'accepted'),
        supabase.from('friends').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('status', 'accepted'),
      ]);
      setStats({
        likedSongs: likedResolved.length,
        playlists: playlists.data?.length || 0,
        downloads: downloads.length,
      });
      setSocial({ followers: followersRes.count || 0, following: followingRes.count || 0 });

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
    if (newUsername.trim().length < 3) { toast.error('Username must be at least 3 characters'); return; }
    if (newUsername.trim().length > 20) { toast.error('Username must be less than 20 characters'); return; }
    if (profileData.username_changed) { toast.error('You can only change your username once'); return; }

    const confirmed = window.confirm(`Set your username to "${newUsername.trim()}"?\n\nThis can only be done once and cannot be changed later.`);
    if (!confirmed) return;

    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ username: newUsername.trim(), username_changed: true })
        .eq('user_id', user.id);
      if (error) throw error;
      setProfileData(prev => ({ ...prev, username: newUsername.trim(), username_changed: true }));
      setIsEditingUsername(false);
      toast.success('Username set!');
    } catch (error) {
      toast.error(error.message || 'Failed to update username');
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

  // Deterministic member number based on user id
  const memberNo = user?.id
    ? '№ ' + parseInt(user.id.replace(/[^0-9a-f]/g, '').slice(0, 6) || '0', 16).toString().padStart(6, '0').slice(-6)
    : '№ 000000';
  const joinYear = user?.created_at ? new Date(user.created_at).getFullYear() : new Date().getFullYear();

  return (
    <TabTransition>
      <SEOHead
        title="Your Profile — Univers Flow"
        description="Manage your Univers Flow profile: avatar, username, listening stats, liked songs, playlists and downloads."
        path="/profile"
      />
      <div className="h-[100dvh] bg-background flex flex-col overflow-hidden">
        <main className="flex-1 overflow-y-auto pb-32 safe-area-pt" style={{ WebkitOverflowScrolling: 'touch' }}>

          {/* === Membership Card Hero === */}
          <section className="px-4 pt-4 pb-2">
            <div
              className="relative rounded-[28px] overflow-hidden p-5"
              style={{
                background:
                  'radial-gradient(120% 90% at 0% 0%, hsl(var(--primary) / 0.28), transparent 55%), radial-gradient(120% 90% at 100% 100%, hsl(18 100% 65% / 0.18), transparent 55%), linear-gradient(180deg, hsl(0 0% 8%), hsl(0 0% 5%))',
                border: '1px solid hsl(0 0% 100% / 0.08)',
                boxShadow: '0 30px 60px -30px hsl(var(--primary) / 0.4), inset 0 1px 0 hsl(0 0% 100% / 0.06)',
              }}
            >
              {/* Grain / noise overlay */}
              <div
                className="absolute inset-0 opacity-[0.06] mix-blend-overlay pointer-events-none"
                style={{ backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")" }}
              />

              {/* Top row: brand + member # */}
              <div className="relative flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                  <span className="text-[9px] font-black uppercase tracking-[0.32em] text-white/60">
                    Univers Flow · Member
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowShare(true)}
                    aria-label="Share profile"
                    className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center active:scale-90"
                  >
                    <Share2 className="w-3.5 h-3.5 text-white/80" />
                  </button>
                  <span className="text-[10px] font-mono tracking-widest text-white/40">{memberNo}</span>
                </div>
              </div>

              {/* Avatar + identity */}
              <div className="relative mt-6 flex items-end gap-4">
                <button
                  onClick={() => user && setShowAvatarPicker(true)}
                  className="relative active:scale-95 transition shrink-0"
                  aria-label="Change avatar"
                >
                  <div
                    className="w-24 h-24 rounded-3xl flex items-center justify-center overflow-hidden"
                    style={{
                      background: 'linear-gradient(135deg, hsl(var(--primary)), hsl(18 100% 70%))',
                      boxShadow: '0 12px 30px -8px hsl(var(--primary) / 0.55), inset 0 0 0 2px hsl(0 0% 100% / 0.12)',
                    }}
                  >
                    {isPresetAvatar(profileData.avatar_url) ? (
                      <VideoAvatar variant={profileData.avatar_url} size={96} />
                    ) : resolveAvatar(profileData.avatar_url) ? (
                      <img
                        src={resolveAvatar(profileData.avatar_url)!}
                        alt="Profile avatar"
                        width={96}
                        height={96}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <User className="w-12 h-12 text-white" strokeWidth={1.5} />
                    )}
                  </div>
                  <div
                    className="absolute -bottom-1.5 -right-1.5 w-7 h-7 rounded-full flex items-center justify-center shadow-lg"
                    style={{
                      background: isPremium ? 'linear-gradient(135deg, #fbbf24, #f59e0b)' : 'hsl(var(--primary))',
                      border: '3px solid hsl(0 0% 6%)',
                    }}
                  >
                    {isPremium ? <Crown className="w-3.5 h-3.5 text-white" /> : <Camera className="w-3 h-3 text-primary-foreground" />}
                  </div>
                </button>

                <div className="flex-1 min-w-0 pb-1">
                  {!profileSettled ? (
                    <div className="space-y-2 animate-pulse">
                      <div className="h-7 w-40 rounded bg-white/10" />
                      <div className="h-3 w-24 rounded bg-white/5" />
                    </div>
                  ) : isEditingUsername ? (
                    <div className="flex items-center gap-1.5">
                      <Input
                        value={newUsername}
                        onChange={(e) => setNewUsername(e.target.value)}
                        className="h-9 bg-white/10 border-white/20 text-base"
                        placeholder="username"
                        maxLength={20}
                        autoFocus
                      />
                      <button onClick={handleSaveUsername} disabled={isSaving} aria-label="Save" className="w-9 h-9 rounded-full bg-green-500/20 flex items-center justify-center shrink-0">
                        <Check className="w-4 h-4 text-green-400" />
                      </button>
                      <button onClick={() => { setIsEditingUsername(false); setNewUsername(profileData.username || ''); }} aria-label="Cancel" className="w-9 h-9 rounded-full bg-red-500/20 flex items-center justify-center shrink-0">
                        <X className="w-4 h-4 text-red-400" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <h1 className="font-display text-[30px] leading-none tracking-tight truncate">{displayName}</h1>
                        {canChangeUsername && (
                          <button onClick={() => setIsEditingUsername(true)} aria-label="Edit username" className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center active:scale-90 transition shrink-0">
                            <Edit2 className="w-3 h-3 text-white/60" />
                          </button>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        {isPremium ? (
                          <PremiumBadge size="xs" />
                        ) : (
                          <span className="text-[9px] font-black uppercase tracking-[0.22em] text-white/50">Free Tier</span>
                        )}
                        <span className="text-white/20">·</span>
                        <span className="text-[9px] font-black uppercase tracking-[0.22em] text-white/50">Est. {joinYear}</span>
                        {isAdmin && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider" style={{ background: 'hsl(211 100% 50% / 0.2)', color: 'hsl(211 100% 65%)' }}>
                            <Shield className="w-2.5 h-2.5" /> Admin
                          </span>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Perforation divider */}
              <div className="relative mt-5 mb-4">
                <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 border-t border-dashed border-white/10" />
                <div className="absolute -left-8 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-background" />
                <div className="absolute -right-8 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-background" />
              </div>

              {/* Ticket stub: listening data */}
              {profileSettled && user && (
                <div className="relative grid grid-cols-3 gap-3">
                  <div>
                    <p className="text-[8px] font-black uppercase tracking-[0.22em] text-white/40 mb-1">Minutes</p>
                    <p className="font-display text-2xl leading-none tracking-tight">{listenStats.minutes.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-[8px] font-black uppercase tracking-[0.22em] text-white/40 mb-1">Streak</p>
                    <p className="font-display text-2xl leading-none tracking-tight inline-flex items-center gap-1">
                      {listenStats.streak}
                      {listenStats.streak > 0 && <Flame className="w-4 h-4 text-primary" fill="currentColor" />}
                    </p>
                  </div>
                  <div>
                    <p className="text-[8px] font-black uppercase tracking-[0.22em] text-white/40 mb-1">Saved</p>
                    <p className="font-display text-2xl leading-none tracking-tight">{stats.likedSongs}</p>
                  </div>
                </div>
              )}
            </div>
          </section>

          <div className="px-4 space-y-4 mt-2">

            <EmailVerificationCard />

            {/* === Now Spinning: Top Artist & Song === */}
            {profileSettled && user && (listenStats.topArtist || listenStats.topSong) && (
              <div
                className="relative rounded-[24px] p-4 overflow-hidden"
                style={{
                  background: 'linear-gradient(120deg, hsl(0 0% 10%), hsl(0 0% 7%))',
                  border: '1px solid hsl(0 0% 100% / 0.06)',
                }}
              >
                <div className="absolute -right-10 -top-10 w-40 h-40 rounded-full uf-rose-gradient opacity-20 blur-3xl pointer-events-none" />
                <div className="relative flex items-center gap-4">
                  {/* Spinning vinyl */}
                  <div className="relative w-16 h-16 shrink-0">
                    <div className="absolute inset-0 rounded-full bg-black border border-white/10" style={{ animation: 'spin 8s linear infinite' }}>
                      <div className="absolute inset-1 rounded-full border border-white/[0.04]" />
                      <div className="absolute inset-2.5 rounded-full border border-white/[0.04]" />
                      <div className="absolute inset-4 rounded-full uf-rose-gradient" />
                      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-background" />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[9px] font-black uppercase tracking-[0.24em] text-primary/80 mb-1 inline-flex items-center gap-1.5">
                      <Radio className="w-2.5 h-2.5" /> On Heavy Rotation
                    </p>
                    <p className="font-display text-lg leading-tight truncate">{listenStats.topSong || 'Start listening'}</p>
                    <p className="text-xs text-white/50 truncate mt-0.5">{listenStats.topArtist || '—'}</p>
                  </div>
                </div>
              </div>
            )}

            {/* === Friend Activity === */}
            {profileSettled && user && (
              <FriendActivityCard onFindFriends={() => setFriendsSheet('search')} />
            )}

            {/* === Social row === */}
            {profileSettled && user && (
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setFriendsSheet('followers')}
                  className="rounded-[20px] p-3.5 text-left bg-white/[0.04] border border-white/[0.06] active:scale-[0.97] transition flex items-center gap-3"
                >
                  <div className="w-9 h-9 rounded-2xl bg-white/[0.06] flex items-center justify-center shrink-0">
                    <Users className="w-4 h-4 text-white/80" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-display text-lg leading-none tracking-tight">{social.followers}</p>
                    <p className="text-[10px] text-white/50 mt-1 font-black uppercase tracking-[0.18em]">Followers</p>
                  </div>
                </button>
                <button
                  onClick={() => setFriendsSheet('following')}
                  className="rounded-[20px] p-3.5 text-left bg-white/[0.04] border border-white/[0.06] active:scale-[0.97] transition flex items-center gap-3"
                >
                  <div className="w-9 h-9 rounded-2xl bg-primary/15 flex items-center justify-center shrink-0">
                    <UserPlus className="w-4 h-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-display text-lg leading-none tracking-tight">{social.following}</p>
                    <p className="text-[10px] text-white/50 mt-1 font-black uppercase tracking-[0.18em]">Following</p>
                  </div>
                </button>
              </div>
            )}

            {/* === Editorial tile grid === */}
            <div className="grid grid-cols-6 gap-3">
              {/* Liked — large */}
              <button
                onClick={() => navigate('/library?tab=liked')}
                className="col-span-4 row-span-2 relative rounded-[24px] p-4 text-left overflow-hidden active:scale-[0.98] transition min-h-[140px] flex flex-col justify-between"
                style={{
                  background: 'linear-gradient(160deg, hsl(var(--primary) / 0.22), hsl(0 0% 8%) 70%)',
                  border: '1px solid hsl(var(--primary) / 0.2)',
                }}
              >
                <div className="absolute -bottom-8 -right-6 w-32 h-32 rounded-full uf-rose-gradient opacity-30 blur-2xl" />
                <div className="relative flex items-center gap-2">
                  <Heart className="w-4 h-4 text-primary" fill="currentColor" />
                  <span className="text-[9px] font-black uppercase tracking-[0.22em] text-white/50">Collection</span>
                </div>
                <div className="relative">
                  <p className="font-display text-3xl leading-none tracking-tight">Liked</p>
                  <p className="text-xs text-white/50 mt-1.5">{profileSettled ? `${stats.likedSongs} tracks in rotation` : '—'}</p>
                </div>
              </button>

              {/* Playlists */}
              <button
                onClick={() => navigate('/library?tab=playlists')}
                className="col-span-2 rounded-[20px] p-3 text-left bg-white/[0.04] border border-white/[0.06] active:scale-[0.97] transition flex flex-col justify-between min-h-[66px]"
              >
                <ListMusic className="w-4 h-4 text-white/70" />
                <div>
                  <p className="text-sm font-bold leading-none">Playlists</p>
                  <p className="text-[10px] text-white/40 mt-1">{profileSettled ? stats.playlists : '—'}</p>
                </div>
              </button>

              {/* Downloads */}
              <button
                onClick={() => navigate('/downloads')}
                className="col-span-2 rounded-[20px] p-3 text-left bg-white/[0.04] border border-white/[0.06] active:scale-[0.97] transition flex flex-col justify-between min-h-[66px]"
              >
                <Download className="w-4 h-4 text-white/70" />
                <div>
                  <p className="text-sm font-bold leading-none">Offline</p>
                  <p className="text-[10px] text-white/40 mt-1">{profileSettled ? stats.downloads : '—'}</p>
                </div>
              </button>

              {/* Audio / EQ */}
              <button
                onClick={() => navigate('/settings')}
                className="col-span-3 rounded-[20px] p-3 text-left bg-white/[0.04] border border-white/[0.06] active:scale-[0.97] transition flex items-center gap-2.5"
              >
                <div className="w-8 h-8 rounded-xl bg-white/[0.06] flex items-center justify-center shrink-0">
                  <Headphones className="w-4 h-4 text-white/80" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold leading-none">Audio</p>
                  <p className="text-[10px] text-white/40 mt-1">EQ · Playback</p>
                </div>
              </button>

              {/* Reviews */}
              <button
                onClick={() => setShowReviewsList(true)}
                className="col-span-3 rounded-[20px] p-3 text-left bg-white/[0.04] border border-white/[0.06] active:scale-[0.97] transition flex items-center gap-2.5"
              >
                <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'hsl(45 100% 50% / 0.15)' }}>
                  <Star className="w-4 h-4 text-yellow-400" fill="currentColor" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold leading-none">Reviews</p>
                  <p className="text-[10px] text-white/40 mt-1">Share your take</p>
                </div>
              </button>
            </div>

            {/* === Premium Upgrade === */}
            {profileSettled && !isPremium && (
              <button
                onClick={() => navigate('/premium')}
                className="w-full rounded-[24px] p-4 text-left relative overflow-hidden"
                style={{
                  background: 'linear-gradient(120deg, hsl(45 90% 50% / 0.14), hsl(var(--primary) / 0.18))',
                  border: '1px solid hsl(45 90% 55% / 0.28)',
                }}
              >
                <div className="absolute -top-10 -right-6 w-40 h-40 rounded-full opacity-40 blur-3xl" style={{ background: 'radial-gradient(circle, #fbbf24, transparent 60%)' }} />
                <div className="relative flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg" style={{ background: 'linear-gradient(135deg, #fbbf24, #f59e0b)' }}>
                    <Crown className="w-6 h-6 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-display text-lg leading-none tracking-tight">Unlock Premium</p>
                    <p className="text-[11px] text-white/60 mt-1">Ad-free · Offline · Studio EQ · HQ Audio</p>
                  </div>
                  <ChevronRight className="w-5 h-5 text-white/40" />
                </div>
              </button>
            )}

            {/* === Menu === */}
            <div className="rounded-[24px] overflow-hidden bg-white/[0.03] border border-white/[0.06]">
              {profileSettled && isAdmin && (
                <button onClick={() => navigate('/admin')} className="w-full flex items-center gap-3 px-4 py-3.5 text-left border-b border-white/[0.05] active:bg-white/[0.04]">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-primary/20"><Shield className="w-4 h-4 text-primary" /></div>
                  <span className="flex-1 text-sm font-medium">Admin Panel</span>
                  <ChevronRight className="w-4 h-4 text-white/30" />
                </button>
              )}
              <button onClick={() => navigate('/settings')} className="w-full flex items-center gap-3 px-4 py-3.5 text-left border-b border-white/[0.05] active:bg-white/[0.04]">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-white/[0.06]"><Settings className="w-4 h-4 text-white/80" /></div>
                <span className="flex-1 text-sm font-medium">Settings</span>
                <ChevronRight className="w-4 h-4 text-white/30" />
              </button>
              <button onClick={handleLogout} className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-white/[0.04]">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-destructive/15"><LogOut className="w-4 h-4 text-destructive" /></div>
                <span className="flex-1 text-sm font-medium text-destructive">Sign Out</span>
              </button>
            </div>

            {/* Footer signature */}
            <p className="text-center text-[9px] font-black uppercase tracking-[0.32em] text-white/25 pt-3 pb-2">
              — Univers Flow —
            </p>
          </div>
        </main>

        <BottomNav />
        <ReviewModal isOpen={showReview} onClose={() => setShowReview(false)} />
        <ReviewsSheet
          isOpen={showReviewsList}
          onClose={() => setShowReviewsList(false)}
          onWriteReview={() => { setShowReviewsList(false); setTimeout(() => setShowReview(true), 250); }}
        />
        {user && (
          <AvatarPickerModal
            isOpen={showAvatarPicker}
            onClose={() => setShowAvatarPicker(false)}
            userId={user.id}
            currentAvatar={profileData.avatar_url}
            onSaved={(id) => setProfileData(prev => ({ ...prev, avatar_url: id }))}
          />
        )}
        <FriendsSheet
          isOpen={friendsSheet !== null}
          mode={friendsSheet || 'followers'}
          onClose={() => setFriendsSheet(null)}
        />
        <ShareProfileSheet isOpen={showShare} onClose={() => setShowShare(false)} />
      </div>
    </TabTransition>
  );
};

export default Profile;
