import { useState, useEffect, useMemo } from 'react';
import {
  Settings, LogOut, Shield, Heart, ListMusic, Crown,
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

const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

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
    if (months < 1) setMemberSinceLabel('NEW');
    else if (months < 12) setMemberSinceLabel(`${months} MO`);
    else {
      const years = Math.floor(months / 12);
      const rem = months % 12;
      setMemberSinceLabel(rem ? `${years}Y ${rem}MO` : `${years} YR`);
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
        title: r.title, artist: r.artist, cover_url: r.cover_url, song_id: r.song_id,
        played_at: r.created_at, duration: 180,
        genre: r.song_id ? songById.get(r.song_id)?.genre || null : null,
      }));
      const rows = [
        ...recentRows.map((r) => {
          const song = songById.get(r.song_id);
          return {
            title: song?.title || null, artist: song?.artist || null,
            cover_url: song?.cover_url || null, song_id: r.song_id,
            played_at: r.played_at, duration: Number(song?.duration) || 180,
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
        if (covers.length >= 10) break;
      }
      setRecentCovers(covers);

      setListenStats({
        minutes: Math.round(totalSeconds / 60),
        topArtist: top(artistCount),
        topSong: top(songCount),
        streak, totalPlays: rows.length,
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
      const { error } = await supabase.from('profiles')
        .update({ username: newUsername.trim(), username_changed: true }).eq('user_id', user.id);
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

  const today = new Date();
  const issueCode = `${MONTHS[today.getMonth()]} ${String(today.getFullYear()).slice(-2)}`;
  const memberId = useMemo(() => {
    const src = user?.id || 'guest';
    let h = 0; for (let i = 0; i < src.length; i++) h = (h * 33 + src.charCodeAt(i)) >>> 0;
    return String(h % 9999999).padStart(7, '0');
  }, [user?.id]);

  return (
    <TabTransition>
      <SEOHead
        title="Your Profile — Univers Flow"
        description="Your Univers Flow membership: listening stats, library, downloads and account."
        path="/profile"
      />
      <div className="h-[100dvh] bg-background flex flex-col overflow-hidden">
        <main className="flex-1 overflow-y-auto pb-32 safe-area-pt" style={{ WebkitOverflowScrolling: 'touch' }}>

          {/* ============ MASTHEAD ============ */}
          <div className="px-5 pt-5 pb-3 flex items-center justify-between border-b border-white/[0.06]">
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-black tracking-[0.4em] text-white/50">UF</span>
              <span className="text-[9px] font-mono text-white/25">·</span>
              <span className="text-[9px] font-mono uppercase tracking-widest text-white/40">{issueCode}</span>
            </div>
            <button
              onClick={() => navigate('/settings')}
              aria-label="Settings"
              className="w-8 h-8 rounded-full border border-white/10 flex items-center justify-center active:scale-90 transition"
            >
              <Settings className="w-3.5 h-3.5 text-white/70" />
            </button>
          </div>

          {/* ============ HERO: cover-style ============ */}
          <section className="px-5 pt-6 pb-7 relative">
            {/* Giant kicker */}
            <p className="text-[10px] font-black uppercase tracking-[0.42em] text-primary/90 mb-2">
              The Listener
            </p>
            {/* Massive editorial display name */}
            {!profileSettled ? (
              <div className="h-14 w-56 rounded bg-white/[0.06] animate-pulse mb-3" />
            ) : isEditingUsername ? (
              <div className="flex items-center gap-1.5 mb-3">
                <Input
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  className="h-11 bg-white/10 border-white/20 text-lg"
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
              <div className="flex items-start gap-2">
                <h1 className="font-display text-[46px] leading-[0.9] tracking-[-0.03em] font-black break-words min-w-0 flex-1">
                  {displayName}
                </h1>
                {canChangeUsername && (
                  <button onClick={() => setIsEditingUsername(true)} aria-label="Edit username"
                    className="mt-2 w-7 h-7 rounded-full bg-white/[0.06] flex items-center justify-center active:scale-90 transition shrink-0">
                    <Edit2 className="w-3 h-3 text-white/60" />
                  </button>
                )}
              </div>
            )}

            {/* Serif italic dek */}
            {profileSettled && listenStats.topArtist && (
              <p className="mt-3 font-serif italic text-white/60 text-[15px] leading-snug">
                “Currently in a{' '}
                <span className="text-white/90 not-italic font-semibold">
                  {listenStats.topArtist}
                </span>{' '}
                era.”
              </p>
            )}

            {/* Avatar + tags row */}
            <div className="mt-5 flex items-center gap-4">
              <button
                onClick={() => user && setShowAvatarPicker(true)}
                className="relative shrink-0 active:scale-95 transition"
                aria-label="Change avatar"
              >
                <div
                  className="w-[72px] h-[72px] rounded-full overflow-hidden flex items-center justify-center"
                  style={{
                    background: avatarGradient,
                    boxShadow: '0 0 0 2px hsl(var(--background)), 0 0 0 3px hsl(0 0% 100% / 0.15)',
                  }}
                >
                  {customAvatarUrl ? (
                    <img src={customAvatarUrl} alt="" className="w-full h-full object-cover" width={72} height={72} />
                  ) : (
                    <span className="text-white font-display font-black"
                      style={{ fontSize: 30, lineHeight: 1, textShadow: '0 1px 2px rgba(0,0,0,0.25)' }}>
                      {initials}
                    </span>
                  )}
                </div>
                <div className="absolute -bottom-0.5 -right-0.5 w-6 h-6 rounded-full flex items-center justify-center"
                  style={{
                    background: isPremium ? 'linear-gradient(135deg,#fbbf24,#f59e0b)' : 'hsl(0 0% 10%)',
                    border: '2px solid hsl(var(--background))',
                  }}>
                  {isPremium ? <Crown className="w-3 h-3 text-black" /> : <Camera className="w-3 h-3 text-white/80" />}
                </div>
              </button>

              <div className="flex-1 min-w-0 flex flex-wrap gap-1.5">
                <Tag>{isPremium ? 'PREMIUM' : 'FREE TIER'}</Tag>
                {memberSinceLabel && <Tag>MEMBER · {memberSinceLabel}</Tag>}
                {isAdmin && <Tag tone="blue"><Shield className="w-2.5 h-2.5" /> ADMIN</Tag>}
                {listenStats.topGenre && <Tag tone="rose">{listenStats.topGenre.toUpperCase()}</Tag>}
              </div>
            </div>

            {/* Member ID barcode-ish */}
            <div className="mt-5 flex items-center gap-3">
              <div className="flex-1 h-[22px] flex items-center gap-[2px] overflow-hidden">
                {Array.from({ length: 64 }).map((_, i) => {
                  const seed = (memberId.charCodeAt(i % memberId.length) + i * 13) % 5;
                  const w = seed === 0 ? 3 : seed === 1 ? 1 : 2;
                  const op = i % 3 === 0 ? 0.9 : i % 3 === 1 ? 0.5 : 0.75;
                  return <span key={i} style={{ width: w, height: '100%', background: `hsl(0 0% 100% / ${op})` }} />;
                })}
              </div>
              <span className="text-[9px] font-mono tracking-widest text-white/40">ID·{memberId}</span>
            </div>
          </section>

          <div className="px-5 space-y-7">

            <EmailVerificationCard />

            {/* ============ 01 · MASTHEAD STATS (newspaper cols) ============ */}
            {profileSettled && user && (
              <section>
                <SectionLabel index="01" title="This Season" />
                <div className="grid grid-cols-4 rounded-2xl overflow-hidden border border-white/[0.08]"
                  style={{ background: 'linear-gradient(180deg, hsl(0 0% 100% / 0.03), hsl(0 0% 100% / 0.01))' }}>
                  <BigStat value={fmt(listenStats.minutes)} label="Min" accent />
                  <BigStat value={fmt(listenStats.totalPlays)} label="Plays" />
                  <BigStat value={listenStats.streak > 0 ? String(listenStats.streak) : '—'} label="Streak" />
                  <BigStat value={fmt(stats.likedSongs)} label="Liked" />
                </div>

                {/* Pull-quote card: top song */}
                {listenStats.topSong && (
                  <div className="mt-3 rounded-2xl border border-white/[0.06] px-4 py-3.5"
                    style={{ background: 'linear-gradient(120deg, hsl(var(--primary) / 0.10), transparent 70%)' }}>
                    <p className="text-[9px] font-black uppercase tracking-[0.28em] text-primary/80">On Repeat</p>
                    <p className="font-display text-lg leading-tight mt-1 truncate">{listenStats.topSong}</p>
                  </div>
                )}
              </section>
            )}

            {/* ============ 02 · FILM STRIP: recently played ============ */}
            {profileSettled && recentCovers.length > 0 && (
              <section>
                <SectionLabel index="02" title="Reel — Recently Played" />
                <div className="relative -mx-5">
                  <div
                    className="flex gap-2 overflow-x-auto scrollbar-none px-5 py-3"
                    style={{
                      background: 'repeating-linear-gradient(90deg, transparent 0 14px, hsl(0 0% 100% / 0.04) 14px 20px)',
                    }}
                  >
                    {recentCovers.map((c, i) => (
                      <button
                        key={c.id}
                        onClick={() => navigate(`/search?q=${encodeURIComponent(`${c.title} ${c.artist}`.trim())}`)}
                        className="shrink-0 w-[76px] text-left active:scale-95 transition"
                        aria-label={`Replay ${c.title}`}
                      >
                        <div className="relative w-[76px] h-[76px] rounded-md overflow-hidden bg-white/[0.05] border border-white/[0.08]">
                          {c.cover_url ? (
                            <img src={c.cover_url} alt={c.title} className="w-full h-full object-cover" loading="lazy" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Music2 className="w-5 h-5 text-white/30" />
                            </div>
                          )}
                          <span className="absolute top-1 left-1 text-[8px] font-mono font-black text-white/95 px-1 rounded"
                            style={{ background: 'rgba(0,0,0,0.55)' }}>
                            {String(i + 1).padStart(2, '0')}
                          </span>
                        </div>
                        <p className="mt-1.5 text-[10px] text-white/70 truncate leading-tight font-medium">{c.title}</p>
                        <p className="text-[9px] text-white/35 truncate">{c.artist}</p>
                      </button>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {/* ============ 03 · CONTENTS (index list) ============ */}
            <section>
              <SectionLabel index="03" title="Contents" />
              <div className="space-y-1">
                <IndexRow icon={<Heart className="w-3.5 h-3.5 text-primary" fill="currentColor" />}
                  label="Liked Songs"
                  meta={profileSettled ? (stats.likedSongs > 0 ? String(stats.likedSongs) : '0') : '—'}
                  onClick={() => navigate('/library?tab=liked')} />
                <IndexRow icon={<ListMusic className="w-3.5 h-3.5 text-white/80" />}
                  label="Playlists"
                  meta={profileSettled ? String(stats.playlists) : '—'}
                  onClick={() => navigate('/library?tab=playlists')} />
                <IndexRow icon={<Download className="w-3.5 h-3.5 text-white/80" />}
                  label="Downloads"
                  meta={profileSettled ? String(stats.downloads) : '—'}
                  onClick={() => navigate('/downloads')} />
                <IndexRow icon={<Headphones className="w-3.5 h-3.5 text-white/80" />}
                  label="Audio & Equalizer"
                  meta="EQ"
                  onClick={() => navigate('/settings')} />
                <IndexRow icon={<Star className="w-3.5 h-3.5 text-yellow-400" fill="currentColor" />}
                  label="Your Reviews"
                  meta="Open"
                  onClick={() => setShowReviewsList(true)} />
              </div>
            </section>

            {/* ============ 04 · UPGRADE (feature ad) ============ */}
            {profileSettled && !isPremium && (
              <section>
                <SectionLabel index="04" title="Advertisement" />
                <button
                  onClick={() => navigate('/premium')}
                  className="w-full rounded-2xl p-5 text-left relative overflow-hidden active:scale-[0.99] transition"
                  style={{
                    background: 'linear-gradient(135deg, hsl(45 92% 55% / 0.14), hsl(var(--primary) / 0.16))',
                    border: '1px solid hsl(45 92% 55% / 0.28)',
                  }}
                >
                  <div className="flex items-start gap-3">
                    <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0"
                      style={{ background: 'linear-gradient(135deg,#fbbf24,#f59e0b)' }}>
                      <Crown className="w-5 h-5 text-black" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[9px] font-black uppercase tracking-[0.32em] text-yellow-300/90">Turn the page</p>
                      <p className="font-display text-xl leading-tight mt-1">Become Premium</p>
                      <p className="text-[11px] text-white/60 mt-1">Ad-free · Offline · Studio EQ · Lossless</p>
                    </div>
                  </div>
                </button>
              </section>
            )}

            {/* ============ 05 · COLOPHON (account) ============ */}
            <section>
              <SectionLabel index={isPremium ? '04' : '05'} title="Colophon" />
              <div className="rounded-2xl overflow-hidden border border-white/[0.08] divide-y divide-white/[0.05]"
                style={{ background: 'linear-gradient(180deg, hsl(0 0% 100% / 0.02), transparent)' }}>
                {user?.email && (
                  <div className="px-4 py-3">
                    <p className="text-[9px] font-black uppercase tracking-[0.28em] text-white/35">Signed in as</p>
                    <p className="text-sm mt-1 truncate">{user.email}</p>
                  </div>
                )}
                {profileSettled && isAdmin && (
                  <RowLink icon={<Shield className="w-4 h-4 text-primary" />} label="Admin Panel"
                    onClick={() => navigate('/admin')} />
                )}
                <RowLink icon={<Settings className="w-4 h-4 text-white/80" />} label="Settings"
                  onClick={() => navigate('/settings')} />
                <button onClick={handleLogout}
                  className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-destructive/10 transition">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-destructive/15">
                    <LogOut className="w-4 h-4 text-destructive" />
                  </div>
                  <span className="flex-1 text-sm font-semibold text-destructive">Sign Out</span>
                </button>
              </div>
            </section>

            {/* Signature */}
            <div className="pt-4 pb-1 text-center">
              <p className="font-serif italic text-white/25 text-[13px]">— pressed for you by —</p>
              <p className="mt-1 text-[10px] font-black uppercase tracking-[0.44em] text-white/40">
                Univers Flow
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

/* ---------- editorial primitives ---------- */

function Tag({ children, tone = 'default' }: { children: React.ReactNode; tone?: 'default' | 'rose' | 'blue' }) {
  const style =
    tone === 'rose'
      ? { background: 'hsl(var(--primary) / 0.14)', color: 'hsl(var(--primary))', borderColor: 'hsl(var(--primary) / 0.35)' }
      : tone === 'blue'
      ? { background: 'hsl(211 100% 55% / 0.14)', color: 'hsl(211 100% 75%)', borderColor: 'hsl(211 100% 55% / 0.35)' }
      : { background: 'hsl(0 0% 100% / 0.04)', color: 'hsl(0 0% 100% / 0.65)', borderColor: 'hsl(0 0% 100% / 0.10)' };
  return (
    <span className="inline-flex items-center gap-1 px-2 py-[3px] rounded-full border text-[9px] font-black tracking-[0.22em]"
      style={style}>
      {children}
    </span>
  );
}

function SectionLabel({ index, title }: { index: string; title: string }) {
  return (
    <div className="flex items-baseline gap-2 mb-3">
      <span className="text-[9px] font-mono text-primary/70 tracking-widest">§{index}</span>
      <span className="text-[10px] font-black uppercase tracking-[0.32em] text-white/70">{title}</span>
      <span className="flex-1 h-px bg-white/[0.08]" />
    </div>
  );
}

function BigStat({ value, label, accent = false }: { value: string; label: string; accent?: boolean }) {
  return (
    <div className="px-2 py-4 text-center border-r border-white/[0.06] last:border-r-0">
      <p className={`font-display font-black leading-none tracking-tight ${accent ? 'text-primary' : ''}`}
        style={{ fontSize: 24 }}>
        {value}
      </p>
      <p className="mt-1.5 text-[9px] font-black uppercase tracking-[0.22em] text-white/40">{label}</p>
    </div>
  );
}

function IndexRow({ icon, label, meta, onClick }:
  { icon: React.ReactNode; label: string; meta: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="w-full flex items-baseline gap-2 py-3 text-left active:opacity-70 transition group">
      <span className="w-5 shrink-0 flex items-center justify-center">{icon}</span>
      <span className="text-[15px] font-semibold text-white/90 group-active:text-white">{label}</span>
      <span className="flex-1 border-b border-dotted border-white/15 translate-y-[-4px]" />
      <span className="text-[11px] font-mono uppercase tracking-widest text-white/45">{meta}</span>
    </button>
  );
}

function RowLink({ icon, label, onClick }:
  { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-white/[0.04] transition">
      <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/[0.05]">{icon}</div>
      <span className="flex-1 text-sm font-medium">{label}</span>
      <span className="text-[10px] font-mono text-white/30 tracking-widest">OPEN</span>
    </button>
  );
}

export default Profile;
