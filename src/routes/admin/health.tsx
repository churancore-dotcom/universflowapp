import { createFileRoute } from "@tanstack/react-router";
import SystemHealth from "@/pages/admin/SystemHealth";

export const Route = createFileRoute("/admin/health")({ component: SystemHealth, head: () => ({ meta: [
  { title: 'UniversFlow Admin — Service Health' },
  { name: 'description', content: 'Check UniversFlow database, account, storage and realtime connections.' },
  { property: 'og:title', content: 'UniversFlow Admin — Service Health' },
  { property: 'og:description', content: 'Verified service connection checks for UniversFlow administrators.' },
  { property: 'og:type', content: 'website' }, { name: 'twitter:card', content: 'summary' },
] }) });
