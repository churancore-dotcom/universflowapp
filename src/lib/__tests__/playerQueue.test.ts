import { describe, expect, it } from 'vitest';
import { dedupePlayerQueue, findNativeQueueIndex, getNativeQueueMediaId } from '../playerQueue';

const tracks = [
  { id: 'catalog-1', title: 'Song Name (Official Audio)', artist: 'Artist' },
  { id: 'audius-2', title: 'Song Name', artist: 'Artist' },
  { id: 'catalog-3', title: 'Another Song', artist: 'Artist' },
];

describe('player queue normalization', () => {
  it('removes provider duplicates by title and primary artist', () => {
    expect(dedupePlayerQueue(tracks).map((track) => track.id)).toEqual(['catalog-1', 'catalog-3']);
  });

  it('maps native media transitions to the exact queue position', () => {
    const queue = dedupePlayerQueue(tracks);
    const mediaId = getNativeQueueMediaId(queue[1], 1);
    expect(findNativeQueueIndex(queue, mediaId)).toBe(1);
    expect(findNativeQueueIndex(queue, getNativeQueueMediaId(queue[0], 0))).toBe(0);
  });
});