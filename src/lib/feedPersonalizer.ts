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

export interface TasteProfile {
  /** artistName(lowercased) -> affinity score (higher = better) */
  artists: Map<string, number>;
  /** keyword(lowercased token from titles) -> affinity score */
  keywords: Map<string, number>;
  /** artistName(lowercased) -> skip penalty (positive number, subtract) */
  skips: Map<string, number>;
  /** total signals observed; <5 means "cold start", keep ordering close to original */
  signalCount: number;
}

const POSITIVE_ACTIONS = new Set(['stream', 'save', 'share', 'playlist_add']);
const NEGATIVE_ACTIONS = new Set(['skip']);

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
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

/** Build (or reuse a cached) taste profile from recent play events. */
export async function getTasteProfile(userId: string | null | undefined): Promise<TasteProfile> {
  if (!userId) return EMPTY_PROFILE;
  if (cache && cache.userId === userId && Date.now() - cache.at < CACHE_TTL) {
    return cache.profile;
  }

  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from('song_play_events')
    .select('action, artist, title, score_weight, created_at')
    .eq('user_id', userId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(2000);

  if (error || !data) return EMPTY_PROFILE;

  const artists = new Map<string, number>();
  const keywords = new Map<string, number>();
  const skips = new Map<string, number>();
  let signalCount = 0;

  for (const row of data) {
    const r = recencyWeight(row.created_at as string);
    const baseW = Math.max(1, Number(row.score_weight) || 1);
    const a = (row.artist || '').trim().toLowerCase();
    const action = (row.action || '').toLowerCase();

    if (POSITIVE_ACTIONS.has(action) && a) {
      const w = baseW * r;
      artists.set(a, (artists.get(a) || 0) + w);
      signalCount++;
      for (const k of tokenize(row.title || '')) {
        keywords.set(k, (keywords.get(k) || 0) + w * 0.3);
      }
    } else if (NEGATIVE_ACTIONS.has(action) && a) {
      skips.set(a, (skips.get(a) || 0) + r * 2);
      signalCount++;
    }
  }

  const profile: TasteProfile = { artists, keywords, skips, signalCount };
  cache = { userId, at: Date.now(), profile };
  return profile;
}

/** Force-refresh next call (e.g. after a like / strong signal). */
export function invalidateTasteProfile() { cache = null; }

export interface RerankItem { artist?: string | null; title?: string | null }

/**
 * Score one item against the taste profile.
 * Returns 0 for cold-start (so original order is preserved).
 */
export function tasteScore(item: RerankItem, profile: TasteProfile): number {
  if (profile.signalCount < 5) return 0;
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
  return s;
}

/**
 * Stable rerank: keeps original order tie-broken so editorial ordering is
 * preserved when the user has no signal for an item. Boost is additive to a
 * decreasing positional score so we don't fully discard the source ranking.
 */
export function rerank<T extends RerankItem>(items: T[], profile: TasteProfile): T[] {
  if (profile.signalCount < 5 || items.length < 2) return items;
  const scored = items.map((item, idx) => {
    // Editorial weight: first item ~ 1.0, decays slowly. Personal score is added.
    const editorial = 1 / Math.log2(idx + 2);
    const personal = tasteScore(item, profile);
    // Normalize personal so it doesn't completely override the source order.
    const personalNorm = Math.tanh(personal / 8); // [-1, 1]
    return { item, idx, score: editorial + personalNorm * 0.9 };
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
