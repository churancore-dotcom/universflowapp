/**
 * Builds a static SPA shell (dist/client/index.html) for the Capacitor APK.
 *
 * TanStack Start's `vite build` emits an SSR worker (dist/server) + static
 * assets (dist/client) and NO index.html. Capacitor needs a real HTML entry
 * inside the APK, otherwise the WebView loads nothing and the app is a black
 * screen. This script synthesises that entry from the built client bundle so
 * the APK boots fully client-side, with no server required.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, cpSync } from "node:fs";
import { join } from "node:path";

// Different versions of the TanStack/Nitro build emit the browser bundle to
// different folders (dist/client, .output/public, .output/client). Capacitor's
// webDir is static (dist/client), so detect whichever the build produced and
// mirror it into dist/client before writing the HTML entry.
const CANDIDATES = [
  join("dist", "client"),
  join(".output", "public"),
  join(".output", "client"),
];

const source = CANDIDATES.map((p) => join(process.cwd(), p)).find((p) =>
  existsSync(join(p, "assets")),
);

if (!source) {
  console.error(
    `[native-shell] No client bundle found (looked in ${CANDIDATES.join(", ")}) — run \`vite build\` first.`,
  );
  process.exit(1);
}

const CLIENT_DIR = join(process.cwd(), "dist", "client");
if (source !== CLIENT_DIR) {
  console.log(`[native-shell] mirroring ${source} -> dist/client`);
  cpSync(source, CLIENT_DIR, { recursive: true });
}
const ASSETS_DIR = join(CLIENT_DIR, "assets");

const files = readdirSync(ASSETS_DIR);

// The client entry is the bundle that boots the router (contains the vite
// dep-map preloader and the hydration call). Fall back to content sniffing so
// a bundler rename can never black-screen the APK again.
const entry =
  files.find((f) => /^index-[\w-]+\.js$/.test(f)) ??
  files.find((f) => /^client-[\w-]+\.js$/.test(f)) ??
  files.find(
    (f) =>
      f.endsWith(".js") &&
      /hydrateRoot|StartClient/.test(readFileSync(join(ASSETS_DIR, f), "utf8")),
  );

if (!entry) {
  console.error("[native-shell] Could not locate the client entry bundle in dist/client/assets");
  process.exit(1);
}

const css = files.filter((f) => f.endsWith(".css") && /^(styles|index)-[\w-]+\.css$/.test(f));
const cssFiles = css.length ? css : files.filter((f) => f.endsWith(".css"));


const html = `<!DOCTYPE html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, maximum-scale=1.0, user-scalable=no" />
    <meta name="theme-color" content="#000000" />
    <title>Univers Flow</title>
    <link rel="icon" href="/favicon.ico" />
    <link rel="manifest" href="/manifest.json" />
${cssFiles.map((f) => `    <link rel="stylesheet" href="/assets/${f}" />`).join("\n")}
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
console.log(`[native-shell] wrote dist/client/index.html (entry: ${entry}, css: ${cssFiles.join(", ") || "none"})`);
