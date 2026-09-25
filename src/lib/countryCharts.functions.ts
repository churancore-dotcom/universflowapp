import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

export interface CountryChartEntry {
  title: string;
  artist: string;
  cover_url?: string;
}

/**
 * Real per-country "most played" chart from Apple's public, keyless RSS feed.
 * Fetched server-side so browsers don't hit CORS.
 */
export const getCountryChart = createServerFn({ method: 'GET' })
  .inputValidator((d) => z.object({ cc: z.string().regex(/^[a-z]{2}$/), limit: z.number().int().min(5).max(100) }).parse(d))
  .handler(async ({ data }): Promise<CountryChartEntry[]> => {
    try {
      const res = await fetch(
        `https://rss.marketingtools.apple.com/api/v2/${data.cc}/music/most-played/${data.limit}/songs.json`,
        { headers: { accept: 'application/json' } },
      );
      if (!res.ok) return [];
      const json = (await res.json()) as { feed?: { results?: Array<{ name?: string; artistName?: string; artworkUrl100?: string }> } };
      return (json.feed?.results ?? [])
        .filter((r) => r.name && r.artistName)
        .map((r) => ({
          title: r.name!,
          artist: r.artistName!,
          cover_url: r.artworkUrl100?.replace('100x100bb', '600x600bb'),
        }));
    } catch {
      return [];
    }
  });
