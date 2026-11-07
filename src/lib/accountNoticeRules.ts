export const DELETION_REASONS = ['Playback or audio issues', 'Songs or discovery', 'Too expensive', 'Privacy concerns', 'Not using the app', 'Other', 'Prefer not to say'] as const;
export const RECOVERY_DAYS = 7;

export function premiumNoticeKind(expiresAt: string | null, now = Date.now()): 'expired' | 'expiring_1d' | 'expiring_3d' | null {
  if (!expiresAt) return null;
  const remaining = Date.parse(expiresAt) - now;
  if (!Number.isFinite(remaining)) return null;
  if (remaining <= 0) return 'expired';
  if (remaining <= 24 * 60 * 60 * 1000) return 'expiring_1d';
  if (remaining <= 3 * 24 * 60 * 60 * 1000) return 'expiring_3d';
  return null;
}

export function deletionFeedback(input: { reason?: string; details?: string }) {
  const reason = input.reason || 'Prefer not to say';
  if (!(DELETION_REASONS as readonly string[]).includes(reason)) throw new Error('Choose a valid reason');
  const details = (input.details || '').trim();
  if (details.length > 1500) throw new Error('Keep feedback under 1,500 characters');
  return { reason, details };
}