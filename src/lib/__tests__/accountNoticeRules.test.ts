import { describe, expect, it } from 'vitest';
import { deletionFeedback, premiumNoticeKind, RECOVERY_DAYS } from '../accountNoticeRules';

const now = Date.parse('2026-11-07T09:40:00Z');
describe('account notices', () => {
  it('warns three days before expiry', () => expect(premiumNoticeKind('2026-11-10T09:40:00Z', now)).toBe('expiring_3d'));
  it('warns one day before expiry', () => expect(premiumNoticeKind('2026-11-08T09:40:00Z', now)).toBe('expiring_1d'));
  it('marks the exact deadline expired', () => expect(premiumNoticeKind('2026-11-07T09:40:00Z', now)).toBe('expired'));
  it('does not warn earlier than three days', () => expect(premiumNoticeKind('2026-11-11T09:40:00Z', now)).toBeNull());
  it('allows deletion without answering the reason', () => expect(deletionFeedback({})).toEqual({ reason: 'Prefer not to say', details: '' }));
  it('rejects unknown feedback categories', () => expect(() => deletionFeedback({ reason: 'invalid' })).toThrow());
  it('bounds free-text feedback', () => expect(() => deletionFeedback({ details: 'a'.repeat(1501) })).toThrow());
  it('preserves seven days of recovery', () => expect(RECOVERY_DAYS).toBe(7));
});