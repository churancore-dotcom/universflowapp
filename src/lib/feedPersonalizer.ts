/**
 * Silent feed personalizer — YouTube-style.
 *
 * We never tell the user a shelf is "personalized." We just quietly reorder
 * the same content based on their listening behavior:
 *   - Plays / saves / shares / playlist-adds  → positive signal
 *   - Skips within first ~10s                  → negative signal
 *   - Recency decay (last 7d weighs 3x last 30d)
 *
 * Everything is computed client-side from `song_play_events` which already
 * powers global charts, so no new tables / no new edge functions.
 */

import { supabase } from '@/integrations/supabase/client';
import { cachesEnabled } from '@/lib/ssrCache';
import { loadLibrarySongs } from '@/lib/streamSongs';
import { readLocalRecent } from '@/lib/localRecentlyPlayed';
import { notInterestedKey } from '@/lib/notInterested';
import { detectScene, detectStyles, type Scene, type Style } from '@/lib/musicScene';

export interface TasteProfile {
  /** artistName(lowercased) -> affinity score (higher = better) */
  artists: Map<string, number>;
  /** keyword(lowercased token from titles) -> affinity score */
  keywords: Map<string, number>;
  /** artistName(lowercased) -> skip penalty (positive number, subtract) */
  skips: Map<string, number>;
  /** total signals observed; <5 means "cold start", keep ordering close to original */
  signalCount: number;
  /** opt-in regional scenes (e.g. Bhojpuri) -> positive weight */
  scenes?: Map<Scene, number>;
  /** total positive weight, for scene share */
  positiveTotal?: number;
  /** language / style affinity (Punjabi, Tamil, lofi, rap...) */
  styles?: Map<Style, number>;
  /** language / style the listener keeps skipping */
  styleSkips?: Map<Style, number>;
  /** exact songs (title|artist) the listener marked "Not interested" */
  hiddenSongs?: Set<string>;
}

const POSITIVE_ACTIONS = new Set(['stream', 'save', 'share', 'playlist_add']);
const NEGATIVE_ACTIONS = new Set(['skip', 'dislike', 'hide', 'not_interested']);
// An explicit dislike outweighs a passive skip.
const STRONG_NEGATIVE = new Set(['dislike', 'hide', 'not_interested']);

const STOP_WORDS = new Set([
  'the','a','an','and','or','of','to','in','on','for','with','feat','ft','featuring',
  'remix','version','edit','radio','official','video','audio','lyric','lyrics','song',
  'mix','remastered','remaster','live','acoustic','instrumental','extended','original',
  'i','me','my','you','your','we','us','our','it','is','are','was','were','be','been',
  'so','no','yes','do','did','do','don','dont',
]);

function tokenize(s: string): string[] {
  if (!s) return [];
  return s
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
}

function recencyWeight(createdAt: string): number {
  // exponential-ish: today=3, week-ago≈1.2, 30d=0.4
  const ageMs = Date.now() - new Date(createdAt).getTime();
  const ageDays = Math.max(0, ageMs / 86_400_000);
  return Math.max(0.4, 3 * Math.exp(-ageDays / 10));
}

const EMPTY_PROFILE: TasteProfile = {
  artists: new Map(),
  keywords: new Map(),
  skips: new Map(),
  signalCount: 0,
};

let cache: { userId: string; at: number; profile: TasteProfile } | null = null;
let cacheGeneration = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

/** Local-only profile for signed-out listeners (device history, no cloud read). */
function localOnlyProfile(): TasteProfile {
  const artists = new Map<string, number>();
  const keywords = new Map<string, number>();
  const scenes = new Map<Scene, number>();
  const styles = new Map<Style, number>();
  let positiveTotal = 0;
  for (const entry of readLocalRecent(null).slice(0, 50)) {
    const artist = (entry.song?.artist || '').trim().toLowerCase();
    if (!artist) continue;
    const ageDays = Math.max(0, (Date.now() - entry.played_at) / 86_400_000);
    const weight = Math.max(0.5, 4 * Math.exp(-ageDays / 7));
    artists.set(artist, (artists.get(artist) || 0) + weight);
    positiveTotal += weight;
    const sc = detectScene({ title: entry.song?.title, artist: entry.song?.artist });
    if (sc) scenes.set(sc, (scenes.get(sc) || 0) + weight);
    for (const st of detectStyles({ title: entry.song?.title, artist: entry.song?.artist })) styles.set(st, (styles.get(st) || 0) + weight);
    for (const keyword of tokenize(entry.song?.title || '')) {
      keywords.set(keyword, (keywords.get(keyword) || 0) + weight * 0.35);
    }
  }
  return { artists, keywords, skips: new Map(), signalCount: artists.size, scenes, positiveTotal, styles };
}

/** Build (or reuse a cached) taste profile from recent play events. */
export async function getTasteProfile(userId: string | null | undefined): Promise<TasteProfile> {
  if (!userId) return typeof window === 'undefined' ? EMPTY_PROFILE : localOnlyProfile();
  // SSR isolation: never read another request's profile from module scope.
  if (cachesEnabled() && cache && cache.userId === userId && Date.now() - cache.at < CACHE_TTL) {
    return cache.profile;
  }


  const generation = cacheGeneration;
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  // YouTube-style implicit taste: combine behavior (plays/skips), explicit
  // intent (likes), and artist follows. A listener should not need five cloud
  // play events before their feed starts feeling personal.
  const [eventsResult, likedSongs, followedResult, hiddenResult] = await Promise.all([
    supabase
      .from('song_play_events')
      .select('action, artist, title, score_weight, created_at')
      .eq('user_id', userId)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(2000),
    loadLibrarySongs(userId).catch(() => []),
    supabase
      .from('user_artist_preferences')
      .select('artist_name')
      .eq('user_id', userId),
    supabase
      .from('feed_not_interested')
      .select('title, artist')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(500),
  ]);

  const data = eventsResult.data ?? [];

  const artists = new Map<string, number>();
  const keywords = new Map<string, number>();
  const skips = new Map<string, number>();
  const scenes = new Map<Scene, number>();
  let positiveTotal = 0;
  const styles = new Map<Style, number>();
  const styleSkips = new Map<Style, number>();
  const tally = (title: string | null | undefined, artist: string | null | undefined, w: number) => {
    positiveTotal += w;
    for (const st of detectStyles({ title, artist })) styles.set(st, (styles.get(st) || 0) + w);
    const sc = detectScene({ title, artist });
    if (sc) scenes.set(sc, (scenes.get(sc) || 0) + w);
  };
  let signalCount = 0;

  for (const row of data) {
    const r = recencyWeight(row.created_at as string);
    const baseW = Math.max(1, Number(row.score_weight) || 1);
    const a = (row.artist || '').trim().toLowerCase();
    const action = (row.action || '').toLowerCase();

    if (POSITIVE_ACTIONS.has(action) && a) {
      const w = baseW * r;
      artists.set(a, (artists.get(a) || 0) + w);
      tally(row.title, row.artist, w);
      signalCount++;
      for (const k of tokenize(row.title || '')) {
        keywords.set(k, (keywords.get(k) || 0) + w * 0.3);
      }
    } else if (NEGATIVE_ACTIONS.has(action) && a) {
      const neg = r * (STRONG_NEGATIVE.has(action) ? 6 : 2);
      skips.set(a, (skips.get(a) || 0) + neg);
      for (const st of detectStyles({ title: row.title, artist: row.artist })) styleSkips.set(st, (styleSkips.get(st) || 0) + neg);
      signalCount++;
    }
  }

  for (const song of likedSongs) {
    const artist = (song.artist || '').trim().toLowerCase();
    if (!artist) continue;
    artists.set(artist, (artists.get(artist) || 0) + 7);
    tally(song.title, song.artist, 7);
    for (const keyword of tokenize(song.title || '')) {
      keywords.set(keyword, (keywords.get(keyword) || 0) + 1.5);
    }
    signalCount += 2;
  }

  for (const row of followedResult.data ?? []) {
    const artist = (row.artist_name || '').trim().toLowerCase();
    if (!artist) continue;
    artists.set(artist, (artists.get(artist) || 0) + 9);
    tally(null, row.artist_name, 9);
    signalCount += 2;
  }

  // Local playback is written immediately, while cloud analytics can arrive
  // later or be unavailable offline. Fold it in so one listening session can
  // reshape the next Home render without waiting for background ingestion.
  for (const entry of readLocalRecent(userId).slice(0, 50)) {
    const artist = (entry.song?.artist || '').trim().toLowerCase();
    const title = entry.song?.title || '';
    if (!artist) continue;
    const ageDays = Math.max(0, (Date.now() - entry.played_at) / 86_400_000);
    const weight = Math.max(0.5, 4 * Math.exp(-ageDays / 7));
    artists.set(artist, (artists.get(artist) || 0) + weight);
    tally(title, entry.song?.artist, weight);
    for (const keyword of tokenize(title)) {
      keywords.set(keyword, (keywords.get(keyword) || 0) + weight * 0.35);
    }
    signalCount += 1;
  }

  const hiddenSongs = new Set<string>();
  for (const row of hiddenResult.data ?? []) {
    hiddenSongs.add(notInterestedKey(row.title, row.artist));
    const artist = (row.artist || '').trim().toLowerCase();
    if (artist) skips.set(artist, (skips.get(artist) || 0) + 3);
    signalCount++;
  }

  const profile: TasteProfile = { artists, keywords, skips, signalCount, scenes, positiveTotal, styles, styleSkips, hiddenSongs };
  if (cachesEnabled() && generation === cacheGeneration) {
    cache = { userId, at: Date.now(), profile };
  }
  return profile;
}

/** Force-refresh next call (e.g. after a like / strong signal). */
export function invalidateTasteProfile() {
  cacheGeneration++;
  cache = null;
}

export interface RerankItem { artist?: string | null; title?: string | null; genre?: string | null }

/**
 * Score one item against the taste profile.
 * Returns 0 for cold-start (so original order is preserved).
 */
export function tasteScore(item: RerankItem, profile: TasteProfile): number {
  if (profile.signalCount < 1) return 0;
  const a = (item.artist || '').trim().toLowerCase();
  let s = 0;
  if (a) {
    s += (profile.artists.get(a) || 0);
    s -= (profile.skips.get(a) || 0);
  }
  if (item.title) {
    const tokens = tokenize(item.title);
    for (const t of tokens) s += (profile.keywords.get(t) || 0);
  }
  // Language / style share: a Punjabi listener's feed leans Punjabi, a lofi
  // listener's leans lofi, and styles they keep skipping sink.
  const total = Math.max(1, profile.positiveTotal || 0);
  for (const st of detectStyles(item)) {
    const share = (profile.styles?.get(st) || 0) / total;
    s += share * 12;
    s -= Math.min(6, (profile.styleSkips?.get(st) || 0) / 3);
  }
  return s;
}

/**
 * Hard negative check. A repeatedly skipped/disliked artist with no offsetting
 * positive signal must not appear in a feed at all — demoting it by score was
 * not enough, because a strong editorial position could still float it to the
 * top of a rail.
 */
export function isSuppressed(item: RerankItem, profile: TasteProfile): boolean {
  const a = (item.artist || '').trim().toLowerCase();
  if (!a) return false;
  const negative = profile.skips.get(a) || 0;
  // ~2+ skips (or one explicit dislike) before we hide an artist.
  if (negative < 3.5) return false;
  const positive = profile.artists.get(a) || 0;
  return negative > positive;
}

/**
 * Stable rerank: keeps original order tie-broken so editorial ordering is
 * preserved when the user has no signal for an item. Boost is additive to a
 * decreasing positional score so we don't fully discard the source ranking.
 * Explicitly disliked artists are removed outright.
 */
export function rerank<T extends RerankItem>(items: T[], profile: TasteProfile): T[] {
  // "Not interested" is an explicit choice about one song: always honour it,
  // even if the rail gets shorter.
  const hidden = profile.hiddenSongs;
  if (hidden && hidden.size) items = items.filter((item) => !hidden.has(notInterestedKey(item.title, item.artist)));
  if (profile.signalCount < 1 || items.length < 2) return items;
  const allowed = items.filter((item) => !isSuppressed(item, profile));
  // Never blank a rail: if suppression would empty it, fall back to the source.
  const pool = allowed.length >= Math.min(3, items.length) ? allowed : items;
  // Confidence ramps the personal weight: a listener with one session gets a
  // gentle nudge, a heavy listener gets a feed that is visibly theirs.
  const confidence = Math.min(1, profile.signalCount / 15);
  const personalWeight = 0.8 + confidence * 1.1; // 0.8 → 1.9
  const scored = pool.map((item, idx) => {
    // Editorial weight: first item ~ 1.0, decays slowly. Personal score is added.
    const editorial = 1 / Math.log2(idx + 2);
    const personal = tasteScore(item, profile);
    // Normalize personal so it doesn't completely override the source order.
    const personalNorm = Math.tanh(personal / 8); // [-1, 1]
    return { item, idx, score: editorial + personalNorm * personalWeight };

  });
  scored.sort((a, b) => b.score - a.score || a.idx - b.idx);
  return scored.map((s) => s.item);
}


/** Top artists by affinity — the real seeds for "Made For You". */
export function topTasteArtists(profile: TasteProfile, n = 5): string[] {
  return [...profile.artists.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k);
}

/** Top title keywords — used to widen seeds when artist affinity is thin. */
export function topTasteKeywords(profile: TasteProfile, n = 3): string[] {
  return [...profile.keywords.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k);
}
