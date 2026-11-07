import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { deletionFeedback } from './accountNoticeRules';

export const requestAccountDeletion = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { reason?: string; details?: string }) => deletionFeedback(input))
  .handler(async ({ context, data: feedback }) => {
    const { data, error } = await context.supabase.rpc('request_account_deletion_with_feedback', { _reason: feedback.reason, _details: feedback.details });
    if (error) throw new Error('Could not schedule account deletion');
    return { deleteAfter: String(data) };
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