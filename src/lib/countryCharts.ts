// Real per-country charts from the `chart_tracks` table.
//
// `chart_tracks` is refreshed by the chart-aggregator cron (Apple / iTunes /
// Last.fm / Deezer) for ~20 markets plus GLOBAL, and it is readable without a
// session. That makes it the correct fallback for Home rails: the previous
// fallback was a plain YouTube *keyword search* ("global top songs this
// week…"), which is search noise, not a chart, and skewed to one market for
// everyone.
//
// Rows carry title/artist/cover only — no stream URL — so they are emitted as
// `source: 'indexed'` + `audio_url: 'resolving'`, which the player resolves by
// artist/title exactly like any other indexed track.
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Song } from '@/contexts/PlayerContext';
import { COUNTRIES } from '@/lib/countries';

export type ChartKind = 'trending' | 'viral' | 'latest';

interface ChartRow {
  rank: number;
  title: string;
  artist: string;
  cover_url: string | null;
  source: string;
  external_id: string | null;
  country_code: string;
  chart_type: string;
}

/** Human label for the shelf subtitle ("Top in Brazil" / "Top worldwide"). */
export function countryLabel(countryCode?: string | null): string {
  const cc = (countryCode || '').toUpperCase();
  if (!cc || cc === 'GLOBAL' || cc === 'ZZ') return 'worldwide';
  return COUNTRIES.find((c) => c.code === cc)?.name || cc;
}

const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '');

function rowToSong(r: ChartRow): Song | null {
  if (!r.title || !r.artist) return null;
  const key = r.external_id ? `${r.source}-${r.external_id}` : `${norm(r.title)}-${norm(r.artist)}`;
  return {
    id: `chart-${key}`,
    title: r.title,
    artist: r.artist,
    cover_url: r.cover_url || undefined,
    // Resolved on demand by artist/title (same path as any indexed track).
    audio_url: 'resolving',
    source: 'indexed',
  } as Song;
}

async function readChart(country: string, kind: ChartKind, limit: number): Promise<ChartRow[]> {
  const { data, error } = await supabase
    .from('chart_tracks')
    .select('rank, title, artist, cover_url, source, external_id, country_code, chart_type')
    .eq('country_code', country)
    .eq('chart_type', kind)
    .order('rank', { ascending: true })
    .limit(limit);
  if (error) return [];
  return (data ?? []) as ChartRow[];
}

export interface CountryChartResult {
  songs: Song[];
  /** The market actually served — may be GLOBAL when the country has no chart. */
  country: string;
}

/**
 * Chart for the listener's market, degrading honestly:
 * country `trending` → country `viral` → GLOBAL `trending` → GLOBAL `viral`.
 */
export async function fetchCountryCharts(
  countryCode: string | null | undefined,
  limit = 60,
): Promise<CountryChartResult> {
  const cc = (countryCode || '').toUpperCase();
  const attempts: Array<{ country: string; kind: ChartKind }> = [];
  if (/^[A-Z]{2}$/.test(cc)) {
    attempts.push({ country: cc, kind: 'trending' }, { country: cc, kind: 'viral' });
  }
  attempts.push({ country: 'GLOBAL', kind: 'trending' }, { country: 'GLOBAL', kind: 'viral' });

  for (const attempt of attempts) {
    const rows = await readChart(attempt.country, attempt.kind, limit);
    const songs: Song[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const song = rowToSong(row);
      if (!song) continue;
      const print = `${norm(song.title)}~${norm(song.artist)}`;
      if (seen.has(print)) continue;
      seen.add(print);
      songs.push(song);
    }
    if (songs.length >= 8) return { songs, country: attempt.country };
  }
  return { songs: [], country: 'GLOBAL' };
}

/** Aggregated per-country chart. Works signed-out (anon SELECT policy). */
export function useCountryCharts(countryCode: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ['country-charts-v1', (countryCode || 'GLOBAL').toUpperCase()],
    enabled,
    staleTime: 30 * 60 * 1000,
    gcTime: 6 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: () => fetchCountryCharts(countryCode, 60),
  });
}
