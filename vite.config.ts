import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  build: {
    sourcemap: true,
    cssCodeSplit: true,
    minify: "esbuild",
    target: "es2020",
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;

          // React core
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/.test(id)) {
            return "react-vendor";
          }
          // Supabase
          if (id.includes("@supabase")) return "supabase-vendor";
          // Animation
          if (id.includes("framer-motion")) return "motion-vendor";
          // Data / query
          if (id.includes("@tanstack")) return "query-vendor";
          // Radix UI (split per-package to stay under 500KB)
          const radix = id.match(/@radix-ui[\\/]([^\\/]+)/);
          if (radix) return `radix-${radix[1].replace(/^react-/, "")}`;
          // Charts
          if (id.includes("recharts") || id.includes("d3-")) return "charts-vendor";
          // Icons
          if (id.includes("lucide-react")) return "icons-vendor";
          // Face / ML
          if (id.includes("@vladmandic") || id.includes("face-api") || id.includes("@tensorflow")) {
            return "face-vendor";
          }
          // Capacitor
          if (id.includes("@capacitor")) return "capacitor-vendor";
          // Forms / validation
          if (id.includes("react-hook-form") || id.includes("zod") || id.includes("@hookform")) {
            return "forms-vendor";
          }
          // Date utils
          if (id.includes("date-fns") || id.includes("dayjs")) return "date-vendor";
          // Everything else from node_modules
          return "vendor";
        },
      },
    },
  },
  // Strip console.log / debugger from production bundle (keeps console.warn/error
  // so real production errors still surface in Sentry).
  esbuild: mode === "production"
    ? { drop: ["debugger"], pure: ["console.log", "console.info", "console.debug"] }
    : undefined,

  plugins: [
    react(),
    mode === "development" && componentTagger(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
