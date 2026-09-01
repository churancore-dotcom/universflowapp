import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import DebugPanel from "@/components/DebugPanel";
import ResolverLogPanel from "@/components/ResolverLogPanel";

export const Route = createFileRoute("/debug")({
  head: () => ({
    meta: [
      { title: "Playback Diagnostics · UniversFlow" },
      { name: "description", content: "Live stream-resolution diagnostics: resolve failures, network drops and retry outcomes as they happen." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Playback Diagnostics · UniversFlow" },
      { property: "og:description", content: "Live stream-resolution diagnostics with timestamps and retry outcomes." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DebugRoute,
});

function DebugRoute() {
  return (
    <div className="min-h-[100dvh] bg-background text-foreground px-4 pt-6 pb-28">
      <div className="flex items-center gap-2 mb-4">
        <Link to="/settings" className="w-9 h-9 rounded-2xl neu-inset flex items-center justify-center">
          <ChevronLeft className="w-4 h-4" />
        </Link>
        <div>
          <h1 className="text-xl font-bold">Playback diagnostics</h1>
          <p className="text-[11px] text-muted-foreground">Live on this device · nothing uploaded</p>
        </div>
      </div>
      <div className="space-y-4">
        <ResolverLogPanel />
        <DebugPanel />
      </div>
    </div>
  );
}
