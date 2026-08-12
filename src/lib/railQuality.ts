/**
 * Rail quality gate — what makes a home shelf look "real" instead of scraped.
 *
 * The complaints about "fake/mock songs on top" of New Releases were not fake
 * data at all: YouTube's release/chart feeds mix genuine singles with
 * auto-generated compilations (jukebox, nonstop mashups, "1 hour", slowed +
 * reverb re-uploads, karaoke, ringtone rips). Those look like filler because
 * they are filler, so they are rejected here for every editorial rail.
 */
import type { Song } from '@/contexts/PlayerContext';

const JUNK_TITLE = [
  /\bjukebox\b/i,
  /\bnon[\s-]?stop\b/i,
  /\bmashup\b/i,
  /\bmedley\b/i,
  /\bfull\s+album\b/i,
  /\bfull\s+movie\b/i,
  /\baudio\s+juke\b/i,
  /\b\d+\s*(hour|hr|hrs|min)s?\b/i,
  /\bslowed\b|\breverb\b|\bnightcore\b|\b8d\s*audio\b/i,
  /\bkaraoke\b|\bringtone\b|\bbgm\b|\binstrumental\b/i,
  /\bcover\s+(song|version|by)\b/i,
  /\bmix\s*(vol|volume)?\s*\d*\b.*\bdj\b/i,
  /\bcompilation\b|\bgreatest\s+hits\b|\ball\s+songs\b|\btop\s+\d+\s+songs\b/i,
  /\blyrical\s+video\s+status\b|\bwhatsapp\s+status\b|\bstatus\s+video\b/i,
];

const JUNK_ARTIST = [
  /^various\s+artists?$/i,
  /^(topic|unknown|official|audio|music|songs|dj\s*mix)$/i,
  /\b(mix|remix|status|shorts|dj)\s*(zone|world|hub|point|club)\b/i,
];

/** True when a track should never appear on an editorial home rail. */
export function isJunkRailTrack(s: { title?: string | null; artist?: string | null; album?: string | null; duration?: number | null }): boolean {
  const title = (s.title || '').trim();
  const artist = (s.artist || '').trim();
  if (!title || !artist) return true;
  if (title.toLowerCase() === artist.toLowerCase()) return true;
  const dur = Number(s.duration || 0);
  // A "single" that runs 15+ minutes is a compilation upload, not a release.
  if (dur && (dur < 50 || dur > 780)) return true;
  if (JUNK_ARTIST.some((r) => r.test(artist))) return true;
  const hay = `${title} ${s.album || ''}`;
  return JUNK_TITLE.some((r) => r.test(hay));
}

/** Stable identity across the several ids the same song arrives under. */
export function songFingerprint(s: { title?: string | null; artist?: string | null }): string {
  const norm = (v?: string | null) =>
    (v || '')
      .toLowerCase()
      .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
      .replace(/\b(official|video|audio|lyrics?|hd|4k|full|song)\b/g, ' ')
      .replace(/[^a-z0-9]+/g, '');
  return `${norm(s.title)}~${norm(s.artist)}`;
}

/**
 * Dedupe + quality-gate a rail in one pass, preserving the incoming order
 * (real chart/recency order is the whole point of these shelves).
 */
export function cleanRail(songs: Song[], opts: { requireCover?: boolean } = {}): Song[] {
  const seen = new Set<string>();
  const out: Song[] = [];
  for (const s of songs) {
    if (!s || isJunkRailTrack(s)) continue;
    if (opts.requireCover && !s.cover_url && !videoIdOf(s)) continue;
    const fp = songFingerprint(s);
    if (fp === '~' || seen.has(fp)) continue;
    seen.add(fp);
    out.push(s);
  }
  return out;
}

/** YouTube video id behind a song id / audio url, when there is one. */
export function videoIdOf(s: { id?: string; audio_url?: string | null }): string | null {
  const id = s.id || '';
  if (id.startsWith('ytm-')) return id.slice(4);
  const url = s.audio_url || '';
  if (url.startsWith('yt-video:')) return url.slice('yt-video:'.length);
  if (/^[\w-]{11}$/.test(id)) return id;
  return null;
}

/**
 * YouTube-style diversity pass: never show the same artist back-to-back more
 * than twice, so a heavy-rotation artist cannot swallow a whole shelf.
 */
export function diversifyByArtist<T extends { artist?: string | null }>(items: T[], maxRun = 2): T[] {
  const out: T[] = [];
  const held: T[] = [];
  let lastArtist = '';
  let run = 0;
  for (const item of items) {
    const a = (item.artist || '').trim().toLowerCase();
    if (a && a === lastArtist && run >= maxRun) {
      held.push(item);
      continue;
    }
    if (a === lastArtist) run += 1;
    else { lastArtist = a; run = 1; }
    out.push(item);
    // Re-admit a held track once its artist is no longer the running one.
    for (let i = held.length - 1; i >= 0; i--) {
      const h = held[i];
      const ha = (h.artist || '').trim().toLowerCase();
      if (ha !== lastArtist) {
        held.splice(i, 1);
        out.push(h);
        lastArtist = ha;
        run = 1;
      }
    }
  }
  return [...out, ...held];
}

// ─── Cross-rail claim registry ───
// Home rails all draw from the same per-country YouTube Music feeds, so a
// regional hit legitimately appears in BOTH the chart feed and the new-release
// feed. Without a shared claim the listener sees the identical song twice on one
// screen, which reads as "the app keeps showing me the same track". Each rail
// claims the fingerprints it renders; lower-priority rails subtract them.
const railClaims = new Map<string, Set<string>>();
const claimListeners = new Set<() => void>();
let claimVersion = 0;

function claimSnapshot() { return claimVersion; }

function subscribeClaims(cb: () => void) {
  claimListeners.add(cb);
  return () => { claimListeners.delete(cb); };
}

/** Register the fingerprints a rail is currently rendering. */
export function claimRailSongs(rail: string, songs: Array<{ title?: string | null; artist?: string | null }>) {
  const next = new Set(songs.map((s) => songFingerprint(s)).filter((fp) => fp !== '~'));
  const prev = railClaims.get(rail);
  if (prev && prev.size === next.size && [...next].every((fp) => prev.has(fp))) return;
  railClaims.set(rail, next);
  claimVersion += 1;
  claimListeners.forEach((cb) => cb());
}

/** Fingerprints claimed by other rails (everything except `exceptRail`). */
export function claimedByOtherRails(exceptRail: string): Set<string> {
  const out = new Set<string>();
  for (const [rail, fps] of railClaims) {
    if (rail === exceptRail) continue;
    fps.forEach((fp) => out.add(fp));
  }
  return out;
}

/** React binding: re-renders a rail when another rail's claim changes. */
export function useRailClaimVersion(): number {
  return useSyncExternalStore(subscribeClaims, claimSnapshot, claimSnapshot);
}
