import { useState, useEffect, useMemo } from 'react';
import {
  Settings, LogOut, Shield, Heart, ListMusic, Crown, ChevronRight,
  Edit2, Check, X, Star, Headphones, Download, Music2, Camera,
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
import AvatarPickerModal from '@/components/AvatarPickerModal';
import { resolveAvatar } from '@/lib/avatars';
import { useDownloads } from '@/contexts/DownloadContext';
import SEOHead from '@/components/SEOHead';
import { loadLibrarySongs } from '@/lib/streamSongs';

interface ProfileData {
  username: string | null;
  username_changed: boolean;
  avatar_url: string | null;
}
type RecentCover = { id: string; title: string; artist: string; cover_url: string | null };

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
  const navigate = useNavigate();

  const [stats, setStats] = useState({ likedSongs: 0, playlists: 0, downloads: 0 });
  const [listenStats, setListenStats] = useState<{ minutes: number; topArtist: string | null; streak: number; totalPlays: number }>({ minutes: 0, topArtist: null, streak: 0, totalPlays: 0 });
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
    if (user) { setProfileReady(false); setStatsReady(false); fetchStats(); fetchProfile(); }
    else { setProfileReady(true); setStatsReady(true); }
  }, [user]);

  useEffect(() => { setStats(prev => ({ ...prev, downloads: downloads.length })); }, [downloads.length]);

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
        supabase.from('song_play_events').select('title,artist,cover_url,song_id,created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(500),
      ]);
      setStats({ likedSongs: likedResolved.length, playlists: playlists.data?.length || 0, downloads: downloads.length });

      type RecentRow = { song_id: string; played_at: string };
      type CatalogSong = { id: string; title: string; artist: string; duration: number | null; cover_url: string | null };
      type PlayEventRow = { title: string | null; artist: string | null; cover_url: string | null; song_id: string | null; created_at: string };

      const recentRows = (recentPlays.data as RecentRow[] | null) || [];
      const eventList = (playEvents.data as PlayEventRow[] | null) || [];
      const catalogIds = [...new Set([
        ...recentRows.map(r => r.song_id).filter(Boolean),
        ...eventList.map(r => r.song_id).filter(Boolean) as string[],
      ])];
      const { data: catalogSongs } = catalogIds.length
        ? await supabase.from('songs').select('id,title,artist,duration,cover_url').in('id', catalogIds)
        : { data: [] as CatalogSong[] };
      const songById = new Map(((catalogSongs as CatalogSong[] | null) || []).map(s => [s.id, s]));

      const rows = [
        ...recentRows.map(r => {
          const s = songById.get(r.song_id);
          return {
            title: s?.title || null, artist: s?.artist || null, cover_url: s?.cover_url || null,
            song_id: r.song_id, played_at: r.played_at, duration: Number(s?.duration) || 180,
          };
        }),
        ...eventList.map(r => ({
          title: r.title, artist: r.artist, cover_url: r.cover_url, song_id: r.song_id,
          played_at: r.created_at, duration: 180,
        })),
      ];
      const totalSeconds = rows.reduce((sum, r) => sum + (Number(r.duration) || 180), 0);
      const artistCount = new Map<string, number>();
      const dayKeys = new Set<string>();
      rows.forEach(r => {
        if (r.artist) artistCount.set(r.artist, (artistCount.get(r.artist) || 0) + 1);
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

      const seen = new Set<string>();
      const covers: RecentCover[] = [];
      for (const r of rows) {
        if (!r.title || !r.song_id) continue;
        const key = String(r.song_id);
        if (seen.has(key)) continue;
        seen.add(key);
        covers.push({ id: key, title: r.title, artist: r.artist || '', cover_url: r.cover_url });
        if (covers.length >= 8) break;
      }
      setRecentCovers(covers);
      setListenStats({
        minutes: Math.round(totalSeconds / 60),
        topArtist: top(artistCount),
        streak, totalPlays: rows.length,
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
    } catch (error) { toast.error(error.message || 'Failed to update username'); }
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
  const customAvatarUrl = resolveAvatar(profileData.avatar_url);
  const fmt = (n: number) => (n > 0 ? n.toLocaleString() : '0');
  const backdropArt = recentCovers.find(c => c.cover_url)?.cover_url || null;

  return (
    <TabTransition>
      <SEOHead
        title="Your Profile — Univers Flow"
        description="Your Univers Flow profile: listening stats, library, downloads and account."
        path="/profile"
      />
      <div className="h-[100dvh] bg-background flex flex-col overflow-hidden">
        <main className="flex-1 overflow-y-auto pb-32 safe-area-pt" style={{ WebkitOverflowScrolling: 'touch' }}>

          {/* ============ HERO ============ */}
          <section className="relative">
            {/* Ambient backdrop from top artwork */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
              {backdropArt ? (
                <>
                  <img src={backdropArt} alt="" className="w-full h-full object-cover opacity-40" style={{ filter: 'blur(60px) saturate(1.4)' }} />
                  <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, hsl(var(--background) / 0.35) 0%, hsl(var(--background)) 92%)' }} />
                </>
              ) : (
                <div className="absolute inset-0" style={{ background: 'radial-gradient(120% 60% at 50% 0%, hsl(var(--primary) / 0.18), transparent 65%)' }} />
              )}
            </div>

            <div className="relative px-5 pt-5 pb-8">
              {/* top bar */}
              <div className="flex items-center justify-between mb-8">
                <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/50">Profile</span>
                <button
                  onClick={() => navigate('/settings')}
                  aria-label="Settings"
                  className="w-9 h-9 rounded-full bg-white/[0.08] backdrop-blur border border-white/10 flex items-center justify-center active:scale-90 transition"
                >
                  <Settings className="w-4 h-4 text-white/80" />
                </button>
              </div>

              {/* Avatar centered */}
              <div className="flex flex-col items-center text-center">
                <button
                  onClick={() => user && setShowAvatarPicker(true)}
                  className="relative active:scale-95 transition"
                  aria-label="Change avatar"
                >
                  <div
                    className="w-28 h-28 rounded-full overflow-hidden flex items-center justify-center"
                    style={{
                      background: avatarGradient,
                      boxShadow: '0 20px 50px -12px rgba(0,0,0,0.6), inset 0 0 0 1px hsl(0 0% 100% / 0.12)',
                    }}
                  >
                    {customAvatarUrl ? (
                      <img src={customAvatarUrl} alt="" className="w-full h-full object-cover" width={112} height={112} />
                    ) : (
                      <span className="text-white font-display font-bold select-none"
                        style={{ fontSize: 44, lineHeight: 1, textShadow: '0 2px 4px rgba(0,0,0,0.3)' }}>
                        {initials}
                      </span>
                    )}
                  </div>
                  <div className="absolute bottom-0 right-0 w-8 h-8 rounded-full flex items-center justify-center"
                    style={{
                      background: isPremium ? 'linear-gradient(135deg,#fbbf24,#f59e0b)' : 'hsl(0 0% 14%)',
                      border: '2.5px solid hsl(var(--background))',
                    }}>
                    {isPremium ? <Crown className="w-4 h-4 text-black" /> : <Camera className="w-3.5 h-3.5 text-white/85" />}
                  </div>
                </button>

                {/* Name */}
                <div className="mt-5 w-full">
                  {!profileSettled ? (
                    <div className="h-8 w-40 mx-auto rounded bg-white/10 animate-pulse" />
                  ) : isEditingUsername ? (
                    <div className="flex items-center gap-1.5 max-w-xs mx-auto">
                      <Input
                        value={newUsername}
                        onChange={(e) => setNewUsername(e.target.value)}
                        className="h-10 bg-white/10 border-white/20 text-center text-base"
                        placeholder="username" maxLength={20} autoFocus
                      />
                      <button onClick={handleSaveUsername} disabled={isSaving} aria-label="Save"
                        className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center shrink-0">
                        <Check className="w-4 h-4 text-green-400" />
                      </button>
                      <button onClick={() => { setIsEditingUsername(false); setNewUsername(profileData.username || ''); }}
                        aria-label="Cancel" className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center shrink-0">
                        <X className="w-4 h-4 text-red-400" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center gap-2">
                      <h1 className="font-display text-[28px] leading-tight tracking-tight font-bold truncate">
                        {displayName}
                      </h1>
                      {canChangeUsername && (
                        <button onClick={() => setIsEditingUsername(true)} aria-label="Edit username"
                          className="w-7 h-7 rounded-full bg-white/[0.08] flex items-center justify-center active:scale-90 transition shrink-0">
                          <Edit2 className="w-3 h-3 text-white/70" />
                        </button>
                      )}
                    </div>
                  )}
                  {user?.email && (
                    <p className="mt-1 text-[13px] text-white/50 truncate">{user.email}</p>
                  )}
                </div>

                {/* Tier chips */}
                {profileSettled && (
                  <div className="mt-4 flex items-center justify-center gap-2 flex-wrap">
                    {isPremium ? (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold"
                        style={{ background: 'linear-gradient(135deg, hsl(45 92% 55% / 0.2), hsl(35 92% 50% / 0.2))', color: '#fbbf24', border: '1px solid hsl(45 92% 55% / 0.3)' }}>
                        <Crown className="w-3 h-3" /> Premium
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-[11px] font-semibold text-white/70 border border-white/15">
                        Free
                      </span>
                    )}
                    {memberSinceLabel && (
                      <span className="text-[11px] text-white/45">Member for {memberSinceLabel}</span>
                    )}
                    {isAdmin && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
                        style={{ background: 'hsl(211 100% 55% / 0.16)', color: 'hsl(211 100% 78%)' }}>
                        <Shield className="w-2.5 h-2.5" /> Admin
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </section>

          <div className="px-5 space-y-6 -mt-2">

            <EmailVerificationCard />

            {/* ============ STATS ============ */}
            {profileSettled && user && (
              <section className="grid grid-cols-4 gap-2">
                <StatCard value={fmt(listenStats.minutes)} label="Minutes" />
                <StatCard value={fmt(listenStats.totalPlays)} label="Plays" />
                <StatCard value={listenStats.streak > 0 ? String(listenStats.streak) : '0'} label="Streak" />
                <StatCard value={fmt(stats.likedSongs)} label="Liked" />
              </section>
            )}

            {profileSettled && listenStats.topArtist && (
              <div className="rounded-2xl px-4 py-3 flex items-center gap-3"
                style={{ background: 'linear-gradient(120deg, hsl(var(--primary) / 0.12), transparent 80%)', border: '1px solid hsl(var(--primary) / 0.18)' }}>
                <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                  <Heart className="w-5 h-5 text-primary" fill="currentColor" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] text-white/55">Most listened this month</p>
                  <p className="font-semibold truncate">{listenStats.topArtist}</p>
                </div>
              </div>
            )}

            {/* ============ RECENTLY PLAYED ============ */}
            {profileSettled && recentCovers.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-[15px] font-bold">Recently played</h2>
                  <button onClick={() => navigate('/library')} className="text-[12px] text-white/55 active:text-white">See all</button>
                </div>
                <div className="flex gap-3 overflow-x-auto scrollbar-none -mx-5 px-5">
                  {recentCovers.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => navigate(`/search?q=${encodeURIComponent(`${c.title} ${c.artist}`.trim())}`)}
                      className="shrink-0 w-24 text-left active:scale-95 transition"
                      aria-label={`Replay ${c.title}`}
                    >
                      <div className="w-24 h-24 rounded-xl overflow-hidden bg-white/[0.05]"
                        style={{ boxShadow: '0 8px 20px -8px rgba(0,0,0,0.5)' }}>
                        {c.cover_url ? (
                          <img src={c.cover_url} alt={c.title} className="w-full h-full object-cover" loading="lazy" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center"><Music2 className="w-6 h-6 text-white/30" /></div>
                        )}
                      </div>
                      <p className="mt-2 text-[12px] font-semibold text-white/90 truncate leading-tight">{c.title}</p>
                      <p className="text-[11px] text-white/45 truncate">{c.artist}</p>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* ============ LIBRARY ============ */}
            <section>
              <h2 className="text-[15px] font-bold mb-3">Your library</h2>
              <div className="rounded-2xl overflow-hidden bg-white/[0.04] border border-white/[0.06] divide-y divide-white/[0.05]">
                <Row icon={<Heart className="w-[18px] h-[18px] text-primary" fill="currentColor" />}
                  label="Liked Songs"
                  hint={profileSettled ? `${stats.likedSongs} ${stats.likedSongs === 1 ? 'song' : 'songs'}` : '—'}
                  onClick={() => navigate('/library?tab=liked')} />
                <Row icon={<ListMusic className="w-[18px] h-[18px] text-white/85" />}
                  label="Playlists"
                  hint={profileSettled ? `${stats.playlists} ${stats.playlists === 1 ? 'playlist' : 'playlists'}` : '—'}
                  onClick={() => navigate('/library?tab=playlists')} />
                <Row icon={<Download className="w-[18px] h-[18px] text-white/85" />}
                  label="Downloads"
                  hint={profileSettled ? `${stats.downloads} offline` : '—'}
                  onClick={() => navigate('/downloads')} />
                <Row icon={<Headphones className="w-[18px] h-[18px] text-white/85" />}
                  label="Audio & Equalizer"
                  onClick={() => navigate('/settings')} />
                <Row icon={<Star className="w-[18px] h-[18px] text-yellow-400" fill="currentColor" />}
                  label="Reviews"
                  onClick={() => setShowReviewsList(true)} />
              </div>
            </section>

            {/* ============ PREMIUM ============ */}
            {profileSettled && !isPremium && (
              <button
                onClick={() => navigate('/premium')}
                className="w-full rounded-2xl p-4 text-left active:scale-[0.99] transition flex items-center gap-4"
                style={{
                  background: 'linear-gradient(135deg, hsl(45 92% 55% / 0.14), hsl(var(--primary) / 0.14))',
                  border: '1px solid hsl(45 92% 55% / 0.26)',
                }}
              >
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0"
                  style={{ background: 'linear-gradient(135deg,#fbbf24,#f59e0b)' }}>
                  <Crown className="w-5 h-5 text-black" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold">Try Premium</p>
                  <p className="text-[12px] text-white/60 mt-0.5">Ad-free · Offline · Studio EQ · Lossless</p>
                </div>
                <ChevronRight className="w-4 h-4 text-white/40" />
              </button>
            )}

            {/* ============ ACCOUNT ============ */}
            <section>
              <h2 className="text-[15px] font-bold mb-3">Account</h2>
              <div className="rounded-2xl overflow-hidden bg-white/[0.04] border border-white/[0.06] divide-y divide-white/[0.05]">
                {profileSettled && isAdmin && (
                  <Row icon={<Shield className="w-[18px] h-[18px] text-primary" />} label="Admin Panel"
                    onClick={() => navigate('/admin')} />
                )}
                <Row icon={<Settings className="w-[18px] h-[18px] text-white/85" />} label="Settings"
                  onClick={() => navigate('/settings')} />
                <button onClick={handleLogout}
                  className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-destructive/10 transition">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-destructive/15">
                    <LogOut className="w-[18px] h-[18px] text-destructive" />
                  </div>
                  <span className="flex-1 text-[14px] font-semibold text-destructive">Sign Out</span>
                </button>
              </div>
            </section>

            <p className="text-center text-[10px] uppercase tracking-[0.3em] text-white/25 pt-2 pb-1">
              Univers Flow
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
      </div>
    </TabTransition>
  );
};

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl bg-white/[0.04] border border-white/[0.06] px-2 py-3 text-center">
      <p className="font-display font-bold text-[18px] leading-none tracking-tight">{value}</p>
      <p className="mt-1.5 text-[10px] uppercase tracking-wider text-white/45 font-semibold">{label}</p>
    </div>
  );
}

function Row({ icon, label, hint, onClick }:
  { icon: React.ReactNode; label: string; hint?: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-white/[0.04] transition">
      <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-white/[0.06]">{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-semibold leading-none">{label}</p>
        {hint && <p className="text-[11.5px] text-white/45 mt-1 truncate">{hint}</p>}
      </div>
      <ChevronRight className="w-4 h-4 text-white/30" />
    </button>
  );
}

export default Profile;
