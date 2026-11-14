import { describe, it, expect } from 'vitest';
import { filterSimilar } from './similarSongs';

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
