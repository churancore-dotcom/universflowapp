import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/tanstack/vite";

// The Capacitor APK has no server: it loads a static HTML file from inside the
// APK. A hand-written HTML shell cannot boot TanStack Start (its client entry
// *hydrates* server-rendered markup, so an empty <body> yields a black screen).
// TanStack Start's SPA mode prerenders a real, hydratable shell instead, so the
// native build turns it on via NATIVE_BUILD=1.
const isNativeBuild = process.env.NATIVE_BUILD === "1";

export default defineConfig({
  plugins: [mcpPlugin()],
  // Nitro's cloudflare output renames the server entry, which breaks the
  // prerender preview server used to emit the SPA shell. The APK never runs a
  // server, so skip nitro for native builds.
  ...(isNativeBuild ? { nitro: false as const } : {}),
  tanstackStart: {
    server: { entry: "server" },
    ...(isNativeBuild
      ? {
          spa: {
            enabled: true,
            prerender: {
              enabled: true,
              outputPath: "/index.html",
              crawlLinks: false,
            },
          },
        }
      : {}),
  },
});
