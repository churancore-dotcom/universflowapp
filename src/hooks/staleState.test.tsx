// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Use the same CommonJS instance as react-dom in the sandbox test runner.
vi.mock('react', async () => {
  const { createRequire } = await import('node:module');
  return createRequire(import.meta.url)('react');
});

const mocks = vi.hoisted(() => ({
  user: { id: 'account-a' } as { id: string } | null,
  reads: vi.fn(), prefs: vi.fn(), suggestions: vi.fn(), country: vi.fn(), removeChannel: vi.fn(),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  from: () => ({ select: () => ({ eq: mocks.reads }) }),
  channel: () => { const channel = { on: () => channel, subscribe: () => channel }; return channel; },
  removeChannel: mocks.removeChannel,
} }));
vi.mock('@/lib/feedPersonalizer', () => ({ invalidateTasteProfile: vi.fn() }));
vi.mock('@/lib/streamSongs', () => ({ persistStreamSong: vi.fn(), flushStreamSongsNow: vi.fn(), getTrackSource: vi.fn() }));
vi.mock('@/lib/userArtistPrefs', () => ({ getUserArtistPrefs: mocks.prefs }));
vi.mock('@/lib/ytmSuggestions.functions', () => ({ getYtmSuggestions: mocks.suggestions }));
vi.mock('@/lib/geoCountry', () => ({ detectCountrySilently: mocks.country }));

import { resetLikeCache, useLike } from './useLike';
import { useFollowedArtists } from './useFollowedArtists';
import { useYtmSuggestions } from './useYtmSuggestions';

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => { vi.clearAllMocks(); mocks.user = { id: 'account-a' }; resetLikeCache(); localStorage.clear(); });
afterEach(() => { cleanup(); resetLikeCache(); vi.useRealTimers(); });

describe('favorites request ownership', () => {
  it('ignores an old account read arriving after the new account library', async () => {
    const old = deferred<{ data: { song_id: string }[] }>();
    mocks.reads.mockImplementation((id: string) => id === 'account-a' ? old.promise : Promise.resolve({ data: [] }));
    const { result, rerender } = renderHook(() => useLike('song-a'));
    mocks.user = { id: 'account-b' };
    rerender();
    await act(async () => {});
    await act(async () => { old.resolve({ data: [{ song_id: 'song-a' }] }); });
    rerender();
    act(() => window.dispatchEvent(new Event('uf:likes-changed')));
    expect(result.current.isLiked).toBe(false);
    // A new mounted consumer must not inherit the old account's late cache.
    const second = renderHook(() => useLike('song-a'));
    await act(async () => {});
    expect(second.result.current.isLiked).toBe(false);
  });
});

describe('followed artists request ownership', () => {
  it('keeps a newer follow refresh when the initial read arrives last', async () => {
    const initial = deferred<unknown[]>();
    const artist = { id: 'artist-b', artist_name: 'New artist', artist_image: null, artist_source: 'catalog', created_at: '' };
    mocks.prefs.mockReturnValueOnce(initial.promise).mockResolvedValue([artist]);
    const { result } = renderHook(() => useFollowedArtists());
    act(() => window.dispatchEvent(new Event('uf:artist-prefs-changed')));
    await waitFor(() => expect(result.current.names).toEqual(['New artist']));
    await act(async () => initial.resolve([]));
    expect(result.current.names).toEqual(['New artist']);
  });

  it('hides previous-account artists while the next account loads', async () => {
    mocks.prefs.mockResolvedValueOnce([{ artist_name: 'Account A artist' }]).mockReturnValue(new Promise(() => {}));
    const { result, rerender } = renderHook(() => useFollowedArtists());
    await waitFor(() => expect(result.current.names).toEqual(['Account A artist']));
    mocks.user = { id: 'account-b' }; rerender();
    expect(result.current.names).toEqual([]);
    expect(result.current.loading).toBe(true);
  });
});

describe('typing suggestion freshness', () => {
  it('clears the previous query immediately even when the next request fails', async () => {
    vi.useFakeTimers(); mocks.country.mockResolvedValue('IN');
    mocks.suggestions.mockResolvedValueOnce({ queries: ['first-song'], items: [] }).mockRejectedValueOnce(new Error('offline'));
    const { result, rerender } = renderHook(({ q }) => useYtmSuggestions(q), { initialProps: { q: 'first-song' } });
    await act(async () => vi.advanceTimersByTimeAsync(130));
    expect(result.current.queries).toEqual(['first-song']);
    rerender({ q: 'second-song' });
    expect(result.current.queries).toEqual([]);
    await act(async () => vi.advanceTimersByTimeAsync(130));
    expect(result.current.queries).toEqual([]);
  });

  it('does not reuse suggestions from another market', async () => {
    vi.useFakeTimers(); mocks.country.mockResolvedValueOnce('IN').mockResolvedValueOnce('US');
    mocks.suggestions.mockResolvedValueOnce({ queries: ['India result'], items: [] }).mockResolvedValueOnce({ queries: ['US result'], items: [] });
    const { result, rerender } = renderHook(({ enabled }) => useYtmSuggestions('market-specific-song', enabled), { initialProps: { enabled: true } });
    await act(async () => vi.advanceTimersByTimeAsync(130));
    rerender({ enabled: false }); rerender({ enabled: true });
    await act(async () => vi.advanceTimersByTimeAsync(130));
    expect(result.current.queries).toEqual(['US result']);
    expect(mocks.suggestions).toHaveBeenLastCalledWith({ data: { q: 'market-specific-song', gl: 'US' } });
  });
});