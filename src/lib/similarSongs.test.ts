import { describe, it, expect } from 'vitest';
import { filterSimilar, pickMixSeeds, blendMixes } from './similarSongs';

const t = (title: string, artist = 'A') => ({ id: title + artist, title, artist, audio_url: 'x' });

describe('songs like this', () => {
  it('drops songs that share the searched title (covers, remixes, versions)', () => {
    const out = filterSimilar(
      [t('Kesariya (Lofi)', 'X'), t('Kesariya Cover', 'Y'), t('Apna Bana Le', 'Arijit'), t('Tum Hi Ho', 'Arijit')],
      { title: 'Kesariya', query: 'kesariya' },
    );
    expect(out.map((s) => s.title)).toEqual(['Apna Bana Le', 'Tum Hi Ho']);
  });
  it('drops duplicate uploads of the same song', () => {
    const out = filterSimilar([t('Tum Hi Ho', 'Arijit'), t('Tum Hi Ho (Official Video)', 'Arijit')], { title: 'Kesariya', query: 'k' });
    expect(out).toHaveLength(1);
  });
});

describe('YouTube-style home mixes', () => {
  it('seeds from recent songs by different artists, keeping YouTube ids', () => {
    const seeds = pickMixSeeds([
      { title: 'Song 1', artist: 'Arijit Singh', audio_url: 'yt-video:abcdefghijk' },
      { title: 'Song 2', artist: 'arijit singh' },
      { title: 'Song 3', artist: 'Karan Aujla' },
      { title: 'Song 4', artist: 'AP Dhillon' },
      { title: 'Song 5', artist: 'Diljit' },
    ]);
    expect(seeds).toEqual([
      { title: 'Song 1', artist: 'Arijit Singh', videoId: 'abcdefghijk' },
      { title: 'Song 3', artist: 'Karan Aujla' },
      { title: 'Song 4', artist: 'AP Dhillon' },
    ]);
  });

  it('interleaves mixes in order without duplicates or excluded songs', () => {
    const a = [t('A1', 'x'), t('Shared', 's'), t('A3', 'x')];
    const b = [t('B1', 'y'), t('Shared', 's'), t('Hidden', 'h')];
    const out = blendMixes([a, b], 10, (s) => s.title === 'Hidden');
    expect(out.map((s) => s.title)).toEqual(['A1', 'B1', 'Shared', 'A3']);
  });
});
