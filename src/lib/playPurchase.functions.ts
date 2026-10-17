import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { z } from 'zod';
import { assertCompletedPlayPurchase, type VerifiedPlayPurchase } from '@/lib/playPaymentPolicy';

const PACKAGE_NAME = 'com.universeflow.app';
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

export const checkPlayBillingReady = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    try {
      await getGoogleAccessToken();
      return { ready: true };
    } catch {
      return { ready: false };
    }
  });

export const verifyPlayPurchase = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const accessToken = await getGoogleAccessToken();
    const purchaseUrl = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE_NAME}/purchases/products/${data.productId}/tokens/${encodeURIComponent(data.purchaseToken)}`;
    const verifyResponse = await fetch(purchaseUrl, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!verifyResponse.ok) throw new Error('Google Play could not verify this purchase');
    const purchase = await verifyResponse.json() as VerifiedPlayPurchase;
    assertCompletedPlayPurchase(purchase);

    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { data: claim, error } = await supabaseAdmin.rpc('claim_verified_play_purchase', {
      _user_id: context.userId,
      _purchase_token: data.purchaseToken,
      _product_id: data.productId,
      _order_id: purchase.orderId || '',
      _consumed: purchase.consumptionState === 1,
    });
    if (error) throw new Error('Could not claim this purchase. It may already belong to another account.');
    const result = z.object({ expiresAt: z.string(), alreadyGranted: z.boolean() }).parse(claim);

    // Always retry consumption on restore, including tokens already granted.
    // The atomic ledger makes retries safe without extending access again.
    if (purchase.consumptionState !== 1) {
      let consumed = false;
      for (let attempt = 0; attempt < 3 && !consumed; attempt += 1) {
        const response = await fetch(`${purchaseUrl}:consume`, {
          method: 'POST',
          headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
          body: '{}',
        });
        consumed = response.ok;
        if (!consumed && response.status < 500 && response.status !== 429) break;
      }
      if (!consumed) throw new Error('Payment verified, but Google Play completion needs a retry. Use Restore purchase before buying again.');
      const { error: markError } = await supabaseAdmin.from('play_purchase_claims')
        .update({ consumed_at: new Date().toISOString() }).eq('purchase_token', data.purchaseToken);
      if (markError) console.error('[PlayBilling] Could not record consumption');
    }
    return { success: true, expiresAt: result.expiresAt };
  });