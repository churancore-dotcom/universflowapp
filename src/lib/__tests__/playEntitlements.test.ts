import { describe, expect, it } from 'vitest';
import { entitlementExpiry } from '../playEntitlements';

describe('Google Play Premium access packs', () => {
  const now = Date.UTC(2026, 9, 9);

  it('grants exactly 30 days for the one-month product', () => {
    expect(entitlementExpiry('universflow_premium_1m', now)).toBe('2026-11-08T00:00:00.000Z');
  });

  it('grants exactly 60 days for the two-month product', () => {
    expect(entitlementExpiry('universflow_premium_2m', now)).toBe('2026-12-08T00:00:00.000Z');
  });

  it('grants exactly 90 days for the three-month product', () => {
    expect(entitlementExpiry('universflow_premium_3m', now)).toBe('2027-01-07T00:00:00.000Z');
  });

  it('extends from an active entitlement instead of replacing it', () => {
    expect(entitlementExpiry('universflow_premium_1m', now, '2026-10-20T00:00:00.000Z')).toBe('2026-11-19T00:00:00.000Z');
  });
});