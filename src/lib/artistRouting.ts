import type { User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

export type ArtistDestination = '/artist/studio' | '/artist/status' | '/artist/onboarding' | null;

async function latestApplicationForUser(userId: string): Promise<{ status?: string } | null> {
  const { data } = await supabase
    .from('artist_applications_safe')
    .select('status, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as { status?: string } | null;
}

export function hasArtistSignupIntent(user?: User | null): boolean {
  const metadata = (user?.user_metadata || {}) as Record<string, unknown>;
  // Do not trust localStorage for auth/routing decisions — any user can modify
  // it in DevTools. Artist intent must come from Supabase auth metadata only.
  return metadata.account_type === 'artist';
}

export async function getArtistDestination(user?: User | null): Promise<ArtistDestination> {
  if (!user) return null;
  // Cached per user: this ran on every guarded navigation and cost up to three
  // round trips before the page was allowed to render.
  return getAccess<ArtistDestination>(user.id, 'artist-destination', () => resolveArtistDestination(user));
}

async function resolveArtistDestination(user: User): Promise<ArtistDestination> {
  if (!user) return null;

  try {
    // Admins are NEVER trapped in the artist flow — even if they once applied
    // as an artist and were rejected, "Back to App" / /home must never land
    // them on /artist/status. Admin role takes priority over any artist intent.
    const { data: isAdmin } = await supabase.rpc('has_role', {
      _user_id: user.id,
      _role: 'admin',
    });
    if (isAdmin) return null;
  } catch {
    // If admin check fails, fall through — don't block the user.
  }

  try {
    const { data: hasArtistRole } = await supabase.rpc('has_role', {
      _user_id: user.id,
      _role: 'artist',
    });
    if (hasArtistRole) return '/artist/studio';
  } catch {
    // Keep routing resilient if the role check is temporarily unavailable.
  }

  // Only force-redirect into the artist flow when the user explicitly arrived
  // via the artist signup intent (just submitted, came from /artist/auth, etc).
  // A pending/rejected/approved application on its own must NEVER trap the
  // user on /artist/status every time they open the app — they're listeners
  // too, and admins must always reach the rest of the app. Users can still
  // visit /artist/status manually from the menu.
  if (!hasArtistSignupIntent(user)) return null;

  try {
    const status = (await latestApplicationForUser(user.id))?.status;
    if (status === 'pending' || status === 'rejected' || status === 'approved') {
      return '/artist/status';
    }
  } catch {
    // Fall through to /artist/apply
  }

  return '/artist/onboarding';
}