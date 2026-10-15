import { describe, expect, it } from 'vitest';
import { isAiGeneratedTrack } from '../aiSlopFilter';
import { cleanRail } from '../railQuality';
import type { Song } from '@/contexts/PlayerContext';

describe('real music editorial rails', () => {
  it.each(['Made with AI', 'AI-generated vocals', 'A.I. cover', 'Synthetic vocals', 'ＡＩ music', 'Suno version', 'Song using AI', 'Song [AI]', 'AI-assisted composition', 'Composed by AI', 'Made-with-AI', 'A\u200bI-generated vocals'])('rejects disclosed synthetic music: %s', (label) => {
    expect(isAiGeneratedTrack({ title: label, artist: 'Uploader' })).toBe(true);
  });
  it('rejects AI disclosure in album metadata', () => {
    expect(isAiGeneratedTrack({ title: 'New Single', artist: 'Uploader', album: 'Produced using Udio' })).toBe(true);
  });
  it('does not mistake ordinary artist names and titles for AI disclosure', () => {
    expect(isAiGeneratedTrack({ title: 'Something in the Air', artist: 'Air' })).toBe(false);
    expect(isAiGeneratedTrack({ title: 'Ai Se Eu Te Pego', artist: 'Michel Teló' })).toBe(false);
  });
  it('removes synthetic tracks while preserving real chart and release order', () => {
    const rows = [
      { id: 'first', title: 'Real First', artist: 'Artist One', cover_url: '/cover.jpg' },
      { id: 'fake', title: 'Generated using Suno', artist: 'Uploader', cover_url: '/cover.jpg' },
      { id: 'second', title: 'Real Second', artist: 'Artist Two', cover_url: '/cover.jpg' },
    ] as Song[];
    expect(cleanRail(rows, { requireCover: true }).map(s => s.id)).toEqual(['first', 'second']);
  });
});