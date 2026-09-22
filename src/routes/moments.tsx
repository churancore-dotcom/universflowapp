import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { ListenerRoute, LazyFallback } from "@/lib/route-guards";
import { routeSeo } from "@/lib/routeSeo";

const MomentsPage = lazy(() => import("@/pages/Moments"));

export const Route = createFileRoute("/moments")({
  head: () => {
    const seo = routeSeo({
      title: "Memory Tape — Save the seconds that hit | Universflow",
      description:
        "Bookmark the exact second of any song, tag how it felt, and replay every saved moment back to back as one continuous memory tape.",
      path: "/moments",
    });
    return { ...seo, meta: [...seo.meta, { name: "robots", content: "noindex, follow" }] };
  },
  component: () => (
    <ListenerRoute>
      <Suspense fallback={<LazyFallback />}>
        <MomentsPage />
      </Suspense>
    </ListenerRoute>
  ),
});
