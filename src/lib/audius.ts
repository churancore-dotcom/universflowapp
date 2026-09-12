// AUDIUS — free, legal, keyless music source.
//
// WHY: YouTube resolution is unreliable (datacenter IP blocks, PoTokens) and
// against YouTube's terms. Audius is an open music network with a public REST
// API that requires no key and serves direct, CORS-clean audio URLs — safe for
// the Play Store and instant to play.
//
// HOW: `https://api.audius.co` returns a list of healthy discovery hosts. We
// pick one, cache it, and fall through to the next on failure. Stream URLs are
// plain HTTPS endpoints that redirect to the CDN, so `<audio>` and ExoPlayer
// can play them directly with zero extra resolution round-trips.

import type { IndexedTrack } from './musicIndexer';

const APP_NAME = 'UniversFlow';
const HOST_KEY = 'uf_audius_hosts_v1';
const FALLBACK_HOSTS = [
  'https://discoveryprovider.audius.co',
  'https://discoveryprovider2.audius.co',
  'https://discoveryprovider3.audius.co',
];

let hosts: string[] | null = null;
let hostPromise: Promise<string[]> | null = null;

function readCachedHosts(): string[] | null {
  try {
    const raw = localStorage.getItem(HOST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { hosts?: string[]; expiresAt?: number };
    if (!parsed?.hosts?.length || (parsed.expiresAt ?? 0) < Date.now()) return null;
    return parsed.hosts;
  } catch {
    return null;
  }
}

async function getHosts(): Promise<string[]> {
  if (hosts?.length) return hosts;
  const cached = readCachedHosts();
  if (cached?.length) {
    hosts = cached;
    return cached;
  }
  if (hostPromise) return hostPromise;
  hostPromise = (async () => {
    try {
      const res = await fetch('https://api.audius.co', { headers: { Accept: 'application/json' } });
      const json = (await res.json()) as { data?: string[] };
      const list = (json?.data || []).filter((h) => typeof h === 'string' && h.startsWith('https://')).slice(0, 6);
      const out = list.length ? list : FALLBACK_HOSTS;
      hosts = out;
      try {
        localStorage.setItem(HOST_KEY, JSON.stringify({ hosts: out, expiresAt: Date.now() + 12 * 60 * 60 * 1000 }));
      } catch { /* private mode */ }
      return out;
    } catch {
      hosts = FALLBACK_HOSTS;
      return FALLBACK_HOSTS;
    } finally {
      hostPromise = null;
    }
  })();
  return hostPromise;
}

interface AudiusTrack {
  id?: string;
  title?: string;
  duration?: number;
  play_count?: number;
  genre?: string;
  is_streamable?: boolean;
  user?: { name?: string; handle?: string };
  artwork?: Record<string, string> | null;
}

async function audiusGet<T>(path: string, timeoutMs = 3500): Promise<T | null> {
  const list = await getHosts();
  for (const host of list.slice(0, 3)) {
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const sep = path.includes('?') ? '&' : '?';
      const res = await fetch(`${host}${path}${sep}app_name=${APP_NAME}`, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) continue;
      const json = (await res.json()) as { data?: T };
      if (json?.data !== undefined) return json.data;
    } catch {
      /* try next host */
    } finally {
      globalThis.clearTimeout(timer);
    }
  }
  return null;
}

/** Direct, playable audio URL for an Audius track id. */
export function audiusStreamUrl(trackId: string, host?: string): string {
  const base = host || hosts?.[0] || FALLBACK_HOSTS[0];
  return `${base}/v1/tracks/${trackId}/stream?app_name=${APP_NAME}`;
}

function artwork(track: AudiusTrack): string | undefined {
  const art = track.artwork || undefined;
  if (!art) return undefined;
  return art['1000x1000'] || art['480x480'] || art['150x150'];
}

function toIndexed(track: AudiusTrack, host: string): IndexedTrack | null {
  if (!track?.id || !track.title) return null;
  if (track.is_streamable === false) return null;
  const artist = track.user?.name || track.user?.handle || '';
  if (!artist) return null;
  const duration = Number(track.duration) || undefined;
  // Skip DJ sets / podcasts / stubs — keep it a music app.
  if (duration && (duration < 45 || duration > 900)) return null;
  return {
    id: `audius-${track.id}`,
    title: track.title,
    artist,
    album: '',
    cover_url: artwork(track),
    duration,
    audio_url: audiusStreamUrl(track.id, host),
    listeners: Number(track.play_count) || undefined,
  };
}

async function mapTracks(tracks: AudiusTrack[] | null): Promise<IndexedTrack[]> {
  if (!tracks?.length) return [];
  const list = await getHosts();
  const host = list[0] ?? FALLBACK_HOSTS[0];
  return tracks.map((t) => toIndexed(t, host)).filter((t): t is IndexedTrack => !!t);
}

/** Full-text track search. Results already carry a playable `audio_url`. */
export async function searchAudiusTracks(query: string, limit = 25): Promise<IndexedTrack[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const data = await audiusGet<AudiusTrack[]>(
    `/v1/tracks/search?query=${encodeURIComponent(q)}&limit=${Math.min(50, limit)}`,
  );
  return (await mapTracks(data)).slice(0, limit);
}

/** Trending tracks — used for Fresh/Trending rails now that YouTube is gone. */
export async function getAudiusTrending(limit = 30, time: 'week' | 'month' | 'allTime' = 'week'): Promise<IndexedTrack[]> {
  const data = await audiusGet<AudiusTrack[]>(`/v1/tracks/trending?time=${time}&limit=${Math.min(100, limit)}`);
  return (await mapTracks(data)).slice(0, limit);
}

/** Newest uploads for a genre-ish feed (falls back to trending when empty). */
export async function getAudiusUnderground(limit = 30): Promise<IndexedTrack[]> {
  const data = await audiusGet<AudiusTrack[]>(`/v1/tracks/trending/underground?limit=${Math.min(100, limit)}`);
  const out = await mapTracks(data);
  return out.length ? out.slice(0, limit) : getAudiusTrending(limit, 'month');
}

/** Resolve a single track by title/artist — used as a playback fallback. */
export async function findAudiusStream(title: string, artist = ''): Promise<IndexedTrack | null> {
  const results = await searchAudiusTracks([title, artist].filter(Boolean).join(' '), 10);
  if (!results.length) return null;
  const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const wantTitle = norm(title);
  const wantArtist = norm(artist);
  const exact = results.find((r) => norm(r.title) === wantTitle
    && (!wantArtist || norm(r.artist).includes(wantArtist) || wantArtist.includes(norm(r.artist))));
  return exact ?? null;
}

export const isAudiusTrackId = (id?: string | null): boolean => !!id && id.startsWith('audius-');
