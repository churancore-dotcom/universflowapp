import { getSongHistory } from './songHistory';

/**
 * How much the listener actually listens to each artist, derived from their real
 * local play history. Used to bias search ranking toward the artists they play,
 * instead of ranking purely by global popularity.
 */

const CACHE_MS = 30_000;
let cached: { at: number; map: Map<string, number> } | null = null;

function norm(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/\s*(?:-|–)\s*topic$/i, '')
    .replace(/\bvevo\b/gi, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Split "A, B & C" / "A feat. B" credits into individual artist names. */
function splitArtists(raw: string): string[] {
  return String(raw || '')
    .split(/,|&|\bfeat\.?\b|\bft\.?\b|\bx\b|\bwith\b|\band\b/i)
    .map(norm)
    .filter((name) => name.length > 1);
}

/** artist (normalized) -> weighted play count, recent plays weighted higher. */
export function getArtistAffinity(): Map<string, number> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_MS) return cached.map;

  const map = new Map<string, number>();
  const history = getSongHistory();
  history.forEach((entry, index) => {
    // Most-recent-first history: earlier entries count for a little more.
    const recency = 1 + Math.max(0, 1 - index / Math.max(20, history.length));
    for (const name of splitArtists(entry.artist)) {
      map.set(name, (map.get(name) || 0) + recency);
    }
  });

  cached = { at: now, map };
  return map;
}

export function invalidateArtistAffinity() {
  cached = null;
}

/**
 * Ranking bonus for a result's artist. Zero when the listener has never played
 * that artist, so unfamiliar-but-relevant results are never pushed down.
 */
export function artistAffinityBonus(artist: string, affinity = getArtistAffinity()): number {
  if (!affinity.size) return 0;
  let plays = 0;
  for (const name of splitArtists(artist)) {
    plays = Math.max(plays, affinity.get(name) || 0);
    // Partial credit for "Artist - Topic" style variants and sub-names.
    if (!plays) {
      for (const [known, count] of affinity) {
        if (known.length > 3 && (known.includes(name) || name.includes(known))) {
          plays = Math.max(plays, count * 0.6);
        }
      }
    }
  }
  if (plays <= 0) return 0;
  // Meaningful but not overwhelming: caps below the title-relevance weights so a
  // played artist never outranks an exact-title match for a different artist.
  return Math.min(700, 220 + Math.log2(1 + plays) * 160);
}
