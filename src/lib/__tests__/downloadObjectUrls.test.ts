import { afterEach, describe, expect, it, vi } from 'vitest';
import { DownloadObjectUrls } from '../downloadObjectUrls';

afterEach(() => vi.restoreAllMocks());

describe('download URL ownership', () => {
  it('releases audio and cover URLs once and ignores native paths', () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValueOnce('blob:audio').mockReturnValueOnce('blob:cover');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const urls = new DownloadObjectUrls();
    const audio = urls.create(new Blob(['audio']));
    urls.create(new Blob(['cover']));
    urls.release('file:///offline/song.m4a');
    urls.release(audio);
    urls.release(audio);
    urls.clear();
    expect(revoke.mock.calls).toEqual([['blob:audio'], ['blob:cover']]);
  });
});