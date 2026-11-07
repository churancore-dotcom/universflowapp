import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke } } }));
vi.mock('@/lib/jiosaavn', () => ({ findSongStreamUrl: vi.fn() }));
vi.mock('@/lib/perfMonitor', () => ({ recordPerfEvent: vi.fn() }));
import { getYouTubeMusicNewReleases } from '../musicIndexer';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
});

describe('actual new release sourcing', () => {
  beforeEach(() => { store.clear(); invoke.mockReset(); vi.useRealTimers(); });

  it('requests only the release shelf and filters synthetic tracks', async () => {
    invoke.mockResolvedValueOnce({ data: { success: true, results: [
      { id: 'real', title: 'New Single', artist: 'Real Artist' },
      { id: 'fake', title: 'Made with AI', artist: 'Uploader' },
    ] }, error: null });
    expect((await getYouTubeMusicNewReleases('IN', 24)).map(t => t.id)).toEqual(['real']);
    expect(invoke).toHaveBeenCalledWith('yt-music-search', { body: { mode: 'new-releases', country: 'IN', limit: 24 } });
  });

  it('does not replace an unavailable release shelf with chart or keyword hits', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('unavailable') });
    expect(await getYouTubeMusicNewReleases('IN', 12)).toEqual([]);
    // One retry for a cold start, and only ever the release shelf.
    expect(invoke).toHaveBeenCalledTimes(2);
    for (const call of invoke.mock.calls) expect(call[1].body.mode).toBe('new-releases');
  });

  it('a failed first request retries once and shows the shelf', async () => {
    invoke
      .mockResolvedValueOnce({ data: null, error: new Error('cold start') })
      .mockResolvedValueOnce({ data: { success: true, results: [{ id: 'drop', title: 'Fresh Drop', artist: 'Real Artist' }] }, error: null });
    expect((await getYouTubeMusicNewReleases('IN', 10)).map(t => t.id)).toEqual(['drop']);
  });

  it('keeps the last shelf from the past 24 hours when the feed fails', async () => {
    store.set('uf:fresh-releases-v5:IN', JSON.stringify({
      data: [{ id: 'saved', title: 'Saved Single', artist: 'Real Artist' }],
      savedAt: Date.now() - 2 * 60 * 60 * 1000,
    }));
    invoke.mockResolvedValue({ data: null, error: new Error('offline') });
    expect((await getYouTubeMusicNewReleases('IN', 11)).map(t => t.id)).toEqual(['saved']);
  });

  it('drops a saved shelf older than 24 hours', async () => {
    store.set('uf:fresh-releases-v5:IN', JSON.stringify({
      data: [{ id: 'old', title: 'Old Single', artist: 'Real Artist' }],
      savedAt: Date.now() - 25 * 60 * 60 * 1000,
    }));
    invoke.mockResolvedValue({ data: null, error: new Error('offline') });
    expect(await getYouTubeMusicNewReleases('IN', 13)).toEqual([]);
  });
});
