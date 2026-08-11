// stream-proxy
// ----------------------------------------------------------------------------
// Re-streams upstream audio with proper CORS + Range headers so the browser's
// WebAudio graph can attach a MediaElementSource without tainting it. This is
// what makes the EQ / reverb / spatial / studio-space chain audibly work for
// streams that ship from servers without ACAO headers (Invidious, some JioSaavn
// CDN paths, custom workers).
//
// Why a dedicated function (vs reusing music-indexer):
//   - Single responsibility, cleaner cache + range semantics.
//   - Wider, audit-friendly allowlist; no accidental open proxy.
//   - Tight Cache-Control so repeat plays hit the edge cache instead of egress.
//   - verify_jwt = false (audio elements can't carry an Authorization header).
// ----------------------------------------------------------------------------

const ALLOWED_HOST_SUFFIXES = [
  // JioSaavn
  '.saavncdn.com',
  'saavncdn.com',
  'jiosaavn-api.universflow.workers.dev',
  // YouTube / Invidious mirrors
  '.googlevideo.com',
  '.youtube.com',
  'youtu.be',
  '.private.coffee',
  '.moomoo.me',
  '.syncpundit.io',
  '.mha.fi',
  '.leptons.xyz',
  '.r4fo.com',
  '.reallyaweso.me',
  '.darkness.services',
  '.drgns.space',
  '.ducks.party',
  '.piped.yt',
  '.piped.video',
  '.piped.privacydev.net',
  '.piped.kavin.rocks',
  '.kavin.rocks',
  '.piped.tokhmi.xyz',
  '.piped.adminforge.de',
  '.projectsegfau.lt',
  '.invidious.io',
  '.invidious.privacydev.net',
  '.invidious.fdn.fr',
  '.invidious.projectsegfau.lt',
  '.invidious.protokolla.fi',
  '.protokolla.fi',
  '.nerdvpn.de',
  '.privacyredirect.com',
  '.nadeko.net',
  '.datura.network',
  '.jing.rocks',
  '.railway.app',
  '.invidious.f5.si',
  '.f5.si',
  '.thepixora.com',
  '.yewtu.be',
  // Cobalt extractor fallback used by music-indexer when mirrors fail
  'co.wuk.sh',
  '.co.wuk.sh',
  'cobalt.tools',
  '.cobalt.tools',
  // Audius
  '.audius.co',
  'audius.co',
  '.the-standard.io',
  'the-standard.io',
  // Artist uploads — Google Drive + Dropbox public share links
  'drive.google.com',
  'drive.usercontent.google.com',
  '.googleusercontent.com',
  'docs.google.com',
  'dropbox.com',
  'www.dropbox.com',
  'dl.dropboxusercontent.com',
  '.dropboxusercontent.com',
];

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'range, content-type, accept',
  'Access-Control-Expose-Headers': 'content-length, content-range, accept-ranges, content-type',
};

// Per-IP rate limit — DB-backed so state is shared across edge instances.
// In-memory map is kept as a hot cache to dampen DB writes within the same
// instance during a burst, and to short-circuit clearly abusive callers.
const RATE_LIMIT_MAX = 240;          // 240 reqs/min/IP — generous for seek + range bursts
const RATE_LIMIT_SOFT = 90;          // below this, skip the shared DB counter entirely
const RATE_LIMIT_WINDOW_MS = 60_000;
const ipHits = new Map<string, number[]>();

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SUPABASE_PROJECT_HOST = (() => {
  try { return SUPABASE_URL ? new URL(SUPABASE_URL).hostname.toLowerCase() : ''; } catch { return ''; }
})();

function clientIp(req: Request): string {
  return (
    (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-real-ip') ||
    'unknown'
  );
}

async function hashIp(ip: string): Promise<string> {
  const data = new TextEncoder().encode(ip + '|stream-proxy');
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function checkRate(ip: string): Promise<boolean> {
  const now = Date.now();
  const hits = (ipHits.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  hits.push(now);
  ipHits.set(ip, hits);
  // Local fast-fail before touching DB
  if (hits.length > RATE_LIMIT_MAX) return false;

  // PERFORMANCE: a browser/ExoPlayer issues many byte-range requests per song,
  // and the shared DB counter used to run on EVERY one of them — an extra
  // round trip in front of the first audio byte, i.e. seconds of "loading"
  // before playback. Normal listening traffic is nowhere near the limit, so
  // only consult the shared counter once a caller looks genuinely bursty.
  if (hits.length < RATE_LIMIT_SOFT) return true;

  if (!SUPABASE_URL || !SERVICE_ROLE) return true; // fail-open if misconfigured

  try {
    const ipHash = await hashIp(ip);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/check_and_increment_ip_rate_limit`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ _ip_hash: ipHash, _endpoint: 'stream-proxy', _max_per_minute: RATE_LIMIT_MAX }),
    });
    if (!res.ok) return true; // fail-open on infra error
    const allowed = await res.json();
    return allowed === true;
  } catch {
    return true; // fail-open on network error
  }
}

function isAllowed(target: string): boolean {
  let url: URL;
  try { url = new URL(target); } catch { return false; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  const host = url.hostname.toLowerCase();
  // Own Supabase storage/function host is allowed so Premium EQ can force our
  // uploaded tracks through this proxy and get guaranteed CORS-clean WebAudio.
  // Do NOT allow every *.supabase.co project — only this app's project host.
  if (SUPABASE_PROJECT_HOST && host === SUPABASE_PROJECT_HOST) return true;
  return ALLOWED_HOST_SUFFIXES.some((suffix) => {
    // Enforce a leading dot so bare entries like "youtu.be" don't match
    // attacker-registered hostnames like "eviltoutu.be".
    const dotted = suffix.startsWith('.') ? suffix : '.' + suffix;
    const bare = dotted.slice(1);
    return host === bare || host.endsWith(dotted);
  });
}

async function fetchAllowedTarget(target: string, req: Request, range: string | null, redirects = 0): Promise<Response> {
  if (!isAllowed(target)) throw new Error('Redirect target not allowed');
  const upstream = await fetch(target, {
    method: req.method,
    headers: {
      ...(range ? { range } : {}),
      'user-agent': 'Mozilla/5.0 (UniversFlow Stream Proxy)',
      accept: '*/*',
    },
    // Never auto-follow redirects. Validate every Location first to prevent
    // allowlisted mirrors redirecting the edge runtime to internal/cloud IPs.
    redirect: 'manual',
  });

  if (upstream.status >= 300 && upstream.status < 400) {
    // Signed music CDN URLs (especially googlevideo / JioSaavn CDNs) can bounce
    // through several validated edge hosts before the final byte-serving URL.
    // The previous limit of 2 made perfectly valid streams fail with 502, which
    // the player interpreted as "skip to next" in the APK.
    if (redirects >= 8) throw new Error('Too many redirects');
    const location = upstream.headers.get('location');
    if (!location) throw new Error('Redirect missing Location');
    const next = new URL(location, target).toString();
    return fetchAllowedTarget(next, req, range, redirects + 1);
  }

  return upstream;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS });
  }

  const reqUrl = new URL(req.url);
  const target = reqUrl.searchParams.get('u') || reqUrl.searchParams.get('url');
  if (!target) {
    return new Response('Missing ?u=<audio url>', { status: 400, headers: CORS_HEADERS });
  }

  if (!isAllowed(target)) {
    return new Response('Host not allowed', { status: 400, headers: CORS_HEADERS });
  }

  const ip = clientIp(req);
  if (!(await checkRate(ip))) {
    return new Response('Too many requests', {
      status: 429,
      headers: { ...CORS_HEADERS, 'retry-after': '60' },
    });
  }

  const range = req.headers.get('range');
  let upstream: Response;
  try {
    upstream = await fetchAllowedTarget(target, req, range);
  } catch (err) {
    console.error('[stream-proxy] upstream fetch failed:', err);
    return new Response('Upstream fetch failed', { status: 502, headers: CORS_HEADERS });
  }

  const headers = new Headers(CORS_HEADERS);
  ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified'].forEach((name) => {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  });
  // Force a useful cache lifetime so repeat plays don't re-pull from upstream.
  // 1 hour public + 1 day SWR is a good balance for music CDNs.
  headers.set('cache-control', 'public, max-age=3600, stale-while-revalidate=86400');
  if (!headers.has('accept-ranges')) headers.set('accept-ranges', 'bytes');

  return new Response(req.method === 'HEAD' ? null : upstream.body, {
    status: upstream.status,
    headers,
  });
});
