import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { deletionFeedback } from './accountNoticeRules';
import { deletionScheduledEmail } from './deletionEmail';

// Best effort: the deletion is already scheduled, so a mail failure must not undo it.
async function sendDeletionEmail(to: string, deleteAfter: string) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !to) return;
  const email = deletionScheduledEmail(deleteAfter, to);
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'Universflow <noreply@universflow.in>', reply_to: 'support@universflow.in', to: [to], ...email }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) console.error(`Deletion email failed [${res.status}]: ${await res.text()}`);
  } catch (error) {
    console.error('Deletion email failed', error);
  }
}

export const requestAccountDeletion = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { reason?: string; details?: string }) => deletionFeedback(input))
  .handler(async ({ context, data: feedback }) => {
    const { data, error } = await context.supabase.rpc('request_account_deletion_with_feedback', { _reason: feedback.reason, _details: feedback.details });
    if (error) throw new Error('Could not schedule account deletion');
    const deleteAfter = String(data);
    const email = typeof context.claims?.email === 'string' ? context.claims.email : '';
    await sendDeletionEmail(email, deleteAfter);
    return { deleteAfter };
  });

export const getAccountDeletionRequests = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { page: number; status: string }) => {
    if (!Number.isInteger(input.page) || input.page < 0 || !['pending', 'cancelled', 'all'].includes(input.status)) throw new Error('Invalid filter');
    return input;
  })
  .handler(async ({ context, data }) => {
    const { data: allowed, error: roleError } = await context.supabase.rpc('has_role', { _user_id: context.userId, _role: 'admin' });
    if (roleError || allowed !== true) throw new Error('Admin access required');
    const { data: rows, error } = await context.supabase.rpc('admin_account_deletion_requests', { _offset: data.page * 50, _status: data.status });
    if (error) throw new Error('Could not load deletion requests');
    return rows;
  });

export const cancelAccountDeletion = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc('cancel_account_deletion');
    if (error || data !== true) throw new Error('Deletion can no longer be cancelled');
    return { cancelled: true };
  });