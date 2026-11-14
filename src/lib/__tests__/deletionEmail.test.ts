import { describe, expect, it } from 'vitest';
import { deletionScheduledEmail, formatDeletionDate } from '../deletionEmail';

describe('deletion scheduled email', () => {
  it('states the exact deletion date', () => {
    expect(formatDeletionDate('2026-11-21T14:45:00Z')).toBe('21 November 2026');
    expect(deletionScheduledEmail('2026-11-21T14:45:00Z', 'a@b.co').subject).toBe('Your account will be deleted on 21 November 2026');
  });
  it('escapes the recipient address', () => {
    expect(deletionScheduledEmail('2026-11-21T00:00:00Z', '<x>@b.co').html).not.toContain('<x>');
  });
});
