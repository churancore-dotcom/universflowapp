export const PLAY_PRODUCT_DAYS = {
  universflow_premium_1m: 30,
  universflow_premium_2m: 60,
  universflow_premium_3m: 90,
} as const;

export type PlayProductId = keyof typeof PLAY_PRODUCT_DAYS;

export function entitlementExpiry(productId: PlayProductId, nowMs: number, existingExpiry?: string | null): string {
  const existingMs = existingExpiry ? new Date(existingExpiry).getTime() : 0;
  const startMs = Math.max(nowMs, Number.isFinite(existingMs) ? existingMs : 0);
  return new Date(startMs + PLAY_PRODUCT_DAYS[productId] * 24 * 60 * 60 * 1000).toISOString();
}