import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@/lib/router-compat';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, Music2, Heart, Download, Users, Plus, Trash2, Loader2,
  CheckCircle2, ExternalLink, Pencil, Image as ImageIcon, X, Eye, TrendingUp,
} from 'lucide-react';
import { toast } from 'sonner';
import SEOHead from '@/components/SEOHead';
import { FadeTransition } from '@/components/PageTransition';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import {
  getMyArtistProfile,
  isBlockedStreamHost,
  uploadArtistCover,
  uploadArtistPhoto,
} from '@/lib/artist';
import { useFilePreview } from '@/lib/useFilePreview';
import ArtistLoading from './ArtistLoading';

type Profile = {
  id: string;
  user_id: string;
  stage_name: string;
  slug: string;
  bio: string | null;
  avatar_url: string | null;
  banner_url: string | null;
  social_links: Record<string, any> | null;
};

type Song = {
  id: string;
  title: string;
  cover_url: string | null;
  stream_url: string;
  duration: number | null;
  play_count: number;
  like_count: number;
  download_count: number;
  view_count: number;
  status: 'live' | 'taken_down';
  created_at: string;
  lyrics_plain: string | null;
  lyrics_synced: string | null;
  lyrics_source: string | null;
};

function fmt(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

export default function ArtistStudio() {
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();
  const [boot, setBoot] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [followers, setFollowers] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  useEffect(() => {
    if (isLoading) return;
    if (!user) { navigate('/auth', { replace: true }); return; }
    (async () => {
      // Verify artist role
      const { data: hasArtist } = await supabase.rpc('has_role', { _user_id: user.id, _role: 'artist' });
      if (!hasArtist) {
        navigate('/artist/status', { replace: true });
        return;
      }
      const p = await getMyArtistProfile(user.id);
      if (!p) { navigate('/artist/status', { replace: true }); return; }
      setProfile(p as Profile);

      const [{ data: s }, { count }] = await Promise.all([
        supabase.from('artist_songs').select('*').eq('artist_user_id', user.id).order('created_at', { ascending: false }),
        supabase.from('artist_followers').select('id', { count: 'exact', head: true }).eq('artist_user_id', user.id),
      ]);
      setSongs((s ?? []) as Song[]);
      setFollowers(count ?? 0);
      setBoot(false);
    })();
  }, [user, isLoading, navigate]);

  // Realtime
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel('artist-studio')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'artist_songs', filter: `artist_user_id=eq.${user.id}` }, (payload) => {
        if (payload.eventType === 'INSERT') setSongs((cur) => [payload.new as Song, ...cur]);
        else if (payload.eventType === 'UPDATE') setSongs((cur) => cur.map((s) => (s.id === (payload.new as Song).id ? (payload.new as Song) : s)));
        else if (payload.eventType === 'DELETE') setSongs((cur) => cur.filter((s) => s.id !== (payload.old as Song).id));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'artist_followers', filter: `artist_user_id=eq.${user.id}` }, (payload) => {
        setFollowers((f) => f + (payload.eventType === 'INSERT' ? 1 : payload.eventType === 'DELETE' ? -1 : 0));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const stats = useMemo(() => {
    const plays = songs.reduce((acc, s) => acc + (s.play_count || 0), 0);
    const views = songs.reduce((acc, s) => acc + (s.view_count || 0), 0);
    const likes = songs.reduce((acc, s) => acc + (s.like_count || 0), 0);
    const downloads = songs.reduce((acc, s) => acc + (s.download_count || 0), 0);
    return { plays, views, likes, downloads };
  }, [songs]);

  if (isLoading || boot || !profile) {
    return <ArtistLoading label="Loading your Studio…" />;
  }

  return (
    <FadeTransition>
      <SEOHead title="Artist Studio — Universflow" description="Manage your artist profile, songs and stats." path="/artist/studio" />
      <div className="min-h-[100dvh] bg-background text-foreground pb-40">
        <header className="sticky top-0 z-20 bg-background/85 backdrop-blur-xl border-b border-white/5">
          <div className="max-w-md mx-auto px-4 py-3 flex items-center gap-3">
            <button onClick={() => navigate('/home')} className="w-9 h-9 rounded-full flex items-center justify-center bg-white/[0.04] active:scale-95">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-[15px] font-semibold tracking-tight">Artist Studio</h1>
            <span className="ml-1.5 inline-flex items-center gap-1 text-[10px] font-semibold tracking-wider uppercase text-emerald-300/90">
              <span className="relative flex w-1.5 h-1.5">
                <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-75" />
                <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-emerald-400" />
              </span>
              Live
            </span>
            <button
              onClick={() => navigate(`/a/${profile.slug}`)}
              className="ml-auto text-[11.5px] text-primary inline-flex items-center gap-1"
            >
              View page <ExternalLink className="w-3.5 h-3.5" />
            </button>
          </div>
        </header>


        <main className="max-w-md mx-auto px-5 pt-5">
          {/* Hero */}
          <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative rounded-3xl p-5 overflow-hidden"
            style={{
              background: 'linear-gradient(160deg, rgba(255,45,85,0.18), rgba(16,16,18,0.85))',
              border: '0.5px solid rgba(255,255,255,0.07)',
            }}
          >
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 rounded-2xl overflow-hidden bg-black/40">
                {profile.avatar_url ? (
                  <img src={profile.avatar_url} alt={profile.stage_name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center"><Music2 className="w-7 h-7 text-muted-foreground" /></div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <h2 className="text-[18px] font-semibold truncate">{profile.stage_name}</h2>
                  <CheckCircle2 className="w-4 h-4 text-primary shrink-0" fill="currentColor" stroke="#fff" />
                </div>
                <p className="text-[12px] text-muted-foreground mt-0.5">@{profile.slug}</p>
                <p className="text-[12px] text-muted-foreground mt-0.5 tabular-nums">{fmt(followers)} followers</p>
              </div>
              <button
                onClick={() => setEditOpen(true)}
                className="w-9 h-9 rounded-full bg-white/[0.06] flex items-center justify-center active:scale-95"
                aria-label="Edit profile"
              >
                <Pencil className="w-4 h-4" />
              </button>
            </div>
          </motion.section>

          {/* Stats — real-time via postgres_changes subscription above */}
          <section className="grid grid-cols-2 gap-3 mt-4">
            <StatCard icon={<Music2 className="w-4 h-4" />} label="Total plays" value={fmt(stats.plays)} accent />
            <StatCard icon={<Eye className="w-4 h-4" />} label="Profile views" value={fmt(stats.views)} />
            <StatCard icon={<Heart className="w-4 h-4" />} label="Likes" value={fmt(stats.likes)} />
            <StatCard icon={<Download className="w-4 h-4" />} label="Downloads" value={fmt(stats.downloads)} />
            <StatCard icon={<Users className="w-4 h-4" />} label="Followers" value={fmt(followers)} />
          </section>

          {/* Tabs */}
          <Tabs defaultValue="songs" className="mt-6">
            <TabsList className="grid grid-cols-2 bg-white/[0.04] rounded-full p-1 h-10">
              <TabsTrigger value="songs" className="rounded-full text-[12.5px]">Songs ({songs.length})</TabsTrigger>
              <TabsTrigger value="profile" className="rounded-full text-[12.5px]">Profile</TabsTrigger>
            </TabsList>

            <TabsContent value="songs" className="mt-4 space-y-2.5">
              <Button
                className="w-full h-11 rounded-xl text-[13.5px] font-semibold text-white"
                style={{ background: '#FF2D55' }}
                onClick={() => setAddOpen(true)}
              >
                <Plus className="w-4 h-4 mr-1.5" /> Add a song
              </Button>

              <TopTrackCard songs={songs} />
              <SongsList songs={songs} />
            </TabsContent>

            <TabsContent value="profile" className="mt-4">
              <ProfileSummary profile={profile} onEdit={() => setEditOpen(true)} />
            </TabsContent>
          </Tabs>
        </main>


        <AddSongDialog
          open={addOpen}
          onClose={() => setAddOpen(false)}
          userId={user!.id}
        />
        <EditProfileDialog
          open={editOpen}
          onClose={() => setEditOpen(false)}
          profile={profile}
          onSaved={(p) => setProfile(p)}
        />
      </div>
    </FadeTransition>
  );
}

function StatCard({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent?: boolean }) {
  const prev = useRef(value);
  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    if (prev.current !== value) {
      prev.current = value;
      setPulse(true);
      const t = setTimeout(() => setPulse(false), 700);
      return () => clearTimeout(t);
    }
  }, [value]);
  return (
    <div
      className="rounded-2xl p-4 relative overflow-hidden transition-shadow"
      style={{
        background: accent ? 'linear-gradient(160deg, rgba(255,45,85,0.18), rgba(16,16,18,0.6))' : 'rgba(255,255,255,0.03)',
        border: '0.5px solid rgba(255,255,255,0.07)',
        boxShadow: pulse ? '0 0 0 1px rgba(255,45,85,0.45), 0 8px 32px -8px rgba(255,45,85,0.35)' : undefined,
      }}
    >
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
        {icon}{label}
      </div>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={value}
          initial={{ y: 8, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -8, opacity: 0 }}
          transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
          className="mt-2 text-[24px] font-semibold tabular-nums leading-none"
        >
          {value}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function TopTrackCard({ songs }: { songs: Song[] }) {
  const top = useMemo(() => {
    if (!songs.length) return null;
    return [...songs].sort((a, b) =>
      (b.play_count + b.like_count * 2 + b.download_count * 3) -
      (a.play_count + a.like_count * 2 + a.download_count * 3),
    )[0];
  }, [songs]);
  if (!top || (top.play_count === 0 && top.like_count === 0 && top.download_count === 0)) return null;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl p-3.5 flex items-center gap-3 relative overflow-hidden"
      style={{
        background: 'linear-gradient(160deg, rgba(255,45,85,0.22), rgba(16,16,18,0.6))',
        border: '0.5px solid rgba(255,45,85,0.25)',
      }}
    >
      <div className="absolute top-2 right-3 inline-flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-wider text-rose-200/90">
        <TrendingUp className="w-3 h-3" /> Top track
      </div>
      <div className="w-14 h-14 rounded-xl overflow-hidden bg-black/40 shrink-0">
        {top.cover_url ? (
          <img src={top.cover_url} alt={top.title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center"><Music2 className="w-6 h-6 text-muted-foreground" /></div>
        )}
      </div>
      <div className="flex-1 min-w-0 pr-14">
        <p className="text-[14px] font-semibold truncate">{top.title}</p>
        <p className="text-[11.5px] text-rose-100/70 tabular-nums mt-0.5">
          {fmt(top.play_count)} plays · {fmt(top.like_count)} likes
        </p>
      </div>
    </motion.div>
  );
}

type SortKey = 'recent' | 'plays' | 'likes' | 'views' | 'downloads';

function SongsList({ songs }: { songs: Song[] }) {
  const [sort, setSort] = useState<SortKey>('recent');
  const sorted = useMemo(() => {
    const arr = [...songs];
    switch (sort) {
      case 'plays': return arr.sort((a, b) => b.play_count - a.play_count);
      case 'likes': return arr.sort((a, b) => b.like_count - a.like_count);
      case 'views': return arr.sort((a, b) => (b.view_count || 0) - (a.view_count || 0));
      case 'downloads': return arr.sort((a, b) => b.download_count - a.download_count);
      default: return arr.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
    }
  }, [songs, sort]);

  if (!songs.length) {
    return (
      <p className="text-center text-[13px] text-muted-foreground py-10">
        No songs yet. Tap "Add a song" to publish your first track.
      </p>
    );
  }

  const opts: Array<[SortKey, string]> = [
    ['recent', 'Recent'], ['plays', 'Plays'], ['likes', 'Likes'], ['views', 'Views'], ['downloads', 'DLs'],
  ];

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-none">
        {opts.map(([k, label]) => (
          <button
            key={k}
            onClick={() => setSort(k)}
            className={`shrink-0 px-3 h-7 rounded-full text-[11.5px] font-medium transition ${
              sort === k
                ? 'bg-white text-black'
                : 'bg-white/[0.05] text-muted-foreground active:scale-95'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <AnimatePresence initial={false}>
        {sorted.map((s) => (
          <SongRow key={s.id} song={s} onDelete={async () => {
            const ok = confirm(`Delete "${s.title}"? This cannot be undone.`);
            if (!ok) return;
            const { error } = await supabase.from('artist_songs').delete().eq('id', s.id);
            if (error) toast.error(error.message); else toast.success('Deleted');
          }} />
        ))}
      </AnimatePresence>
    </div>
  );
}


function SongRow({ song, onDelete }: { song: Song; onDelete: () => void }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-3 p-3 rounded-2xl bg-white/[0.03] border border-white/[0.06]"
    >
      <div className="w-12 h-12 rounded-xl overflow-hidden bg-black/40 shrink-0">
        {song.cover_url ? (
          <img src={song.cover_url} alt={song.title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center"><Music2 className="w-5 h-5 text-muted-foreground" /></div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13.5px] font-medium truncate">{song.title}</p>
        <p className="text-[11.5px] text-muted-foreground tabular-nums mt-0.5">
          {fmt(song.play_count)} plays · {fmt(song.view_count || 0)} views · {fmt(song.like_count)} likes · {fmt(song.download_count)} downloads
        </p>
        {song.status === 'taken_down' && (
          <p className="text-[11px] text-rose-400 mt-0.5">Taken down by admin</p>
        )}
      </div>
      <button
        onClick={onDelete}
        className="w-9 h-9 rounded-full bg-white/[0.04] flex items-center justify-center text-rose-400 active:scale-95"
        aria-label="Delete song"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </motion.div>
  );
}

function ProfileSummary({ profile, onEdit }: { profile: Profile; onEdit: () => void }) {
  return (
    <div className="space-y-3">
      <div className="rounded-2xl p-4 bg-white/[0.03] border border-white/[0.06]">
        <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground mb-2">Bio</p>
        <p className="text-[13px] leading-relaxed">{profile.bio || <span className="text-muted-foreground italic">No bio yet.</span>}</p>
      </div>
      <div className="rounded-2xl p-4 bg-white/[0.03] border border-white/[0.06]">
        <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground mb-2">Slug</p>
        <p className="text-[13px] font-mono">/a/{profile.slug}</p>
      </div>
      <Button variant="outline" className="w-full h-11 rounded-xl" onClick={onEdit}>
        <Pencil className="w-4 h-4 mr-1.5" /> Edit profile
      </Button>
    </div>
  );
}

function AddSongDialog({ open, onClose, userId }: { open: boolean; onClose: () => void; userId: string }) {
  const [title, setTitle] = useState('');
  const [streamUrl, setStreamUrl] = useState('');
  const [lyricsPlain, setLyricsPlain] = useState('');
  const [lyricsSynced, setLyricsSynced] = useState('');
  const [cover, setCover] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) { setTitle(''); setStreamUrl(''); setLyricsPlain(''); setLyricsSynced(''); setCover(null); setError(null); }
  }, [open]);

  const urlError = streamUrl ? isBlockedStreamHost(streamUrl) : null;

  const save = async () => {
    if (!title.trim() || !streamUrl.trim()) return;
    const blocked = isBlockedStreamHost(streamUrl);
    if (blocked) { setError(blocked); return; }
    setSaving(true);
    setError(null);
    try {
      const coverUrl = cover ? await uploadArtistCover(userId, cover) : null;
      const { error } = await supabase.from('artist_songs').insert({
        artist_user_id: userId,
        title: title.trim(),
        stream_url: streamUrl.trim(),
        cover_url: coverUrl,
        lyrics_plain: lyricsPlain.trim() || null,
        lyrics_synced: lyricsSynced.trim() || null,
        lyrics_source: lyricsPlain.trim() || lyricsSynced.trim() ? 'artist' : null,
      });
      if (error) throw error;
      toast.success('Song published ✓');
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Could not save song.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add a song</DialogTitle>
        </DialogHeader>

        <div className="rounded-xl p-3 bg-amber-500/10 border border-amber-500/20 text-[12px] leading-relaxed text-amber-100/90">
          We only accept <strong>direct audio URLs</strong> from sources you own or have rights to
          (your website, your CDN, your label's HLS). YouTube, JioSaavn, Spotify and SoundCloud links
          are <strong>not allowed</strong>.
        </div>

        <div className="space-y-3 mt-1">
          <div>
            <label className="block text-[11px] uppercase tracking-[0.16em] text-muted-foreground/70 mb-1.5">Title</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Song title" maxLength={80} />
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-[0.16em] text-muted-foreground/70 mb-1.5">Direct stream URL</label>
            <Input value={streamUrl} onChange={(e) => setStreamUrl(e.target.value)} placeholder="https://your-domain.com/song.mp3" />
            {urlError && <p className="text-[11.5px] text-rose-400 mt-1.5">{urlError}</p>}
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-[0.16em] text-muted-foreground/70 mb-1.5">Cover art (optional)</label>
            <CoverPicker cover={cover} onPick={setCover} />
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-[0.16em] text-muted-foreground/70 mb-1.5">Lyrics (optional)</label>
            <Textarea value={lyricsPlain} onChange={(e) => setLyricsPlain(e.target.value)} placeholder="Paste plain lyrics" maxLength={12000} className="min-h-28 resize-none" />
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-[0.16em] text-muted-foreground/70 mb-1.5">Synced LRC lyrics (optional)</label>
            <Textarea value={lyricsSynced} onChange={(e) => setLyricsSynced(e.target.value)} placeholder="[00:12.30] First line" maxLength={20000} className="min-h-24 resize-none font-mono text-[12px]" spellCheck={false} />
          </div>

          {error && <p className="text-[12px] text-rose-400">{error}</p>}

          <Button
            className="w-full h-11 rounded-xl font-semibold text-white"
            style={{ background: '#FF2D55' }}
            disabled={saving || !title.trim() || !streamUrl.trim() || !!urlError}
            onClick={save}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Publish song'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditProfileDialog({ open, onClose, profile, onSaved }: {
  open: boolean; onClose: () => void; profile: Profile;
  onSaved: (p: Profile) => void;
}) {
  const [stageName, setStageName] = useState(profile.stage_name);
  const [bio, setBio] = useState(profile.bio ?? '');
  const [avatar, setAvatar] = useState<File | null>(null);
  const [banner, setBanner] = useState<File | null>(null);
  const [instagram, setInstagram] = useState(profile.social_links?.instagram ?? '');
  const [youtube, setYoutube] = useState(profile.social_links?.youtube ?? '');
  const [spotify, setSpotify] = useState(profile.social_links?.spotify ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setStageName(profile.stage_name);
    setBio(profile.bio ?? '');
    setInstagram(profile.social_links?.instagram ?? '');
    setYoutube(profile.social_links?.youtube ?? '');
    setSpotify(profile.social_links?.spotify ?? '');
    setAvatar(null);
    setBanner(null);
  }, [profile, open]);

  const save = async () => {
    setSaving(true);
    try {
      const avatar_url = avatar ? await uploadArtistPhoto(profile.user_id, avatar) : profile.avatar_url;
      const banner_url = banner ? await uploadArtistCover(profile.user_id, banner) : profile.banner_url;
      const social_links = {
        ...(profile.social_links || {}),
        instagram: instagram.trim() || null,
        youtube: youtube.trim() || null,
        spotify: spotify.trim() || null,
      };
      const { data, error } = await supabase.from('artist_profiles').update({
        stage_name: stageName.trim(),
        bio: bio.trim() || null,
        avatar_url,
        banner_url,
        social_links,
      }).eq('user_id', profile.user_id).select().single();
      if (error) throw error;
      onSaved(data as Profile);
      toast.success('Profile updated');
      onClose();
    } catch (e: any) {
      toast.error(e?.message || 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit artist profile</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Stage name"><Input value={stageName} onChange={(e) => setStageName(e.target.value)} maxLength={50} /></Field>
          <Field label="Bio"><Textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={3} maxLength={300} /></Field>
          <PhotoField label="Profile photo" file={avatar} existing={profile.avatar_url} onPick={setAvatar} />
          <PhotoField label="Banner" file={banner} existing={profile.banner_url} onPick={setBanner} />
          <Field label="Instagram"><Input value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder="https://instagram.com/…" /></Field>
          <Field label="YouTube"><Input value={youtube} onChange={(e) => setYoutube(e.target.value)} placeholder="https://youtube.com/…" /></Field>
          <Field label="Spotify"><Input value={spotify} onChange={(e) => setSpotify(e.target.value)} placeholder="https://open.spotify.com/artist/…" /></Field>

          <Button
            className="w-full h-11 rounded-xl text-white font-semibold mt-2"
            style={{ background: '#FF2D55' }}
            disabled={saving}
            onClick={save}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-[0.16em] text-muted-foreground/70 mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function CoverPicker({ cover, onPick }: { cover: File | null; onPick: (f: File | null) => void }) {
  const preview = useFilePreview(cover);
  return (
    <label className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-3 flex items-center gap-3 cursor-pointer">
      <div className="w-12 h-12 rounded-xl bg-white/[0.04] flex items-center justify-center overflow-hidden">
        {cover ? <img src={preview || undefined} className="w-full h-full object-cover" alt="" /> : <ImageIcon className="w-5 h-5 text-muted-foreground" />}
      </div>
      <span className="text-[12.5px] text-muted-foreground">{cover ? cover.name : 'Tap to pick cover'}</span>
      <input
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => {
          onPick(e.target.files?.[0] ?? null);
          e.target.value = '';
        }}
      />
    </label>
  );
}

function PhotoField({ label, file, existing, onPick }: { label: string; file: File | null; existing: string | null; onPick: (f: File | null) => void }) {
  const preview = useFilePreview(file);
  const src = preview || existing;
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-[0.16em] text-muted-foreground/70 mb-1.5">{label}</span>
      <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-3 flex items-center gap-3">
        <div className="w-14 h-14 rounded-xl bg-white/[0.04] flex items-center justify-center overflow-hidden">
          {src ? <img src={src} alt="" className="w-full h-full object-cover" /> : <ImageIcon className="w-5 h-5 text-muted-foreground" />}
        </div>
        <div className="flex-1 text-[12.5px] text-muted-foreground truncate">{file ? file.name : existing ? 'Current photo' : 'No image'}</div>
        <label className="text-[12px] text-primary px-2 py-1 cursor-pointer">
          {file || existing ? 'Change' : 'Pick'}
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => {
              onPick(e.target.files?.[0] ?? null);
              e.target.value = '';
            }}
          />
        </label>
        {file && (
          <button type="button" onClick={() => onPick(null)} className="text-muted-foreground p-1">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </label>
  );
}
