import { memo, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Music2 } from 'lucide-react';
import { Song, usePlayer } from '@/contexts/PlayerContext';
import { useDownloads } from '@/contexts/DownloadContext';
import { useAuth } from '@/contexts/AuthContext';
import { getUserArtistPrefs } from '@/lib/userArtistPrefs';
import { getArtistTopTracksByName } from '@/lib/musicIndexer';
import { supabase } from '@/integrations/supabase/client';
import { triggerHaptic } from '@/hooks/useHaptics';
import { isSpamSong } from '@/pages/Search';

interface Props { songs: Song[] }

const normalize = (value?: string | null) => value?.trim().toLowerCase() || '';

type SongRowWithArtist = {
  id: string;
  title: string;
  artist: string;
  album?: string | null;
  cover_url?: string | null;
  audio_url: string;
  duration?: number | null;
  artist_id?: string | null;
  genre?: string | null;
  mood?: string | null;
  created_at?: string | null;
  artists?: { id: string; name: string; photo_url: string | null } | null;
};

const toCatalogSong = (row: SongRowWithArtist): Song => {
  const artistData = row.artists;
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    album: row.album || undefined,
    cover_url: row.cover_url || undefined,
    audio_url: row.audio_url,
    duration: row.duration || undefined,
    artist_id: artistData?.id || row.artist_id || undefined,
    artist_photo_url: artistData?.photo_url || undefined,
    genre: row.genre || undefined,
    mood: row.mood || undefined,
    created_at: row.created_at || undefined,
    source: 'library',
  };
};

const dedupeSongs = (songs: Song[]) => {
  const seenKey = new Set<string>();
  const coverCount = new Map<string, number>();
  return songs.filter((song) => {
    const key = `${normalize(song.artist)}::${normalize(song.title)}`;
    if (!key.trim() || seenKey.has(key) || isSpamSong(song)) return false;
    // Limit same-cover repeats to 1 per artist so albums don't visually clone tiles.
    const coverKey = `${normalize(song.artist)}::${song.cover_url || ''}`;
    const count = coverCount.get(coverKey) || 0;
    if (song.cover_url && count >= 1) return false;
    coverCount.set(coverKey, count + 1);
    seenKey.add(key);
    return true;
  });
};

const fetchFollowedArtistSongs = async (userId: string, seedSongs: Song[] = []) => {
  const prefs = await getUserArtistPrefs(userId, true);
  const followedNames = [...new Set(prefs.map((pref) => pref.artist_name).filter(Boolean))];
  const followed = new Set(followedNames.map(normalize));
  if (!followed.size) return [];

  const seedMatches = seedSongs.filter((song) => followed.has(normalize(song.artist)));
  const [{ data: catalog, error }, fallbackGroups] = await Promise.all([
    supabase
      .from('songs')
      .select('*, artists(id, name, photo_url)')
      .eq('is_visible', true)
      .order('created_at', { ascending: false })
      .limit(500),
    // Pull more per artist (20) across more artists (16) so the rail feels rich and varied.
    Promise.all(followedNames.slice(0, 16).map((artist) => getArtistTopTracksByName(artist, 20).catch(() => []))),
  ]);

  if (error) console.warn('Failed to load followed-artist catalog songs:', error);

  const catalogMatches = ((catalog || []) as SongRowWithArtist[])
    .map(toCatalogSong)
    .filter((song) => followed.has(normalize(song.artist)));

  const fallbackSongs = fallbackGroups.flat().map((track): Song => ({
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    cover_url: track.cover_url,
    audio_url: track.audio_url || 'resolving',
    duration: track.duration,
    source: 'indexed',
  }));

  // Interleave artists round-robin so the rail isn't dominated by a single artist's album.
  const byArtist = new Map<string, Song[]>();
  for (const song of [...seedMatches, ...catalogMatches, ...fallbackSongs]) {
    const k = normalize(song.artist);
    if (!byArtist.has(k)) byArtist.set(k, []);
    byArtist.get(k)!.push(song);
  }
  const interleaved: Song[] = [];
  let added = true;
  while (added) {
    added = false;
    for (const list of byArtist.values()) {
      const next = list.shift();
      if (next) { interleaved.push(next); added = true; }
    }
  }

  return dedupeSongs(interleaved).slice(0, 60);
};

const FollowedArtistSongsSection = memo(function FollowedArtistSongsSection({ songs }: Props) {
  const { user } = useAuth();
  const userId = user?.id;
  const { currentSong, isPlaying, playSong, togglePlay } = usePlayer();
  const { getDownloadedUrl } = useDownloads();
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ['followed-artist-songs-v2', userId] as const, [userId]);

  useEffect(() => {
    if (!userId) return;
    const refresh = () => queryClient.invalidateQueries({ queryKey });
    const onVisibility = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('uf:artist-prefs-changed', refresh);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('uf:artist-prefs-changed', refresh);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [userId, queryClient, queryKey]);

  const { data: followedSongs = [] } = useQuery({
    queryKey,
    queryFn: () => fetchFollowedArtistSongs(userId!, songs),
    enabled: !!userId,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnReconnect: true,
  });

  if (!user || followedSongs.length === 0) return null;

  return (
    <section className="mb-2 pt-4">
      <div className="flex items-end justify-between mb-3 px-1">
        <div>
          <h2 className="font-display text-2xl tracking-[0.06em] uppercase text-foreground">From Your Artists</h2>
          <p className="text-[11px] text-muted-foreground/55 font-semibold mt-0.5">New music from people you follow</p>
        </div>
      </div>

      <div className="flex gap-3 overflow-x-auto hide-scrollbar pb-2 px-1">
        {followedSongs.map((song, idx) => {
          const active = currentSong?.id === song.id;
          return (
            <button
              key={song.id}
              type="button"
              onClick={() => {
                triggerHaptic('impactLight');
                if (active) togglePlay();
                else playSong(song, getDownloadedUrl(song.id), followedSongs);
              }}
              className="w-32 flex-shrink-0 text-left active:scale-[0.97] transition-transform"
            >
              <div className="mb-2.5 aspect-square overflow-hidden bg-muted/40 ring-1 ring-white/10 relative rounded-2xl">
                {song.cover_url ? (
                  <img src={song.cover_url} alt={`${song.title} cover art`} className="h-full w-full object-cover transition-all duration-300" loading={idx < 3 ? 'eager' : 'lazy'} decoding="async" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center"><Music2 className="w-7 h-7 text-muted-foreground" /></div>
                )}
                {idx === 0 && <div className="absolute top-2 left-2 rounded-full bg-primary text-primary-foreground px-1.5 py-0.5 text-[8px] font-black uppercase tracking-[0.15em]">New</div>}
                {active && <div className="absolute bottom-1.5 right-1.5 rounded-full bg-primary text-primary-foreground px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider">{isPlaying ? '▶ Live' : 'Ⅱ'}</div>}
              </div>
              <p className={`text-[12px] font-bold leading-tight truncate ${active ? 'text-primary' : 'text-foreground'}`}>{song.title}</p>
              <p className="mt-1 truncate text-[10.5px] text-muted-foreground/70 font-semibold">{song.artist}</p>
            </button>
          );
        })}
      </div>
    </section>
  );
});

export default FollowedArtistSongsSection;