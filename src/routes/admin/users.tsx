import { createFileRoute } from "@tanstack/react-router";
import ManageUsers from "@/pages/admin/ManageUsers";

export const Route = createFileRoute("/admin/users")({ component: ManageUsers, head: () => ({ meta: [
  { title: 'UniversFlow Admin — User Management' },
  { name: 'description', content: 'Review UniversFlow accounts and manage account status.' },
  { property: 'og:title', content: 'UniversFlow Admin — User Management' },
  { property: 'og:description', content: 'Account management for authorized UniversFlow administrators.' },
  { property: 'og:type', content: 'website' }, { name: 'twitter:card', content: 'summary' },
] }) });
