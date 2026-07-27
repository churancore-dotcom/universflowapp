import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion, useScroll, useTransform } from 'framer-motion';
import {
  ArrowLeft, BadgeCheck, Heart, Music2, Play, UserPlus, UserCheck,
  Instagram, Youtube, Shuffle, Share2, Headphones, Globe2, Star, Camera,
} from 'lucide-react';
import { toast } from 'sonner';
import SEOHead from '@/components/SEOHead';
import { FadeTransition } from '@/components/PageTransition';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { usePlayer, type Song as PlayerSong } from '@/contexts/PlayerContext';
import ArtistLoading from './ArtistLoading';

type Profile = {
  id: string;
  user_id: string;
  stage_name: string;
  slug: string;
  bio: string | null;
  tagline?: string | null;
  location?: string | null;
  accent_color?: string | null;
  genres?: string[] | null;
  avatar_url: string | null;
  banner_url: string | null;
  social_links: Record<string, any> | null;
  is_verified: boolean;
  artist_pick_song_id?: string | null;
  artist_pick_message?: string | null;
  gallery_urls?: string[] | null;
};

type Song = {
  id: string;
  title: string;
  cover_url: string | null;
  stream_url: string;
  duration: number | null;
  play_count: number;
  like_count: number;
};

function fmt(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}
function dur(seconds: number | null) {
  if (!seconds || !Number.isFinite(seconds)) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export default function ArtistPublic() {
  const { slug = '' } = useParams<{ slug: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const player = usePlayer();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [followers, setFollowers] = useState(0);
  const [monthly, setMonthly] = useState<number>(0);
  const [isFollowing, setIsFollowing] = useState(false);
  const [loading, setLoading] = useState(true);

  // Parallax / sticky header
  const scrollRef = useRef<HTMLDivElement>(null);
  const { scrollY } = useScroll({ container: scrollRef });
  const bannerY = useTransform(scrollY, [0, 300], [0, 80]);
  const bannerScale = useTransform(scrollY, [0, 300], [1.04, 1.18]);
  const titleOpacity = useTransform(scrollY, [120, 200], [0, 1]);

  useEffect(() => {
    (async () => {
      const { data: p } = await supabase
        .from('artist_profiles')
        .select('*')
        .eq('slug', slug)
        .maybeSingle();
      if (!p) { setLoading(false); return; }
      setProfile(p as Profile);

      const [{ data: s }, { data: count }, { data: follow }] = await Promise.all([
        supabase.from('artist_songs').select('*')
          .eq('artist_user_id', (p as Profile).user_id)
          .eq('status', 'live')
          .order('created_at', { ascending: false }),
        supabase.rpc('get_artist_follower_count' as never, { _artist_user_id: (p as Profile).user_id } as never),
        user ? supabase.rpc('is_following_artist' as never, { _artist_user_id: (p as Profile).user_id } as never)
             : Promise.resolve({ data: false }),
      ]);
      const list = (s ?? []) as Song[];
      setSongs(list);
      setFollowers(Number(count ?? 0));
      setIsFollowing(!!follow);
      setLoading(false);

      // Monthly listeners — distinct real listeners (user_id or session_id) over last 30 days.
      // Rows without either identifier are dropped so we never inflate the count.
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      const ids = list.map((x) => x.id);
      if (ids.length) {
        const { data: ev } = await supabase
          .from('song_play_events')
          .select('user_id, session_id')
          .in('song_id', ids)
          .gte('created_at', since)
          .limit(5000);
        const set = new Set<string>();
        for (const r of (ev ?? []) as Array<{ user_id: string | null; session_id: string | null }>) {
          const key = r.user_id ?? r.session_id;
          if (key) set.add(key);
        }
        setMonthly(set.size);
      }

      // Bump view_count once per song per session so every track on the profile
      // ticks up (not just the newest), while refreshes don't inflate counts.
      for (const song of list) {
        const key = `uf_song_viewed_${song.id}`;
        if (sessionStorage.getItem(key)) continue;
        sessionStorage.setItem(key, '1');
        supabase.rpc('increment_artist_song_view' as never, { _song_id: song.id } as never);
      }

    })();
  }, [slug, user]);

  useEffect(() => {
    if (!profile) return;
    const channel = supabase
      .channel(`pub-artist-${profile.user_id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'artist_followers', filter: `artist_user_id=eq.${profile.user_id}` },
        (payload) => {
          setFollowers((f) => f + (payload.eventType === 'INSERT' ? 1 : payload.eventType === 'DELETE' ? -1 : 0));
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile]);

  const toggleFollow = async () => {
    if (!user || !profile) { navigate('/auth'); return; }
    if (user.id === profile.user_id) {
      toast.error("You can't follow your own artist page");
      return;
    }
    if (isFollowing) {
      const { error } = await supabase.from('artist_followers')
        .delete()
        .eq('artist_user_id', profile.user_id)
        .eq('follower_user_id', user.id);
      if (error) { toast.error(error.message); return; }
      setIsFollowing(false);
    } else {
      const { error } = await supabase.from('artist_followers')
        .insert({ artist_user_id: profile.user_id, follower_user_id: user.id });
      if (error) { toast.error(error.message); return; }
      setIsFollowing(true);
    }
  };

  const sharePage = async () => {
    const url = `${window.location.origin}/a/${profile?.slug}`;
    try {
      if (navigator.share) await navigator.share({ title: profile?.stage_name ?? 'Artist', url });
      else { await navigator.clipboard.writeText(url); toast.success('Link copied'); }
    } catch { /* user cancelled */ }
  };

  const toPlayerSong = (s: Song): PlayerSong => ({
    id: `as_${s.id}`,
    title: s.title,
    artist: profile?.stage_name || 'Artist',
    cover_url: s.cover_url || undefined,
    audio_url: s.stream_url,
    duration: s.duration || undefined,
    artist_photo_url: profile?.avatar_url || undefined,
    source: 'indexed',
  });

  const playSong = async (s: Song) => {
    if (!player || !profile) return;
    const queue = songs.map(toPlayerSong);
    player.playSong(toPlayerSong(s), null, queue);
    supabase.rpc('increment_artist_song_play' as never, { _song_id: s.id } as never);
  };

  const playAll = (shuffle = false) => {
    if (!songs.length || !profile || !player) return;
    const ordered = shuffle ? [...songs].sort(() => Math.random() - 0.5) : songs;
    const queue = ordered.map(toPlayerSong);
    player.playSong(queue[0], null, queue);
    supabase.rpc('increment_artist_song_play' as never, { _song_id: ordered[0].id } as never);
  };

  const popular = useMemo(
    () => [...songs].sort((a, b) => (b.play_count || 0) - (a.play_count || 0)).slice(0, 3),
    [songs],
  );
  const totalStreams = useMemo(
    () => songs.reduce((a, s) => a + (s.play_count || 0), 0),
    [songs],
  );

  if (loading) return <ArtistLoading label="Loading artist…" />;

  if (!profile) {
    return (
      <FadeTransition>
        <div className="min-h-[100dvh] bg-background text-foreground flex items-center justify-center px-6">
          <div className="text-center">
            <p className="text-muted-foreground text-[14px] mb-4">Artist not found.</p>
            <Button onClick={() => navigate('/home')}>Back to home</Button>
          </div>
        </div>
      </FadeTransition>
    );
  }

  // Defensive scheme allowlist: prevent stored javascript:/data:/vbscript: URIs
  // (written directly to social_links via API) from executing when a visitor
  // clicks the link.
  const safeHttpHref = (v: unknown): string | null => {
    if (typeof v !== 'string') return null;
    const s = v.trim();
    if (!s) return null;
    // Allow bare handles like "@name" or "name" by prefixing https://
    if (/^[A-Za-z0-9._-]+$/.test(s.replace(/^@/, ''))) return null;
    try {
      const u = new URL(s);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      return u.toString();
    } catch {
      return null;
    }
  };
  const rawIg = profile.social_links?.instagram;
  const rawYt = profile.social_links?.youtube;
  const ig = typeof rawIg === 'string' && /^https?:\/\//i.test(rawIg)
    ? safeHttpHref(rawIg)
    : typeof rawIg === 'string' && rawIg.trim()
      ? safeHttpHref(`https://instagram.com/${rawIg.trim().replace(/^@/, '')}`)
      : null;
  const yt = typeof rawYt === 'string' && /^https?:\/\//i.test(rawYt)
    ? safeHttpHref(rawYt)
    : typeof rawYt === 'string' && rawYt.trim()
      ? safeHttpHref(`https://youtube.com/${rawYt.trim().replace(/^@?/, '@')}`)
      : null;
  const accent = (profile.accent_color && /^#[0-9a-fA-F]{6}$/.test(profile.accent_color)) ? profile.accent_color : '#FF2D55';
  const pickSong = profile.artist_pick_song_id ? songs.find((s) => s.id === profile.artist_pick_song_id) : null;
  const gallery = (profile.gallery_urls ?? []).filter(Boolean);

  const canonicalUrl = `https://universflow.in/a/${profile.slug}`;
  const shareImage =
    profile.banner_url ||
    profile.avatar_url ||
    'https://universflow.in/pwa-512x512.png';
  const topTitles = songs.slice(0, 5).map((s) => s.title).filter(Boolean);
  const seoTitle = `${profile.stage_name}${profile.is_verified ? ' ✓' : ''} — Songs, Albums & Playlists | Universflow`;
  const seoDescription =
    (profile.bio?.trim() ? `${profile.bio.trim().slice(0, 140)} ` : '') +
    `Listen to ${profile.stage_name} on Universflow — ${fmt(monthly)} monthly listeners, ${fmt(followers)} followers, ${songs.length} track${songs.length === 1 ? '' : 's'}.${topTitles.length ? ` Popular: ${topTitles.slice(0, 3).join(', ')}.` : ''}`;
  const seoKeywords = [
    profile.stage_name,
    `${profile.stage_name} songs`,
    `${profile.stage_name} music`,
    `listen to ${profile.stage_name}`,
    `${profile.stage_name} playlist`,
    'Universflow artist',
    'free music streaming',
    ...topTitles.slice(0, 3).map((t) => `${profile.stage_name} ${t}`),
  ].join(', ');

  const socialSameAs = [
    ig,
    yt,
    safeHttpHref(profile.social_links?.spotify),
    safeHttpHref(profile.social_links?.website),
  ].filter(Boolean) as string[];

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'MusicGroup',
    '@id': canonicalUrl,
    name: profile.stage_name,
    url: canonicalUrl,
    image: shareImage,
    ...(profile.avatar_url ? { logo: profile.avatar_url } : {}),
    ...(profile.bio ? { description: profile.bio } : {}),
    ...(socialSameAs.length ? { sameAs: socialSameAs } : {}),
    ...(songs.length
      ? {
          track: songs.slice(0, 10).map((s) => ({
            '@type': 'MusicRecording',
            name: s.title,
            byArtist: { '@type': 'MusicGroup', name: profile.stage_name },
            ...(s.duration ? { duration: `PT${Math.floor(s.duration / 60)}M${Math.floor(s.duration % 60)}S` } : {}),
            ...(s.cover_url ? { image: s.cover_url } : {}),
          })),
        }
      : {}),
    interactionStatistic: [
      {
        '@type': 'InteractionCounter',
        interactionType: 'https://schema.org/FollowAction',
        userInteractionCount: followers,
      },
      {
        '@type': 'InteractionCounter',
        interactionType: 'https://schema.org/ListenAction',
        userInteractionCount: totalStreams,
      },
    ],
  } as Record<string, unknown>;

  return (
    <FadeTransition>
      <SEOHead
        title={seoTitle}
        description={seoDescription}
        keywords={seoKeywords}
        path={`/a/${profile.slug}`}
        url={canonicalUrl}
        image={shareImage}
        type="profile"
        jsonLd={jsonLd}
        jsonLdId={`artist-${profile.slug}-jsonld`}
      />


      <div
        ref={scrollRef}
        className="min-h-[100dvh] max-h-[100dvh] overflow-y-auto bg-[#060608] text-foreground pb-36 relative"
      >
        {/* === STICKY MINI HEADER === */}
        <motion.header
          style={{ opacity: titleOpacity }}
          className="fixed top-0 inset-x-0 z-30 bg-[#060608]/85 backdrop-blur-xl border-b border-white/5"
        >
          <div className="max-w-md mx-auto px-3 h-14 flex items-center gap-3">
            <button
              onClick={() => navigate(-1)}
              className="w-9 h-9 rounded-full grid place-items-center bg-white/[0.05] active:scale-95"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <p className="font-semibold text-[15px] tracking-tight truncate flex-1 flex items-center gap-1">
              {profile.stage_name}
              {profile.is_verified && <BadgeCheck className="w-4 h-4 text-white shrink-0" fill={accent} />}
            </p>
            <button
              onClick={() => playAll(false)}
              className="w-9 h-9 rounded-full grid place-items-center text-white active:scale-95"
              style={{ background: accent }}
              aria-label="Play all"
            >
              <Play className="w-4 h-4 ml-0.5" fill="currentColor" />
            </button>
          </div>
        </motion.header>

        {/* === CINEMATIC BANNER === */}
        <div className="relative h-[360px] overflow-hidden">
          <motion.div
            style={{ y: bannerY, scale: bannerScale }}
            className="absolute inset-0"
          >
            {profile.banner_url ? (
              <img src={profile.banner_url} alt="" className="w-full h-full object-cover" />
            ) : (
              <div
                className="w-full h-full"
                style={{ background: `linear-gradient(155deg, ${accent} 0%, #2A0712 50%, #0A0A0B 100%)` }}
              />
            )}
          </motion.div>
          {/* Editorial scrim */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                'linear-gradient(180deg, rgba(6,6,8,0.4) 0%, rgba(6,6,8,0.1) 35%, rgba(6,6,8,0.85) 80%, #060608 100%)',
            }}
          />

          {/* Back button */}
          <button
            onClick={() => navigate(-1)}
            className="absolute top-3 left-3 z-10 w-10 h-10 rounded-full grid place-items-center bg-black/40 backdrop-blur-md border border-white/15 active:scale-95"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <button
            onClick={sharePage}
            className="absolute top-3 right-3 z-10 w-10 h-10 rounded-full grid place-items-center bg-black/40 backdrop-blur-md border border-white/15 active:scale-95"
            aria-label="Share"
          >
            <Share2 className="w-4 h-4" />
          </button>

          {/* Bottom-anchored name block */}
          <div className="absolute inset-x-0 bottom-0 px-5 pb-5">
            <div className="max-w-md mx-auto">
              {profile.is_verified && (
                <div className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-black/50 backdrop-blur-sm border border-white/15">
                  <BadgeCheck className="w-3 h-3 text-white" fill={accent} />
                  <span className="text-[9.5px] uppercase tracking-[0.22em] font-semibold text-white/95">
                    Verified Artist
                  </span>
                </div>
              )}
              <h1
                className="mt-2 font-display text-white tracking-tight leading-[0.95]"
                style={{
                  fontSize: 'clamp(38px, 11vw, 52px)',
                  textShadow: '0 6px 32px rgba(0,0,0,0.6)',
                }}
              >
                {profile.stage_name}
              </h1>
              <p className="mt-2 text-[12px] text-white/85 tabular-nums">
                {fmt(monthly)} monthly listeners
              </p>
            </div>
          </div>
        </div>

        {/* === MAIN === */}
        <main className="max-w-md mx-auto px-5 -mt-4 relative z-10">

          {/* CTA row */}
          <div className="flex items-center gap-2.5">
            <Button
              className="h-12 px-5 rounded-full text-[13.5px] font-semibold text-white"
              style={{
                background: isFollowing ? 'rgba(255,255,255,0.08)' : accent,
                boxShadow: isFollowing ? 'none' : '0 14px 32px -8px rgba(255,45,85,0.55)',
                border: isFollowing ? '1px solid rgba(255,255,255,0.12)' : 'none',
              }}
              onClick={toggleFollow}
            >
              {isFollowing
                ? <><UserCheck className="w-4 h-4 mr-1.5" /> Following</>
                : <><UserPlus className="w-4 h-4 mr-1.5" /> Follow</>}
            </Button>
            <button
              onClick={() => playAll(false)}
              disabled={!songs.length}
              className="h-12 w-12 rounded-full grid place-items-center text-white active:scale-95 disabled:opacity-40"
              style={{ background: accent, boxShadow: '0 14px 32px -8px rgba(255,45,85,0.55)' }}
              aria-label="Play all"
            >
              <Play className="w-5 h-5 ml-0.5" fill="currentColor" />
            </button>
            <button
              onClick={() => playAll(true)}
              disabled={!songs.length}
              className="h-12 w-12 rounded-full grid place-items-center text-foreground active:scale-95 disabled:opacity-40"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}
              aria-label="Shuffle"
            >
              <Shuffle className="w-4 h-4" />
            </button>
          </div>

          {/* Stat strip */}
          <section className="mt-5 grid grid-cols-3 gap-2">
            <StatPill icon={<Headphones className="w-3 h-3" />} label="Streams" value={fmt(totalStreams)} />
            <StatPill icon={<Heart className="w-3 h-3" />} label="Followers" value={fmt(followers)} />
            <StatPill icon={<Globe2 className="w-3 h-3" />} label="Monthly" value={fmt(monthly)} />
          </section>

          {/* Genres */}
          {profile.genres && profile.genres.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {profile.genres.map((g) => (
                <span
                  key={g}
                  className="px-2.5 h-6 inline-flex items-center rounded-full text-[10.5px] font-semibold tracking-wide uppercase"
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}
                >
                  {g}
                </span>
              ))}
            </div>
          )}

          {/* Tagline */}
          {profile.tagline && (
            <p className="mt-4 text-[13.5px] text-white/85 italic font-display leading-snug">
              “{profile.tagline}”
            </p>
          )}

          {/* Artist Pick */}
          {pickSong && (
            <section className="mt-6">
              <div className="flex items-center gap-1.5 mb-2">
                <Star className="w-3.5 h-3.5 text-yellow-400" fill="currentColor" />
                <span className="text-[10.5px] uppercase tracking-[0.22em] font-semibold text-yellow-400">
                  Artist Pick
                </span>
              </div>
              <button
                onClick={() => playSong(pickSong)}
                className="w-full rounded-2xl overflow-hidden text-left relative group"
                style={{
                  background: `linear-gradient(140deg, ${accent}26, rgba(16,16,18,0.7))`,
                  border: `1px solid ${accent}40`,
                }}
              >
                <div className="flex items-center gap-3 p-3">
                  <div className="w-16 h-16 rounded-xl overflow-hidden bg-black/40 shrink-0 ring-1 ring-white/10">
                    {pickSong.cover_url
                      ? <img src={pickSong.cover_url} alt="" className="w-full h-full object-cover" />
                      : <div className="w-full h-full grid place-items-center"><Music2 className="w-5 h-5 text-muted-foreground" /></div>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[15px] font-semibold truncate">{pickSong.title}</p>
                    {profile.artist_pick_message && (
                      <p className="text-[12px] text-white/75 line-clamp-2 mt-0.5">
                        {profile.artist_pick_message}
                      </p>
                    )}
                  </div>
                  <div
                    className="w-10 h-10 rounded-full grid place-items-center shrink-0 text-white"
                    style={{ background: accent, boxShadow: `0 10px 24px -8px ${accent}88` }}
                  >
                    <Play className="w-4 h-4 ml-0.5" fill="currentColor" />
                  </div>
                </div>
              </button>
            </section>
          )}

          {popular.length > 0 && popular[0].play_count > 0 && (
            <section className="mt-7">
              <div className="flex items-baseline justify-between mb-3">
                <h2 className="font-display text-[18px] tracking-tight">Popular</h2>
                <span className="text-[10.5px] uppercase tracking-[0.18em] text-muted-foreground/70 font-semibold">
                  Top {popular.length}
                </span>
              </div>
              <div className="space-y-1.5">
                {popular.map((s, i) => (
                  <button
                    key={s.id}
                    onClick={() => playSong(s)}
                    className="w-full flex items-center gap-3 p-2 rounded-2xl hover:bg-white/[0.04] active:bg-white/[0.07] transition text-left group"
                  >
                    <span className="font-display text-[22px] w-7 text-center tabular-nums text-muted-foreground/60 group-hover:text-foreground transition">
                      {i + 1}
                    </span>
                    <div className="w-14 h-14 rounded-xl overflow-hidden bg-black/40 shrink-0 ring-1 ring-white/10 relative">
                      {s.cover_url
                        ? <img src={s.cover_url} alt="" className="w-full h-full object-cover" />
                        : <div className="w-full h-full grid place-items-center"><Music2 className="w-5 h-5 text-muted-foreground" /></div>}
                      <span className="absolute inset-0 grid place-items-center opacity-0 group-hover:opacity-100 transition bg-black/45">
                        <Play className="w-4 h-4 text-white" fill="currentColor" />
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-medium truncate">{s.title}</p>
                      <p className="text-[11.5px] text-muted-foreground tabular-nums mt-0.5">
                        {fmt(s.play_count)} plays
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Discography (full list) */}
          <section className="mt-7">
            <h2 className="font-display text-[18px] tracking-tight mb-3">Discography</h2>
            {songs.length === 0 ? (
              <p className="text-[13px] text-muted-foreground py-8 text-center">
                No songs yet — check back soon.
              </p>
            ) : (
              <ul className="divide-y divide-white/[0.05] rounded-2xl overflow-hidden border border-white/[0.05] bg-white/[0.02]">
                {songs.map((s, i) => (
                  <li key={s.id}>
                    <button
                      onClick={() => playSong(s)}
                      className="w-full flex items-center gap-3 p-3 hover:bg-white/[0.03] active:bg-white/[0.05] transition text-left group"
                    >
                      <span className="w-5 text-[11px] font-semibold tabular-nums text-muted-foreground/60 text-right group-hover:hidden">
                        {i + 1}
                      </span>
                      <span className="w-5 hidden group-hover:grid place-items-center text-primary">
                        <Play className="w-3 h-3" fill="currentColor" />
                      </span>
                      <div className="w-10 h-10 rounded-lg overflow-hidden bg-black/40 shrink-0 ring-1 ring-white/10">
                        {s.cover_url
                          ? <img src={s.cover_url} alt="" className="w-full h-full object-cover" />
                          : <div className="w-full h-full grid place-items-center"><Music2 className="w-4 h-4 text-muted-foreground" /></div>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13.5px] font-medium truncate">{s.title}</p>
                        <p className="text-[11px] text-muted-foreground tabular-nums mt-0.5 flex items-center gap-2">
                          <span className="inline-flex items-center gap-1"><Play className="w-2.5 h-2.5" />{fmt(s.play_count)}</span>
                          <span className="inline-flex items-center gap-1"><Heart className="w-2.5 h-2.5" />{fmt(s.like_count)}</span>
                        </p>
                      </div>
                      <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">{dur(s.duration)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Gallery */}
          {gallery.length > 0 && (
            <section className="mt-8">
              <div className="flex items-center gap-1.5 mb-3">
                <Camera className="w-3.5 h-3.5 text-muted-foreground" />
                <h2 className="font-display text-[18px] tracking-tight">Gallery</h2>
              </div>
              <div className="flex gap-2 overflow-x-auto -mx-5 px-5 pb-1 snap-x snap-mandatory scrollbar-none">
                {gallery.map((url, i) => (
                  <div
                    key={url + i}
                    className="w-40 h-52 rounded-2xl overflow-hidden shrink-0 ring-1 ring-white/10 snap-start bg-black/40"
                  >
                    <img
                      src={url}
                      alt=""
                      loading="lazy"
                      className="w-full h-full object-cover"
                    />
                  </div>
                ))}
              </div>
            </section>
          )}


          {/* About */}
          {(profile.bio || ig || yt) && (
            <section className="mt-8">
              <h2 className="font-display text-[18px] tracking-tight mb-3">About</h2>
              <div
                className="rounded-3xl p-5 relative overflow-hidden"
                style={{
                  background: 'rgba(16,16,18,0.78)',
                  border: '0.5px solid rgba(255,255,255,0.06)',
                  boxShadow: '0 18px 50px rgba(0,0,0,0.45)',
                }}
              >
                <span
                  aria-hidden
                  className="pointer-events-none absolute -top-16 -right-16 w-56 h-56 rounded-full opacity-50"
                  style={{ background: `radial-gradient(closest-side, ${accent}55, transparent 70%)` }}
                />
                <div className="relative">
                  <div className="flex items-center gap-3">
                    <div className="w-14 h-14 rounded-2xl overflow-hidden bg-black/40 shrink-0 ring-1 ring-white/10">
                      {profile.avatar_url
                        ? <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
                        : <div className="w-full h-full grid place-items-center"><Music2 className="w-5 h-5 text-muted-foreground" /></div>}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground/80 font-semibold">
                        The artist
                      </p>
                      <p className="font-display text-[18px] truncate flex items-center gap-1">
                        {profile.stage_name}
                        {profile.is_verified && <BadgeCheck className="w-4 h-4 text-white" fill={accent} />}
                      </p>
                    </div>
                  </div>
                  {profile.bio && (
                    <p className="mt-4 text-[13.5px] leading-relaxed text-foreground/85 font-display italic">
                      "{profile.bio}"
                    </p>
                  )}
                  {(ig || yt) && (
                    <div className="mt-4 flex items-center gap-2">
                      {ig && (
                        <a
                          href={ig} target="_blank" rel="noreferrer"
                          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full text-[12px] font-medium bg-white/[0.05] hover:bg-white/[0.08] transition"
                        >
                          <Instagram className="w-3.5 h-3.5" /> Instagram
                        </a>
                      )}
                      {yt && (
                        <a
                          href={yt} target="_blank" rel="noreferrer"
                          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full text-[12px] font-medium bg-white/[0.05] hover:bg-white/[0.08] transition"
                        >
                          <Youtube className="w-3.5 h-3.5" /> YouTube
                        </a>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* Footer mark */}
          <p className="mt-10 text-center text-[10px] tracking-[0.28em] uppercase text-muted-foreground/45 font-semibold">
            Universflow · for Artists
          </p>
        </main>
      </div>
    </FadeTransition>
  );
}

function StatPill({
  icon, label, value,
}: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div
      className="rounded-2xl p-3 flex flex-col gap-1"
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '0.5px solid rgba(255,255,255,0.06)',
      }}
    >
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground/80 font-semibold">
        {icon}{label}
      </div>
      <p className="font-display text-[18px] tabular-nums leading-none">{value}</p>
    </div>
  );
}
