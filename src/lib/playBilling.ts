import { Capacitor, registerPlugin } from '@capacitor/core';
import { usesPlayCheckout } from '@/lib/playPaymentPolicy';

export const PLAY_PRODUCTS = {
  monthly: 'universflow_premium_1m',
  bimonthly: 'universflow_premium_2m',
  quarterly: 'universflow_premium_3m',
} as const;

export type PlayPlan = keyof typeof PLAY_PRODUCTS;

export interface PlayProduct {
  productId: string;
  name: string;
  description: string;
  formattedPrice: string;
}

export interface PlayPurchase {
  productId: string;
  purchaseToken: string;
  orderId: string;
}

interface PlayBillingPluginShape {
  getProducts(options: { productIds: string[] }): Promise<{ products: PlayProduct[] }>;
  purchase(options: { productId: string }): Promise<PlayPurchase>;
  restorePurchases(): Promise<{ purchases: PlayPurchase[] }>;
}

const PlayBilling = registerPlugin<PlayBillingPluginShape>('PlayBilling');

// Only the signed Play Store AAB build sets VITE_PLAY_STORE=true. Website APKs use UPI checkout.
export const isPlayStoreBuild = () =>
  usesPlayCheckout(import.meta.env.VITE_PLAY_STORE);

function requirePlayRuntime() {
  if (!isPlayStoreBuild() || !Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
    throw new Error('Google Play Billing is unavailable on this device');
  }
}

export async function getPlayProducts(): Promise<PlayProduct[]> {
  if (!isPlayStoreBuild()) return [];
  requirePlayRuntime();
  return (await PlayBilling.getProducts({ productIds: Object.values(PLAY_PRODUCTS) })).products;
}

export async function startPlayPurchase(plan: PlayPlan): Promise<PlayPurchase> {
  requirePlayRuntime();
  return PlayBilling.purchase({ productId: PLAY_PRODUCTS[plan] });
}

export async function restorePlayPurchases(): Promise<PlayPurchase[]> {
  if (!isPlayStoreBuild()) return [];
  requirePlayRuntime();
  return (await PlayBilling.restorePurchases()).purchases;
}