import { createFileRoute } from "@tanstack/react-router";

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
        // Signs only the fixed release path — no caller-controlled input.
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin.storage
          .from("music")
          .createSignedUrl(APK_OBJECT_PATH, 60 * 10, { download: "UniversFlow.apk" });

        if (error || !data?.signedUrl) {
          console.error("[api/public/apk] sign failed", error?.message);
          return new Response("Download temporarily unavailable", { status: 503 });
        }

        return new Response(null, {
          status: 302,
          headers: { Location: data.signedUrl, "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" },
        });
      },
    },
  },
});
