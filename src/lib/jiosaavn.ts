import type { IndexedTrack } from './musicIndexer';

const API = 'https://jiosaavn-api.universflow.workers.dev';

interface SaavnImage {
  url?: string;
  link?: string;
}

interface SaavnDownloadUrl {
  quality?: string;
  url?: string;
  link?: string;
}

interface SaavnSong {
  id?: string;
  name?: string;
  title?: string;
  image?: string | SaavnImage[];
  downloadUrl?: string | SaavnDownloadUrl[];
  artists?: { primary?: Array<{ name?: string }> };
  primaryArtists?: string;
  artist?: string;
  album?: { name?: string } | string;
  duration?: number | string;
  playCount?: number | string;
}

interface SaavnStreamResult {
  streamUrl: string;
  id?: string;
  title: string;
  artist: string;
  album: string;
  duration?: number | string;
  image?: string;
}

const cache = new Map<string, SaavnStreamResult>();
const SEARCH_TIMEOUT_MS = 8000;

async function fetchJson(url: string): Promise<unknown | null> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    return await res.json();
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export async function searchSongs(query: string, limit = 20): Promise<SaavnSong[]> {
  try {
    const data = await fetchJson(`${API}/api/search/songs?query=${encodeURIComponent(query)}&limit=${limit}`) as { data?: { results?: SaavnSong[] } } | null;
    return Array.isArray(data?.data?.results) ? data.data.results : [];
  } catch {
    return [];
  }
}

function decodeEntities(value = ''): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function bestImage(images: SaavnSong['image']): string | undefined {
  if (!images) return undefined;
  if (typeof images === 'string') return images;
  if (Array.isArray(images)) {
    const last = images[images.length - 1];
    return last?.url || last?.link;
  }
  return undefined;
}

function bestAudio(downloadUrl: SaavnSong['downloadUrl']): string | undefined {
  if (!downloadUrl) return undefined;
  if (typeof downloadUrl === 'string') return downloadUrl;
  if (Array.isArray(downloadUrl)) {
    const hi = downloadUrl.find((u) => u.quality === '320kbps')
      || downloadUrl.find((u) => u.quality === '160kbps')
      || downloadUrl[downloadUrl.length - 1];
    return hi?.url || hi?.link;
  }
  return undefined;
}

function primaryArtists(song: SaavnSong): string {
  const primary = song?.artists?.primary;
  if (Array.isArray(primary) && primary.length) {
    return primary.map((a) => a.name).filter(Boolean).join(', ');
  }
  if (typeof song?.primaryArtists === 'string') return song.primaryArtists;
  return song?.artist || '';
}

function albumName(album: SaavnSong['album']): string {
  if (!album) return '';
  return typeof album === 'string' ? album : album.name || '';
}

const clean = (value = '') => decodeEntities(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const SPAM_TRACK_PATTERNS = [
  /\b(top|best)\s*\d+\b/i,
  /\b\d+\s*(top|best|hit|hits|songs)\b/i,
  /\b(non\s*stop|jukebox|mashup|medley|playlist|compilation|collection|mixtape|full\s*album|all\s*songs)\b/i,
  /\b(sped\s*up|slowed(\s*\+?\s*reverb)?|nightcore|8\s*d|bass\s*boost(ed)?|reverb(ed)?)\b/i,
  /\b(karaoke|instrumental|backing\s*track|cover(\s*by)?|unofficial|tribute|ai\s*cover|ai\s*voice)\b/i,
  /\b(lyric\s*video|with\s*lyrics?|tutorial|reaction|whatsapp\s*status|ringtone|bgm|loop(ed)?|tiktok\s*version|reels?\s*version|shorts?)\b/i,
  /\b\d+\s*(hour|hours|hr|hrs|minute|minutes|min)\b/i,
  /\b(dj\s*remix|club\s*mix|extended\s*mix|edm\s*remix|trap\s*remix|phonk\s*remix)\b/i,
];

function numericPlayCount(value: SaavnSong['playCount']): number | undefined {
  const n = typeof value === 'number' ? value : Number(String(value || '').replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function looksSpammy(song: SaavnSong): boolean {
  const haystack = `${song.name || song.title || ''} ${primaryArtists(song)} ${albumName(song.album)}`;
  const duration = typeof song.duration === 'number' ? song.duration : Number(song.duration) || 0;
  if (duration && (duration < 75 || duration > 540)) return true;
  if (/\boriginals?\b/i.test(primaryArtists(song))) return true;
  return SPAM_TRACK_PATTERNS.some((pattern) => pattern.test(haystack));
}

function scoreSong(song: SaavnSong, title: string, artist = ''): number {
  const songTitle = clean(song?.name || song?.title || '');
  const songArtist = clean(primaryArtists(song));
  const wantedTitle = clean(title);
  const wantedArtist = clean(artist);
  const titleScore = songTitle === wantedTitle
    ? 100
    : songTitle.includes(wantedTitle) || wantedTitle.includes(songTitle)
      ? 65
      : 0;
  const artistScore = wantedArtist && songArtist.includes(wantedArtist) ? 35 : 0;
  return titleScore + artistScore + Math.min(20, Math.log10(Math.max(1, Number(song?.playCount) || 1)) * 4);
}

function isConfidentMatch(song: SaavnSong, title: string, artist = ''): boolean {
  const songTitle = clean(song?.name || song?.title || '');
  const songArtist = clean(primaryArtists(song));
  const wantedTitle = clean(title);
  const wantedArtist = clean(artist);

  if (!songTitle || !wantedTitle) return false;
  const titleMatches = songTitle === wantedTitle || songTitle.includes(wantedTitle) || wantedTitle.includes(songTitle);
  if (!titleMatches) return false;

  // Loosened: prefer instant CORS-clean JioSaavn CDN playback over a YouTube
  // fallback that will hit IP-blocked edge functions on web. If artists don't
  // overlap, still accept an exact title match. Otherwise a low score (>=45)
  // is enough — we would rather stream a plausible match instantly than stall.
  if (wantedArtist && songArtist && !songArtist.includes(wantedArtist)
      && !wantedArtist.split(' ').some((tok) => tok.length > 2 && songArtist.includes(tok))) {
    return songTitle === wantedTitle;
  }

  return scoreSong(song, title, artist) >= 45;
}

/**
 * Search JioSaavn and return results in IndexedTrack shape so the existing
 * Search UI and ranking code can consume them unchanged.
 */
export async function searchSongsAsTracks(query: string, limit = 30): Promise<IndexedTrack[]> {
  const results = await searchSongs(query, limit);
  return (results || [])
    .filter((song) => !looksSpammy(song))
    .map((song): IndexedTrack | null => {
      if (!song?.id) return null;
      const audio = bestAudio(song.downloadUrl);
      return {
        id: `saavn-${song.id}`,
        title: decodeEntities(song.name || song.title || ''),
        artist: decodeEntities(primaryArtists(song)),
        album: decodeEntities(albumName(song.album)),
        cover_url: bestImage(song.image),
        duration: typeof song.duration === 'number' ? song.duration : Number(song.duration) || undefined,
        audio_url: audio || 'resolving',
        listeners: numericPlayCount(song.playCount),
      };
    })
    .filter((t): t is IndexedTrack => !!t && !!t.title && !!t.artist);
}

export async function getSongStreamUrl(songId: string, opts: { forceRefresh?: boolean } = {}) {
  // Strip our own prefix if caller forgot
  const id = songId.startsWith('saavn-') ? songId.slice(6) : songId;
  if (!opts.forceRefresh && cache.has(id)) return cache.get(id);

  try {
    const data = await fetchJson(`${API}/api/songs/${id}`) as { data?: SaavnSong[] | SaavnSong } | null;
    const song = Array.isArray(data?.data) ? data.data[0] : data?.data;
    if (!song) return null;

    const streamUrl = bestAudio(song.downloadUrl);
    if (!streamUrl) return null;

    const result = {
      streamUrl,
      id: song.id,
      title: decodeEntities(song.name || ''),
      artist: decodeEntities(primaryArtists(song)),
      album: decodeEntities(albumName(song.album)),
      duration: song.duration,
      image: bestImage(song.image),
    };

    cache.set(id, result);
    if (cache.size > 60) {
      const firstKey = cache.keys().next().value;
      if (firstKey !== undefined) cache.delete(firstKey);
    }
    return result;
  } catch {
    return null;
  }
}

export async function findSongStreamUrl(title: string, artist = '', opts: { forceRefresh?: boolean } = {}) {
  const query = [title, artist].filter(Boolean).join(' ').trim();
  if (query.length < 2) return null;

  const results = await searchSongs(query, 8);
  const best = (results || [])
    .filter((song): song is SaavnSong & { id: string } => !!song?.id)
    .filter((song) => !looksSpammy(song))
    .sort((a, b) => scoreSong(b, title, artist) - scoreSong(a, title, artist))[0];
  if (!best?.id) return null;
  if (!isConfidentMatch(best, title, artist)) return null;

  const direct = bestAudio(best.downloadUrl);
  if (direct && !opts.forceRefresh) {
    const result = {
      streamUrl: direct,
      id: best.id,
      title: decodeEntities(best.name || best.title || title),
      artist: decodeEntities(primaryArtists(best) || artist),
      album: decodeEntities(albumName(best.album)),
      duration: best.duration,
      image: bestImage(best.image),
    };
    cache.set(best.id, result);
    return result;
  }

  return getSongStreamUrl(best.id, opts);
}

export function prefetchSong(songId: string) {
  const id = songId.startsWith('saavn-') ? songId.slice(6) : songId;
  if (!cache.has(id)) getSongStreamUrl(id);
}

export function preloadNext(queue: Array<{ id?: string }>, currentIndex: number) {
  const next = queue[currentIndex + 1];
  if (next?.id) prefetchSong(next.id);
}
