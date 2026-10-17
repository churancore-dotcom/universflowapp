import { describe, expect, it } from 'vitest';
import { assertCompletedPlayPurchase, canBuyPlayProduct, planDisplayPrice, usesPlayCheckout } from '../playPaymentPolicy';

describe('Play distribution payment policy', () => {
  it('never falls back to external checkout for a Play-flagged build', () => {
    expect(usesPlayCheckout('true')).toBe(true);
  });
  it('preserves external checkout for website APK distribution', () => {
    expect(usesPlayCheckout(undefined)).toBe(false);
    expect(usesPlayCheckout('false')).toBe(false);
  });
  it('does not substitute website INR prices for missing Play prices', () => {
    expect(planDisplayPrice(true, undefined, 199)).toBe('Unavailable');
    expect(planDisplayPrice(true, '$2.99', 199)).toBe('$2.99');
    expect(planDisplayPrice(false, undefined, 199)).toBe('₹199');
  });
  it('blocks checkout without server verification even when Play supplies a price', () => {
    expect(canBuyPlayProduct('₹199', false)).toBe(false);
    expect(canBuyPlayProduct(undefined, true)).toBe(false);
    expect(canBuyPlayProduct('₹199', true)).toBe(true);
  });
  it.each([1, 2, undefined])('does not grant cancelled, pending or unknown state %s', (purchaseState) => {
    expect(() => assertCompletedPlayPurchase({ purchaseState, consumptionState: 0 })).toThrow('Purchase is not complete');
  });
  it('requires a verified consumption state before an atomic token claim', () => {
    expect(() => assertCompletedPlayPurchase({ purchaseState: 0 })).toThrow();
    expect(() => assertCompletedPlayPurchase({ purchaseState: 0, consumptionState: 0 })).not.toThrow();
    expect(() => assertCompletedPlayPurchase({ purchaseState: 0, consumptionState: 1 })).not.toThrow();
  });
});