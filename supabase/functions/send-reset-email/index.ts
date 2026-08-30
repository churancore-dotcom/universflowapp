// Sends a password reset link via Resend (bypassing Supabase's default email).
// Generates a recovery link server-side using the admin API, then emails it.
// Uniform response prevents account enumeration.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function isEmail(s: string): boolean {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254;
}

async function sha256(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
async function idToUuid(id: string): Promise<string> {
  const h = await sha256(`ip:${id}`);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
function clientIp(req: Request): string {
  const xf = req.headers.get('x-forwarded-for') ?? '';
  return (xf.split(',')[0] || req.headers.get('cf-connecting-ip') || 'unknown').trim();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const UNIFORM_OK = new Response(
    JSON.stringify({ success: true }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );

  if (!RESEND_API_KEY) {
    return new Response(JSON.stringify({ error: 'RESEND_API_KEY not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body?.email ?? '').trim().toLowerCase();
    // Never trust a caller-supplied redirect: a recovery token lands on that
    // URL, so an open redirect here leaks account takeover. Allowlist only.
    const DEFAULT_REDIRECT = 'https://universflow.in/reset-password';
    const ALLOWED_REDIRECT_HOSTS = [
      'universflow.in', 'www.universflow.in',
      'universflow.cyou', 'www.universflow.cyou',
      'universflowapp.lovable.app',
      'localhost',
    ];
    const safeRedirect = (value: unknown): string => {
      if (typeof value !== 'string' || !value) return DEFAULT_REDIRECT;
      try {
        const u = new URL(value);
        if (u.protocol !== 'https:' && !(u.protocol === 'http:' && u.hostname === 'localhost')) {
          return DEFAULT_REDIRECT;
        }
        if (!ALLOWED_REDIRECT_HOSTS.includes(u.hostname.toLowerCase())) return DEFAULT_REDIRECT;
        if (u.pathname !== '/reset-password') return DEFAULT_REDIRECT;
        return `${u.origin}/reset-password`;
      } catch {
        return DEFAULT_REDIRECT;
      }
    };
    const redirectTo = safeRedirect(body?.redirectTo);


    if (!isEmail(email)) {
      return new Response(JSON.stringify({ error: 'Invalid email' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Per-IP throttle: 5/min. Silently swallow excess.
    try {
      const ipUuid = await idToUuid(clientIp(req));
      const rl = await fetch(`${SUPABASE_URL}/rest/v1/rpc/check_and_increment_rate_limit`, {
        method: 'POST',
        headers: {
          apikey: SERVICE_ROLE,
          Authorization: `Bearer ${SERVICE_ROLE}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ _user_id: ipUuid, _endpoint: 'send_reset_email', _max_per_minute: 5 }),
      });
      const allowed = await rl.json().catch(() => true);
      if (allowed === false) return UNIFORM_OK;
    } catch (_) { /* fail-open */ }

    // Generate a real recovery link via admin API.
    const linkRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'recovery',
        email,
        options: { redirect_to: redirectTo },
      }),
    });

    if (!linkRes.ok) {
      // Uniform success on unknown-email / other admin errors.
      return UNIFORM_OK;
    }
    const linkData = await linkRes.json().catch(() => ({}));
    const actionLink: string | undefined =
      linkData?.action_link ?? linkData?.properties?.action_link;
    if (!actionLink) return UNIFORM_OK;

    const html = `<!doctype html><html><body style="margin:0;padding:0;background:#050506;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#fff">
  <div style="max-width:600px;margin:0 auto;padding:40px 18px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:22px"><tr><td align="center">
      <img src="https://universflow.in/pwa-512x512.png" width="56" height="56" alt="Universflow" style="display:block;border-radius:14px;box-shadow:0 10px 28px rgba(255,45,85,0.28)">
      <div style="margin-top:12px;font:700 20px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;letter-spacing:-0.3px">
        <span style="background:linear-gradient(135deg,#FF2D55,#BF5AF2,#5E5CE6);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:#FF2D55">Univers</span><span style="color:#fff;font-weight:300;margin-left:3px">Flow</span>
      </div>
    </td></tr></table>
    <div style="background:linear-gradient(180deg,#141418 0%,#0a0a0c 100%);border:1px solid rgba(255,255,255,0.08);border-radius:24px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,0.55)">
      <div style="padding:44px 34px 40px;text-align:center;background:radial-gradient(120% 80% at 50% 0%, rgba(255,45,85,0.14) 0%, transparent 65%)">
        <div style="display:inline-block;font-size:11px;letter-spacing:.28em;text-transform:uppercase;color:#FF2D55;background:rgba(255,45,85,0.12);border:1px solid rgba(255,45,85,0.30);padding:7px 14px;border-radius:999px">Password Reset</div>
        <h1 style="margin:22px 0 12px;font-size:28px;font-weight:700;letter-spacing:-0.5px;line-height:1.2">Reset your password</h1>
        <p style="font-size:15px;line-height:1.65;color:#a1a1a6;margin:0 auto 28px;max-width:440px">
          Tap the button below to set a new password. This link expires in 1 hour and can only be used once.
        </p>
        <a href="${actionLink}" style="display:inline-block;background:linear-gradient(135deg,#FF2D55,#BF5AF2);color:#fff;text-decoration:none;padding:15px 40px;border-radius:999px;font-weight:600;font-size:15px;letter-spacing:.01em;box-shadow:0 14px 34px rgba(255,45,85,0.40)">Reset Password</a>
        <p style="margin:22px 0 0;font-size:12px;color:#6e6e73;line-height:1.6">Or paste this link into your browser:<br><span style="color:#a1a1a6;word-break:break-all">${actionLink}</span></p>
      </div>
      <div style="padding:0 32px 30px;text-align:center">
        <p style="margin:0;font-size:11px;color:#48484a;line-height:1.7">If you didn't request this, you can safely ignore this email — your password won't change.</p>
      </div>
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:22px"><tr><td align="center" style="font-size:11px;color:#48484a;line-height:1.8">
      © Universflow · <a href="https://universflow.in" style="color:#6e6e73;text-decoration:none">universflow.in</a>
    </td></tr></table>
  </div>
</body></html>`;

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Universflow <noreply@universflow.in>',
        reply_to: 'support@universflow.in',
        to: [email],
        subject: 'Reset your Universflow password',
        html,
      }),
    });

    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      console.error('Resend failed', r.status, errText);
      return new Response(JSON.stringify({ error: 'Unable to send reset email.' }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return UNIFORM_OK;
  } catch (err) {
    console.error('send-reset-email error', err);
    return new Response(JSON.stringify({ error: 'Unable to send reset email.' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
