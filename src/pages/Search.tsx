import { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { useNavigate, useSearchParams } from '@/lib/router-compat';
import { Search as SearchIcon, Music, X, Radio, Loader2, Clock, Trash2, UserSearch } from 'lucide-react';
import { toast } from 'sonner';
import { prewarmSong } from '@/lib/instantPlay';
import { usePlayer, Song } from '@/contexts/PlayerContext';
import { useDownloads } from '@/contexts/DownloadContext';
import BottomNav from '@/components/BottomNav';
import LikeButton from '@/components/LikeButton';

import DownloadButton from '@/components/DownloadButton';
import { TabTransition } from '@/components/PageTransition';
import SEOHead from '@/components/SEOHead';
import RoseHero from '@/components/RoseHero';
import { Input } from '@/components/ui/input';
import { SearchSkeleton } from '@/components/PageSkeletons';
import VirtualList from '@/components/VirtualList';

import { useYtmSuggestions } from '@/hooks/useYtmSuggestions';
import { supabase } from '@/integrations/supabase/client';
import { prefetchIndexedTrack, prefetchYouTubeVideoStream, searchYouTubeMusicTracks, searchArtistDirectory, getTagTopTracks, type IndexedArtistInfo, type IndexedTrack } from '@/lib/musicIndexer';
// FollowedArtistsRail removed from Search per product decision
import { clearCache, getCached, setCached } from '@/lib/searchCache';
import { AI_SLOP_ARTIST_PATTERNS, AI_SLOP_TITLE_PATTERNS } from '@/lib/aiSlopFilter';
import {
  getSongHistory,
  removeSongFromHistory,
  clearSongHistory,
  type SongHistoryEntry,
} from '@/lib/songHistory';

type SearchSource = 'songs' | 'artists';

const normalizeText = (value = '') => value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const cleanIdentity = (value = '') => normalizeText(value).replace(/\b(official|lyrics?|video|audio|hd|4k|topic|vevo|records|music)\b/g, '').replace(/\s+/g, ' ').trim();
const resultKey = (track: IndexedTrack) => `${cleanIdentity(track.artist)}::${cleanIdentity(track.title)}`;
// Reuploads keep the real credit inside the title ("Ian Asher - Way Too Self Aware")
// while the uploader channel is some aggregator. Split the credit out of the title so
// every reupload of the same song collapses onto one identity.
const stripBrackets = (value = '') => value.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ');
const splitTitleCredit = (title = '') => {
  const parts = stripBrackets(title).split(/\s+[-–—|]\s+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length > 1) return { credit: parts[0], name: parts.slice(1).join(' ') };
  return { credit: '', name: parts[0] || '' };
};
const songIdentity = (track: IndexedTrack) => {
  const { credit, name } = splitTitleCredit(String(track.title || ''));
  const creditKey = cleanIdentity(credit) || cleanIdentity(track.artist);
  return `${creditKey}::${cleanIdentity(name) || cleanIdentity(track.title)}`;
};
const SEARCH_STOP_WORDS = new Set(['song', 'songs', 'music', 'track', 'tracks', 'best', 'top', 'latest', 'new', 'by', 'ft', 'feat', 'featuring', 'from', 'genre']);
const queryTokens = (query: string) => normalizeText(query).split(' ').filter((token) => token.length > 1 && !SEARCH_STOP_WORDS.has(token));
const KNOWN_GENRE_KEYWORDS = ['phonk', 'lofi', 'lo fi', 'edm', 'drill', 'afrobeats', 'amapiano', 'hyperpop', 'trap', 'house', 'techno', 'dubstep', 'jazz', 'rnb', 'hip hop', 'rap', 'rock', 'metal', 'country', 'reggaeton', 'kpop', 'pop', 'indie', 'chill', 'focus', 'hype', 'relax', 'love'];
const GENRE_QUERY_ALIASES: Record<string, string[]> = {
  phonk: ['phonk', 'drift phonk', 'phonk music', 'phonk songs'],
  lofi: ['lofi', 'lo fi', 'lofi beats', 'chillhop'],
  'lo fi': ['lofi', 'lo fi', 'lofi beats', 'chillhop'],
  edm: ['edm', 'electronic dance music', 'dance music'],
  rnb: ['rnb', 'r&b', 'rhythm and blues'],
  'hip hop': ['hip hop', 'hiphop', 'rap'],
};
const COMMON_QUERY_CORRECTIONS: Record<string, string> = {
  phonks: 'phonk',
  phonkks: 'phonk',
  lofii: 'lofi',
  lofi: 'lofi',
  hiphop: 'hip hop',
  rb: 'rnb',
};
const stripSimplePlural = (token: string) => token.length > 3 && token.endsWith('s') && !/(ss|us|is)$/.test(token) ? token.slice(0, -1) : token;
function levenshteinDistance(a: string, b: string) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, index) => index);
  const curr = Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev.splice(0, prev.length, ...curr);
  }
  return prev[b.length];
}
// Short, generic genre words ('love', 'rock', 'pop', 'chill', 'focus', 'house')
// double as ordinary song-title words, so fuzzy matching them turns real
// searches ("Lover", "Rocky") into genre browsing and disables the relevance
// gate. Fuzzy matching is therefore restricted to distinctive, longer genre
// names and only applied to the full query — never to individual tokens.
const GENRE_FUZZY_MIN_LENGTH = 5;
function findKnownGenre(query: string) {
  const normalized = normalizeText(query);
  if (!normalized) return null;
  const fullQueryCandidates = [
    normalized,
    COMMON_QUERY_CORRECTIONS[normalized],
    normalized.split(' ').map((token) => COMMON_QUERY_CORRECTIONS[token] || stripSimplePlural(token)).join(' '),
  ].filter(Boolean) as string[];
  const candidates = [
    ...fullQueryCandidates,
    ...normalized.split(' '),
    ...normalized.split(' ').map(stripSimplePlural),
  ];
  for (const candidate of candidates) {
    const exact = KNOWN_GENRE_KEYWORDS.find((genre) => normalizeText(genre) === candidate);
    if (exact) return exact === 'lo fi' ? 'lofi' : exact;
  }
  for (const candidate of fullQueryCandidates) {
    if (candidate.length < GENRE_FUZZY_MIN_LENGTH) continue;
    const fuzzy = KNOWN_GENRE_KEYWORDS.find((genre) => {
      const normalizedGenre = normalizeText(genre);
      if (normalizedGenre.length < GENRE_FUZZY_MIN_LENGTH) return false;
      return Math.abs(candidate.length - normalizedGenre.length) <= 1 && levenshteinDistance(candidate, normalizedGenre) <= 1;
    });
    if (fuzzy) return fuzzy === 'lo fi' ? 'lofi' : fuzzy;
  }
  return null;
}

function buildResilientSearchIntent(query: string) {
  const normalized = normalizeText(query);
  const corrected = COMMON_QUERY_CORRECTIONS[normalized] || normalized.split(' ').map((token) => COMMON_QUERY_CORRECTIONS[token] || token).join(' ');
  const singular = corrected.split(' ').map(stripSimplePlural).join(' ');
  const genre = findKnownGenre(query);
  const variants = [query.trim(), normalized, corrected, singular, ...(genre ? (GENRE_QUERY_ALIASES[genre] || [genre, `${genre} music`, `${genre} songs`]) : [])]
    .map((variant) => variant.trim())
    .filter((variant, index, list) => variant.length > 1 && list.findIndex((item) => normalizeText(item) === normalizeText(variant)) === index);
  const tokens = [...new Set(variants.flatMap(queryTokens))];
  return { genre, variants, tokens };
}
const isGenreSearchIntent = (query: string) => Boolean(buildResilientSearchIntent(query).genre);
const HIDDEN_RESULTS_KEY = 'uf_hidden_search_results_v1';
const SEARCH_CACHE_NAMESPACE = 'stable-search-v18-no-ai-slop';
/** Titles the owner has banned app-wide — never surfaced anywhere. */
const BANNED_TITLE_PATTERNS = [/\bbarba+d+i\b/i, /\bbarbaadi\b/i];
const SPAM_RESULT_PATTERNS = [
  ...BANNED_TITLE_PATTERNS,
  // AI-generated uploads (Suno/Udio/voice clones) are never real music.
  ...AI_SLOP_TITLE_PATTERNS,

  /\b(top|best)\s*\d+\b/i,
  /\b\d+\s*(top|best|hit|hits|songs)\b/i,
  /\b(non\s*stop|jukebox|mashup|medley|playlist|compilation|collection|mixtape|full\s*album|all\s*songs)\b/i,
  /\b(sped\s*up|slowed(\s*\+?\s*reverb)?|nightcore|8\s*d|bass\s*boost(ed)?|reverb(ed)?)\b/i,
  /\b(karaoke|instrumental|backing\s*track|minus\s*one|tribute)\b/i,
  /\b(cover(\s*by)?|cover\s*version|fan\s*made|unofficial|ai\s*cover|ai\s*voice|ai\s*song)\b/i,
  /\b(lyric\s*video|with\s*lyrics?|tutorial|reaction|breakdown|explained|status\s*video)\b/i,
  /\b(whatsapp\s*status|ringtone|bgm|loop(ed)?|tiktok\s*version|reels?\s*version|shorts?)\b/i,
  /\b\d+\s*(hour|hours|hr|hrs|minute|minutes|min)\b/i,
  /\b(dj\s*remix|remix\s*by|club\s*mix|extended\s*mix|edm\s*remix|trap\s*remix|phonk\s*remix)\b/i,
];
const SPAM_ARTIST_PATTERNS = [
  ...AI_SLOP_ARTIST_PATTERNS,
  /\b(speed\s*songs?|slowed\s*songs?|reverb\s*nation|nightcore|lofi\s*girl|ai\s*cover|topic\s*music|music\s*lover\s*\d+)\b/i,
  /\b(remix\s*king|remix\s*world|karaoke\s*world|cover\s*world|status\s*king|whatsapp\s*status)\b/i,
  /\b(7clouds|cloudx|wave\s*music|unique\s*vibes|lyrics?|lyrical|lyric\s*zone|status|ringtone|sped\s*up|slowed)\b/i,
];

const ilikeSafeTerm = (value: string) => value.replace(/[%_,()]/g, ' ').replace(/\s+/g, ' ').trim();
const ilikePattern = (value: string) => `%${ilikeSafeTerm(value)}%`;
const buildIlikeOr = (column: string, terms: string[]) =>
  terms.map((term) => `${column}.ilike.${ilikePattern(term)}`).join(',');

type UploadedArtistTrack = IndexedTrack & {
  source: 'artist_upload';
  artistSongId: string;
  artistSlug?: string | null;
};

type ArtistSongSearchRow = {
  id: string;
  artist_user_id: string;
  title: string;
  cover_url: string | null;
  stream_url: string;
  duration: number | null;
  play_count: number | null;
  created_at?: string | null;
};

type ArtistProfileSearchRow = {
  user_id: string;
  stage_name: string;
  slug: string | null;
  avatar_url: string | null;
};

type HiddenSearchEntry = {
  key: string;
  id?: string;
  videoId?: string;
  title: string;
  artist: string;
  hiddenAt: number;
};

function loadHiddenResults(): HiddenSearchEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(HIDDEN_RESULTS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry?.key === 'string') : [];
  } catch {
    return [];
  }
}

function saveHiddenResults(entries: HiddenSearchEntry[]) {
  try {
    localStorage.setItem(HIDDEN_RESULTS_KEY, JSON.stringify(entries.slice(0, 500)));
  } catch { /* ignore quota */ }
}

function isHiddenTrack(track: IndexedTrack, hiddenEntries: HiddenSearchEntry[]) {
  const key = resultKey(track);
  const videoId = track.videoId || (track.id.startsWith('ytm-') ? track.id.slice(4) : undefined);
  return hiddenEntries.some((entry) =>
    entry.key === key ||
    (videoId && entry.videoId === videoId) ||
    (track.id && entry.id === track.id)
  );
}

function hideSearchTrack(track: IndexedTrack) {
  const key = resultKey(track);
  if (!key || key === '::') return;
  const videoId = track.videoId || (track.id.startsWith('ytm-') ? track.id.slice(4) : undefined);
  const existing = loadHiddenResults().filter((entry) => entry.key !== key && entry.id !== track.id && (!videoId || entry.videoId !== videoId));
  saveHiddenResults([
    { key, id: track.id, videoId, title: track.title, artist: track.artist, hiddenAt: Date.now() },
    ...existing,
  ]);
  clearCache(SEARCH_CACHE_NAMESPACE);
}

function isSpamTrack(track: IndexedTrack, query: string) {
  const q = normalizeText(query);
  const title = track.title || "";
  const artist = track.artist || "";
  const haystack = `${title} ${artist} ${track.album || ""}`;
  const normalizedHaystack = normalizeText(haystack);
  const duration = Number(track.duration || 0);
  const allowLongForm = /\b(lofi|mix|playlist|jukebox|medley|concert|live|full album)\b/.test(q);
  
  if (!title || !artist) return true;
  // Excessive duration check (too short or too long unless asked)
  if (duration && (duration < 60 || (!allowLongForm && duration > 660))) return true;
  
  // Detect low-quality automated uploads (common on YouTube)
  const isGenericArtist = /^(original|official|audio|music|songs|topic|records|vevo)$/i.test(normalizeText(artist).trim());
  if (isGenericArtist && !q.includes("original") && !q.includes("topic")) return true;

  if (!q.includes("lofi") && /\blo\s*fi\b|\blofi\b/.test(normalizedHaystack)) return true;
  if (SPAM_ARTIST_PATTERNS.some((pattern) => pattern.test(artist))) return true;
  return SPAM_RESULT_PATTERNS.some((pattern) => pattern.test(haystack));
}

// Lightweight spam check for home rails (Trending/Fresh) — no query context.
export function isSpamSong(input: { title?: string | null; artist?: string | null; album?: string | null; duration?: number | null }): boolean {
  const title = input.title || '';
  const artist = input.artist || '';
  const haystack = `${title} ${artist} ${input.album || ''}`;
  if (!title || !artist) return true;
  const duration = Number(input.duration || 0);
  if (duration && (duration < 45 || duration > 900)) return true;
  if (SPAM_ARTIST_PATTERNS.some((p) => p.test(artist))) return true;
  return SPAM_RESULT_PATTERNS.some((p) => p.test(haystack));
}

function isUploadedArtistTrack(track: IndexedTrack): track is UploadedArtistTrack {
  return (track as { source?: string }).source === 'artist_upload';
}

async function searchUploadedArtistSongs(query: string): Promise<UploadedArtistTrack[]> {
  const rawQuery = query.trim();
  const qNorm = normalizeText(query);
  const tokens = queryTokens(query);
  if (rawQuery.length < 2) return [];

  const likeTerms = [...new Set([rawQuery, ...tokens].map(ilikeSafeTerm).filter((term) => term.length > 1))].slice(0, 8);
  if (!likeTerms.length) return [];
  const titleFilter = buildIlikeOr('title', likeTerms);
  const profileFilter = buildIlikeOr('stage_name', likeTerms);
  const { data: sessionData } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
  const currentUserId = sessionData.session?.user?.id ?? null;

  const [titleSongResult, matchedProfileResult] = await Promise.all([
    supabase
      .from('artist_songs')
      .select('id, artist_user_id, title, cover_url, stream_url, duration, play_count, created_at')
      .eq('status', 'live')
      .or(titleFilter)
      .order('created_at', { ascending: false })
      .limit(60),
    supabase
      .from('artist_profiles')
      .select('user_id, stage_name, slug, avatar_url')
      .or(profileFilter)
      .limit(20),
  ]);

  if (titleSongResult.error) {
    console.warn('Uploaded artist song search failed:', titleSongResult.error.message);
  }
  if (matchedProfileResult.error) {
    console.warn('Uploaded artist profile search failed:', matchedProfileResult.error.message);
  }

  const matchedProfiles = (matchedProfileResult.data ?? []) as ArtistProfileSearchRow[];
  const matchedArtistIds = matchedProfiles.map((profile) => profile.user_id).filter(Boolean);
  const ownerProfileMatched = Boolean(currentUserId && matchedArtistIds.includes(currentUserId));
  const [artistSongResult, ownerTitleSongResult, ownerArtistSongResult] = await Promise.all([
    matchedArtistIds.length
      ? supabase
          .from('artist_songs')
          .select('id, artist_user_id, title, cover_url, stream_url, duration, play_count, created_at')
          .eq('status', 'live')
          .in('artist_user_id', matchedArtistIds)
          .order('created_at', { ascending: false })
          .limit(80)
      : Promise.resolve({ data: [] as ArtistSongSearchRow[] }),
    currentUserId
      ? supabase
          .from('artist_songs')
          .select('id, artist_user_id, title, cover_url, stream_url, duration, play_count, created_at')
          .eq('artist_user_id', currentUserId)
          .neq('status', 'taken_down')
          .or(titleFilter)
          .order('created_at', { ascending: false })
          .limit(80)
      : Promise.resolve({ data: [] as ArtistSongSearchRow[] }),
    ownerProfileMatched && currentUserId
      ? supabase
          .from('artist_songs')
          .select('id, artist_user_id, title, cover_url, stream_url, duration, play_count, created_at')
          .eq('artist_user_id', currentUserId)
          .neq('status', 'taken_down')
          .order('created_at', { ascending: false })
          .limit(120)
      : Promise.resolve({ data: [] as ArtistSongSearchRow[] }),
  ]);

  const songMap = new Map<string, ArtistSongSearchRow>();
  ([
    ...(titleSongResult.data ?? []),
    ...(artistSongResult.data ?? []),
    ...(ownerTitleSongResult.data ?? []),
    ...(ownerArtistSongResult.data ?? []),
  ] as ArtistSongSearchRow[]).forEach((song) => {
    songMap.set(song.id, song);
  });
  const songs = [...songMap.values()];
  if (!songs.length) return [];

  const matchedProfileMap = new Map(matchedProfiles.map((profile) => [profile.user_id, profile]));
  const missingArtistIds = [...new Set(songs.map((song) => song.artist_user_id).filter(Boolean))]
    .filter((id) => !matchedProfileMap.has(id));
  const { data: profileRows } = missingArtistIds.length
    ? await supabase
        .from('artist_profiles')
        .select('user_id, stage_name, slug, avatar_url')
        .in('user_id', missingArtistIds)
    : { data: [] };

  const profiles = new Map(
    ([...matchedProfiles, ...((profileRows ?? []) as ArtistProfileSearchRow[])]).map((profile) => [profile.user_id, profile]),
  );

  return songs
    .map((song) => {
      const profile = profiles.get(song.artist_user_id);
      const artist = profile?.stage_name || 'Universflow Artist';
      const rawHaystack = `${song.title} ${artist}`.toLocaleLowerCase();
      const titleNorm = normalizeText(song.title);
      const artistNorm = normalizeText(artist);
      const haystack = `${titleNorm} ${artistNorm}`;
      const tokenHits = tokens.reduce((sum, token) => sum + (haystack.includes(token) ? 1 : 0), 0);
      const titlePhrase = qNorm.length > 1 && titleNorm.includes(qNorm);
      const rawPhrase = rawHaystack.includes(rawQuery.toLocaleLowerCase());
      if (!rawPhrase && !titlePhrase && (tokens.length > 0 ? tokenHits === 0 : true)) return null;

      return {
        id: `as_${song.id}`,
        title: song.title,
        artist,
        audio_url: song.stream_url,
        album: 'Universflow Artist Upload',
        cover_url: song.cover_url || profile?.avatar_url || undefined,
        duration: song.duration || undefined,
        listeners: Math.max(1, Number(song.play_count || 0)),
        rank: titlePhrase ? 1 : 10 + tokenHits,
        source: 'artist_upload' as const,
        artistSongId: song.id,
        artistSlug: profile?.slug ?? null,
      } satisfies UploadedArtistTrack;
    })
    .filter(Boolean) as UploadedArtistTrack[];
}

function rankAndDedupeResults(query: string, youtube: IndexedTrack[], literal: IndexedTrack[], tagSets: IndexedTrack[][], allowDiscoveryFallback = false) {
  const intent = buildResilientSearchIntent(query);
  const tokens = intent.tokens.length ? intent.tokens : queryTokens(query);
  const qNorm = normalizeText(intent.genre || query);
  const phraseVariants = intent.variants.map(normalizeText).filter((variant) => variant.length > 2);
  const genreIntent = Boolean(intent.genre);
  const allTracks: { track: IndexedTrack; score: number; sourcePriority: number; index: number }[] = [];

  const processTrack = (track: IndexedTrack, base: number, index: number, sourcePriority: number) => {
    if (isSpamTrack(track, query)) return;
    const rawTitle = String(track.title || "");
    const rawArtist = String(track.artist || "");
    const title = normalizeText(rawTitle);
    const artist = normalizeText(rawArtist);
    const haystack = normalizeText(`${rawTitle} ${rawArtist} ${track.album || ""}`);
    
    const tokenHits = tokens.reduce((sum, token) => sum + (haystack.includes(token) ? 1 : 0), 0);
    const phraseHit = phraseVariants.some((variant) => haystack.includes(variant));
    if (!allowDiscoveryFallback && !genreIntent && tokens.length > 0 && tokenHits === 0 && !phraseHit) return;

    // Relevance
    const titleStartsWith = qNorm.length > 1 && title.startsWith(qNorm);
    const titlePhraseHit = phraseVariants.some((variant) => title.includes(variant));
    const titleAllTokens = tokens.length > 0 && tokens.every((t) => title.includes(t));
    const titleTokenHits = tokens.reduce((sum, t) => sum + (title.includes(t) ? 1 : 0), 0);
    const artistTokenHits = tokens.reduce((sum, t) => sum + (artist.includes(t) ? 1 : 0), 0);
    
    const relevance =
      (titleStartsWith ? 1000 : 0) +
      (titlePhraseHit ? 800 : 0) +
      (titleAllTokens ? 600 : 0) +
      titleTokenHits * 150 +
      artistTokenHits * 130 +
      (phraseHit ? 100 : 0);

    // Popularity
    const listeners = Math.max(0, Number(track.listeners) || 0);
    const popularity = Math.min(200, Math.log10(1 + listeners) * 28);
    const viralTier = listeners >= 5_000_000 ? 250 : listeners >= 500_000 ? 120 : 0;

    // Quality signals
    const isOfficial = /\b(VEVO|Topic|Official)\b/i.test(rawArtist) || /\b(official\s*video|official\s*audio|official\s*music\s*video)\b/i.test(rawTitle);
    const officialBonus = isOfficial ? 650 : 0;
    // YT Music's ATV/Songs result is authoritative recording metadata. Generic
    // video uploads and re-uploads must not beat it through title stuffing.
    const kindBonus = track.kind === "song" ? 1500 : -350;

    // Uploader authority: when the title credits an artist ("Ian Asher - ..."),
    // the real upload comes from that artist's own channel. Aggregator/reupload
    // channels credit someone else in the title and must rank below it.
    const credited = cleanIdentity(splitTitleCredit(rawTitle).credit);
    const uploader = cleanIdentity(rawArtist);
    const uploaderIsCredit =
      !!credited && !!uploader && (uploader.includes(credited) || credited.includes(uploader));
    const authority = credited ? (uploaderIsCredit ? 900 : -900) : 0;

    // Noise penalty (refined: don't penalize 'official')
    const actualNoise = /\b(slowed|reverb|8d|lofi|karaoke|instrumental|lyrics?|nightcore|mashup|remix|fan\s*made|unofficial|cover|tribute|ai\s*cover|ai\s*voice)\b/i;
    const parenNoise = (rawTitle.match(/\([^\)]{4,}\)|\[[^\]]{4,}\]/g) || []).length;
    const noiseWords = actualNoise.test(rawTitle) ? 1 : 0;
    const noisePenalty = parenNoise * 40 + noiseWords * 180 + (rawTitle.length > 70 ? 40 : 0);

    const genreBonus = genreIntent ? 420 : 0;
    const score = base + relevance + popularity + viralTier + officialBonus + kindBonus + authority + genreBonus - noisePenalty - index * 0.8;
    allTracks.push({ track, score, sourcePriority, index });
  };

  youtube.forEach((track, index) => processTrack(track, 360, index, 3));
  literal.forEach((track, index) => processTrack(track, 520, index, 2));
  tagSets.forEach((set, setIndex) => set.forEach((track, index) => processTrack(track, 220 + setIndex * 40, index, 1)));

  // Deduplication: collapse every reupload of the same song onto one identity,
  // regardless of which channel uploaded it.
  // Keep exactly one upload for each recording identity. Merely pushing
  // duplicates to the bottom still surfaced the same song repeatedly after
  // scrolling; select the highest-authority candidate before sorting instead.
  const primaryTracks = new Map<string, (typeof allTracks)[number]>();
  for (const candidate of allTracks) {
    const key = songIdentity(candidate.track);
    const current = primaryTracks.get(key);
    if (
      !current ||
      candidate.score > current.score ||
      (candidate.score === current.score && candidate.sourcePriority > current.sourcePriority) ||
      (candidate.score === current.score && candidate.sourcePriority === current.sourcePriority && candidate.index < current.index)
    ) {
      primaryTracks.set(key, candidate);
    }
  }

  return [...primaryTracks.values()]
    .sort((a, b) => b.score - a.score || b.sourcePriority - a.sourcePriority || a.index - b.index)
    .map((candidate) => candidate.track);
}

async function fetchResilientSearchTracks(query: string, limit: number) {
  const intent = buildResilientSearchIntent(query);
  const [youtube, uploaded] = await Promise.all([
    searchYouTubeMusicTracks(query, limit),
    searchUploadedArtistSongs(query),
  ]);

  let expandedYoutube: IndexedTrack[] = [];
  let tagSets: IndexedTrack[][] = [];
  const primary = rankAndDedupeResults(query, [...youtube, ...uploaded], [], [], false);
  const shouldExpand = primary.length < 8 || isGenreSearchIntent(query);

  if (shouldExpand) {
    const normalizedOriginal = normalizeText(query);
    const expansionQueries = intent.variants
      .filter((variant) => normalizeText(variant) !== normalizedOriginal)
      .slice(0, 5);
    const genreQueries = intent.genre ? (GENRE_QUERY_ALIASES[intent.genre] || [intent.genre]).slice(0, 4) : [];
    const [expandedSets, genreSets] = await Promise.all([
      Promise.all(expansionQueries.map((variant, index) => searchYouTubeMusicTracks(variant, Math.max(80, Math.min(limit, 160)), `resilient-${normalizedOriginal}-${index}`))),
      Promise.all(genreQueries.map((tag) => getTagTopTracks(tag, 50))),
    ]);
    expandedYoutube = expandedSets.flat();
    tagSets = genreSets;
  }

  return rankAndDedupeResults(query, [...youtube, ...expandedYoutube, ...uploaded], [], tagSets, false);
}

const Search = () => {
  const [query, setQuery] = useState('');
  const [indexedResults, setIndexedResults] = useState<IndexedTrack[]>([]);
  const [artistResults, setArtistResults] = useState<IndexedArtistInfo[]>([]);
  const [searching, setSearching] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [source, setSource] = useState<SearchSource>('songs');
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [searchHistory, setSearchHistory] = useState<SongHistoryEntry[]>(() => getSongHistory());
  const [hiddenResults, setHiddenResults] = useState<HiddenSearchEntry[]>(() => loadHiddenResults());
  const [visibleCount, setVisibleCount] = useState(40);
  const [loadingMore, setLoadingMore] = useState(false);
  
  // Live autocomplete from YT Music Innertube. Suppressed once the user has
  // actually triggered a search (we don't want it covering results).
  const [suggestActive, setSuggestActive] = useState(true);
  const suggestions = useYtmSuggestions(query, suggestActive && isFocused);

  const expandedQueriesRef = useRef<Set<string>>(new Set());
  const { playSong, currentSong, isPlaying } = usePlayer();
  const { getDownloadedUrl } = useDownloads();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const scrollRef = useRef<HTMLElement>(null);


  useEffect(() => {
    const urlQuery = params.get('q')?.trim() || '';
    if (urlQuery && urlQuery !== query.trim()) setQuery(urlQuery);
  }, [params, query]);

  // Refresh history snapshot whenever the currently playing song changes
  useEffect(() => {
    if (currentSong) setSearchHistory(getSongHistory());
  }, [currentSong]);

  useEffect(() => {
    const trimmedQuery = query.trim();

    if (trimmedQuery.length < 2) {
      setIndexedResults([]);
      setArtistResults([]);
      setSearching(false);
      setVisibleCount(40);
      return;
    }

    // INSTANT skeleton: flip to "searching" + clear previous rows the moment
    // the user types, so they always see the loading state — never stale hits.
    setSearching(true);
    setIndexedResults([]);
    setVisibleCount(40);
    expandedQueriesRef.current.delete(trimmedQuery);



    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const cached = getCached<IndexedTrack[]>(SEARCH_CACHE_NAMESPACE, trimmedQuery);
        if (cached) {
          const uploaded = await searchUploadedArtistSongs(trimmedQuery);
          if (!cancelled) {
            setIndexedResults(rankAndDedupeResults(trimmedQuery, [...cached, ...uploaded], [], [], false)
              .filter((track) => !isHiddenTrack(track, hiddenResults)));
            setSearching(false);
          }
          return;
        }
        const artistJob = searchArtistDirectory(trimmedQuery, 30);
        const [rankedTracks, artists] = await Promise.all([
          fetchResilientSearchTracks(trimmedQuery, 200),
          artistJob,
        ]);
        if (cancelled) return;

        const merged = rankedTracks
          .filter((track) => !isHiddenTrack(track, hiddenResults))
          .slice(0, 300);

        setCached(SEARCH_CACHE_NAMESPACE, trimmedQuery, merged);
        // Artist tab only: require a strong artist-name match. Do NOT allow
        // substring/plural matches like "Headlight" -> "Headlights" because that
        // hijacked song searches and surfaced fake-looking artist cards.
        const qNorm = normalizeText(trimmedQuery);
        const qArtistTokens = queryTokens(trimmedQuery);
        const MIN_ARTIST_LISTENERS = 50_000;
        const verifiedArtists = artists.filter((a) => {
          if (!a.image_url) return false;
          const nameNorm = normalizeText(a.name || '');
          if (!nameNorm) return false;
          // Hard-block spam artist patterns (remix kings, status channels, AI covers, etc.)
          if (SPAM_ARTIST_PATTERNS.some((p) => p.test(a.name || ''))) return false;
          const nameTokens = nameNorm.split(' ').filter(Boolean);
          const nameMatches = nameNorm === qNorm || (
            qArtistTokens.length > 0 && qArtistTokens.every((token) => nameTokens.includes(token))
          );
          const hasListeners = typeof a.listeners === 'number' && a.listeners >= MIN_ARTIST_LISTENERS;
          return nameMatches && hasListeners;
        });
        setArtistResults(verifiedArtists.slice(0, 24));
        setIndexedResults(merged);
        setSearchHistory(getSongHistory());
      } catch {
        if (!cancelled) { setIndexedResults([]); setArtistResults([]); }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, hiddenResults]);

  useEffect(() => {
    indexedResults.slice(0, 6).forEach((track) => {
      if (track.videoId) prefetchYouTubeVideoStream(track.videoId, { title: track.title, artist: track.artist });
      else prefetchIndexedTrack(track.artist, track.title);
    });
  }, [indexedResults]);

  const libraryResults: Song[] = [];
  const hasQuery = query.length > 1;
  const visibleIndexedResults = source === 'songs' ? indexedResults : [];
  const displayedIndexedResults = visibleIndexedResults.slice(0, visibleCount);
  const hasMoreLocal = visibleCount < visibleIndexedResults.length;

  // Deeper server fetch when the local pool is exhausted. Runs once per query.
  const fetchMoreFromServer = useCallback(async () => {
    const trimmed = query.trim();
    if (trimmed.length < 2) return;
    if (expandedQueriesRef.current.has(trimmed)) return;
    expandedQueriesRef.current.add(trimmed);
    setLoadingMore(true);
    try {
      const deeper = await fetchResilientSearchTracks(trimmed, 400);
      // Deeper pages MUST go through the same ranker/spam filter as page one —
      // appending raw source order is what let junk results reappear on scroll.
      const ranked = rankAndDedupeResults(trimmed, deeper, [], [], false);
      const existing = new Set(indexedResults.map((t) => t.id));
      const additions = ranked.filter(
        (t) => !existing.has(t.id) && !isHiddenTrack(t, hiddenResults),
      );
      if (additions.length > 0) {
        setIndexedResults((prev) => [...prev, ...additions]);
      }
    } catch {
      /* ignore */
    } finally {
      setLoadingMore(false);
    }
  }, [query, indexedResults, hiddenResults]);


  // Infinite scroll — bump visibleCount as the user nears the bottom; when the
  // local pool runs out, request a deeper page from the server.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || source !== 'songs') return;
    const onScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (distanceFromBottom < 600) {
        if (hasMoreLocal) {
          setVisibleCount((n) => Math.min(n + 40, visibleIndexedResults.length));
        } else if (!loadingMore) {
          void fetchMoreFromServer();
        }
      }
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [source, hasMoreLocal, loadingMore, visibleIndexedResults.length, fetchMoreFromServer]);


  const handleHideIndexed = useCallback((track: IndexedTrack) => {
    hideSearchTrack(track);
    const nextHidden = loadHiddenResults();
    setHiddenResults(nextHidden);
    setIndexedResults((results) => results.filter((item) => !isHiddenTrack(item, nextHidden)));
  }, []);


  const handlePlayIndexed = useCallback((track: IndexedTrack) => {
    const trackAudioUrl = track.audio_url || (track.videoId ? `yt-video:${track.videoId}` : 'resolving');
    const song: Song = {
      id: track.id,
      title: track.title,
      artist: track.artist,
      album: track.album,
      cover_url: track.cover_url,
      audio_url: trackAudioUrl,
      duration: track.duration,
      source: 'indexed',
    };
    playSong(song, undefined, displayedIndexedResults.map((item) => ({
      id: item.id,
      title: item.title,
      artist: item.artist,
      album: item.album,
      cover_url: item.cover_url,
      audio_url: item.audio_url || (item.videoId ? `yt-video:${item.videoId}` : 'resolving'),
      duration: item.duration,
      source: 'indexed' as const,
    })));
  }, [playSong, displayedIndexedResults]);

  return (
    <TabTransition>
      <div className="ethereal-page h-[100dvh] flex flex-col overflow-hidden relative">
        <SEOHead
          title="Search Music — Songs, Artists & Albums | Univers Flow"
          description="Search any song, artist, or album worldwide. Discover and play tracks instantly on Univers Flow."
          path="/search"
          jsonLdId="search-jsonld"
          jsonLd={{
            '@context': 'https://schema.org',
            '@type': 'SearchResultsPage',
            name: 'Search — Univers Flow',
            url: 'https://universflow.in/search',
            isPartOf: { '@type': 'WebSite', name: 'Univers Flow', url: 'https://universflow.in' },
          }}
        />
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-0" style={{
            background: `radial-gradient(ellipse 80% 50% at 50% 0%, hsl(260 100% 60% / 0.05), transparent),
              radial-gradient(ellipse 60% 40% at 80% 20%, hsl(330 100% 65% / 0.04), transparent)`,
          }} />
        </div>

        {/* Header — rose-ember hero matching Home */}
        <header className="flex-shrink-0 z-30 px-3 pt-3 pb-3 safe-area-pt">
          <h1 className="sr-only">Search Music — Songs, Artists &amp; Albums</h1>
          <RoseHero
            eyebrow="Universflow"
            title="DISCOVER"
            subtitle="Songs · artists · albums · worldwide"
            compact
          />
          <div className="px-1 mt-3">


          <div className="relative">
            <SearchIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input value={query} onChange={(e) => { setQuery(e.target.value); setSuggestActive(true); }}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setTimeout(() => setIsFocused(false), 150)}
              placeholder="Any song, artist, or album worldwide"
              aria-label="Search songs, artists, or albums"
              className="pl-10 pr-8 h-12 text-sm rounded-3xl border-0 bg-card"
              style={{
                background: 'hsl(var(--foreground) / 0.05)',
                border: isFocused ? '1px solid hsl(var(--primary) / 0.4)' : '1px solid hsl(var(--foreground) / 0.05)',
                transition: 'border-color 0.2s',
              }} />
            {query && (
              <button onClick={() => { setQuery(''); setIndexedResults([]); setArtistResults([]); setSuggestActive(true); }}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-full"
                style={{ background: 'hsl(var(--foreground) / 0.12)' }}>
                <X className="w-3 h-3" />
              </button>
            )}

            {/* Live autocomplete dropdown (YT Music suggestions).
                No exit animation / AnimatePresence here on purpose: framer
                removes exiting nodes itself, and while a sibling list is
                re-rendering that races React and throws
                "removeChild: node is not a child of this node", which blanked
                the whole Search screen behind the error boundary. */}
            {isFocused && suggestActive && suggestions.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.14 }}
                className="absolute left-0 right-0 top-full mt-2 z-40 rounded-2xl overflow-hidden"
                style={{
                  background: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--foreground) / 0.05)',
                  boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
                }}
              >
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { setQuery(s); setSuggestActive(false); }}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-sm hover:bg-foreground/5 active:bg-foreground/10 transition-colors"
                  >
                    <SearchIcon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    <span className="truncate">{s}</span>
                  </button>
                ))}
              </motion.div>
            )}

          </div>

          {/* Source tabs */}
          {hasQuery && (
            <div className="flex gap-2 mt-2.5 overflow-x-auto hide-scrollbar">
              {([
                { key: 'songs' as SearchSource, label: 'Songs', icon: Music, count: indexedResults.length },
                { key: 'artists' as SearchSource, label: 'Artists', icon: Radio, count: artistResults.length },
              ]).map(tab => (
                <motion.button key={tab.key} onClick={() => setSource(tab.key)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all flex-shrink-0"
                  style={{
                    background: source === tab.key ? 'linear-gradient(135deg, hsl(var(--primary)), hsl(18 100% 82%))' : 'hsl(var(--card))',
                    border: source === tab.key ? '1px solid hsl(0 0% 100% / 0.12)' : '1px solid hsl(0 0% 100% / 0.06)',
                    color: source === tab.key ? 'hsl(var(--background))' : undefined,
                  }} whileTap={{ scale: 0.95 }}>
                  <tab.icon className="w-3 h-3" />
                  {tab.label}
                  {tab.count > 0 && (
                    <span className="ml-0.5 text-[10px] opacity-60">{tab.count}</span>
                  )}
                </motion.button>
              ))}
            </div>
          )}

          </div>
        </header>

        {/* Content */}
        <main ref={scrollRef} className="flex-1 overflow-y-auto px-4 pt-4 pb-32 relative z-10" style={{ WebkitOverflowScrolling: 'touch' }}>
          {!query && (
            <motion.div key="browse" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}>


                {/* Recently Played (song-based history, Spotify-style) */}
                {searchHistory.length > 0 && (
                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-2">
                      <h2 className="font-display text-[32px] font-black uppercase tracking-[0.04em] leading-none flex items-center gap-2">
                        <Clock className="w-4 h-4 text-muted-foreground" /> Recently Played
                      </h2>
                      <button
                        onClick={() => { clearSongHistory(); setSearchHistory([]); }}
                        className="text-[11px] text-muted-foreground flex items-center gap-1"
                      >
                        <Trash2 className="w-3 h-3" /> Clear
                      </button>
                    </div>
                    <div className="space-y-1">
                      {searchHistory.slice(0, 20).map((entry) => {
                        const isActive = currentSong?.id === entry.id;
                        return (
                          <motion.div
                            key={entry.id}
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            className={`flex items-center gap-3 px-2 py-2 rounded-[28px] active:scale-[0.98] transition-all ${isActive ? 'bg-primary/10' : 'bg-card/40 active:bg-foreground/5'}`}
                          >
                            <button
                              className="flex items-center gap-3 flex-1 min-w-0 text-left"
                              onClick={async () => {
                                if (entry.source === 'indexed' || entry.source === 'audius') {
                                  playSong({
                                    id: entry.id,
                                    title: entry.title,
                                    artist: entry.artist,
                                    album: entry.album,
                                    cover_url: entry.cover_url,
                                    audio_url: entry.audio_url || 'resolving',
                                    duration: entry.duration,
                                    source: 'indexed',
                                  });
                                } else if (entry.audio_url) {
                                  playSong({
                                    id: entry.id,
                                    title: entry.title,
                                    artist: entry.artist,
                                    album: entry.album,
                                    cover_url: entry.cover_url,
                                    audio_url: entry.audio_url,
                                    duration: entry.duration,
                                    source: entry.source || 'library',
                                  });
                                }
                              }}
                            >
                              <div className="w-11 h-11 rounded-[14px] overflow-hidden flex-shrink-0 bg-muted">
                                {entry.cover_url ? (
                                  <img src={entry.cover_url} alt="" className="w-full h-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
                                ) : (
                                  <div className="w-full h-full bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center">
                                    <Music className="w-4 h-4 text-foreground/40" />
                                  </div>
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className={`font-semibold text-[13px] truncate ${isActive ? 'text-primary' : ''}`}>
                                  {resolvingId === entry.id ? 'Loading…' : entry.title}
                                </p>
                                <p className="text-[11px] text-muted-foreground/60 truncate mt-0.5">{entry.artist}</p>
                              </div>
                            </button>
                            <button
                              onClick={() => {
                                removeSongFromHistory(entry.id);
                                setSearchHistory(getSongHistory());
                              }}
                              className="w-7 h-7 flex items-center justify-center rounded-full text-muted-foreground active:bg-foreground/10"
                              aria-label="Remove from history"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </motion.div>
                        );
                      })}
                    </div>
                  </div>
                )}


            </motion.div>
          )}


          {/* Results */}
          {searching ? <SearchSkeleton /> : (
            <>
              {source === 'songs' && displayedIndexedResults.length > 0 && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={libraryResults.length > 0 ? 'mt-6' : ''}>
                  <h2 className="font-display text-[32px] font-black uppercase tracking-[0.04em] leading-none mb-3 flex items-center gap-2">
                    <Music className="w-4 h-4 text-primary" />
                    Songs
                    <span className="text-[11px] font-bold tracking-[0.18em] text-muted-foreground">{displayedIndexedResults.length}{hasMoreLocal || loadingMore ? '+' : ''}</span>
                  </h2>
                  <VirtualList<IndexedTrack>
                    items={displayedIndexedResults}
                    estimateSize={68}
                    gap={4}
                    scrollParentRef={scrollRef as any}
                    getKey={(track) => track.id}
                    renderItem={(track) => {
                      const isActive = currentSong?.id === track.id;
                      const isResolving = resolvingId === track.id;
                      return (
                        <div
                          className={`flex items-center gap-3 px-3 py-2.5 rounded-[28px] cursor-pointer active:scale-[0.98] transition-all ${isActive ? 'bg-primary/10' : 'bg-card/40 active:bg-foreground/5'} ${isResolving ? 'opacity-60' : ''}`}
                          onClick={() => !isResolving && handlePlayIndexed(track)}
                          onPointerDown={() => prewarmSong({ id: track.id, title: track.title, artist: track.artist, videoId: track.videoId, audio_url: track.audio_url })}
                        >
                          <div className={`relative w-12 h-12 rounded-[14px] overflow-hidden flex-shrink-0 ${isActive ? 'shadow-lg shadow-primary/20' : 'shadow-md'}`}>
                            {track.cover_url ? (
                              <img src={track.cover_url} alt={`${track.title} cover art`} className="w-full h-full object-cover" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                            ) : (
                              <div className="w-full h-full bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center">
                                <Music className="w-4 h-4 text-foreground/30" />
                              </div>
                            )}
                            <div className="absolute bottom-0 right-0 w-4 h-4 rounded-tl-md bg-primary flex items-center justify-center">
                              <Radio className="w-2.5 h-2.5 text-primary-foreground" />
                            </div>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`font-semibold text-[13px] truncate ${isActive ? 'text-primary' : 'text-foreground'}`}>
                              {isResolving ? 'Starting song...' : track.title}
                            </p>
                            <p className="text-[11px] text-muted-foreground/60 truncate mt-0.5">{track.artist}</p>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {isActive && isPlaying ? (
                              <div className="flex items-end gap-[2px] h-4 mr-1">
                                {[0, 1, 2].map((j) => (
                                  <div key={j} className="w-[3px] bg-primary rounded-full animate-audio-wave" style={{ animationDelay: `${j * 0.12}s` }} />
                                ))}
                              </div>
                            ) : isResolving ? (
                              <Loader2 className="w-4 h-4 animate-spin text-primary" />
                            ) : (
                              <LikeButton songId={track.id} song={{ id: track.id, title: track.title, artist: track.artist, cover_url: track.cover_url, audio_url: 'resolving', duration: track.duration, source: (track as { source?: string }).source === 'audius' ? 'audius' : 'indexed' } as Song} size="sm" className="w-8 h-8" />
                            )}
                          </div>
                        </div>
                      );
                    }}
                  />
                  {(hasMoreLocal || loadingMore) && (
                    <div className="flex items-center justify-center py-6 text-xs text-muted-foreground gap-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Loading more…
                    </div>
                  )}
                </motion.div>
              )}

              {/* Artists tab — grid of real artist profiles */}
              {source === 'artists' && artistResults.length > 0 && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <h2 className="font-display text-[32px] font-black uppercase tracking-[0.04em] leading-none mb-3 flex items-center gap-2">
                    <Radio className="w-4 h-4 text-primary" />
                    Artists · {artistResults.length}
                  </h2>
                  <div className="grid grid-cols-2 gap-3">
                    {artistResults.map((a, i) => (
                      <motion.button
                        key={`${a.name}-${i}`}
                        type="button"
                        onClick={() => navigate(`/artists?focus=${encodeURIComponent(a.name)}`)}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.03, duration: 0.25 }}
                        className="relative aspect-square overflow-hidden rounded-[28px] text-left active:scale-[0.97] transition-transform bg-card border border-border"
                      >
                        <img
                          src={a.image_url}
                          alt={`${a.name} artist photo`}
                          className="absolute inset-0 w-full h-full object-cover"
                          style={{ objectPosition: '50% 22%' }}
                          loading="lazy"
                          decoding="async"
                          referrerPolicy="no-referrer"
                        />
                        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />
                        <div className="absolute left-3 right-3 bottom-3">
                          <p className="text-[9px] font-extrabold uppercase tracking-[0.18em] text-muted-foreground">Artist</p>
                          <p className="text-sm font-bold tracking-tight text-white truncate mt-0.5">{a.name}</p>
                        </div>
                      </motion.button>
                    ))}
                  </div>
                </motion.div>
              )}

              {source === 'artists' && !searching && query.length > 1 && artistResults.length === 0 && (
                <div className="flex flex-col items-center text-center py-12 px-6">
                  <div className="neu-inset w-20 h-20 rounded-[28px] flex items-center justify-center mb-4">
                    <UserSearch className="w-8 h-8 text-muted-foreground" aria-hidden />
                  </div>
                  <h3 className="font-display text-[22px] font-black uppercase tracking-[0.04em] leading-none">No artists found</h3>
                  <p className="mt-2 text-[13px] text-muted-foreground max-w-[260px]">We couldn't find an artist matching "{query}". Artist names work best spelled exactly.</p>
                  <button
                    onClick={() => setSource('songs')}
                    className="neu-accent neu-press mt-5 px-5 py-2.5 rounded-full text-[11px] font-black uppercase tracking-[0.18em]">
                    Search songs instead
                  </button>
                </div>
              )}



              {/* No results */}
              {source === 'songs' && query.length > 1 && !searching && libraryResults.length === 0 && displayedIndexedResults.length === 0 && (
                <div className="flex flex-col items-center text-center py-12 px-6">
                  <div className="neu-inset w-20 h-20 rounded-[28px] flex items-center justify-center mb-4">
                    <Music className="w-8 h-8 text-muted-foreground" aria-hidden />
                  </div>
                  <h3 className="font-display text-[22px] font-black uppercase tracking-[0.04em] leading-none">Nothing here yet</h3>
                  <p className="mt-2 text-[13px] text-muted-foreground max-w-[260px]">No tracks matched "{query}". Try a shorter title, or look for the artist instead.</p>
                  <div className="flex items-center gap-2 mt-5">
                    <button
                      onClick={() => setSource('artists')}
                      className="neu-accent neu-press px-5 py-2.5 rounded-full text-[11px] font-black uppercase tracking-[0.18em]">
                      Find the artist
                    </button>
                    <button
                      onClick={() => setQuery('')}
                      className="neu-sm neu-press px-5 py-2.5 rounded-full text-[11px] font-black uppercase tracking-[0.18em] text-muted-foreground">
                      Clear
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </main>

        <BottomNav />
      </div>
    </TabTransition>
  );
};

export default Search;
