import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { ProtectedRoute, LazyFallback } from "@/lib/route-guards";
import { routeSeo } from "@/lib/routeSeo";

const ProfilePage = lazy(() => import("@/pages/Profile"));

export const Route = createFileRoute("/profile")({
  head: () => {
    const seo = routeSeo({
      title: "Your Profile — Universflow",
      description:
        "See your listening stats, recently played tracks, top artists and account details on your Universflow profile.",
      path: "/profile",
    });
    return { ...seo, meta: [...seo.meta, { name: "robots", content: "noindex, follow" }] };
  },
  component: () => (
    <ProtectedRoute>
      <Suspense fallback={<LazyFallback />}>
        <ProfilePage />
      </Suspense>
    </ProtectedRoute>
  ),
});
