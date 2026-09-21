/**
 * Moments — premium "Memory Tape".
 *
 * A Moment is a bookmarked second of a song plus how it felt. Moments replay
 * as a tape: each saved second plays for a short clip, then the tape moves on,
 * so a month of listening becomes one continuous memory reel.
 *
 * Pure helpers here are unit-tested; Supabase access is thin and typed.
 */
import { supabase } from '@/integrations/supabase/client';
import type { Song } from '@/contexts/PlayerContext';

export interface Moment {
  id: string;
  songId: string;
  songTitle: string;
  songArtist: string;
  coverUrl: string | null;
  audioUrl: string | null;
  source: string | null;
  positionMs: number;
  clipMs: number;
  feeling: string | null;
  note: string | null;
  createdAt: string;
}

export interface MomentInput {
  song: Pick<Song, 'id' | 'title' | 'artist' | 'cover_url' | 'audio_url' | 'source'>;
  positionMs: number;
  clipMs?: number;
  feeling?: string | null;
  note?: string | null;
}

export interface Feeling {
  id: string;
  label: string;
  emoji: string;
}

/** Fixed, human feelings — no free-form taxonomy to keep the tape readable. */
export const FEELINGS: Feeling[] = [
  { id: 'goosebumps', label: 'Goosebumps', emoji: '✨' },
  { id: 'heartbreak', label: 'Heartbreak', emoji: '💔' },
  { id: 'euphoria', label: 'Euphoria', emoji: '🔥' },
  { id: 'nostalgia', label: 'Nostalgia', emoji: '🕰️' },
  { id: 'calm', label: 'Calm', emoji: '🌊' },
  { id: 'drive', label: 'Late drive', emoji: '🌙' },
];

export const DEFAULT_CLIP_MS = 30_000;
export const MIN_CLIP_MS = 10_000;
export const MAX_CLIP_MS = 60_000;

export const getFeeling = (id: string | null | undefined): Feeling | null =>
  FEELINGS.find((f) => f.id === id) ?? null;

/** mm:ss stamp for the exact bookmarked second. */
export const formatMomentStamp = (positionMs: number): string => {
  const total = Math.max(0, Math.floor((Number.isFinite(positionMs) ? positionMs : 0) / 1000));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

export const clampClipMs = (clipMs: number): number => {
  if (!Number.isFinite(clipMs)) return DEFAULT_CLIP_MS;
  return Math.min(MAX_CLIP_MS, Math.max(MIN_CLIP_MS, Math.round(clipMs)));
};

export interface MomentGroup {
  key: string;
  label: string;
  moments: Moment[];
}

/** Groups moments into month buckets, newest month first, newest moment first. */
export const groupMomentsByMonth = (moments: Moment[]): MomentGroup[] => {
  const buckets = new Map<string, Moment[]>();
  [...moments]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .forEach((moment) => {
      const date = new Date(moment.createdAt);
      const key = Number.isNaN(date.getTime())
        ? 'unknown'
        : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const list = buckets.get(key);
      if (list) list.push(moment);
      else buckets.set(key, [moment]);
    });

  return [...buckets.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, list]) => {
      let label = 'Undated';
      if (key !== 'unknown') {
        const [year, month] = key.split('-').map(Number);
        label = new Date(year, (month ?? 1) - 1, 1).toLocaleString(undefined, {
          month: 'long',
          year: 'numeric',
        });
      }
      return { key, label, moments: list };
    });
};

/** Total tape runtime in seconds. */
export const getTapeDurationSeconds = (moments: Moment[]): number =>
  Math.round(moments.reduce((sum, m) => sum + clampClipMs(m.clipMs), 0) / 1000);

/** Rebuilds a playable Song from a stored moment. */
export const momentToSong = (moment: Moment): Song => ({
  id: moment.songId,
  title: moment.songTitle,
  artist: moment.songArtist,
  cover_url: moment.coverUrl ?? undefined,
  audio_url: moment.audioUrl ?? '',
  source: (moment.source as Song['source']) ?? undefined,
});

type MomentRow = {
  id: string;
  song_id: string;
  song_title: string;
  song_artist: string | null;
  cover_url: string | null;
  audio_url: string | null;
  source: string | null;
  position_ms: number;
  clip_ms: number;
  feeling: string | null;
  note: string | null;
  created_at: string;
};

export const mapMomentRow = (row: MomentRow): Moment => ({
  id: row.id,
  songId: row.song_id,
  songTitle: row.song_title,
  songArtist: row.song_artist ?? '',
  coverUrl: row.cover_url,
  audioUrl: row.audio_url,
  source: row.source,
  positionMs: row.position_ms,
  clipMs: clampClipMs(row.clip_ms),
  feeling: row.feeling,
  note: row.note,
  createdAt: row.created_at,
});

export const fetchMoments = async (userId: string): Promise<Moment[]> => {
  const { data, error } = await supabase
    .from('song_moments')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(300);
  if (error) throw error;
  return (data ?? []).map((row) => mapMomentRow(row as MomentRow));
};

export const createMoment = async (userId: string, input: MomentInput): Promise<Moment> => {
  const { data, error } = await supabase
    .from('song_moments')
    .insert({
      user_id: userId,
      song_id: input.song.id,
      song_title: input.song.title,
      song_artist: input.song.artist ?? '',
      cover_url: input.song.cover_url ?? null,
      audio_url: input.song.audio_url ?? null,
      source: input.song.source ?? null,
      position_ms: Math.max(0, Math.round(input.positionMs)),
      clip_ms: clampClipMs(input.clipMs ?? DEFAULT_CLIP_MS),
      feeling: input.feeling ?? null,
      note: input.note?.trim() ? input.note.trim().slice(0, 180) : null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return mapMomentRow(data as MomentRow);
};

export const deleteMoment = async (id: string): Promise<void> => {
  const { error } = await supabase.from('song_moments').delete().eq('id', id);
  if (error) throw error;
};
