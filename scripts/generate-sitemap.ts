// Generates public/sitemap.xml for every non-admin Universflow route.
// Dynamic public playlist + artist entries are fetched from Lovable Cloud at build time
// using the publishable anon key only.

import { writeFileSync } from "fs";
import { resolve } from "path";

const BASE_URL = "https://universflow.in";
const SUPABASE_URL = "https://kzaeahjeqlihmxrfhjqd.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt6YWVhaGplcWxpaG14cmZoanFkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgzMDAwMTcsImV4cCI6MjA4Mzg3NjAxN30._KvpWrcgc6-6g3VXWhAAAwSeZ3ZqexMwjYEigr6Ij7c";

interface SitemapEntry {
  path: string;
  lastmod?: string;
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: string;
}

const today = new Date().toISOString().slice(0, 10);

// Only PUBLIC, indexable routes. Auth-gated app routes (/home, /library, /search,
// /profile, /settings, /downloads, /subscription, /verify, /check-email, /offline*,
// /artist/status, /artist/studio/*) are excluded — they redirect logged-out crawlers
// to /auth, which Google reports as "Page with redirect" and refuses to index.
const staticEntries: SitemapEntry[] = [
  { path: "/", lastmod: today, changefreq: "daily", priority: "1.0" },
  { path: "/get", lastmod: today, changefreq: "weekly", priority: "0.9" },
  { path: "/download", lastmod: today, changefreq: "weekly", priority: "0.9" },
  { path: "/app", lastmod: today, changefreq: "weekly", priority: "0.85" },
  { path: "/apk", lastmod: today, changefreq: "weekly", priority: "0.85" },
  { path: "/welcome", lastmod: today, changefreq: "monthly", priority: "0.5" },
  { path: "/verify", lastmod: today, changefreq: "monthly", priority: "0.3" },
  { path: "/premium", lastmod: today, changefreq: "monthly", priority: "0.8" },
  { path: "/artists", lastmod: today, changefreq: "weekly", priority: "0.85" },
  { path: "/support", lastmod: today, changefreq: "monthly", priority: "0.65" },
  { path: "/auth", lastmod: today, changefreq: "monthly", priority: "0.4" },
  { path: "/artist/auth", lastmod: today, changefreq: "monthly", priority: "0.4" },
  { path: "/artist/apply", lastmod: today, changefreq: "monthly", priority: "0.45" },
  { path: "/blog/free-music-download-apps-india", lastmod: today, changefreq: "monthly", priority: "0.7" },
  { path: "/blog/universflow-vs-jiosaavn-vs-gaana", lastmod: today, changefreq: "monthly", priority: "0.7" },
  { path: "/blog/trending-punjabi-songs-2026", lastmod: today, changefreq: "weekly", priority: "0.75" },
  { path: "/blog/new-hindi-songs-2026", lastmod: today, changefreq: "weekly", priority: "0.8" },
  { path: "/legal/terms", lastmod: today, changefreq: "yearly", priority: "0.35" },
  { path: "/legal/privacy", lastmod: today, changefreq: "yearly", priority: "0.35" },
  { path: "/legal/artist-terms", lastmod: today, changefreq: "yearly", priority: "0.3" },
  { path: "/legal/artist-privacy", lastmod: today, changefreq: "yearly", priority: "0.3" },
];

async function fetchDynamic(): Promise<SitemapEntry[]> {
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  };
  const out: SitemapEntry[] = [];
  try {
    const [artistProfilesRes, playlistsRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/artist_profiles?select=slug,updated_at&slug=not.is.null`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/playlists?select=id,updated_at&is_public=eq.true`, { headers }),
    ]);
    if (artistProfilesRes.ok) {
      const rows = (await artistProfilesRes.json()) as Array<{ slug: string | null; updated_at?: string }>;
      for (const r of rows) {
        if (!r.slug) continue;
        out.push({
          path: `/a/${encodeURIComponent(r.slug)}`,
          lastmod: (r.updated_at || today).slice(0, 10),
          changefreq: "weekly",
          priority: "0.75",
        });
      }
    } else {
      console.warn(`[sitemap] artist_profiles fetch failed: ${artistProfilesRes.status}`);
    }
    if (playlistsRes.ok) {
      const rows = (await playlistsRes.json()) as Array<{ id: string; updated_at?: string }>;
      for (const r of rows) {
        out.push({
          path: `/playlist/${r.id}`,
          lastmod: (r.updated_at || today).slice(0, 10),
          changefreq: "weekly",
          priority: "0.65",
        });
      }
    } else {
      console.warn(`[sitemap] playlists fetch failed: ${playlistsRes.status}`);
    }
  } catch (err) {
    console.warn("[sitemap] dynamic fetch error, falling back to static only:", err);
  }
  return out;
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function generateSitemap(items: SitemapEntry[]) {
  const seen = new Set<string>();
  const urls = items
    .filter((entry) => {
      if (seen.has(entry.path)) return false;
      seen.add(entry.path);
      return true;
    })
    .map((entry) =>
      [
        "  <url>",
        `    <loc>${escapeXml(`${BASE_URL}${entry.path}`)}</loc>`,
        entry.lastmod ? `    <lastmod>${entry.lastmod}</lastmod>` : null,
        entry.changefreq ? `    <changefreq>${entry.changefreq}</changefreq>` : null,
        entry.priority ? `    <priority>${entry.priority}</priority>` : null,
        "  </url>",
      ]
        .filter(Boolean)
        .join("\n"),
    );

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    ...urls,
    `</urlset>`,
    "",
  ].join("\n");
}

(async () => {
  try {
    const dynamic = await fetchDynamic();
    const all = [...staticEntries, ...dynamic];
    const outPath = resolve("public/sitemap.xml");
    writeFileSync(outPath, generateSitemap(all));
    console.log(`[sitemap] OK — wrote ${all.length} entries (${dynamic.length} dynamic) to ${outPath}`);
  } catch (err) {
    console.error("[sitemap] FAILED to generate public/sitemap.xml");
    console.error("[sitemap] Reason:", err instanceof Error ? err.message : err);
    if (err instanceof Error && err.stack) console.error(err.stack);
    process.exit(1);
  }
})();
