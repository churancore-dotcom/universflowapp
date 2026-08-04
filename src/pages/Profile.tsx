import { useState, useEffect, useMemo } from 'react';
import {
  Settings, LogOut, Shield, Heart, ListMusic, Crown, ChevronRight,
  Edit2, Check, X, Star, Headphones, Download, Music2, Play,
} from 'lucide-react';
import { useNavigate } from '@/lib/router-compat';
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
type RecentCover = { id: string; title: string; artist: string; cover_url: string | null };

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
  const navigate = useNavigate();

  const [stats, setStats] = useState({ likedSongs: 0, playlists: 0, downloads: 0 });
  const [listenStats, setListenStats] = useState<{ minutes: number; topArtist: string | null; streak: number; totalPlays: number }>({ minutes: 0, topArtist: null, streak: 0, totalPlays: 0 });
  const [recentCovers, setRecentCovers] = useState<RecentCover[]>([]);
  const [memberSinceLabel, setMemberSinceLabel] = useState<string>('');
  const [statsReady, setStatsReady] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [showReviewsList, setShowReviewsList] = useState(false);

  const [profileData, setProfileData] = useState<ProfileData>({ username: null, username_changed: false });
  const [profileReady, setProfileReady] = useState(false);
  const [isEditingUsername, setIsEditingUsername] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [isSaving, setIsSaving] = useState(false);



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
        if (covers.length >= 10) break;
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
              <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-white/35">Univers Flow</p>
              <p className="font-display text-[20px] leading-tight tracking-wide">PROFILE</p>
            </div>
            <button
              onClick={() => navigate('/settings')}
              aria-label="Settings"
              className="neu-sm neu-press w-11 h-11 rounded-2xl flex items-center justify-center"
            >
              <Settings className="w-[18px] h-[18px] text-white/70" />
            </button>
          </header>

          {/* ============ IDENTITY PANEL ============ */}
          <section className="px-5 pt-6">
            <div className="neu rounded-[30px] p-6 flex flex-col items-center text-center">
              {/* Carved avatar well */}
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
                      <X className="w-4 h-4 text-white/60" />
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
                        <Edit2 className="w-3 h-3 text-white/60" />
                      </button>
                    )}
                  </div>
                )}
                {user?.email && (
                  <p className="mt-1.5 text-[11.5px] text-white/40 truncate">{user.email}</p>
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
                    <span className="neu-inset inline-flex items-center px-3 py-1.5 rounded-full text-[10.5px] font-bold uppercase tracking-wider text-white/45">
                      Free
                    </span>
                  )}
                  {isAdmin && (
                    <span className="neu-sm inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10.5px] font-bold uppercase tracking-wider text-sky-300">
                      <Shield className="w-3 h-3" /> Admin
                    </span>
                  )}
                  {memberSinceLabel && (
                    <span className="neu-inset inline-flex items-center px-3 py-1.5 rounded-full text-[10.5px] font-semibold text-white/45">
                      {memberSinceLabel}
                    </span>
                  )}
                </div>
              )}
            </div>
          </section>

          <div className="px-5 pt-6 space-y-7">
            <EmailVerificationCard />

            {/* ============ STATS — carved dial cluster ============ */}
            {profileSettled && user && (
              <section className="neu rounded-[28px] p-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-white/35 mb-4 px-1">Listening</p>
                <div className="grid grid-cols-2 gap-3">
                  <Dial value={fmt(listenStats.minutes)} label="Minutes" />
                  <Dial value={fmt(listenStats.totalPlays)} label="Plays" />
                  <Dial value={listenStats.streak > 0 ? `${listenStats.streak}d` : '0d'} label="Streak" />
                  <Dial value={fmt(stats.likedSongs)} label="Liked" />
                </div>

                {listenStats.topArtist && (
                  <div className="neu-inset mt-3 rounded-2xl px-4 py-3.5 flex items-center gap-3">
                    <div className="neu-accent w-10 h-10 rounded-full flex items-center justify-center shrink-0">
                      <Play className="w-4 h-4 text-white" fill="currentColor" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">Heavy rotation</p>
                      <p className="font-semibold truncate text-[14px] mt-0.5">{listenStats.topArtist}</p>
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* ============ RECENTLY PLAYED — cover pucks ============ */}
            {profileSettled && recentCovers.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-[10px] font-bold uppercase tracking-[0.28em] text-white/35">Recently played</h2>
                  <button onClick={() => navigate('/library')} className="neu-sm neu-press px-3 py-1.5 rounded-full text-[10.5px] font-bold uppercase tracking-wider text-white/55">
                    All
                  </button>
                </div>
                <div className="flex gap-4 overflow-x-auto hide-scrollbar -mx-5 px-5 pb-2">
                  {recentCovers.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => navigate(`/search?q=${encodeURIComponent(`${c.title} ${c.artist}`.trim())}`)}
                      className="shrink-0 w-[104px] text-left"
                      aria-label={`Replay ${c.title}`}
                    >
                      <div className="neu neu-press rounded-3xl p-2">
                        <div className="neu-inset w-full aspect-square rounded-2xl overflow-hidden">
                          {c.cover_url ? (
                            <img src={c.cover_url} alt={c.title} className="w-full h-full object-cover rounded-2xl" loading="lazy" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center"><Music2 className="w-6 h-6 text-white/20" /></div>
                          )}
                        </div>
                      </div>
                      <p className="mt-2.5 px-1 text-[12px] font-semibold text-white/85 truncate leading-tight">{c.title}</p>
                      <p className="px-1 text-[11px] text-white/35 truncate">{c.artist}</p>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* ============ LIBRARY — moulded keys ============ */}
            <section>
              <h2 className="text-[10px] font-bold uppercase tracking-[0.28em] text-white/35 mb-4">Your library</h2>
              <div className="space-y-3">
                <Key icon={<Heart className="w-[18px] h-[18px] text-primary" fill="currentColor" />}
                  label="Liked Songs"
                  hint={profileSettled ? `${stats.likedSongs} ${stats.likedSongs === 1 ? 'song' : 'songs'}` : '—'}
                  onClick={() => navigate('/library?tab=liked')} />
                <Key icon={<ListMusic className="w-[18px] h-[18px] text-white/70" />}
                  label="Playlists"
                  hint={profileSettled ? `${stats.playlists} ${stats.playlists === 1 ? 'playlist' : 'playlists'}` : '—'}
                  onClick={() => navigate('/library?tab=playlists')} />
                <Key icon={<Download className="w-[18px] h-[18px] text-white/70" />}
                  label="Downloads"
                  hint={profileSettled ? `${stats.downloads} offline` : '—'}
                  onClick={() => navigate('/downloads')} />
                <Key icon={<Headphones className="w-[18px] h-[18px] text-white/70" />}
                  label="Audio & Equalizer"
                  hint="Studio EQ, stems, spatial"
                  onClick={() => navigate('/settings')} />
                <Key icon={<Star className="w-[18px] h-[18px] text-amber-300" fill="currentColor" />}
                  label="Reviews"
                  hint="Rate Univers Flow"
                  onClick={() => setShowReviewsList(true)} />
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
                  <p className="text-[11.5px] text-white/45 mt-0.5">Ad-free · Offline · Studio EQ · Lossless</p>
                </div>
                <ChevronRight className="w-4 h-4 text-white/25" />
              </button>
            )}

            {/* ============ ACCOUNT ============ */}
            <section>
              <h2 className="text-[10px] font-bold uppercase tracking-[0.28em] text-white/35 mb-4">Account</h2>
              <div className="space-y-3">
                {profileSettled && isAdmin && (
                  <Key icon={<Shield className="w-[18px] h-[18px] text-primary" />} label="Admin Panel"
                    hint="Manage the platform"
                    onClick={() => navigate('/admin')} />
                )}
                <Key icon={<Settings className="w-[18px] h-[18px] text-white/70" />} label="Settings"
                  hint="Playback, quality, privacy"
                  onClick={() => navigate('/settings')} />
                <button onClick={handleLogout}
                  className="neu neu-press w-full flex items-center gap-4 px-4 py-4 rounded-3xl text-left">
                  <div className="neu-inset w-11 h-11 rounded-2xl flex items-center justify-center shrink-0">
                    <LogOut className="w-[18px] h-[18px] text-destructive" />
                  </div>
                  <span className="flex-1 text-[14px] font-semibold text-destructive">Sign Out</span>
                </button>
              </div>
            </section>

            <p className="text-center text-[9.5px] uppercase tracking-[0.35em] text-white/20 pt-2 pb-1">
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
      </div>
    </TabTransition>
  );
};

function Dial({ value, label }: { value: string; label: string }) {
  return (
    <div className="neu-inset rounded-2xl px-3 py-4 text-center">
      <p className="font-display font-bold text-[22px] leading-none tracking-wide">{value}</p>
      <p className="mt-2 text-[9.5px] uppercase tracking-[0.2em] text-white/35 font-bold">{label}</p>
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
        {hint && <p className="text-[11px] text-white/35 mt-1.5 truncate">{hint}</p>}
      </div>
      <ChevronRight className="w-4 h-4 text-white/20" />
    </button>
  );
}

export default Profile;

