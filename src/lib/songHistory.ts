// Persistent song-based search history (Spotify-style).
// Replaces the old text-only history. Each entry stores enough metadata
// to re-play instantly without another API roundtrip.

import type { Song } from '@/contexts/PlayerContext';

const KEY = 'uf_song_history_v1';
const MAX = 100;

export interface SongHistoryEntry {
  id: string;
  title: string;
  artist: string;
  album?: string;
  cover_url?: string;
  audio_url?: string;
  duration?: number;
  source?: Song['source'];
  ts: number;
}

export function getSongHistory(): SongHistoryEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function addSongToHistory(song: Song) {
  if (!song?.id) return;
  try {
    const list = getSongHistory().filter(e => e.id !== song.id);
    list.unshift({
      id: song.id,
      title: song.title,
      artist: song.artist,
      album: song.album,
      cover_url: song.cover_url,
      audio_url: song.audio_url,
      duration: song.duration,
      source: song.source,
      ts: Date.now(),
    });
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    // Storage quota — ignore
  }
}

export function removeSongFromHistory(id: string) {
  try {
    const list = getSongHistory().filter(e => e.id !== id);
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

export function clearSongHistory() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

// Map mood names → smart search terms used against Last.fm tag/track index.
// This makes Search mood chips work for streaming songs, not just catalog.
export const MOOD_QUERIES: Record<string, string[]> = {
  Chill: ['chill', 'lofi chill', 'chillout', 'relaxing'],
  Energetic: ['workout', 'hype', 'energetic edm', 'pump up'],
  Romantic: ['love song', 'romantic', 'slow dance', 'romance'],
  Focus: ['focus music', 'study lofi', 'concentration', 'instrumental focus'],
  Sad: ['sad song', 'heartbreak', 'melancholy', 'crying'],
  Happy: ['happy song', 'feel good', 'upbeat'],
  Party: ['party hit', 'club banger', 'dance party'],
};

export const GENRE_QUERIES: Record<string, string[]> = {
  Pop: ['top pop hits', 'pop'],
  Rock: ['rock anthem', 'classic rock', 'rock'],
  'Hip Hop': ['hip hop hits', 'rap', 'trap'],
  'R&B': ['r&b', 'rnb soul'],
  Electronic: ['edm', 'electronic dance', 'house'],
  Jazz: ['jazz', 'smooth jazz'],
};
