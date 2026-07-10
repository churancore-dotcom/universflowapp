import { useState, useEffect, useMemo } from 'react';
import {
  Settings, LogOut, Shield, Heart, ListMusic, ChevronRight, Crown, Edit2, Check, X,
  Star, Headphones, Download, Flame, Radio, ArrowUpRight,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { usePremium } from '@/hooks/usePremium';
import BottomNav from '@/components/BottomNav';
import ReviewModal from '@/components/ReviewModal';
import ReviewsSheet from '@/components/ReviewsSheet';
import { TabTransition } from '@/components/PageTransition';
import EmailVerificationCard from '@/components/EmailVerificationCard';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { useDownloads } from '@/contexts/DownloadContext';
import SEOHead from '@/components/SEOHead';
import { loadLibrarySongs } from '@/lib/streamSongs';

interface ProfileData {
  username: string | null;
  username_changed: boolean;
}

const Profile = () => {
  const { user, isAdmin, isLoading: authLoading, signOut } = useAuth();
  const { isPremium, isLoading: premiumLoading } = usePremium();
  const { downloads } = useDownloads();
  const navigate = useNavigate();

  const [stats, setStats] = useState({ likedSongs: 0, playlists: 0, downloads: 0 });
  const [listenStats, setListenStats] = useState<{ minutes: number; topArtist: string | null; topSong: string | null; streak: number }>({
    minutes: 0, topArtist: null, topSong: null, streak: 0,
  });
  const [statsReady, setStatsReady] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [showReviewsList, setShowReviewsList] = useState(false);

  const [profileData, setProfileData] = useState<ProfileData>({ username: null, username_changed: false });
  const [profileReady, setProfileReady] = useState(false);
  const [isEditingUsername, setIsEditingUsername] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [isSaving, setIsSaving] = useState(false);

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
        .select('username, username_changed')
        .eq('user_id', user.id)
        .single();

      if (data) {
        setProfileData({
          username: data.username,
          username_changed: data.username_changed || false,
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
        title: r.title, artist: r.artist, played_at: r.created_at, duration: 180,
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
        if (dayKeys.has(key)) { streak++; cursor.setDate(cursor.getDate() - 1); }
        else if (i === 0) { cursor.setDate(cursor.getDate() - 1); }
        else break;
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

  const monogram = useMemo(() => {
    const src = (profileData.username || user?.email || 'UF').trim();
    const parts = src.split(/[\s._-]+/).filter(Boolean);
    const letters = parts.length >= 2 ? parts[0][0] + parts[1][0] : src.slice(0, 2);
    return letters.toUpperCase();
  }, [profileData.username, user?.email]);

  const memberNo = user?.id
    ? parseInt(user.id.replace(/[^0-9a-f]/g, '').slice(0, 6) || '0', 16).toString().padStart(6, '0').slice(-6)
    : '000000';
  const joinYear = user?.created_at ? new Date(user.created_at).getFullYear() : new Date().getFullYear();
  const volume = joinYear - 2024 + 1; // "Vol." of membership
  const issue = String(((user?.id?.charCodeAt(0) || 0) % 12) + 1).padStart(2, '0');

  const fmtNum = (n: number) => n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K' : String(n);

  const indexItems = [
    { n: '01', label: 'Minutes Streamed', value: fmtNum(listenStats.minutes) },
    { n: '02', label: 'Day Streak', value: String(listenStats.streak), flame: listenStats.streak > 0 },
    { n: '03', label: 'Saved Tracks', value: String(stats.likedSongs) },
    { n: '04', label: 'Playlists Built', value: String(stats.playlists) },
    { n: '05', label: 'Offline Library', value: String(stats.downloads) },
  ];

  const menuRows: Array<{ n: string; label: string; sub: string; onClick: () => void; danger?: boolean; icon: JSX.Element }> = [
    { n: 'A', label: 'Liked Songs', sub: `${stats.likedSongs} in rotation`, onClick: () => navigate('/library?tab=liked'), icon: <Heart className="w-4 h-4" /> },
    { n: 'B', label: 'Playlists', sub: `${stats.playlists} collections`, onClick: () => navigate('/library?tab=playlists'), icon: <ListMusic className="w-4 h-4" /> },
    { n: 'C', label: 'Offline', sub: `${stats.downloads} downloaded`, onClick: () => navigate('/downloads'), icon: <Download className="w-4 h-4" /> },
    { n: 'D', label: 'Audio & Equalizer', sub: 'Studio-grade tuning', onClick: () => navigate('/settings'), icon: <Headphones className="w-4 h-4" /> },
    { n: 'E', label: 'Reviews', sub: 'Your take on the app', onClick: () => setShowReviewsList(true), icon: <Star className="w-4 h-4" /> },
  ];

  return (
    <TabTransition>
      <SEOHead
        title="Your Profile — Univers Flow"
        description="Your Univers Flow sonic dossier: listening stats, saved tracks, playlists, downloads."
        path="/profile"
      />
      <div className="h-[100dvh] bg-background flex flex-col overflow-hidden">
        <main
          className="flex-1 overflow-y-auto pb-32 safe-area-pt"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          {/* ================ MASTHEAD ================ */}
          <header className="px-5 pt-5 pb-3">
            <div className="flex items-center justify-between text-[9px] font-black tracking-[0.32em] uppercase text-white/40">
              <span>Univers Flow</span>
              <span className="flex items-center gap-2">
                <span>Vol. {String(volume).padStart(2, '0')}</span>
                <span className="w-1 h-1 rounded-full bg-white/25" />
                <span>Iss. {issue}</span>
              </span>
            </div>
            <div className="mt-3 h-px w-full bg-white/10" />
            <div className="mt-3 flex items-center justify-between text-[9px] font-black tracking-[0.28em] uppercase text-white/35">
              <span>The Sonic Dossier</span>
              <span>№ {memberNo}</span>
            </div>
          </header>

          {/* ================ IDENTITY BLOCK ================ */}
          <section className="px-5 pt-4 pb-6">
            <div className="flex items-start gap-4">
              {/* Monogram — no animated PFP, just typography */}
              <div
                className="relative shrink-0 w-[92px] h-[124px] flex items-center justify-center"
                style={{
                  background: 'linear-gradient(180deg, hsl(var(--primary)) 0%, hsl(14 95% 55%) 100%)',
                  clipPath: 'polygon(0 0, 100% 0, 100% 92%, 88% 100%, 0 100%)',
                }}
                aria-hidden
              >
                <span
                  className="font-display text-[64px] leading-none text-black tracking-tight"
                  style={{ transform: 'translateY(2px)' }}
                >
                  {monogram}
                </span>
                <span className="absolute bottom-1.5 left-2 text-[7px] font-black tracking-[0.2em] text-black/60">
                  UF·ID
                </span>
              </div>

              <div className="flex-1 min-w-0 pt-1">
                <p className="text-[9px] font-black uppercase tracking-[0.28em] text-white/40 mb-2">
                  Signed as
                </p>

                {!profileSettled ? (
                  <div className="space-y-2 animate-pulse">
                    <div className="h-9 w-44 rounded bg-white/10" />
                    <div className="h-3 w-32 rounded bg-white/5" />
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
                    <button onClick={handleSaveUsername} disabled={isSaving} aria-label="Save"
                      className="w-9 h-9 rounded-full bg-green-500/20 flex items-center justify-center shrink-0">
                      <Check className="w-4 h-4 text-green-400" />
                    </button>
                    <button onClick={() => { setIsEditingUsername(false); setNewUsername(profileData.username || ''); }} aria-label="Cancel"
                      className="w-9 h-9 rounded-full bg-red-500/20 flex items-center justify-center shrink-0">
                      <X className="w-4 h-4 text-red-400" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <h1 className="font-display text-[38px] leading-[0.9] tracking-tight truncate uppercase">
                      {displayName}
                    </h1>
                    {canChangeUsername && (
                      <button onClick={() => setIsEditingUsername(true)} aria-label="Edit username"
                        className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center active:scale-90 transition shrink-0">
                        <Edit2 className="w-3 h-3 text-white/60" />
                      </button>
                    )}
                  </div>
                )}

                <div className="mt-3 flex items-center flex-wrap gap-x-2 gap-y-1 text-[9px] font-black uppercase tracking-[0.22em] text-white/50">
                  {isPremium ? (
                    <span className="inline-flex items-center gap-1 text-[hsl(45,90%,60%)]">
                      <Crown className="w-2.5 h-2.5" fill="currentColor" /> Premium
                    </span>
                  ) : (
                    <span>Free Tier</span>
                  )}
                  <span className="text-white/20">/</span>
                  <span>Est. {joinYear}</span>
                  {isAdmin && (
                    <>
                      <span className="text-white/20">/</span>
                      <span className="inline-flex items-center gap-1 text-[hsl(211,100%,65%)]">
                        <Shield className="w-2.5 h-2.5" /> Admin
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* ================ THE INDEX (stats as editorial index) ================ */}
          <section className="px-5">
            <div className="flex items-baseline justify-between mb-3">
              <p className="text-[9px] font-black uppercase tracking-[0.32em] text-white/40">The Index</p>
              <p className="text-[9px] font-black uppercase tracking-[0.32em] text-white/25">This Season</p>
            </div>
            <div className="border-t border-white/10">
              {indexItems.map((it, idx) => (
                <div
                  key={it.n}
                  className={`flex items-baseline justify-between py-3 ${idx < indexItems.length - 1 ? 'border-b border-white/[0.06]' : ''}`}
                >
                  <div className="flex items-baseline gap-3 min-w-0">
                    <span className="text-[10px] font-mono text-white/30 tabular-nums">{it.n}</span>
                    <span className="text-[13px] text-white/70 truncate">{it.label}</span>
                  </div>
                  <span className="font-display text-2xl leading-none tracking-tight tabular-nums inline-flex items-center gap-1.5">
                    {profileSettled ? it.value : '—'}
                    {profileSettled && it.flame && <Flame className="w-4 h-4 text-primary" fill="currentColor" />}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* ================ FEATURE: NOW ROTATING ================ */}
          {profileSettled && user && (listenStats.topArtist || listenStats.topSong) && (
            <section className="px-5 mt-8">
              <div className="flex items-baseline justify-between mb-3">
                <p className="text-[9px] font-black uppercase tracking-[0.32em] text-white/40 inline-flex items-center gap-1.5">
                  <Radio className="w-2.5 h-2.5" /> Now Rotating
                </p>
                <p className="text-[9px] font-black uppercase tracking-[0.32em] text-white/25">Feature</p>
              </div>
              <div className="border-t-2 border-white/80 pt-3">
                <p className="text-[10px] uppercase tracking-[0.22em] text-primary font-black mb-1.5">
                  Most-played track
                </p>
                <p className="font-display text-[32px] leading-[0.95] tracking-tight uppercase break-words">
                  {listenStats.topSong || 'Silence, for now'}
                </p>
                <p className="text-sm text-white/50 mt-2 italic">
                  by {listenStats.topArtist || 'nobody yet — press play somewhere'}
                </p>
              </div>
            </section>
          )}

          {/* ================ NAVIGATION (numbered list) ================ */}
          <section className="px-5 mt-8">
            <div className="flex items-baseline justify-between mb-3">
              <p className="text-[9px] font-black uppercase tracking-[0.32em] text-white/40">Sections</p>
              <p className="text-[9px] font-black uppercase tracking-[0.32em] text-white/25">A → E</p>
            </div>
            <div className="border-t border-white/10">
              {menuRows.map((row, idx) => (
                <button
                  key={row.n}
                  onClick={row.onClick}
                  className={`w-full flex items-center gap-4 py-4 text-left active:bg-white/[0.03] transition ${
                    idx < menuRows.length - 1 ? 'border-b border-white/[0.06]' : ''
                  }`}
                >
                  <span className="text-[10px] font-mono text-white/30 tabular-nums w-4">{row.n}</span>
                  <span className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 bg-white/[0.05] text-white/70">
                    {row.icon}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block font-display text-[18px] leading-none tracking-tight uppercase">
                      {row.label}
                    </span>
                    <span className="block text-[11px] text-white/40 mt-1">{row.sub}</span>
                  </span>
                  <ArrowUpRight className="w-4 h-4 text-white/30 -rotate-0" />
                </button>
              ))}
            </div>
          </section>

          <div className="px-5 mt-6 space-y-5">
            <EmailVerificationCard />

            {/* Premium strip */}
            {profileSettled && !isPremium && (
              <button
                onClick={() => navigate('/premium')}
                className="w-full text-left relative overflow-hidden rounded-none border-y-2 border-white/90 py-5 px-1 active:opacity-80 transition"
                style={{
                  background:
                    'linear-gradient(90deg, transparent 0%, hsl(45 90% 50% / 0.08) 45%, hsl(var(--primary) / 0.12) 100%)',
                }}
              >
                <div className="flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-[9px] font-black uppercase tracking-[0.32em] text-white/40 mb-1.5">
                      Editor's pick
                    </p>
                    <p className="font-display text-[26px] leading-[0.95] tracking-tight uppercase">
                      Go Premium.
                    </p>
                    <p className="text-[11px] text-white/55 mt-1.5 italic">
                      Ad-free · Offline · Studio EQ · HQ audio
                    </p>
                  </div>
                  <div className="shrink-0 w-11 h-11 rounded-full flex items-center justify-center"
                    style={{ background: 'linear-gradient(135deg, #fbbf24, #f59e0b)' }}>
                    <Crown className="w-5 h-5 text-black" />
                  </div>
                </div>
              </button>
            )}

            {/* Admin / Settings / Sign out */}
            <div className="border-t border-white/10">
              {profileSettled && isAdmin && (
                <button
                  onClick={() => navigate('/admin')}
                  className="w-full flex items-center gap-4 py-4 text-left border-b border-white/[0.06] active:bg-white/[0.03]"
                >
                  <span className="text-[10px] font-mono text-primary tabular-nums w-4">✦</span>
                  <Shield className="w-4 h-4 text-primary shrink-0" />
                  <span className="flex-1 text-sm font-semibold">Admin Panel</span>
                  <ChevronRight className="w-4 h-4 text-white/30" />
                </button>
              )}
              <button
                onClick={() => navigate('/settings')}
                className="w-full flex items-center gap-4 py-4 text-left border-b border-white/[0.06] active:bg-white/[0.03]"
              >
                <span className="text-[10px] font-mono text-white/30 tabular-nums w-4">⚙</span>
                <Settings className="w-4 h-4 text-white/70 shrink-0" />
                <span className="flex-1 text-sm font-semibold">Settings</span>
                <ChevronRight className="w-4 h-4 text-white/30" />
              </button>
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-4 py-4 text-left active:bg-white/[0.03]"
              >
                <span className="text-[10px] font-mono text-destructive/70 tabular-nums w-4">✕</span>
                <LogOut className="w-4 h-4 text-destructive shrink-0" />
                <span className="flex-1 text-sm font-semibold text-destructive">Sign Out</span>
              </button>
            </div>

            {/* Colophon */}
            <div className="pt-4 pb-2 text-center">
              <p className="text-[9px] font-black uppercase tracking-[0.4em] text-white/25">
                — End of Dossier —
              </p>
              <p className="text-[9px] font-mono text-white/20 mt-2">
                UF · № {memberNo} · Vol. {String(volume).padStart(2, '0')}
              </p>
            </div>
          </div>
        </main>

        <BottomNav />
        <ReviewModal isOpen={showReview} onClose={() => setShowReview(false)} />
        <ReviewsSheet
          isOpen={showReviewsList}
          onClose={() => setShowReviewsList(false)}
          onWriteReview={() => { setShowReviewsList(false); setTimeout(() => setShowReview(true), 250); }}
        />
      </div>
    </TabTransition>
  );
};

export default Profile;
