import { createFileRoute } from '@tanstack/react-router';
import AccountDeletionRequests from '@/pages/admin/AccountDeletionRequests';

export const Route = createFileRoute('/admin/deletion-requests')({
  component: AccountDeletionRequests,
  head: () => ({ meta: [
    { title: 'Deletion Requests — Univers Flow Admin' },
    { name: 'description', content: 'Review Univers Flow account deletion requests, feedback and recovery deadlines.' },
    { property: 'og:title', content: 'Deletion Requests — Univers Flow Admin' },
    { property: 'og:description', content: 'Account deletion feedback and recovery deadlines for Univers Flow administrators.' },
    { property: 'og:type', content: 'website' },
    { name: 'twitter:card', content: 'summary' },
    { name: 'robots', content: 'noindex, nofollow' },
  ] }),
});