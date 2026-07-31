import { createFileRoute } from "@tanstack/react-router";
import AdsManager from "@/pages/admin/AdsManager";

export const Route = createFileRoute("/admin/ads")({
  component: AdsManager,
  head: () => ({
    meta: [
      { title: "Ads Manager · Univers Flow Admin" },
      { name: "description", content: "Create and control sponsored and Premium promo ads shown between songs on Univers Flow." },
      { property: "og:title", content: "Ads Manager · Univers Flow Admin" },
      { property: "og:description", content: "Manage ad campaigns, creatives, timing and skip rules for Univers Flow." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});
