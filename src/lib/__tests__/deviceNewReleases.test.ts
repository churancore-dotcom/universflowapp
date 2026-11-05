import { describe, expect, it } from 'vitest';
import { isFreshUpload, parseReleaseCards } from '@/lib/deviceNewReleases';

const DAY = 86400000;
const now = Date.parse('2026-11-05T10:00:00Z');

describe('device new releases', () => {
  it('accepts an upload from 34 days ago', () => {
    expect(isFreshUpload(new Date(now - 34 * DAY).toISOString(), now)).toBe(true);
  });

  it('drops an upload from 36 days ago', () => {
    expect(isFreshUpload(new Date(now - 36 * DAY).toISOString(), now)).toBe(false);
  });

  it('drops tracks with no upload date', () => {
    expect(isFreshUpload(undefined, now)).toBe(false);
  });

  it('keeps shelf order and skips YouTube mix tiles', () => {
    const tile = (title: string, subtitle: string, browseId: string) => ({
      musicTwoRowItemRenderer: {
        title: { runs: [{ text: title }] },
        subtitle: { runs: [{ text: subtitle }] },
        navigationEndpoint: { browseEndpoint: { browseId } },
      },
    });
    const cards = parseReleaseCards({
      items: [
        tile('New Release Mix', 'Mix • YouTube Music', 'RDCLAK'),
        tile('Song B', 'Single • Artist B', 'MPREb_b'),
        tile('Song A', 'Album • Artist A', 'MPREb_a'),
      ],
    });
    expect(cards.map((c) => c.title)).toEqual(['Song B', 'Song A']);
    expect(cards[1].type).toBe('album');
  });
});
