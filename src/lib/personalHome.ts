/**
 * Personal Home data — derived ONLY from signals we really have:
 * device play history snapshots (localStorage) and the taste profile that
 * already powers the feed re-ranker. Nothing here invents filler content; each
 * helper returns an empty list when the signal is missing so the matching shelf
 * self-hides instead of rendering a fake row.
 */
import type { Song } from '@/contexts/PlayerContext';
import type { LocalRecentEntry } from '@/lib/localRecentlyPlayed';
import type { TasteProfile } from '@/lib/feedPersonalizer';
import { songFingerprint } from '@/lib/railQuality';
import { isBlockedTrack } from '@/lib/blockedTracks';

/** Recent plays → playable songs, most recent first, de-duplicated. */
export function recentSongs(entries: LocalRecentEntry[]): Song[] {
  const out: Song[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const snap = entry.song;
    if (!snap?.title || !snap?.artist) continue;
    if (isBlockedTrack(snap.title, snap.artist)) continue;
    const fp = songFingerprint(snap);
    if (seen.has(fp)) continue;
    seen.add(fp);
    out.push({
      id: entry.song_id,
      title: snap.title,
      artist: snap.artist,
      album: snap.album ?? undefined,
      cover_url: snap.cover_url ?? undefined,
      audio_url: snap.audio_url ?? 'resolving',
      duration: snap.duration ?? undefined,
    } as Song);
  }
  return out;
}

export interface JumpBackInGroup {
  id: string;
  /** Album name when we have one, otherwise the artist. */
  title: string;
  subtitle: string;
  cover_url?: string;
  songs: Song[];
  lastPlayedAt: number;
}

/**
 * "Jump Back In" — real album/artist groups from history, so a listener can
 * resume the thing they were actually working through. A group needs at least
 * two tracks; a single play is not a body of work to resume.
 */
export function jumpBackInGroups(entries: LocalRecentEntry[], min = 2): JumpBackInGroup[] {
  const groups = new Map<string, JumpBackInGroup>();
  for (const entry of entries) {
    const snap = entry.song;
    if (!snap?.title || !snap?.artist) continue;
    const album = (snap.album || '').trim();
    const key = (album || snap.artist).toLowerCase();
    const song = recentSongs([entry])[0];
    if (!song) continue;
    const existing = groups.get(key);
    if (existing) {
      if (!existing.songs.some((s) => songFingerprint(s) === songFingerprint(song))) {
        existing.songs.push(song);
      }
      existing.lastPlayedAt = Math.max(existing.lastPlayedAt, entry.played_at);
      if (!existing.cover_url) existing.cover_url = song.cover_url;
      continue;
    }
    groups.set(key, {
      id: key,
      title: album || snap.artist,
      subtitle: album ? snap.artist : 'Recently played',
      cover_url: song.cover_url,
      songs: [song],
      lastPlayedAt: entry.played_at,
    });
  }
  return [...groups.values()]
    .filter((g) => g.songs.length >= min)
    .sort((a, b) => b.lastPlayedAt - a.lastPlayedAt);
}

export interface TopArtistRow {
  name: string;
  plays: number;
  cover_url?: string;
  songs: Song[];
}

/**
 * "Your Top Artists" — ranked by real play counts from history, with the taste
 * profile's 30-day affinity as the tie-breaker (it also folds in likes/follows).
 */
export function topArtistRows(entries: LocalRecentEntry[], taste: TasteProfile, max = 10): TopArtistRow[] {
  const rows = new Map<string, TopArtistRow>();
  for (const song of recentSongs(entries)) {
    const name = (song.artist || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const row = rows.get(key) || { name, plays: 0, cover_url: song.cover_url, songs: [] };
    row.plays += 1;
    if (!row.cover_url) row.cover_url = song.cover_url;
    row.songs.push(song);
    rows.set(key, row);
  }
  return [...rows.entries()]
    .sort((a, b) => {
      const byPlays = b[1].plays - a[1].plays;
      if (byPlays !== 0) return byPlays;
      return (taste.artists.get(b[0]) || 0) - (taste.artists.get(a[0]) || 0);
    })
    .map(([, row]) => row)
    .slice(0, max);
}

/**
 * "Quick Picks" — a short grid for one-tap access: the listener's most recent
 * plays first, then the best taste-matched tracks from the live feed pool.
 */
export function quickPicks(
  entries: LocalRecentEntry[],
  pool: Song[],
  score: (song: Song) => number,
  size = 8,
): Song[] {
  const picks: Song[] = [];
  const seen = new Set<string>();
  const push = (song: Song) => {
    const fp = songFingerprint(song);
    if (!song.title || !song.artist || seen.has(fp)) return;
    seen.add(fp);
    picks.push(song);
  };

  const recents = recentSongs(entries);
  const recentQuota = Math.min(Math.ceil(size / 2), recents.length);
  recents.slice(0, recentQuota).forEach(push);

  [...pool]
    .filter((s) => s.cover_url)
    .sort((a, b) => score(b) - score(a))
    .forEach((s) => { if (picks.length < size) push(s); });

  return picks.slice(0, size);
}

/** Time-of-day greeting — the only part of the header that is not taste-driven. */
export function greetingForHour(hour: number): string {
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  if (hour < 22) return 'Good evening';
  return 'Late night';
}

/**
 * A second line that only appears when it can say something TRUE about this
 * listener (their most-played artist, or their listening volume). No history →
 * no claim.
 */
export function tasteLine(entries: LocalRecentEntry[], taste: TasteProfile): string | null {
  const rows = topArtistRows(entries, taste, 1);
  if (rows.length && rows[0].plays >= 2) return `Back on ${rows[0].name}?`;
  if (entries.length >= 1) return 'Pick up where you left off';
  return null;
}
