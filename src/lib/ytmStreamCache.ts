// 6-hour localStorage cache for YouTube Music audio stream URLs.
// Server cache (stream_url_cache) is 5h; YouTube signed URLs live ~6h.
// We mirror that on the client so repeat plays never hit the edge function.

const NAMESPACE = 'ytm:stream:v1';
const TTL_MS = 6 * 60 * 60 * 1000;
const MAX_ENTRIES = 200;

type Entry = {
  url: string;
  ts: number;
  meta?: {
    title?: string;
    artist?: string;
    cover_url?: string;
    duration?: number;
  };
};

const memory = new Map<string, Entry>();

const lsKey = (videoId: string) => `${NAMESPACE}:${videoId}`;

function readLS(videoId: string): Entry | null {
  try {
    const raw = localStorage.getItem(lsKey(videoId));
    if (!raw) return null;
    return JSON.parse(raw) as Entry;
  } catch {
    return null;
  }
}

function writeLS(videoId: string, entry: Entry) {
  try {
    localStorage.setItem(lsKey(videoId), JSON.stringify(entry));
  } catch {
    // Quota exceeded — best-effort: clear oldest 20 entries and retry once.
    try {
      const keys: { k: string; ts: number }[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k?.startsWith(NAMESPACE)) continue;
        try {
          const v = JSON.parse(localStorage.getItem(k) || '{}');
          keys.push({ k, ts: Number(v?.ts) || 0 });
        } catch { /* skip */ }
      }
      keys.sort((a, b) => a.ts - b.ts).slice(0, 20).forEach((e) => localStorage.removeItem(e.k));
      localStorage.setItem(lsKey(videoId), JSON.stringify(entry));
    } catch { /* give up */ }
  }
}

export function getCachedStream(videoId: string): Entry | null {
  const now = Date.now();
  const mem = memory.get(videoId);
  if (mem && now - mem.ts < TTL_MS && !mem.url.startsWith('yt-video:')) return mem;
  if (mem?.url.startsWith('yt-video:')) memory.delete(videoId);
  const disk = readLS(videoId);
  if (disk && now - disk.ts < TTL_MS && typeof disk.url === 'string') {
    if (disk.url.startsWith('yt-video:')) {
      try { localStorage.removeItem(lsKey(videoId)); } catch { /* ignore */ }
      return null;
    }
    memory.set(videoId, disk);
    return disk;
  }
  if (disk) {
    try { localStorage.removeItem(lsKey(videoId)); } catch { /* ignore */ }
  }
  memory.delete(videoId);
  return null;
}

export function setCachedStream(videoId: string, url: string, meta?: Entry['meta']) {
  if (!videoId || !url) return;
  // Never cache iframe fallback markers as audio streams. Cached `yt-video:`
  // values make the player skip stream extraction on the next play, which means
  // Premium Equalizer/effects can never attach to the <audio> element.
  if (url.startsWith('yt-video:')) return;
  const entry: Entry = { url, ts: Date.now(), meta };
  memory.set(videoId, entry);
  // Trim memory cache
  if (memory.size > MAX_ENTRIES) {
    const oldest = [...memory.entries()].sort((a, b) => a[1].ts - b[1].ts).slice(0, memory.size - MAX_ENTRIES);
    for (const [k] of oldest) memory.delete(k);
  }
  writeLS(videoId, entry);
}

export function invalidateStream(videoId: string) {
  memory.delete(videoId);
  try { localStorage.removeItem(lsKey(videoId)); } catch { /* ignore */ }
}
