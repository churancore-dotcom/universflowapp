// Distribution policy must not change when the native bridge is delayed or unavailable.
export function usesPlayCheckout(playFlag: unknown): boolean {
  return playFlag === 'true';
}

export function canBuyPlayProduct(formattedPrice: string | undefined, verificationReady: boolean): boolean {
  return verificationReady && Boolean(formattedPrice?.trim());
}

export function planDisplayPrice(playBuild: boolean, formattedPrice: string | undefined, webPrice: number): string {
  return playBuild ? formattedPrice?.trim() || 'Unavailable' : `₹${webPrice}`;
}

export interface VerifiedPlayPurchase {
  purchaseState?: number;
  consumptionState?: number;
  orderId?: string;
}

export function assertCompletedPlayPurchase(purchase: VerifiedPlayPurchase): void {
  if (purchase.purchaseState !== 0) throw new Error('Purchase is not complete');
  if (purchase.consumptionState !== 0 && purchase.consumptionState !== 1) {
    throw new Error('Purchase consumption status is unavailable');
  }
}