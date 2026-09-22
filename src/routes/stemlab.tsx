import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { ListenerRoute, LazyFallback } from "@/lib/route-guards";
import { routeSeo } from "@/lib/routeSeo";

const StemLabPage = lazy(() => import("@/pages/StemLab"));

export const Route = createFileRoute("/stemlab")({
  head: () => {
    const seo = routeSeo({
      title: "Stem Lab — Remix any song live | Universflow",
      description:
        "Push the vocals down for karaoke, strip the band for a cappella, or widen the stage — live stem control on any track, with per-song remix memory.",
      path: "/stemlab",
    });
    return { ...seo, meta: [...seo.meta, { name: "robots", content: "noindex, follow" }] };
  },
  component: () => (
    <ListenerRoute>
      <Suspense fallback={<LazyFallback />}>
        <StemLabPage />
      </Suspense>
    </ListenerRoute>
  ),
});
