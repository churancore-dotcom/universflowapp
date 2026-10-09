import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { z } from 'zod';

const PACKAGE_NAME = 'com.universeflow.app';
const PRODUCT_DAYS: Record<string, number> = {
  universflow_premium_1m: 30,
  universflow_premium_2m: 60,
  universflow_premium_3m: 90,
};

const inputSchema = z.object({
  productId: z.enum(['universflow_premium_1m', 'universflow_premium_2m', 'universflow_premium_3m']),
  purchaseToken: z.string().min(20).max(4096),
  orderId: z.string().max(200).optional(),
});

const base64Url = (value: Uint8Array | string) => {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
};

const getGoogleAccessToken = async () => {
  const raw = process.env['GOOGLE_PLAY_SERVICE_ACCOUNT_JSON'];
  if (!raw) throw new Error('Play purchase verification is not configured');
  const credentials = JSON.parse(raw) as { client_email?: string; private_key?: string };
  if (!credentials.client_email || !credentials.private_key) throw new Error('Invalid Play verification credentials');
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64Url(JSON.stringify({
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const pem = credentials.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  const keyBytes = Uint8Array.from(atob(pem), (char) => char.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', keyBytes, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claims}`));
  const assertion = `${header}.${claims}.${base64Url(new Uint8Array(signature))}`;
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!tokenResponse.ok) throw new Error('Could not authenticate Play purchase verification');
  const token = await tokenResponse.json() as { access_token?: string };
  if (!token.access_token) throw new Error('Play verification token missing');
  return token.access_token;
};

export const verifyPlayPurchase = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const accessToken = await getGoogleAccessToken();
    const purchaseUrl = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE_NAME}/purchases/products/${data.productId}/tokens/${encodeURIComponent(data.purchaseToken)}`;
    const verifyResponse = await fetch(purchaseUrl, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!verifyResponse.ok) throw new Error('Google Play could not verify this purchase');
    const purchase = await verifyResponse.json() as { purchaseState?: number; orderId?: string; purchaseTimeMillis?: string };
    if (purchase.purchaseState !== 0) throw new Error('Purchase is not complete');

    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { data: claimed } = await supabaseAdmin.from('user_subscriptions')
      .select('user_id').eq('purchase_token', data.purchaseToken).maybeSingle();
    if (claimed && claimed.user_id !== context.userId) throw new Error('Purchase already belongs to another account');

    const { data: existing } = await supabaseAdmin.from('user_subscriptions')
      .select('expires_at').eq('user_id', context.userId).maybeSingle();
    const existingExpiry = existing?.expires_at ? new Date(existing.expires_at).getTime() : 0;
    const startAt = Math.max(Date.now(), existingExpiry);
    const expiresAt = new Date(startAt + PRODUCT_DAYS[data.productId] * 24 * 60 * 60 * 1000).toISOString();
    const transactionId = purchase.orderId || data.orderId || `play:${data.productId}`;
    const { error } = await supabaseAdmin.from('user_subscriptions').upsert({
      user_id: context.userId,
      subscription_type: 'premium_monthly',
      platform: 'android',
      purchase_token: data.purchaseToken,
      transaction_id: transactionId,
      expires_at: expiresAt,
      status: 'active',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    if (error) throw new Error('Could not activate Premium');

    const consumeResponse = await fetch(`${purchaseUrl}:consume`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: '{}',
    });
    if (!consumeResponse.ok) console.error('[PlayBilling] Purchase verified but consume failed', consumeResponse.status);
    return { success: true, expiresAt };
  });