import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { ListenerRoute, LazyFallback } from "@/lib/route-guards";
import { routeSeo } from "@/lib/routeSeo";

const RecapPage = lazy(() => import("@/pages/Recap"));

export const Route = createFileRoute("/recap")({
  head: () => {
    const seo = routeSeo({
      title: "Your Listening Recap — Universflow",
      description:
        "Your month in music: minutes listened, top artists, listening personality and every track you played, ready to replay.",
      path: "/recap",
    });
    return { ...seo, meta: [...seo.meta, { name: "robots", content: "noindex, follow" }] };
  },
  component: () => (
    <ListenerRoute>
      <Suspense fallback={<LazyFallback />}>
        <RecapPage />
      </Suspense>
    </ListenerRoute>
  ),
});
