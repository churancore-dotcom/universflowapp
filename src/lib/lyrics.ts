import { supabase } from '@/integrations/supabase/client';
import { recordPerfEvent } from '@/lib/perfMonitor';

export interface LyricLine {
  time: number; // seconds
  text: string;
}

export interface LyricsResult {
  synced: LyricLine[];      // empty if unsynced
  plain: string | null;     // raw text if no sync
  source: 'artist' | 'lrclib' | 'kugou' | 'netease' | 'qqmusic' | 'lyricsovh' | 'lyricsplus' | 'unison' | null;
  hasLyrics: boolean;
  isSynced: boolean;
}

const EMPTY: LyricsResult = {
  synced: [], plain: null, source: null, hasLyrics: false, isSynced: false,
};

// localStorage cache (7 days)
const LS_KEY = 'uf_lyrics_cache_v2';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 80;

type CacheShape = Record<string, { data: LyricsResult; expiresAt: number }>;

function readCache(): CacheShape {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; }
}
function writeCache(c: CacheShape) {
  try {
    const entries = Object.entries(c).filter(([, v]) => v.expiresAt > Date.now());
    if (entries.length > MAX_ENTRIES) {
      entries.sort((a, b) => b[1].expiresAt - a[1].expiresAt);
      entries.length = MAX_ENTRIES;
    }
    localStorage.setItem(LS_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch { /* quota — ignore */ }
}

function makeKey(artist: string, title: string, duration?: number, songId?: string) {
  const idKey = songId?.trim() || 'no-id';
  const durationKey = duration && Number.isFinite(duration) && duration > 0 ? Math.round(duration) : 'unknown';
  return `${idKey}::${artist.toLowerCase().trim()}::${title.toLowerCase().trim()}::${durationKey}`;
}

/** Parse LRC text into time-ordered lines. Handles [mm:ss.xx] and [mm:ss]. */
export function parseLrc(raw: string): LyricLine[] {
  if (!raw) return [];
  const out: LyricLine[] = [];
  const lineRe = /^((?:\[\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?\])+)(.*)$/;
  const tagRe = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(lineRe);
    if (!m) continue;
    const text = (m[2] || '').trim();
    let tag: RegExpExecArray | null;
    tagRe.lastIndex = 0;
    while ((tag = tagRe.exec(m[1])) !== null) {
      const mm = parseInt(tag[1], 10);
      const ss = parseInt(tag[2], 10);
      const fracRaw = tag[3] || '0';
      const frac = parseInt(fracRaw, 10) / Math.pow(10, fracRaw.length);
      const t = mm * 60 + ss + frac;
      if (Number.isFinite(t)) out.push({ time: t, text });
    }
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}

/** Find the active lyric line index for a given playback time. -1 if before first. */
export function findActiveLine(lines: LyricLine[], currentTime: number): number {
  if (!lines.length) return -1;
  // Binary search
  let lo = 0, hi = lines.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= currentTime) { ans = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return ans;
}

function buildTimedPlainLyrics(plain: string | null, duration?: number): LyricLine[] {
  if (!plain || !duration || !Number.isFinite(duration) || duration < 30) return [];
  const lines = plain
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const intro = Math.min(8, Math.max(2.2, duration * 0.025));
  const outro = Math.min(6, Math.max(2, duration * 0.018));
  const usable = Math.max(lines.length * 1.35, duration - intro - outro);
  const step = usable / lines.length;
  return lines.map((text, index) => ({ time: intro + index * step, text }));
}

const inFlight = new Map<string, Promise<LyricsResult>>();

export async function fetchLyrics(artist: string, title: string, duration?: number, songId?: string): Promise<LyricsResult> {
  if (!artist || !title) return EMPTY;
  const key = makeKey(artist, title, duration, songId);
  const cache = readCache();
  const hit = cache[key];
  if (hit && hit.expiresAt > Date.now()) return hit.data;

  const existing = inFlight.get(key);
  if (existing) return existing;

  const startedAt = Date.now();
  const p = (async () => {
    try {
      const { data, error } = await supabase.functions.invoke('lyrics', {
        body: { artist, title, duration, songId },
      });
      if (error || !data?.success) return EMPTY;
      const synced = data.synced ? parseLrc(data.synced) : [];
      const plain = data.plain || null;
      const timedPlain = synced.length > 0 ? [] : buildTimedPlainLyrics(plain, duration);
      const result: LyricsResult = {
        synced: synced.length > 0 ? synced : timedPlain,
        plain,
        source: data.source || null,
        hasLyrics: synced.length > 0 || timedPlain.length > 0 || !!plain,
        isSynced: synced.length > 0 || timedPlain.length > 0,
      };
      recordPerfEvent({
        event_type: result.hasLyrics ? 'lyrics_hit' : 'lyrics_miss',
        severity: 'info',
        source: result.source || 'none',
        track_id: songId || `${artist} - ${title}`.slice(0, 120),
        latency_ms: Date.now() - startedAt,
        details: { synced: result.isSynced },
      });
      const c = readCache();
      c[key] = { data: result, expiresAt: Date.now() + TTL_MS };
      writeCache(c);
      return result;
    } catch {
      recordPerfEvent({
        event_type: 'lyrics_miss',
        severity: 'warn',
        source: 'error',
        track_id: songId || `${artist} - ${title}`.slice(0, 120),
        latency_ms: Date.now() - startedAt,
      });
      return EMPTY;
    } finally {
      inFlight.delete(key);
    }

  })();

  inFlight.set(key, p);
  return p;
}
