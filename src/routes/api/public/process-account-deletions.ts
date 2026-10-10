import { createFileRoute } from '@tanstack/react-router';

const safeEqual = (left: string, right: string): boolean => {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
};

export const Route = createFileRoute('/api/public/process-account-deletions')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const supplied = request.headers.get('x-cron-secret') || '';
        const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
        const { data: secretRow } = await supabaseAdmin
          .from('internal_secrets')
          .select('value')
          .eq('key', 'account_deletion_cron_token')
          .maybeSingle();
        const expected = secretRow?.value || '';
        if (!supplied || !expected || !safeEqual(supplied, expected)) {
          return new Response('Unauthorized', { status: 401 });
        }

        const { data: due, error: readError } = await supabaseAdmin
          .from('account_deletion_requests')
          .select('user_id')
          .is('cancelled_at', null)
          .is('completed_at', null)
          .lte('delete_after', new Date().toISOString())
          .limit(50);
        if (readError) return new Response('Queue unavailable', { status: 503 });

        let deleted = 0;
        let failed = 0;
        for (const row of due ?? []) {
          const { error } = await supabaseAdmin.auth.admin.deleteUser(row.user_id);
          if (error) {
            failed += 1;
            console.error('[account-deletion] delete failed', row.user_id, error.message);
          } else {
            deleted += 1;
          }
        }
        return Response.json({ processed: due?.length ?? 0, deleted, failed });
      },
    },
  },
});