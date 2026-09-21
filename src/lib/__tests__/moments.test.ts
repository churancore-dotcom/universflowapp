import { describe, expect, it } from 'vitest';
import {
  clampClipMs,
  DEFAULT_CLIP_MS,
  formatMomentStamp,
  getFeeling,
  getTapeDurationSeconds,
  groupMomentsByMonth,
  momentToSong,
  type Moment,
} from '@/lib/moments';

const moment = (id: string, createdAt: string, clipMs = 30_000): Moment => ({
  id,
  songId: `song-${id}`,
  songTitle: `Song ${id}`,
  songArtist: 'Artist',
  coverUrl: null,
  audioUrl: 'https://example.com/a.mp3',
  source: 'audius',
  positionMs: 95_000,
  clipMs,
  feeling: 'goosebumps',
  note: null,
  createdAt,
});

describe('moments helpers', () => {
  it('stamps the bookmarked second as mm:ss', () => {
    expect(formatMomentStamp(0)).toBe('0:00');
    expect(formatMomentStamp(95_000)).toBe('1:35');
    expect(formatMomentStamp(Number.NaN)).toBe('0:00');
  });

  it('clamps clip length into a listenable range', () => {
    expect(clampClipMs(1_000)).toBe(10_000);
    expect(clampClipMs(90_000)).toBe(60_000);
    expect(clampClipMs(Number.NaN)).toBe(DEFAULT_CLIP_MS);
  });

  it('groups moments into months, newest month first', () => {
    const groups = groupMomentsByMonth([
      moment('a', '2026-08-02T10:00:00Z'),
      moment('b', '2026-09-11T10:00:00Z'),
      moment('c', '2026-09-20T10:00:00Z'),
    ]);
    expect(groups.map((g) => g.key)).toEqual(['2026-09', '2026-08']);
    expect(groups[0].moments.map((m) => m.id)).toEqual(['c', 'b']);
  });

  it('sums tape runtime from clamped clips', () => {
    expect(getTapeDurationSeconds([moment('a', '2026-09-01T00:00:00Z', 30_000), moment('b', '2026-09-01T00:00:00Z', 5_000)])).toBe(40);
  });

  it('rebuilds a playable song and resolves feelings', () => {
    const song = momentToSong(moment('a', '2026-09-01T00:00:00Z'));
    expect(song.id).toBe('song-a');
    expect(song.audio_url).toBe('https://example.com/a.mp3');
    expect(getFeeling('goosebumps')?.emoji).toBe('✨');
    expect(getFeeling('nope')).toBeNull();
  });
});
