import { supabase } from '@/integrations/supabase/client';
import type { Song } from '@/contexts/PlayerContext';
import { isCatalogSongId } from '@/lib/songSupport';

export interface PlaylistSongRow {
  id: string;
  song_id: string;
  position: number;
  track_source?: string;
}

export interface LibrarySongRow {
  id: string;
  song_id: string;
  added_at?: string;
  track_source?: string;
}

interface CatalogSongRow {
  id: string;
  title: string;
  artist: string;
  album?: string | null;
  cover_url?: string | null;
  audio_url: string;
  duration?: number | null;
  artist_id?: string | null;
  artist_image_url?: string | null;
}

interface StreamSongRow {
  track_id: string;
  title: string;
  artist: string;
  album?: string | null;
  cover_url?: string | null;
  audio_url?: string | null;
  duration?: number | null;
  artist_image_url?: string | null;
  source?: string | null;
}

interface PlaylistSongRefRow {
  id?: string;
  playlist_id?: string;
  song_id: string;
  position?: number;
  track_source?: string | null;
}

const songFromCatalog = (song: CatalogSongRow): Song => ({
  id: song.id,
  title: song.title,
  artist: song.artist,
  album: song.album || undefined,
  cover_url: song.cover_url || undefined,
  audio_url: song.audio_url,
  duration: song.duration || undefined,
  artist_id: song.artist_id || undefined,
  artist_photo_url: song.artist_image_url || undefined,
  source: 'library',
});

const songFromStream = (song: StreamSongRow): Song => ({
  id: song.track_id,
  title: song.title,
  artist: song.artist,
  album: song.album || undefined,
  cover_url: song.cover_url || undefined,
  audio_url: song.audio_url || 'resolving',
  duration: song.duration || undefined,
  artist_photo_url: song.artist_image_url || undefined,
  source: song.source === 'audius' ? 'audius' : 'indexed',
});

export const getTrackSource = (song: Pick<Song, 'id' | 'source'>) => {
  if (song.source) return song.source;
  return isCatalogSongId(song.id) ? 'library' : 'indexed';
};

// Coalesced, batched upsert queue for stream_songs metadata.
// Rationale: previously every play upserted a row with an ephemeral (signed)
// audio_url, causing 8k+ writes and up to 7s tail latency on the DB. We now:
//   1) skip if same track was persisted in the last 30 min
//   2) NEVER write the ephemeral audio_url (that lives in stream_url_cache)
//   3) flush queued writes in a single batched upsert every 1s
const _persistedRecently = new Map<string, number>();
const _pendingUpserts = new Map<string, Record<string, unknown>>();
let _flushTimer: ReturnType<typeof setTimeout> | null = null;

const flushStreamSongUpserts = async () => {
  _flushTimer = null;
  if (_pendingUpserts.size === 0) return;
  const rows = Array.from(_pendingUpserts.values());
  _pendingUpserts.clear();
  try {
    await supabase.from('stream_songs').upsert(rows, { onConflict: 'track_id' });
  } catch {
    // best-effort metadata write
  }
};

export const persistStreamSong = async (song: Song) => {
  if (!song?.id || isCatalogSongId(song.id)) return;
  const now = Date.now();
  const last = _persistedRecently.get(song.id) ?? 0;
  if (now - last < 30 * 60 * 1000) return; // 30-min dedup (was 5)
  _persistedRecently.set(song.id, now);
  if (_persistedRecently.size > 1000) {
    const cutoff = now - 60 * 60 * 1000;
    for (const [k, t] of _persistedRecently) if (t < cutoff) _persistedRecently.delete(k);
  }

  _pendingUpserts.set(song.id, {
    track_id: song.id,
    source: getTrackSource(song),
    title: song.title,
    artist: song.artist,
    album: song.album ?? null,
    cover_url: song.cover_url ?? null,
    // audio_url intentionally omitted — it's an expiring signed URL and
    // belongs in stream_url_cache, not this metadata row.
    duration: song.duration ?? null,
    artist_image_url: song.artist_photo_url ?? null,
    metadata: {},
    last_seen_at: new Date().toISOString(),
  });

  if (!_flushTimer) {
    _flushTimer = setTimeout(flushStreamSongUpserts, 1000);
  }
};


export const loadLibrarySongs = async (userId: string) => {
  const { data: rows, error } = await supabase
    .from('user_library')
    .select('id, song_id, added_at, track_source')
    .eq('user_id', userId)
    .order('added_at', { ascending: false });

  if (error || !rows?.length) return [];

  const catalogIds = rows
    .filter((row) => row.track_source === 'library' || isCatalogSongId(row.song_id))
    .map((row) => row.song_id);
  const streamIds = rows
    .filter((row) => row.track_source !== 'library' && !isCatalogSongId(row.song_id))
    .map((row) => row.song_id);

  const [catalogRes, streamRes] = await Promise.all([
    catalogIds.length
      ? supabase.from('songs').select('id, title, artist, album, cover_url, audio_url, duration, artist_id, artists(photo_url)').in('id', catalogIds)
      : Promise.resolve({ data: [] as any[] }),
    streamIds.length
      ? supabase.from('stream_songs').select('*').in('track_id', streamIds)
      : Promise.resolve({ data: [] as StreamSongRow[] }),
  ]);

  const catalogMap = new Map(
    ((catalogRes.data || []) as any[]).map((song) => [
      song.id,
      songFromCatalog({
        ...song,
        artist_image_url: song.artists?.photo_url ?? null,
      } as CatalogSongRow),
    ]),
  );
  const streamMap = new Map(
    ((streamRes.data || []) as StreamSongRow[]).map((song) => [song.track_id, songFromStream(song)]),
  );

  return rows
    .map((row) => catalogMap.get(row.song_id) || streamMap.get(row.song_id))
    .filter(Boolean) as Song[];
};

export const hydratePlaylistCoverUrls = async <T extends { id: string; cover_url?: string | null }>(playlists: T[]): Promise<T[]> => {
  const ids = playlists.map((playlist) => playlist.id);
  if (ids.length === 0) return playlists;

  const { data: rows } = await supabase
    .from('playlist_songs')
    .select('playlist_id, song_id, position, track_source')
    .in('playlist_id', ids)
    .order('position', { ascending: true });

  if (!rows?.length) return playlists;

  const typedRows = rows as PlaylistSongRefRow[];

  const catalogIds = typedRows
    .filter((row) => row.track_source === 'library' || isCatalogSongId(row.song_id))
    .map((row) => row.song_id);
  const streamIds = typedRows
    .filter((row) => row.track_source !== 'library' && !isCatalogSongId(row.song_id))
    .map((row) => row.song_id);

  const [catalogRes, streamRes] = await Promise.all([
    catalogIds.length
      ? supabase.from('songs').select('id, cover_url').in('id', catalogIds)
      : Promise.resolve({ data: [] as Pick<CatalogSongRow, 'id' | 'cover_url'>[] }),
    streamIds.length
      ? supabase.from('stream_songs').select('track_id, cover_url').in('track_id', streamIds)
      : Promise.resolve({ data: [] as Pick<StreamSongRow, 'track_id' | 'cover_url'>[] }),
  ]);

  const coverBySongId = new Map<string, string>();
  ((catalogRes.data || []) as Pick<CatalogSongRow, 'id' | 'cover_url'>[]).forEach((song) => { if (song.cover_url) coverBySongId.set(song.id, song.cover_url); });
  ((streamRes.data || []) as Pick<StreamSongRow, 'track_id' | 'cover_url'>[]).forEach((song) => { if (song.cover_url) coverBySongId.set(song.track_id, song.cover_url); });

  // Collect up to 3 distinct artworks per playlist (in song order) for stacked cover
  const coversByPlaylistId = new Map<string, string[]>();
  typedRows.forEach((row) => {
    const cover = coverBySongId.get(row.song_id);
    if (!cover || !row.playlist_id) return;
    const list = coversByPlaylistId.get(row.playlist_id) || [];
    if (list.length >= 3 || list.includes(cover)) return;
    list.push(cover);
    coversByPlaylistId.set(row.playlist_id, list);
  });

  return playlists.map((playlist) => {
    const stack = coversByPlaylistId.get(playlist.id) || [];
    return {
      ...playlist,
      cover_url: playlist.cover_url || stack[0] || null,
      cover_urls: stack,
    } as T & { cover_urls: string[] };
  });
};

export const loadPlaylistSongs = async (playlistId: string) => {
  const { data: rows, error } = await supabase
    .from('playlist_songs')
    .select('id, song_id, position, track_source')
    .eq('playlist_id', playlistId)
    .order('position', { ascending: true });

  if (error || !rows?.length) return [];

  const typedRows = rows as PlaylistSongRefRow[];

  const catalogIds = typedRows
    .filter((row) => row.track_source === 'library' || isCatalogSongId(row.song_id))
    .map((row) => row.song_id);
  const streamIds = typedRows
    .filter((row) => row.track_source !== 'library' && !isCatalogSongId(row.song_id))
    .map((row) => row.song_id);

  const [catalogRes, streamRes] = await Promise.all([
    catalogIds.length
      ? supabase.from('songs').select('*').in('id', catalogIds)
      : Promise.resolve({ data: [] as CatalogSongRow[] }),
    streamIds.length
      ? supabase.from('stream_songs').select('*').in('track_id', streamIds)
      : Promise.resolve({ data: [] as StreamSongRow[] }),
  ]);

  const catalogMap = new Map(((catalogRes.data || []) as CatalogSongRow[]).map((song) => [song.id, songFromCatalog(song)]));
  const streamMap = new Map(((streamRes.data || []) as StreamSongRow[]).map((song) => [song.track_id, songFromStream(song)]));

  return typedRows
    .map((row) => {
      const song = (row.track_source === 'library' || isCatalogSongId(row.song_id))
        ? catalogMap.get(row.song_id)
        : streamMap.get(row.song_id);
      if (!song) return null;
      return { ...song, position: row.position, playlist_song_id: row.id };
    })
    .filter(Boolean);
};
