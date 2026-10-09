import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';

export const requestAccountDeletion = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc('request_account_deletion');
    if (error) throw new Error('Could not schedule account deletion');
    return { deleteAfter: String(data) };
  });

export const cancelAccountDeletion = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc('cancel_account_deletion');
    if (error || data !== true) throw new Error('Deletion can no longer be cancelled');
    return { cancelled: true };
  });