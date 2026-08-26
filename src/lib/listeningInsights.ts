// Real listening insights: recap, streaks, "on this day" memories.
//
// Data sources — all real, nothing synthesised:
//  1. `song_play_events` (server): one row per play with title/artist/time.
//  2. local recently-played snapshots: gives track durations + artwork.
//  3. the measured listen log (`listenLog.ts`): audible seconds + active days.
//
// When a listener is too new for a stat, the stat is omitted (`null`) instead of
// being invented. Callers render a lighter version in that case.

import { supabase } from '@/integrations/supabase/client';
import { readLocalRecent } from '@/lib/localRecentlyPlayed';
import { getSongHistory } from '@/lib/songHistory';
import { readListenLog, localDayKey } from '@/lib/listenLog';

export interface PlayRecord {
  fingerprint: string;
  title: string;
  artist: string;
  cover?: string | null;
  songId?: string | null;
  at: number; // epoch ms
  duration?: number | null; // seconds, when known
}

export const trackFingerprint = (title?: string | null, artist?: string | null) =>
  `${(title || '').trim().toLowerCase()}|${(artist || '').trim().toLowerCase()}`;

export interface RecapSlideData {
  window: 'month' | 'year';
  /** Human label for the window, e.g. "August 2026". */
  windowLabel: string;
  totalPlays: number;
  uniqueArtists: number;
  uniqueTracks: number;
  activeDays: number;
  /** Measured minutes when available; estimated from durations otherwise. */
  minutes: number | null;
  minutesEstimated: boolean;
  topArtist: { name: string; plays: number; cover?: string | null } | null;
  topArtists: { name: string; plays: number }[];
  topSong: PlayRecord | null;
  mostRepeated: { record: PlayRecord; plays: number } | null;
  topGenre: string | null;
  nightShare: number; // 0..1 share of plays between 22:00 and 05:00
  repeatRate: number; // 0..1 share of plays that were repeats
  personality: { name: string; blurb: string };
  /** True when there simply isn't enough history for a full recap. */
  sparse: boolean;
}

/* ------------------------------------------------------------------ loading */

export async function loadPlayRecords(userId: string | null): Promise<PlayRecord[]> {
  const durationByFingerprint = new Map<string, number>();
  const coverByFingerprint = new Map<string, string>();

  const localRecents = typeof window === 'undefined' ? [] : readLocalRecent(userId);
  const localHistory = typeof window === 'undefined' ? [] : getSongHistory();

  for (const entry of localRecents) {
    const snap = entry.song;
    if (!snap) continue;
    const fp = trackFingerprint(snap.title, snap.artist);
    if (snap.duration && snap.duration > 0) durationByFingerprint.set(fp, snap.duration);
    if (snap.cover_url) coverByFingerprint.set(fp, snap.cover_url);
  }
  for (const entry of localHistory) {
    const fp = trackFingerprint(entry.title, entry.artist);
    if (entry.duration && entry.duration > 0) durationByFingerprint.set(fp, entry.duration);
    if (entry.cover_url) coverByFingerprint.set(fp, entry.cover_url);
  }

  const records: PlayRecord[] = [];
  const seen = new Set<string>();

  if (userId) {
    const since = new Date(Date.now() - 400 * 86_400_000).toISOString();
    const { data } = await supabase
      .from('song_play_events')
      .select('title, artist, cover_url, song_id, created_at')
      .eq('user_id', userId)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(5000);

    for (const row of data || []) {
      const title = (row.title || '').trim();
      const artist = (row.artist || '').trim();
      if (!title && !artist) continue;
      const at = new Date(row.created_at as string).getTime();
      if (!Number.isFinite(at)) continue;
      const fp = trackFingerprint(title, artist);
      // Dedupe rows logged twice for the same play (same track, same minute).
      const key = `${fp}|${Math.floor(at / 60_000)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      records.push({
        fingerprint: fp,
        title,
        artist,
        cover: row.cover_url || coverByFingerprint.get(fp) || null,
        songId: row.song_id,
        at,
        duration: durationByFingerprint.get(fp) ?? null,
      });
    }
  }

  // Device-local plays cover signed-out sessions and anything the server missed.
  for (const entry of localRecents) {
    const snap = entry.song;
    if (!snap?.title) continue;
    const fp = trackFingerprint(snap.title, snap.artist);
    const key = `${fp}|${Math.floor(entry.played_at / 60_000)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    records.push({
      fingerprint: fp,
      title: snap.title,
      artist: (snap.artist || '').trim(),
      cover: snap.cover_url || null,
      songId: snap.id,
      at: entry.played_at,
      duration: snap.duration ?? null,
    });
  }

  return records.sort((a, b) => b.at - a.at);
}

/* ------------------------------------------------------------------ streaks */

export interface StreakInfo {
  current: number;
  best: number;
  /** True when today already counts, so the flame is "safe". */
  activeToday: boolean;
}

export function computeStreak(records: PlayRecord[], userId: string | null): StreakInfo {
  const days = new Set<string>();
  for (const r of records) days.add(localDayKey(r.at));
  for (const d of readListenLog(userId).days) {
    if (d.plays > 0 || d.seconds > 0) days.add(d.day);
  }
  if (days.size === 0) return { current: 0, best: 0, activeToday: false };

  const today = localDayKey();
  const activeToday = days.has(today);

  // Current streak: walk backwards from today (a streak survives until the end
  // of the following day, same as Duolingo — you haven't broken it at 00:05).
  let current = 0;
  const cursor = new Date();
  if (!activeToday) cursor.setDate(cursor.getDate() - 1);
  for (let i = 0; i < 400; i++) {
    if (!days.has(localDayKey(cursor))) break;
    current++;
    cursor.setDate(cursor.getDate() - 1);
  }

  const sorted = [...days].sort();
  let best = 0;
  let run = 0;
  let prev: number | null = null;
  for (const day of sorted) {
    const t = new Date(`${day}T00:00:00`).getTime();
    run = prev !== null && Math.round((t - prev) / 86_400_000) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = t;
  }

  return { current, best: Math.max(best, current), activeToday };
}

export const STREAK_MILESTONES = [7, 30, 100, 365];

/* -------------------------------------------------------------- on this day */

export interface Memory {
  record: PlayRecord;
  plays: number;
  /** 'month' = 1 month ago, 'year' = 1 year ago. */
  scale: 'month' | 'year';
  headline: string;
}

/**
 * The track the listener was genuinely playing most around this date a month or
 * a year ago (±3 days). Returns null when that window has no history.
 */
export function findMemory(records: PlayRecord[]): Memory | null {
  const windows: { scale: 'month' | 'year'; center: Date; headline: string }[] = [];
  const yearAgo = new Date();
  yearAgo.setFullYear(yearAgo.getFullYear() - 1);
  const monthAgo = new Date();
  monthAgo.setMonth(monthAgo.getMonth() - 1);
  windows.push({ scale: 'year', center: yearAgo, headline: 'One year ago today' });
  windows.push({ scale: 'month', center: monthAgo, headline: 'One month ago' });

  for (const w of windows) {
    const from = w.center.getTime() - 3 * 86_400_000;
    const to = w.center.getTime() + 3 * 86_400_000;
    const inWindow = records.filter((r) => r.at >= from && r.at <= to);
    if (inWindow.length < 2) continue;
    const counts = new Map<string, { record: PlayRecord; plays: number }>();
    for (const r of inWindow) {
      const hit = counts.get(r.fingerprint);
      if (hit) hit.plays++;
      else counts.set(r.fingerprint, { record: r, plays: 1 });
    }
    const best = [...counts.values()].sort((a, b) => b.plays - a.plays)[0];
    if (!best) continue;
    return {
      record: best.record,
      plays: best.plays,
      scale: w.scale,
      headline: w.headline,
    };
  }
  return null;
}

/* -------------------------------------------------------------------- recap */

const GENRE_HINTS: Record<string, string[]> = {
  Phonk: ['phonk', 'drift', 'memphis'],
  'Lo-fi': ['lofi', 'lo-fi', 'chillhop', 'study'],
  'Hip-Hop': ['rap', 'hip hop', 'hip-hop', 'trap', 'drill'],
  EDM: ['remix', 'edm', 'house', 'techno', 'dubstep', 'bass', 'club'],
  Romance: ['love', 'pyaar', 'ishq', 'dil', 'heart', 'romantic'],
  Sad: ['sad', 'broken', 'alone', 'tears', 'cry', 'bewafa'],
  Punjabi: ['punjabi', 'jatt', 'desi', 'sidhu', 'karan aujla'],
  Bollywood: ['bollywood', 'hindi', 'title track', 'film version'],
  Rock: ['rock', 'metal', 'guitar', 'punk'],
  Party: ['party', 'dance', 'nasha', 'banger'],
};

function inferGenre(records: PlayRecord[]): string | null {
  const scores = new Map<string, number>();
  for (const r of records) {
    const hay = `${r.title} ${r.artist}`.toLowerCase();
    for (const [genre, keys] of Object.entries(GENRE_HINTS)) {
      if (keys.some((k) => hay.includes(k))) scores.set(genre, (scores.get(genre) || 0) + 1);
    }
  }
  const best = [...scores.entries()].sort((a, b) => b[1] - a[1])[0];
  // Require a real signal: at least 3 plays and 10% of the window.
  if (!best || best[1] < 3 || best[1] / Math.max(1, records.length) < 0.1) return null;
  return best[0];
}

function personalityFrom(opts: {
  repeatRate: number;
  nightShare: number;
  uniqueArtists: number;
  totalPlays: number;
  topGenre: string | null;
  topArtist: string | null;
}): { name: string; blurb: string } {
  const { repeatRate, nightShare, uniqueArtists, totalPlays, topGenre, topArtist } = opts;
  const variety = uniqueArtists / Math.max(1, totalPlays);

  if (nightShare >= 0.4) {
    return {
      name: 'The Nocturnal',
      blurb: `${Math.round(nightShare * 100)}% of your listening happened after dark${
        topGenre ? ` — mostly ${topGenre.toLowerCase()}` : ''
      }. The quiet hours are where your music lives.`,
    };
  }
  if (repeatRate >= 0.55) {
    return {
      name: 'The Loyalist',
      blurb: `You replayed your favourites more than you chased new ones${
        topArtist ? `, and ${topArtist} never left rotation` : ''
      }. When you love a song, you really commit.`,
    };
  }
  if (variety >= 0.6) {
    return {
      name: 'The Explorer',
      blurb: `${uniqueArtists} different artists in one window. You treat music like a map, not a playlist.`,
    };
  }
  if (topGenre) {
    return {
      name: `The ${topGenre} Purist`,
      blurb: `${topGenre} shaped most of your listening${
        topArtist ? `, with ${topArtist} leading it` : ''
      }. You know exactly what you like.`,
    };
  }
  return {
    name: 'The Steady One',
    blurb: `A balanced mix — a few favourites, a little discovery${
      topArtist ? `, and ${topArtist} at the centre of it` : ''
    }.`,
  };
}

export function buildRecap(
  records: PlayRecord[],
  userId: string | null,
  window: 'month' | 'year' = 'month',
): RecapSlideData | null {
  const now = new Date();
  const from =
    window === 'month'
      ? new Date(now.getFullYear(), now.getMonth(), 1).getTime()
      : new Date(now.getFullYear(), 0, 1).getTime();

  let scoped = records.filter((r) => r.at >= from);
  // A recap of an almost-empty calendar month is depressing and useless, so fall
  // back to a rolling window of the same length rather than showing nothing.
  if (scoped.length < 10) {
    const rollingFrom = Date.now() - (window === 'month' ? 30 : 365) * 86_400_000;
    scoped = records.filter((r) => r.at >= rollingFrom);
  }
  if (scoped.length === 0) return null;

  const windowLabel =
    window === 'month'
      ? now.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
      : `${now.getFullYear()}`;

  const artistPlays = new Map<string, number>();
  const trackPlays = new Map<string, { record: PlayRecord; plays: number }>();
  const days = new Set<string>();
  let nightPlays = 0;
  let estimatedSeconds = 0;

  for (const r of scoped) {
    const artist = r.artist || 'Unknown artist';
    artistPlays.set(artist, (artistPlays.get(artist) || 0) + 1);
    const hit = trackPlays.get(r.fingerprint);
    if (hit) hit.plays++;
    else trackPlays.set(r.fingerprint, { record: r, plays: 1 });
    days.add(localDayKey(r.at));
    const hour = new Date(r.at).getHours();
    if (hour >= 22 || hour < 5) nightPlays++;
    if (r.duration && r.duration > 0) estimatedSeconds += r.duration;
  }

  const topArtists = [...artistPlays.entries()]
    .map(([name, plays]) => ({ name, plays }))
    .sort((a, b) => b.plays - a.plays);
  const rankedTracks = [...trackPlays.values()].sort((a, b) => b.plays - a.plays);
  const topTrack = rankedTracks[0] ?? null;
  const repeated = rankedTracks.find((t) => t.plays >= 2) ?? null;

  // Measured minutes win; the duration estimate is only a fallback and is
  // labelled as such in the UI.
  const log = readListenLog(userId);
  const measuredSeconds = log.days
    .filter((d) => new Date(`${d.day}T00:00:00`).getTime() >= from)
    .reduce((sum, d) => sum + d.seconds, 0);
  const minutesMeasured = Math.round(measuredSeconds / 60);
  const minutesEstimatedValue = Math.round(estimatedSeconds / 60);
  const minutes =
    minutesMeasured >= 5 ? minutesMeasured : minutesEstimatedValue > 0 ? minutesEstimatedValue : null;

  const topGenre = inferGenre(scoped);
  const uniqueTracks = trackPlays.size;
  const repeatRate = 1 - uniqueTracks / scoped.length;
  const nightShare = nightPlays / scoped.length;

  const topArtistName = topArtists[0]?.name ?? null;
  const topArtistCover = topArtistName
    ? scoped.find((r) => r.artist === topArtistName && r.cover)?.cover ?? null
    : null;

  return {
    window,
    windowLabel,
    totalPlays: scoped.length,
    uniqueArtists: artistPlays.size,
    uniqueTracks,
    activeDays: days.size,
    minutes,
    minutesEstimated: minutes !== null && minutesMeasured < 5,
    topArtist: topArtists[0]
      ? { name: topArtists[0].name, plays: topArtists[0].plays, cover: topArtistCover }
      : null,
    topArtists: topArtists.slice(0, 5),
    topSong: topTrack?.record ?? null,
    mostRepeated: repeated,
    topGenre,
    nightShare,
    repeatRate,
    personality: personalityFrom({
      repeatRate,
      nightShare,
      uniqueArtists: artistPlays.size,
      totalPlays: scoped.length,
      topGenre,
      topArtist: topArtistName,
    }),
    sparse: scoped.length < 15,
  };
}
