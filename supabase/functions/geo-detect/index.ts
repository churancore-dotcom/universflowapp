// Returns the visitor's ISO-3166 alpha-2 country code.
// Priority: CDN/edge headers → real IP geo lookup → null.
// No personal data is stored, nothing is logged.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

function pickHeader(h: Headers): string | null {
  const raw =
    h.get('cf-ipcountry') ||
    h.get('x-vercel-ip-country') ||
    h.get('x-country-code') ||
    h.get('x-appengine-country') ||
    h.get('cloudfront-viewer-country') ||
    '';
  return raw.toUpperCase().match(/^[A-Z]{2}$/)?.[0] || null;
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const IPV6 = /^[0-9a-fA-F:]{2,39}$/;

function isPublicIp(ip: string): boolean {
  if (IPV4.test(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0 || a >= 224) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    return true;
  }
  if (IPV6.test(ip) && ip.includes(':')) {
    const l = ip.toLowerCase();
    if (l.startsWith('::') || l.startsWith('fe80') || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('ff')) return false;
    return true;
  }
  return false;
}

// Only trust the IP appended by the platform's own proxy (rightmost
// x-forwarded-for entry), never a caller-supplied leftmost value.
function clientIp(h: Headers): string | null {
  const parts = (h.get('x-forwarded-for') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ip = parts[parts.length - 1] || '';
  return isPublicIp(ip) ? ip : null;
}

async function lookupIp(ip: string): Promise<string | null> {
  const safe = encodeURIComponent(ip);
  const providers = [
    `https://ipapi.co/${safe}/country/`,
    `https://api.country.is/${safe}`,
    `https://ipwho.is/${safe}?fields=country_code`,
  ];
  for (const url of providers) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 1500);
      const res = await fetch(url, { signal: ctrl.signal, redirect: 'error' });
      clearTimeout(t);
      if (!res.ok) continue;
      const ct = res.headers.get('content-type') || '';
      let cc: string | null = null;
      if (ct.includes('application/json')) {
        const j = await res.json();
        cc = (j?.country || j?.country_code || '').toUpperCase();
      } else {
        cc = (await res.text()).slice(0, 8).trim().toUpperCase();
      }
      if (/^[A-Z]{2}$/.test(cc || '')) return cc;
    } catch { /* try next */ }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  let cc = pickHeader(req.headers);
  if (!cc) {
    const ip = clientIp(req.headers);
    if (ip) cc = await lookupIp(ip);
  }

  return new Response(
    JSON.stringify({ country_code: cc, detected_at: new Date().toISOString() }),
    {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Cache-Control': 'private, max-age=3600',
      },
    },
  );
});
