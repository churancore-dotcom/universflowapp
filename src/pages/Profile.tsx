import { useState, useEffect, useMemo } from 'react';
import {
  User, Settings, LogOut, Shield, Heart, ListMusic, ChevronRight, Crown,
  Edit2, Check, X, Star, Headphones, Download, Music2, Clock, Mail,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { usePremium } from '@/hooks/usePremium';

import BottomNav from '@/components/BottomNav';
import PremiumBadge from '@/components/PremiumBadge';
import ReviewModal from '@/components/ReviewModal';
import ReviewsSheet from '@/components/ReviewsSheet';
import { TabTransition } from '@/components/PageTransition';
import EmailVerificationCard from '@/components/EmailVerificationCard';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import AvatarPickerModal from '@/components/AvatarPickerModal';
import { resolveAvatar } from '@/lib/avatars';
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

/** Deterministic gradient per user id so the static avatar always has personality */
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

  useEffect(() => {
    if (!user?.created_at) { setMemberSinceLabel(''); return; }
    const created = new Date(user.created_at);
    const now = new Date();
    const months = Math.max(0, (now.getFullYear() - created.getFullYear()) * 12 + (now.getMonth() - created.getMonth()));
    if (months < 1) setMemberSinceLabel('New');
    else if (months < 12) setMemberSinceLabel(`${months}mo`);
    else {
      const years = Math.floor(months / 12);
      const rem = months % 12;
      setMemberSinceLabel(rem ? `${years}y ${rem}mo` : `${years}y`);
    }
  }, [user?.created_at]);

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
      const [likedResolved, playlists, recentPlays, playEvents] = await Promise.all([
        loadLibrarySongs(user.id),
        supabase.from('playlists').select('id').eq('user_id', user.id),
        supabase.from('recently_played').select('song_id,played_at').eq('user_id', user.id).order('played_at', { ascending: false }).limit(500),
        supabase.from('song_play_events').select('title,artist,cover_url,song_id,created_at,source').eq('user_id', user.id).order('created_at', { ascending: false }).limit(500),
      ]);
      setStats({
        likedSongs: likedResolved.length,
        playlists: playlists.data?.length || 0,
        downloads: downloads.length,
      });

      type RecentRow = { song_id: string; played_at: string };
      type CatalogSong = { id: string; title: string; artist: string; duration: number | null; genre: string | null; cover_url: string | null };
      type PlayEventRow = { title: string | null; artist: string | null; cover_url: string | null; song_id: string | null; created_at: string };

      const recentRows = (recentPlays.data as RecentRow[] | null) || [];
      const eventList = (playEvents.data as PlayEventRow[] | null) || [];
      const catalogIds = [...new Set([
        ...recentRows.map((r) => r.song_id).filter(Boolean),
        ...eventList.map((r) => r.song_id).filter(Boolean) as string[],
      ])];
      const { data: catalogSongs } = catalogIds.length
        ? await supabase.from('songs').select('id,title,artist,duration,genre,cover_url').in('id', catalogIds)
        : { data: [] as CatalogSong[] };
      const songById = new Map(((catalogSongs as CatalogSong[] | null) || []).map((song) => [song.id, song]));

      const eventRows = eventList.map((r) => ({
        title: r.title,
        artist: r.artist,
        cover_url: r.cover_url,
        song_id: r.song_id,
        played_at: r.created_at,
        duration: 180,
        genre: r.song_id ? songById.get(r.song_id)?.genre || null : null,
      }));
      const rows = [
        ...recentRows.map((r) => {
          const song = songById.get(r.song_id);
          return {
            title: song?.title || null,
            artist: song?.artist || null,
            cover_url: song?.cover_url || null,
            song_id: r.song_id,
            played_at: r.played_at,
            duration: Number(song?.duration) || 180,
            genre: song?.genre || null,
          };
        }),
        ...eventRows,
      ];
      const totalSeconds = rows.reduce((sum, r) => sum + (Number(r.duration) || 180), 0);
      const artistCount = new Map<string, number>();
      const songCount = new Map<string, number>();
      const genreCount = new Map<string, number>();
      const dayKeys = new Set<string>();
      rows.forEach((r) => {
        if (r.artist) artistCount.set(r.artist, (artistCount.get(r.artist) || 0) + 1);
        if (r.title) songCount.set(r.title, (songCount.get(r.title) || 0) + 1);
        if (r.genre) genreCount.set(r.genre, (genreCount.get(r.genre) || 0) + 1);
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
        topSong: top(songCount),
        streak,
        totalPlays: rows.length,
        topGenre: top(genreCount),
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
  const initials = useMemo(() => {
    const src = (profileData.username || user?.email || 'U').replace(/[^a-zA-Z0-9]/g, '');
    return (src.slice(0, 2) || 'U').toUpperCase();
  }, [profileData.username, user?.email]);
  const avatarGradient = useMemo(() => gradientFromSeed(user?.id || 'guest'), [user?.id]);
  const customAvatarUrl = resolveAvatar(profileData.avatar_url);
  const fmt = (n: number) => (n > 0 ? n.toLocaleString() : '—');

  return (
    <TabTransition>
      <SEOHead
        title="Your Profile — Univers Flow"
        description="Manage your Univers Flow profile: avatar, username, listening stats, liked songs, playlists and downloads."
        path="/profile"
      />
      <div className="h-[100dvh] bg-background flex flex-col overflow-hidden">
        <main className="flex-1 overflow-y-auto pb-32 safe-area-pt" style={{ WebkitOverflowScrolling: 'touch' }}>

          {/* === Editorial header === */}
          <header className="px-5 pt-6 pb-5">
            <div className="flex items-center justify-between mb-8">
              <span className="text-[10px] font-black uppercase tracking-[0.32em] text-white/40">
                Profile
              </span>
              <button
                onClick={() => navigate('/settings')}
                aria-label="Settings"
                className="w-9 h-9 rounded-full bg-white/[0.05] border border-white/[0.06] flex items-center justify-center active:scale-90 transition"
              >
                <Settings className="w-4 h-4 text-white/70" />
              </button>
            </div>

            <div className="flex items-start gap-4">
              {/* Static avatar: initials on deterministic gradient (no autoplay video) */}
              <button
                onClick={() => user && setShowAvatarPicker(true)}
                className="relative shrink-0 active:scale-95 transition"
                aria-label="Change avatar"
              >
                <div
                  className="w-20 h-20 rounded-2xl overflow-hidden flex items-center justify-center"
                  style={{
                    background: avatarGradient,
                    boxShadow: 'inset 0 0 0 1px hsl(0 0% 100% / 0.08)',
                  }}
                >
                  {customAvatarUrl ? (
                    <img
                      src={customAvatarUrl}
                      alt=""
                      className="w-full h-full object-cover"
                      width={80}
                      height={80}
                    />
                  ) : (
                    <span
                      className="text-white font-display tracking-tight select-none"
                      style={{ fontSize: 34, lineHeight: 1, textShadow: '0 1px 2px rgba(0,0,0,0.25)' }}
                    >
                      {initials}
                    </span>
                  )}
                </div>
                <div
                  className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center"
                  style={{
                    background: isPremium ? 'linear-gradient(135deg,#fbbf24,#f59e0b)' : 'hsl(0 0% 12%)',
                    border: '2px solid hsl(var(--background))',
                  }}
                >
                  {isPremium ? <Crown className="w-3 h-3 text-black" /> : <Camera className="w-3 h-3 text-white/80" />}
                </div>
              </button>

              <div className="flex-1 min-w-0 pt-1">
                {!profileSettled ? (
                  <div className="space-y-2 animate-pulse">
                    <div className="h-6 w-40 rounded bg-white/10" />
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
                      <h1 className="font-display text-[26px] leading-[1.05] tracking-tight truncate">
                        {displayName}
                      </h1>
                      {canChangeUsername && (
                        <button onClick={() => setIsEditingUsername(true)} aria-label="Edit username" className="w-6 h-6 rounded-full bg-white/[0.06] flex items-center justify-center active:scale-90 transition shrink-0">
                          <Edit2 className="w-3 h-3 text-white/60" />
                        </button>
                      )}
                    </div>
                    {user?.email && (
                      <p className="mt-1 text-[12px] text-white/45 truncate inline-flex items-center gap-1.5">
                        <Mail className="w-3 h-3" /> {user.email}
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                      {isPremium ? (
                        <PremiumBadge size="xs" />
                      ) : (
                        <span className="text-[9px] font-black uppercase tracking-[0.22em] text-white/40 px-2 py-0.5 rounded-full border border-white/10">
                          Free
                        </span>
                      )}
                      {memberSinceLabel && (
                        <span className="text-[9px] font-black uppercase tracking-[0.22em] text-white/40 inline-flex items-center gap-1">
                          <Clock className="w-2.5 h-2.5" /> {memberSinceLabel}
                        </span>
                      )}
                      {isAdmin && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider" style={{ background: 'hsl(211 100% 50% / 0.16)', color: 'hsl(211 100% 70%)' }}>
                          <Shield className="w-2.5 h-2.5" /> Admin
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </header>

          <div className="px-5 space-y-6">

            <EmailVerificationCard />

            {/* === Stats strip === */}
            {profileSettled && user && (
              <section>
                <SectionLabel index="01" title="At a glance" />
                <div className="grid grid-cols-4 divide-x divide-white/[0.06] rounded-2xl bg-white/[0.03] border border-white/[0.06]">
                  <Stat value={fmt(listenStats.minutes)} label="Minutes" />
                  <Stat value={fmt(listenStats.totalPlays)} label="Plays" />
                  <Stat value={listenStats.streak > 0 ? String(listenStats.streak) : '—'} label="Streak" />
                  <Stat value={fmt(stats.likedSongs)} label="Liked" />
                </div>
                {(listenStats.topArtist || listenStats.topGenre) && (
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <MetaLine label="Top artist" value={listenStats.topArtist || '—'} />
                    <MetaLine label="Top genre" value={listenStats.topGenre || '—'} />
                  </div>
                )}
              </section>
            )}

            {/* === Recently played === */}
            {profileSettled && recentCovers.length > 0 && (
              <section>
                <SectionLabel index="02" title="Recently played" />
                <div className="flex gap-2.5 overflow-x-auto scrollbar-none -mx-5 px-5">
                  {recentCovers.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => navigate(`/search?q=${encodeURIComponent(`${c.title} ${c.artist}`.trim())}`)}
                      className="shrink-0 w-16 text-left active:scale-95 transition"
                      aria-label={`Replay ${c.title}`}
                    >
                      <div className="w-16 h-16 rounded-xl overflow-hidden bg-white/[0.04] border border-white/[0.06]">
                        {c.cover_url ? (
                          <img src={c.cover_url} alt={c.title} className="w-full h-full object-cover" loading="lazy" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Music2 className="w-5 h-5 text-white/30" />
                          </div>
                        )}
                      </div>
                      <p className="mt-1.5 text-[10px] text-white/60 truncate leading-tight">{c.title}</p>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* === Library === */}
            <section>
              <SectionLabel index="03" title="Your library" />
              <div className="rounded-2xl overflow-hidden bg-white/[0.03] border border-white/[0.06] divide-y divide-white/[0.05]">
                <LibraryRow
                  icon={<Heart className="w-4 h-4 text-primary" fill="currentColor" />}
                  label="Liked Songs"
                  hint={profileSettled ? (stats.likedSongs > 0 ? `${stats.likedSongs} tracks` : 'Tap the heart on any song') : '—'}
                  onClick={() => navigate('/library?tab=liked')}
                />
                <LibraryRow
                  icon={<ListMusic className="w-4 h-4 text-white/80" />}
                  label="Playlists"
                  hint={profileSettled ? (stats.playlists > 0 ? `${stats.playlists} created` : 'None yet') : '—'}
                  onClick={() => navigate('/library?tab=playlists')}
                />
                <LibraryRow
                  icon={<Download className="w-4 h-4 text-white/80" />}
                  label="Downloads"
                  hint={profileSettled ? (stats.downloads > 0 ? `${stats.downloads} offline` : 'Save for later') : '—'}
                  onClick={() => navigate('/downloads')}
                />
                <LibraryRow
                  icon={<Headphones className="w-4 h-4 text-white/80" />}
                  label="Audio & Equalizer"
                  hint="Tune your sound"
                  onClick={() => navigate('/settings')}
                />
                <LibraryRow
                  icon={<Star className="w-4 h-4 text-yellow-400" fill="currentColor" />}
                  label="Reviews"
                  hint="Share your take"
                  onClick={() => setShowReviewsList(true)}
                />
              </div>
            </section>

            {/* === Premium upgrade (only for free) === */}
            {profileSettled && !isPremium && (
              <section>
                <SectionLabel index="04" title="Upgrade" />
                <button
                  onClick={() => navigate('/premium')}
                  className="w-full rounded-2xl p-4 text-left relative overflow-hidden active:scale-[0.99] transition"
                  style={{
                    background: 'linear-gradient(120deg, hsl(45 90% 50% / 0.12), hsl(var(--primary) / 0.14))',
                    border: '1px solid hsl(45 90% 55% / 0.24)',
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#fbbf24,#f59e0b)' }}>
                      <Crown className="w-5 h-5 text-black" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold leading-none">Go Premium</p>
                      <p className="text-[11px] text-white/55 mt-1">Ad-free · Offline · Studio EQ · HQ Audio</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-white/40" />
                  </div>
                </button>
              </section>
            )}

            {/* === Account === */}
            <section>
              <SectionLabel index={isPremium ? '04' : '05'} title="Account" />
              <div className="rounded-2xl overflow-hidden bg-white/[0.03] border border-white/[0.06] divide-y divide-white/[0.05]">
                {profileSettled && isAdmin && (
                  <LibraryRow
                    icon={<Shield className="w-4 h-4 text-primary" />}
                    label="Admin Panel"
                    onClick={() => navigate('/admin')}
                  />
                )}
                <LibraryRow
                  icon={<Settings className="w-4 h-4 text-white/80" />}
                  label="Settings"
                  onClick={() => navigate('/settings')}
                />
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-white/[0.04] transition"
                >
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-destructive/12">
                    <LogOut className="w-4 h-4 text-destructive" />
                  </div>
                  <span className="flex-1 text-sm font-medium text-destructive">Sign Out</span>
                </button>
              </div>
            </section>

            <p className="text-center text-[9px] font-black uppercase tracking-[0.32em] text-white/20 pt-2 pb-1">
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

/* ---------- Editorial sub-components ---------- */

function SectionLabel({ index, title }: { index: string; title: string }) {
  return (
    <div className="flex items-baseline gap-2 mb-2.5">
      <span className="text-[9px] font-mono text-white/30 tracking-widest">{index}</span>
      <span className="text-[10px] font-black uppercase tracking-[0.28em] text-white/55">
        {title}
      </span>
      <span className="flex-1 h-px bg-white/[0.06]" />
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="px-2 py-3 text-center">
      <p className="font-display text-xl leading-none tracking-tight">{value}</p>
      <p className="mt-1 text-[9px] font-black uppercase tracking-[0.18em] text-white/40">{label}</p>
    </div>
  );
}

function MetaLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] px-3 py-2.5 min-w-0">
      <p className="text-[9px] font-black uppercase tracking-[0.2em] text-white/40">{label}</p>
      <p className="text-sm font-semibold mt-0.5 truncate">{value}</p>
    </div>
  );
}

function LibraryRow({
  icon, label, hint, onClick,
}: { icon: React.ReactNode; label: string; hint?: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-white/[0.04] transition"
    >
      <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-white/[0.05]">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium leading-none">{label}</p>
        {hint && <p className="text-[11px] text-white/40 mt-1 truncate">{hint}</p>}
      </div>
      <ChevronRight className="w-4 h-4 text-white/25" />
    </button>
  );
}

export default Profile;
