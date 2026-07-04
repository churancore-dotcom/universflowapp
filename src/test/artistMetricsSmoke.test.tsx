/**
 * Smoke test: publishing a song → play/download/like/view counters update live
 * on the artist page in real time.
 *
 * This exercises the wiring the app depends on:
 *   1. Publishing a song → INSERT payload appears at the top of the artist song list.
 *   2. The four increment RPCs (`increment_artist_song_play/view/download` and
 *      the like trigger via `user_library` insert) fire and produce UPDATE
 *      payloads that mutate the same song in the artist list — with no reload.
 *
 * We stub the Supabase client so the test is hermetic and runs in CI without a
 * network; it verifies the contract `useArtistLive` relies on.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

type Row = Record<string, unknown>;
type Handler = (payload: {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new: Row;
  old: Row;
}) => void;

const ARTIST_ID = 'artist-uid-1';
const SONG_ID = '11111111-1111-1111-1111-111111111111';

const baseSong = {
  id: SONG_ID,
  title: 'Smoke Test Track',
  cover_url: null,
  stream_url: 'https://example.com/a.mp3',
  duration: 180,
  play_count: 0,
  like_count: 0,
  download_count: 0,
  view_count: 0,
  status: 'live' as const,
  takedown_reason: null,
  created_at: new Date().toISOString(),
};

// ---- Fake Supabase client -------------------------------------------------
const state = vi.hoisted(() => ({
  songs: [] as Row[],
  handlers: [] as Handler[],
  rpc: null as unknown as ReturnType<typeof vi.fn>,
}));

function emit(eventType: 'INSERT' | 'UPDATE' | 'DELETE', row: Row) {
  for (const h of state.handlers) h({ eventType, new: row, old: row });
}

vi.mock('@/integrations/supabase/client', () => {
  state.rpc = vi.fn(async (fn: string, args: { _song_id: string }) => {
    const s = state.songs.find((x) => x.id === args._song_id) as Record<string, unknown> | undefined;
    if (!s) return { data: null, error: null };
    if (fn === 'increment_artist_song_play') s.play_count = (s.play_count as number) + 1;
    if (fn === 'increment_artist_song_view') s.view_count = (s.view_count as number) + 1;
    if (fn === 'increment_artist_song_download') s.download_count = (s.download_count as number) + 1;
    for (const h of state.handlers) h({ eventType: 'UPDATE', new: s, old: s });
    return { data: null, error: null };
  });

  const makeQuery = (table: string) => {
    const q: Record<string, unknown> = {};
    q.select = vi.fn(() => q);
    q.eq = vi.fn(() => q);
    q.order = vi.fn(() => Promise.resolve({ data: state.songs, error: null }));
    q.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }));
    if (table === 'artist_followers') {
      (q as { then: unknown }).then = (r: (v: { count: number; error: null }) => void) =>
        r({ count: 0, error: null });
    }
    return q;
  };

  const channel = {
    on: vi.fn(function on(_evt: string, cfg: { table: string }, handler: Handler) {
      if (cfg.table === 'artist_songs') state.handlers.push(handler);
      return channel;
    }),
    subscribe: vi.fn(() => channel),
  };
  return {
    supabase: {
      from: vi.fn((table: string) => makeQuery(table)),
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(),
      rpc: (...args: unknown[]) => state.rpc(...args),
    },
  };
});


// Import AFTER the mock is registered.
import { useArtistLive } from '@/pages/artist/useArtistLive';
import { supabase } from '@/integrations/supabase/client';

beforeEach(() => {
  state.songs = [];
  state.handlers = [];
  state.rpc.mockClear();
});

describe('artist metrics smoke test', () => {
  it('publishes a song and reflects play/view/download/like updates in real time', async () => {
    const { result } = renderHook(() => useArtistLive(ARTIST_ID));

    // Initial load resolves with empty list
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.songs).toHaveLength(0);

    // 1. Publish a song → realtime INSERT (row registered for RPC lookup only)
    act(() => {
      const row = { ...baseSong };
      emit('INSERT', row);
      state.songs.push(row);
    });

    await waitFor(() => expect(result.current.songs).toHaveLength(1));
    const s0 = result.current.songs[0];
    expect(s0.play_count).toBe(0);
    expect(s0.view_count).toBe(0);
    expect(s0.download_count).toBe(0);
    expect(s0.like_count).toBe(0);

    // 2. Fire the wired counters — same RPCs the app calls at
    //    30s-of-play (PlayerContext), download-success (DownloadContext), and
    //    view/like moments — and confirm the artist page state mutates live.
    await act(async () => {
      await supabase.rpc('increment_artist_song_play', { _song_id: SONG_ID });
      await supabase.rpc('increment_artist_song_view', { _song_id: SONG_ID });
      await supabase.rpc('increment_artist_song_download', { _song_id: SONG_ID });
      // Like is server-side (trigger on user_library insert); simulate its UPDATE
      const row = state.songs[0];
      row.like_count = (row.like_count as number) + 1;
      emit('UPDATE', row);
    });

    await waitFor(() => {
      const s = result.current.songs[0];
      expect(s.play_count).toBe(1);
      expect(s.view_count).toBe(1);
      expect(s.download_count).toBe(1);
      expect(s.like_count).toBe(1);
    });

    // Contract check: all four RPC names are the ones the artist pages read from.
    const calls = state.rpc.mock.calls.map((c) => c[0]);
    expect(calls).toContain('increment_artist_song_play');
    expect(calls).toContain('increment_artist_song_view');
    expect(calls).toContain('increment_artist_song_download');
  });
});
