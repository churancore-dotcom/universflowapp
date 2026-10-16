import { describe, expect, it, vi } from 'vitest';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke } } }));
vi.mock('@/lib/jiosaavn', () => ({ findSongStreamUrl: vi.fn() }));
vi.mock('@/lib/perfMonitor', () => ({ recordPerfEvent: vi.fn() }));
import { getYouTubeMusicNewReleases } from '../musicIndexer';

describe('actual new release sourcing', () => {
  it('requests only the release shelf and filters synthetic tracks', async () => {
    invoke.mockResolvedValueOnce({ data: { success: true, results: [
      { id: 'real', title: 'New Single', artist: 'Real Artist' },
      { id: 'fake', title: 'Made with AI', artist: 'Uploader' },
    ] }, error: null });
    expect((await getYouTubeMusicNewReleases('GB', 24)).map(t => t.id)).toEqual(['real']);
    expect(invoke).toHaveBeenCalledWith('yt-music-search', { body: { mode: 'new-releases', country: 'GB', limit: 24 } });
  });
  it('does not replace an unavailable release shelf with chart or keyword hits', async () => {
    invoke.mockClear();
    invoke.mockResolvedValueOnce({ data: null, error: new Error('unavailable') });
    expect(await getYouTubeMusicNewReleases('FR', 24)).toEqual([]);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});