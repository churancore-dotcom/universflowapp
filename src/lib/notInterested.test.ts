import { describe, it, expect, vi } from 'vitest';
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
import { rerank, type TasteProfile } from '@/lib/feedPersonalizer';
import { notInterestedKey } from '@/lib/notInterested';

const profile = (hidden: string[]): TasteProfile => ({
  artists: new Map(), keywords: new Map(), skips: new Map(), signalCount: 1,
  hiddenSongs: new Set(hidden),
});

describe('Not interested', () => {
  it('removes the exact song even when the rail gets short', () => {
    const items = [{ title: 'A', artist: 'X' }, { title: 'B', artist: 'Y' }];
    const out = rerank(items, profile([notInterestedKey('a ', 'x')]));
    expect(out).toEqual([{ title: 'B', artist: 'Y' }]);
  });
  it('keeps other songs by the same artist', () => {
    const items = [{ title: 'A', artist: 'X' }, { title: 'C', artist: 'X' }];
    const out = rerank(items, profile([notInterestedKey('A', 'X')]));
    expect(out.map((i) => i.title)).toEqual(['C']);
  });
});
