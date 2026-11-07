import { describe, it, expect } from 'vitest';
import { rediscoverSongs } from '@/lib/personalHome';
import type { LocalRecentEntry } from '@/lib/localRecentlyPlayed';

// Most recent first, matching device history order.
const play = (title: string, at: number): LocalRecentEntry => ({
  song_id: `yt-${title}`,
  played_at: at,
  song: { id: `yt-${title}`, title, artist: `${title} Artist` },
});

describe('rediscoverSongs', () => {
  it('never offers a song heard in the latest plays', () => {
    const entries = [play('Fresh', 100), play('Old', 50), play('Fresh', 40)];
    const titles = rediscoverSongs(entries, 1).map((s) => s.title);
    expect(titles).toEqual(['Old']);
  });

  it('ranks older songs by how often they were played', () => {
    const entries = [play('Now', 100), play('Once', 60), play('Twice', 50), play('Twice', 40)];
    const titles = rediscoverSongs(entries, 1).map((s) => s.title);
    expect(titles).toEqual(['Twice', 'Once']);
  });

  it('is empty when history is shorter than the recent window', () => {
    expect(rediscoverSongs([play('A', 2), play('B', 1)], 15)).toEqual([]);
  });
});
