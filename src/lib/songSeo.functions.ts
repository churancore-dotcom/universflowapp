import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";

export type SongSeo = {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  cover_url: string | null;
} | null;

/**
 * Public SEO read for shared song links (/song/<id>).
 * Only returns visible free catalog songs; streamed/indexed tracks have no
 * catalog row, so the landing page falls back to a branded app CTA.
 */
export const getSongSeo = createServerFn({ method: "GET" })
  .inputValidator((d: { songId: string }) => ({ songId: String(d?.songId ?? "").slice(0, 120) }))
  .handler(async ({ data }): Promise<SongSeo> => {
    const url = process.env["SUPABASE_URL"];
    const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
    if (!url || !key || !data.songId) return null;
    try {
      const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data: row } = await sb
        .from("songs")
        .select("id, title, artist, album, cover_url")
        .eq("id", data.songId)
        .eq("is_visible", true)
        .eq("is_premium_only", false)
        .maybeSingle();
      return (row as SongSeo) ?? null;
    } catch {
      return null;
    }
  });
