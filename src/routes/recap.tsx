import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { ListenerRoute, LazyFallback } from "@/lib/route-guards";
import { routeSeo } from "@/lib/routeSeo";

const RecapPage = lazy(() => import("@/pages/Recap"));

export const Route = createFileRoute("/recap")({
  head: () =>
    routeSeo({
      title: "Your Listening Recap — Universflow",
      description:
        "Your month in music: minutes listened, top artists, listening personality and every track you played, ready to replay.",
      path: "/recap",
      noindex: true,
    }),
  component: () => (
    <ListenerRoute>
      <Suspense fallback={<LazyFallback />}>
        <RecapPage />
      </Suspense>
    </ListenerRoute>
  ),
});
