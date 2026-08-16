import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

/**
 * Public APK download.
 *
 * The `music` bucket is private (premium audio lives there), so the release
 * artifact is served through a short-lived signed URL. Storage RLS allows
 * anonymous reads only for objects under `releases/`, so nothing else in the
 * bucket can be signed through this endpoint.
 */
const APK_OBJECT_PATH = "releases/UniversFlow.apk";

export const Route = createFileRoute("/api/public/apk")({
  server: {
    handlers: {
      GET: async () => {
        const url = process.env["VITE_SUPABASE_URL"] || process.env["SUPABASE_URL"];
        const key =
          process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ||
          process.env["SUPABASE_ANON_KEY"];

        if (!url || !key) {
          return new Response("Download temporarily unavailable", { status: 503 });
        }

        const supabase = createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false },
        });

        const { data, error } = await supabase.storage
          .from("music")
          .createSignedUrl(APK_OBJECT_PATH, 60 * 10);

        if (error || !data?.signedUrl) {
          console.error("[api/public/apk] sign failed", error?.message);
          return new Response("Download temporarily unavailable", { status: 503 });
        }

        return new Response(null, {
          status: 302,
          headers: { Location: data.signedUrl, "Cache-Control": "no-store" },
        });
      },
    },
  },
});
