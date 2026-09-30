import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";

export type ArtistSeo = { stage_name: string; bio: string | null; avatar_url: string | null; slug: string } | null;

export const getArtistSeo = createServerFn({ method: "GET" })
  .inputValidator((d: { slug: string }) => ({ slug: String(d?.slug ?? "").slice(0, 120) }))
  .handler(async ({ data }): Promise<ArtistSeo> => {
    const url = process.env["SUPABASE_URL"];
    const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
    if (!url || !key || !data.slug) return null;
    try {
      const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data: row } = await sb
        .from("artist_profiles")
        .select("stage_name, bio, avatar_url, slug")
        .eq("slug", data.slug)
        .maybeSingle();
      return (row as ArtistSeo) ?? null;
    } catch {
      return null;
    }
  });
