import { createFileRoute } from "@tanstack/react-router";
import ContentControl from "@/pages/admin/ContentControl";

export const Route = createFileRoute("/admin/content-control")({ component: ContentControl, head: () => ({ meta: [
  { title: 'UniversFlow Admin — Content Control' },
  { name: 'description', content: 'Feature tracks on the UniversFlow home page and manage their order.' },
  { property: 'og:title', content: 'UniversFlow Admin — Content Control' },
  { property: 'og:description', content: 'Homepage featuring controls for authorized UniversFlow administrators.' },
  { property: 'og:type', content: 'website' }, { name: 'twitter:card', content: 'summary' },
] }) });
