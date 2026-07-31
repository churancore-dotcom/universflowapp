/**
 * Builds a static SPA shell (dist/client/index.html) for the Capacitor APK.
 *
 * TanStack Start's `vite build` emits an SSR worker (dist/server) + static
 * assets (dist/client) and NO index.html. Capacitor needs a real HTML entry
 * inside the APK, otherwise the WebView loads nothing and the app is a black
 * screen. This script synthesises that entry from the built client bundle so
 * the APK boots fully client-side, with no server required.
 */
import { readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const CLIENT_DIR = join(process.cwd(), "dist", "client");
const ASSETS_DIR = join(CLIENT_DIR, "assets");

if (!existsSync(ASSETS_DIR)) {
  console.error("[native-shell] dist/client/assets missing — run `vite build` first.");
  process.exit(1);
}

const files = readdirSync(ASSETS_DIR);

// The client entry is the bundle that boots the router (contains the vite
// dep-map preloader and the hydration call).
const entry =
  files.find((f) => /^index-[\w-]+\.js$/.test(f)) ??
  files.find((f) => /^client-[\w-]+\.js$/.test(f));

if (!entry) {
  console.error("[native-shell] Could not locate the client entry bundle in dist/client/assets");
  process.exit(1);
}

const css = files.filter((f) => f.endsWith(".css") && /^(styles|index)-[\w-]+\.css$/.test(f));

const html = `<!DOCTYPE html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, maximum-scale=1.0, user-scalable=no" />
    <meta name="theme-color" content="#000000" />
    <title>Univers Flow</title>
    <link rel="icon" href="/favicon.ico" />
    <link rel="manifest" href="/manifest.json" />
${css.map((f) => `    <link rel="stylesheet" href="/assets/${f}" />`).join("\n")}
    <style>
      html, body { margin: 0; background: #000; color: #fff; }
    </style>
  </head>
  <body>
    <script type="module" src="/assets/${entry}"></script>
  </body>
</html>
`;

writeFileSync(join(CLIENT_DIR, "index.html"), html, "utf8");
console.log(`[native-shell] wrote dist/client/index.html (entry: ${entry}, css: ${css.join(", ") || "none"})`);
