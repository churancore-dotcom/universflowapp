import { createFileRoute } from '@tanstack/react-router';
import DeleteAccount from '@/pages/legal/DeleteAccount';
import { routeSeo } from '@/lib/routeSeo';

export const Route = createFileRoute('/legal/delete-account')({
  head: () => routeSeo({
    title: 'Delete Your Account — UniversFlow',
    description: 'Schedule permanent deletion of your UniversFlow account and associated data, with a seven-day recovery period.',
    path: '/legal/delete-account',
  }),
  component: DeleteAccount,
});