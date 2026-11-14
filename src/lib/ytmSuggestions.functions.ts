import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { parseYtmSuggestions, type YtmSuggestions } from './ytmSuggestions';

/** Live YouTube Music typing suggestions: search terms plus real songs/artists. */
export const getYtmSuggestions = createServerFn({ method: 'GET' })
  .inputValidator((d) => z.object({ q: z.string().trim().min(1).max(120), gl: z.string().regex(/^[A-Z]{2}$/).default('US') }).parse(d))
  .handler(async ({ data }): Promise<YtmSuggestions> => {
    try {
      const res = await fetch('https://music.youtube.com/youtubei/v1/music/get_search_suggestions?prettyPrint=false', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://music.youtube.com',
          Referer: 'https://music.youtube.com/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0 Safari/537.36',
        },
        body: JSON.stringify({
          context: { client: { clientName: 'WEB_REMIX', clientVersion: '1.20241218.01.00', hl: 'en', gl: data.gl } },
          input: data.q,
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return { queries: [], items: [] };
      return parseYtmSuggestions(await res.json());
    } catch {
      return { queries: [], items: [] };
    }
  });
