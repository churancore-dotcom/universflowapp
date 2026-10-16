import { describe, expect, it } from 'vitest';
import { cleanRail, claimRailSongs, claimedByOtherRails, songFingerprint } from '../railQuality';
import { isSpamSong } from '../../pages/Search';
import type { Song } from '@/contexts/PlayerContext';

describe('Release Feed & Filtering Integration', () => {
  const mockSongs: Song[] = [
    { id: '1', title: 'Fresh Single', artist: 'Real Artist', cover_url: 'c1', audio_url: '' },
    { id: '2', title: 'Trending Hit', artist: 'Popular Artist', cover_url: 'c2', audio_url: '' },
    { id: '3', title: 'AI Song (Suno)', artist: 'Uploader', cover_url: 'c3', audio_url: '' },
    { id: '4', title: 'Trash (Slowed + Reverb)', artist: 'Uploader', cover_url: 'c4', audio_url: '' },
    { id: '5', title: 'Jukebox Medley', artist: 'Various Artists', cover_url: 'c5', audio_url: '' },
    { id: '6', title: 'Fresh Single', artist: 'Real Artist', cover_url: 'c6', audio_url: '' }, // Duplicate
  ];

  it('filters spam and junk correctly for FreshReleasesSection', () => {
    const fresh = mockSongs.filter(s => !isSpamSong(s));
    
    // Debug: see what's left after isSpamSong
    const freshTitles = fresh.map(s => s.title);
    console.log('After isSpamSong:', freshTitles);

    const cleaned = cleanRail(fresh, { requireCover: true });
    
    const titles = cleaned.map(s => s.title);
    console.log('After cleanRail:', titles);

    expect(titles).toContain('Fresh Single');
    expect(titles).toContain('Trending Hit');
    expect(titles).not.toContain('AI Song (Suno)');
    expect(titles).not.toContain('Trash (Slowed + Reverb)');
    expect(titles).not.toContain('Jukebox Medley');
    
    // Fingerprint deduplication check: Only 'Fresh Single' and 'Trending Hit' should remain
    expect(cleaned.length).toBe(2);
  });

  it('deduplicates across rails using the claim system', () => {
    const trendingSongs = [mockSongs[1]]; // Trending Hit
    claimRailSongs('trending', trendingSongs);

    const claimed = claimedByOtherRails('fresh');
    expect(claimed.has(songFingerprint(mockSongs[1]))).toBe(true);

    const freshPool = [mockSongs[0], mockSongs[1]]; // Fresh Single, Trending Hit
    const filteredFresh = freshPool.filter(s => !claimed.has(songFingerprint(s)));
    
    expect(filteredFresh.map(s => s.id)).toEqual(['1']);
  });

  it('handles durational junk correctly', () => {
     // isSpamSong uses 45-900s
     // isJunkRailTrack uses 50-780s
     // Combined effect: 50-780s is the intersection
     
     const tooShort = { id: 's', title: 'Short', artist: 'A', duration: 30, cover_url: 'c' } as Song;
     const tooLong = { id: 'l', title: 'Long', artist: 'A', duration: 1000, cover_url: 'c' } as Song;
     const justRight = { id: 'ok', title: 'Ok', artist: 'A', duration: 300, cover_url: 'c' } as Song;
     
     const pool = [tooShort, tooLong, justRight];
     const fresh = pool.filter(s => !isSpamSong(s));
     const cleaned = cleanRail(fresh);
     
     expect(cleaned).toEqual([justRight]);
  });
});
