import { createFileRoute } from "@tanstack/react-router";

/**
 * Public APK download.
 *
 * The `music` bucket is private (premium audio lives there), so the release
 * artifact is read through a short-lived signed URL and streamed from this site. Storage RLS allows
 * anonymous reads only for objects under `releases/`, so nothing else in the
 * bucket can be signed through this endpoint.
 */
const APK_OBJECT_PATH = "releases/UniversFlow.apk";

export const Route = createFileRoute("/api/public/apk")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // Signs only the fixed release path — no caller-controlled input.
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin.storage
          .from("music")
          .createSignedUrl(APK_OBJECT_PATH, 60 * 10, { download: "UniversFlow.apk" });

        if (error || !data?.signedUrl) {
          console.error("[api/public/apk] sign failed", error?.message);
          return new Response("Download temporarily unavailable", { status: 503 });
        }

        // Stream the file through this site instead of redirecting. Some
        // Indian mobile networks block or stall the storage host, so a
        // redirect left the browser "loading" forever on universflow.in.
        const range = request.headers.get("range");
        const upstream = await fetch(data.signedUrl, range ? { headers: { Range: range } } : undefined);
        if (!upstream.ok || !upstream.body) {
          console.error("[api/public/apk] fetch failed", upstream.status);
          return new Response("Download temporarily unavailable", { status: 503 });
        }
        const headers = new Headers({
          "Content-Type": "application/vnd.android.package-archive",
          "Content-Disposition": 'attachment; filename="UniversFlow.apk"',
          "Cache-Control": "no-store, max-age=0",
          Pragma: "no-cache",
          "Accept-Ranges": "bytes",
        });
        for (const h of ["content-length", "content-range", "last-modified", "etag"]) {
          const v = upstream.headers.get(h);
          if (v) headers.set(h, v);
        }
        return new Response(upstream.body, { status: upstream.status, headers });
      },
    },
  },
});
