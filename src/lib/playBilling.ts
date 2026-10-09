import { Capacitor, registerPlugin } from '@capacitor/core';

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

export const isPlayStoreBuild = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

export async function getPlayProducts(): Promise<PlayProduct[]> {
  if (!isPlayStoreBuild()) return [];
  return (await PlayBilling.getProducts({ productIds: Object.values(PLAY_PRODUCTS) })).products;
}

export async function startPlayPurchase(plan: PlayPlan): Promise<PlayPurchase> {
  return PlayBilling.purchase({ productId: PLAY_PRODUCTS[plan] });
}

export async function restorePlayPurchases(): Promise<PlayPurchase[]> {
  if (!isPlayStoreBuild()) return [];
  return (await PlayBilling.restorePurchases()).purchases;
}