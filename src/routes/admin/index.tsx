import { createFileRoute } from "@tanstack/react-router";
import AdminDashboard from "@/pages/admin/AdminDashboard";

export const Route = createFileRoute("/admin/")({
  component: AdminDashboard,
  head: () => ({ meta: [
    { title: 'UniversFlow Admin — Operations & Reviews' },
    { name: 'description', content: 'Manage UniversFlow music, payment reviews, artist applications, content reports and support.' },
    { property: 'og:title', content: 'UniversFlow Admin — Operations & Reviews' },
    { property: 'og:description', content: 'UniversFlow operations and pending reviews.' },
    { property: 'og:type', content: 'website' },
    { name: 'twitter:card', content: 'summary' },
  ] }),
});
