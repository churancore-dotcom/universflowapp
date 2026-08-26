// Runs automated verification checks on a freshly-submitted artist application:
// 1) Music-platform ownership: fetch the artist page and confirm the ownership
//    code is present in the HTML (bio-code proof).
// 2) Platform photo face match: pull the OG image from the artist page and
//    compare against the liveness selfie via Gemini Vision.
// 3) Persist scores + admin-visible warnings on the application row.
//
// Cost: $0 — uses Lovable AI Gateway (Gemini Flash Lite) which is included.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const KYC_BUCKET = "artist-kyc";
const MODEL = "google/gemini-2.5-flash-lite";

async function blobToDataUrl(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
  const b64 = btoa(s);
  return `data:${blob.type || "image/jpeg"};base64,${b64}`;
}

async function callGemini(messages: unknown[]): Promise<string> {
  const r = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": LOVABLE_API_KEY,
    },
    body: JSON.stringify({ model: MODEL, messages, temperature: 0 }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Gemini ${r.status}: ${t.slice(0, 200)}`);
  }
  const j = await r.json();
  return j?.choices?.[0]?.message?.content ?? "";
}

function parseJsonish(s: string): Record<string, unknown> | null {
  try {
    const m = s.match(/\{[\s\S]*\}/);
    return JSON.parse(m ? m[0] : s) as Record<string, unknown>;
  } catch { return null; }
}

// --- SSRF hardening -------------------------------------------------------
// music_platform_url / og:image URLs are attacker-controlled, so every outbound
// fetch must be restricted to public http(s) endpoints on standard ports, and
// redirects must be validated hop-by-hop (redirect: "manual").

const BLOCKED_HOSTNAMES = new Set([
  "localhost", "localhost.localdomain", "metadata", "metadata.google.internal",
  "instance-data", "0.0.0.0", "[::]", "[::1]",
]);

function isPrivateIpv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if ([a, Number(m[2]), Number(m[3]), Number(m[4])].some((n) => n > 255)) return true;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function isSafePublicUrl(raw: string): URL | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  if (u.port && u.port !== "80" && u.port !== "443") return null;
  const host = u.hostname.toLowerCase();
  if (!host || BLOCKED_HOSTNAMES.has(host)) return null;
  if (host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return null;
  if (host.startsWith("[")) return null; // no raw IPv6 literals (incl. mapped/ULA)
  if (isPrivateIpv4(host)) return null;
  if (/^\d+$/.test(host.replace(/\./g, ""))) {
    // Dotted-decimal or integer IP form that isn't a valid public IPv4.
    if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) return null;
  }
  return u;
}

/** fetch() that refuses private/internal targets on every redirect hop. */
async function safeFetch(raw: string, headers: Record<string, string>): Promise<Response | null> {
  let target = isSafePublicUrl(raw);
  if (!target) return null;
  for (let hop = 0; hop < 5; hop++) {
    const r = await fetch(target.toString(), { redirect: "manual", headers });
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get("location");
      if (!loc) return null;
      const next = isSafePublicUrl(new URL(loc, target).toString());
      if (!next) return null;
      target = next;
      continue;
    }
    return r;
  }
  return null;
}

async function fetchPlatformPage(url: string): Promise<{ html: string; ogImage: string | null } | null> {
  try {
    const r = await safeFetch(url, {
      "User-Agent": "Mozilla/5.0 (compatible; UniversflowVerifier/1.0; +https://universflow.in)",
      "Accept": "text/html,application/xhtml+xml",
    });
    if (!r || !r.ok) return null;
    const html = (await r.text()).slice(0, 500_000);
    const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] || null;
    return { html, ogImage: og && isSafePublicUrl(og) ? og : null };
  } catch { return null; }
}

async function fetchImageAsDataUrl(url: string): Promise<string | null> {
  try {
    const r = await safeFetch(url, { "User-Agent": "Mozilla/5.0 (compatible; UniversflowVerifier/1.0)" });
    if (!r || !r.ok) return null;
    const blob = await r.blob();
    if (blob.size > 4_000_000) return null; // safety cap
    if (!/^image\//i.test(blob.type || "")) return null;
    return await blobToDataUrl(blob);
  } catch { return null; }
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const { application_id } = await req.json().catch(() => ({}));
    if (!application_id || typeof application_id !== "string") {
      return new Response(JSON.stringify({ error: "application_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: rlAllowed } = await admin.rpc("check_and_increment_rate_limit", {
      _user_id: userId,
      _endpoint: "artist-verify-checks",
      _max_per_minute: 3,
    });
    if (rlAllowed === false) {
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded. Try again shortly." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: app, error: appErr } = await admin
      .from("artist_applications")
      .select("id, user_id, stage_name, music_platform_url, ownership_code, selfie_path, social_links")
      .eq("id", application_id)
      .maybeSingle();

    if (appErr || !app) {
      return new Response(JSON.stringify({ error: "Application not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (app.user_id !== userId) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const warnings: string[] = [];
    let ownershipVerifiedAt: string | null = null;
    let platformPhotoUrl: string | null = null;
    let platformFaceScore: number | null = null;
    let platformFaceStatus: "passed" | "failed" | "review" | null = null;

    // --- 1) Ownership code presence in artist page ---
    let platformPage: Awaited<ReturnType<typeof fetchPlatformPage>> = null;
    if (app.music_platform_url && app.ownership_code) {
      platformPage = await fetchPlatformPage(app.music_platform_url);
      if (!platformPage) {
        warnings.push("⚠️ Could not fetch the music-platform artist page — verify manually.");
      } else {
        const codeNorm = app.ownership_code.replace(/\s+/g, "").toUpperCase();
        const htmlNorm = platformPage.html.replace(/\s+/g, "").toUpperCase();
        if (htmlNorm.includes(codeNorm)) {
          ownershipVerifiedAt = new Date().toISOString();
        } else {
          warnings.push(`⚠️ Ownership code "${app.ownership_code}" was not found in the artist page bio.`);
        }
        platformPhotoUrl = platformPage.ogImage;
      }
    } else {
      warnings.push("⚠️ No music-platform URL or ownership code — ownership check skipped.");
    }

    // --- 2) Platform photo vs liveness selfie ---
    try {
      if (platformPhotoUrl && app.selfie_path) {
        const [platformDataUrl, selfieBlob] = await Promise.all([
          fetchImageAsDataUrl(platformPhotoUrl),
          (async () => {
            const { data } = await admin.storage.from(KYC_BUCKET).download(app.selfie_path!);
            return data ?? null;
          })(),
        ]);
        if (platformDataUrl && selfieBlob) {
          const selfieDataUrl = await blobToDataUrl(selfieBlob);
          const out = await callGemini([
            {
              role: "system",
              content:
                "You are a strict face-verification reviewer. Compare two photos and decide whether the SAME real person appears in both. Ignore background, lighting, expression, hairstyle, and glasses. If either photo has no clear human face, set match=false and confidence=0. Reply ONLY with compact JSON: {\"match\":boolean,\"confidence\":number_between_0_and_1,\"reason\":\"short\"}.",
            },
            {
              role: "user",
              content: [
                { type: "text", text: "Photo A (live-selfie from the app):" },
                { type: "image_url", image_url: { url: selfieDataUrl } },
                { type: "text", text: "Photo B (public artist-page profile photo):" },
                { type: "image_url", image_url: { url: platformDataUrl } },
              ],
            },
          ]);
          const parsed = parseJsonish(out);
          const conf = typeof parsed?.confidence === "number" ? parsed.confidence : null;
          if (parsed && conf != null) {
            platformFaceScore = Math.max(0, Math.min(1, conf));
            platformFaceStatus = parsed.match && platformFaceScore >= 0.7 ? "passed"
              : !parsed.match && platformFaceScore <= 0.3 ? "failed"
              : "review";
            if (platformFaceStatus === "failed") warnings.push("⚠️ Selfie does not match the artist-page profile photo.");
            else if (platformFaceStatus === "review") warnings.push("ℹ️ Platform photo match uncertain — please review manually.");
          } else {
            platformFaceStatus = "review";
            warnings.push("ℹ️ Platform photo face check could not run — please review manually.");
          }
        } else {
          platformFaceStatus = "review";
          warnings.push("ℹ️ Missing selfie or artist-page image — platform face check skipped.");
        }
      }
    } catch (e) {
      console.error("platform face check error", e);
      platformFaceStatus = "review";
      warnings.push("⚠️ Platform face check failed to run — please review manually.");
    }

    const { error: updErr } = await admin
      .from("artist_applications")
      .update({
        ownership_check_at: new Date().toISOString(),
        ownership_verified_at: ownershipVerifiedAt,
        platform_photo_url: platformPhotoUrl,
        face_match_platform_score: platformFaceScore,
        face_match_platform_status: platformFaceStatus,
        auto_check_warnings: warnings,
        auto_checks_at: new Date().toISOString(),
      })
      .eq("id", application_id);

    if (updErr) {
      console.error("update error", updErr);
      return new Response(JSON.stringify({ error: updErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Don't leak raw scores to the applicant — they could iterate and game
    // the check. Reply with a generic submitted status.
    return new Response(
      JSON.stringify({ ok: true, status: "submitted" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("artist-verify-checks fatal", e);
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
