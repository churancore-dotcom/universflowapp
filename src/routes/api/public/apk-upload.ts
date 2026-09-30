import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

/**
 * CI-only APK publish endpoint.
 *
 * The GitHub Android workflow POSTs the freshly built APK here with a shared
 * secret; the server then replaces `music/releases/UniversFlow.apk`, which is
 * what /api/public/apk (and the /get page) serves. This keeps the website
 * download permanently on the latest build without manual uploads.
 *
 * Security: requires the APK_UPLOAD_SECRET bearer token (constant-time
 * compared), enforces a size ceiling, and only ever writes the single
 * releases/UniversFlow.apk object — no caller-controlled paths.
 */
const APK_OBJECT_PATH = "releases/UniversFlow.apk";
const MAX_APK_BYTES = 200 * 1024 * 1024; // 200 MB ceiling

export const Route = createFileRoute("/api/public/apk-upload")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["APK_UPLOAD_SECRET"];
        if (!secret) {
          return new Response("Upload not configured", { status: 503 });
        }

        const auth = request.headers.get("authorization") || "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
        const a = Buffer.from(token);
        const b = Buffer.from(secret);
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          return new Response("Invalid token", { status: 401 });
        }

        const body = await request.arrayBuffer();
        if (!body || body.byteLength < 1024 * 1024) {
          return new Response("Body too small to be an APK", { status: 400 });
        }
        if (body.byteLength > MAX_APK_BYTES) {
          return new Response("APK too large", { status: 413 });
        }

        // APKs are ZIP files — verify the PK magic bytes.
        const magic = new Uint8Array(body.slice(0, 2));
        if (magic[0] !== 0x50 || magic[1] !== 0x4b) {
          return new Response("Not an APK file", { status: 400 });
        }

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );

        const { error } = await supabaseAdmin.storage
          .from("music")
          .upload(APK_OBJECT_PATH, body, {
            contentType: "application/vnd.android.package-archive",
            upsert: true,
          });

        if (error) {
          console.error("[api/public/apk-upload] upload failed", error.message);
          return new Response("Upload failed", { status: 502 });
        }

        return Response.json({ ok: true, bytes: body.byteLength });
      },

      DELETE: async ({ request }) => {
        const secret = process.env["APK_UPLOAD_SECRET"];
        if (!secret) {
          return new Response("Not configured", { status: 503 });
        }
        const auth = request.headers.get("authorization") || "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
        const a = Buffer.from(token);
        const b = Buffer.from(secret);
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          return new Response("Invalid token", { status: 401 });
        }
        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );
        const { error } = await supabaseAdmin.storage
          .from("music")
          .remove([APK_OBJECT_PATH]);
        if (error) {
          return new Response("Delete failed", { status: 502 });
        }
        return Response.json({ ok: true, deleted: APK_OBJECT_PATH });
      },
    },
  },
});
