/**
 * Real personal signals for the Home surface.
 *
 * Everything here is derived from history the app already records
 * (`song_play_events` + local recently-played + the measured listen log).
 * When a signal is too thin it comes back as null/0 and the UI drops that
 * piece rather than inventing a number.
 */
import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  computeStreak,
  inferGenre,
  loadPlayRecords,
  type PlayRecord,
  type StreakInfo,
} from '@/lib/listeningInsights';

export interface HomeInsights {
  loading: boolean;
  streak: StreakInfo;
  /** Plays in the last 7 days. */
  weekPlays: number;
  /** Plays inside the current calendar month. */
  monthPlays: number;
  /** Most-played artist this week, when there is one. */
  weekTopArtist: string | null;
  /** Genre inferred from the last 30 days of titles. */
  topGenre: string | null;
  /** Lifetime-ish play counts per artist (lowercased key). */
  playsByArtist: Record<string, number>;
  /** Total records loaded — used to decide how rich Home can be. */
  totalPlays: number;
}

const EMPTY: HomeInsights = {
  loading: true,
  streak: { current: 0, best: 0, activeToday: false },
  weekPlays: 0,
  monthPlays: 0,
  weekTopArtist: null,
  topGenre: null,
  playsByArtist: {},
  totalPlays: 0,
};

const primaryArtist = (raw: string) =>
  (raw || '')
    .split(/,|&|\bfeat\.?\b|\bft\.?\b|\bwith\b/i)[0]
    .trim();

function derive(records: PlayRecord[], userId: string | null): HomeInsights {
  const now = Date.now();
  const weekFrom = now - 7 * 86_400_000;
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const week = records.filter((r) => r.at >= weekFrom);
  const month = records.filter((r) => r.at >= monthStart.getTime());
  const recent30 = records.filter((r) => r.at >= now - 30 * 86_400_000);

  const weekArtists = new Map<string, { name: string; plays: number }>();
  for (const r of week) {
    const name = primaryArtist(r.artist);
    if (name.length < 2) continue;
    const key = name.toLowerCase();
    const row = weekArtists.get(key);
    if (row) row.plays += 1;
    else weekArtists.set(key, { name, plays: 1 });
  }

  const playsByArtist: Record<string, number> = {};
  for (const r of records) {
    const name = primaryArtist(r.artist);
    if (name.length < 2) continue;
    const key = name.toLowerCase();
    playsByArtist[key] = (playsByArtist[key] || 0) + 1;
  }

  return {
    loading: false,
    streak: computeStreak(records, userId),
    weekPlays: week.length,
    monthPlays: month.length,
    weekTopArtist:
      [...weekArtists.values()].sort((a, b) => b.plays - a.plays)[0]?.name ?? null,
    topGenre: inferGenre(recent30.length >= 6 ? recent30 : records),
    playsByArtist,
    totalPlays: records.length,
  };
}

export function useHomeInsights(): HomeInsights {
  const { user } = useAuth();
  const [state, setState] = useState<HomeInsights>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    const userId = user?.id ?? null;

    const run = async () => {
      try {
        const records = await loadPlayRecords(userId);
        if (cancelled) return;
        setState(derive(records, userId));
      } catch {
        if (!cancelled) setState({ ...EMPTY, loading: false });
      }
    };

    run();
    const refresh = () => { void run(); };
    window.addEventListener('universflow:recently-played-changed', refresh);
    return () => {
      cancelled = true;
      window.removeEventListener('universflow:recently-played-changed', refresh);
    };
  }, [user?.id]);

  return state;
}
