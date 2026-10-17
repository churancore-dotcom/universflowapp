import { createFileRoute } from "@tanstack/react-router";
import Analytics from "@/pages/admin/Analytics";

export const Route = createFileRoute("/admin/analytics")({ component: Analytics, head: () => ({ meta: [
  { title: 'UniversFlow Admin — Catalog Analytics' },
  { name: 'description', content: 'UniversFlow catalog listening counts, file sizes and recent activity.' },
  { property: 'og:title', content: 'UniversFlow Admin — Catalog Analytics' },
  { property: 'og:description', content: 'Review UniversFlow catalog and account statistics.' },
  { property: 'og:type', content: 'website' }, { name: 'twitter:card', content: 'summary' },
] }) });
