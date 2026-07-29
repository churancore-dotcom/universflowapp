import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from '@/lib/router-compat';
import { Loader2, Music2, Disc3 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { usePlayer, Song } from '@/contexts/PlayerContext';
import { useAuth } from '@/contexts/AuthContext';
import { getUserArtistPrefs } from '@/lib/userArtistPrefs';
import { prefetchIndexedTrack, resolveIndexedTrack, getArtistTopTracksByName, type IndexedTrack } from '@/lib/musicIndexer';
import { supabase } from '@/integrations/supabase/client';

/**
 * Top 30 from the user's followed artists.
 * (Renamed from "Global Top 30" — same component name kept to avoid churn.)
 */
const GlobalTopTracksSection = () => {
  const { user } = useAuth();
  const { playSong, currentSong } = usePlayer();
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  // Cached across Home revisits — only refetches every 10 min.
  const { data, isLoading: loading } = useQuery({
    queryKey: ['top30-followed', user?.id ?? 'anon'],
    enabled: !!user,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    queryFn: async () => {
      const prefs = await getUserArtistPrefs(user!.id);
      const names = prefs.map(p => p.artist_name).filter(Boolean);
      if (names.length === 0) return { tracks: [] as IndexedTrack[], followedCount: 0 };

      const { data: rows } = await supabase
        .from('stream_songs')
        .select('track_id, title, artist, album, cover_url, duration')
        .in('artist', names)
        .order('last_seen_at', { ascending: false })
        .limit(30);

      const seen = new Set<string>();
      const mapped: IndexedTrack[] = [];
      for (const r of (rows || [])) {
        const key = `${(r.artist || '').toLowerCase()}::${(r.title || '').toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        mapped.push({
          id: r.track_id, title: r.title, artist: r.artist,
          album: r.album ?? undefined, cover_url: r.cover_url ?? undefined,
          duration: r.duration ?? undefined,
        });
      }

      if (mapped.length < 30) {
        const perArtist = Math.max(2, Math.ceil((30 - mapped.length) / Math.max(1, names.length)));
        const lists = await Promise.all(
          names.slice(0, 12).map((n) => getArtistTopTracksByName(n, perArtist).catch(() => [] as IndexedTrack[]))
        );
        for (const list of lists) {
          for (const t of list) {
            const key = `${(t.artist || '').toLowerCase()}::${(t.title || '').toLowerCase()}`;
            if (seen.has(key)) continue;
            seen.add(key);
            mapped.push(t);
            if (mapped.length >= 30) break;
          }
          if (mapped.length >= 30) break;
        }
      }

      // Only surface tracks with real cover art — no placeholder icons.
      return { tracks: mapped.filter((t) => !!t.cover_url), followedCount: prefs.length };
    },
  });

  const tracks = useMemo(() => data?.tracks ?? [], [data?.tracks]);
  const followedCount = data?.followedCount ?? 0;

  useEffect(() => {
    tracks.slice(0, 8).forEach(t => prefetchIndexedTrack(t.artist, t.title));
  }, [tracks]);

  const handlePlay = useCallback(async (track: IndexedTrack) => {
    setResolvingId(track.id);
    try {
      const resolved = await resolveIndexedTrack(track.artist, track.title).catch(() => null);
      const song: Song = {
        id: track.id,
        title: resolved?.title || track.title,
        artist: resolved?.artist || track.artist,
        album: track.album,
        cover_url: resolved?.cover_url || track.cover_url,
        audio_url: resolved?.streamUrl || 'resolving',
        duration: resolved?.duration || track.duration,
        source: 'indexed',
      };
      const queue: Song[] = tracks.map(t => ({
        id: t.id, title: t.title, artist: t.artist, album: t.album,
        cover_url: t.cover_url, audio_url: t.id === track.id ? song.audio_url : 'resolving', source: 'indexed' as const,
      }));
      playSong(song, undefined, queue);
    } finally {
      setResolvingId(null);
    }
  }, [playSong, tracks]);

  // No followed artists yet → soft CTA
  if (!loading && followedCount === 0) {
    return (
      <section className="space-y-3">
        <div className="flex items-center gap-2 px-1">
          <Disc3 className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-bold text-foreground">Top 30 from Your Artists</h2>
        </div>
        <div className="rounded-3xl border border-border/50 bg-card/50 p-5 text-center">
          <p className="text-sm text-foreground/90 font-semibold mb-1">Follow artists to unlock this rail</p>
          <p className="text-xs text-muted-foreground mb-3">We'll surface their hottest tracks here.</p>
          <Link to="/artists" className="inline-block px-4 py-2 rounded-full text-xs font-bold bg-primary text-primary-foreground">Discover artists</Link>
        </div>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="space-y-3">
        <div className="flex items-center gap-2 px-1">
          <Disc3 className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-bold text-foreground">Top 30 from Your Artists</h2>
        </div>
        <div className="flex gap-3 overflow-x-auto hide-scrollbar pb-1">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="w-40 flex-shrink-0 rounded-3xl border border-border/50 bg-card/60 p-3 animate-pulse">
              <div className="mb-3 aspect-square rounded-3xl bg-muted/60" />
              <div className="h-3 rounded bg-muted/60 mb-2" />
              <div className="h-3 w-2/3 rounded bg-muted/40" />
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (tracks.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <Disc3 className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-bold text-foreground">Top 30 from Your Artists</h2>
        </div>
      </div>

      <div className="flex gap-3 overflow-x-auto hide-scrollbar pb-1">
        {tracks.map((track) => {
          const isActive = currentSong?.id === track.id;
          const isResolving = resolvingId === track.id;
          return (
            <button
              key={track.id}
              type="button"
              onClick={() => !isResolving && handlePlay(track)}
              className="w-40 flex-shrink-0 rounded-3xl border border-border/50 bg-card/70 p-3 text-left transition-transform active:scale-[0.98]"
            >
              <div className="relative mb-3 aspect-square overflow-hidden rounded-3xl bg-muted/50">
                <img src={track.cover_url!} alt={`${track.title} cover art`} className="h-full w-full object-cover" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                {isResolving && (
                  <div className="absolute bottom-2 right-2 rounded-full border border-border/60 bg-background/85 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                    <Loader2 className="w-3 h-3 animate-spin" />
                  </div>
                )}
              </div>
              <p className={`truncate text-[13px] font-semibold ${isActive ? 'text-primary' : 'text-foreground'}`}>{track.title}</p>
              <p className="mt-1 truncate text-[11px] text-muted-foreground">{track.artist}</p>
            </button>
          );
        })}
      </div>
    </section>
  );
};

export default GlobalTopTracksSection;
