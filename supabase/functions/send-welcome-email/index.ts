// Sends a welcome / confirmation email via Resend after signup.
// Public endpoint (no JWT) — recipient + username are validated server-side.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)
  );
}

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

  if (!RESEND_API_KEY) {
    return new Response(JSON.stringify({ error: 'RESEND_API_KEY not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body?.email ?? '').trim().toLowerCase();
    const username = String(body?.username ?? '').trim().slice(0, 40) || 'there';

    const UNIFORM_OK = new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

    // Per-IP throttle: max 10 attempts / minute / IP. Silently swallow excess.
    try {
      const ipUuid = await idToUuid(clientIp(req));
      const rl = await fetch(`${SUPABASE_URL}/rest/v1/rpc/check_and_increment_rate_limit`, {
        method: 'POST',
        headers: {
          apikey: SERVICE_ROLE,
          Authorization: `Bearer ${SERVICE_ROLE}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ _user_id: ipUuid, _endpoint: 'send_welcome_email', _max_per_minute: 10 }),
      });
      const allowed = await rl.json().catch(() => true);
      if (allowed === false) return UNIFORM_OK;
    } catch (_) { /* fail-open on rate-limiter outage */ }

    if (!isEmail(email)) {
      return new Response(JSON.stringify({ error: 'Invalid email' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Anti-abuse: only send if a matching auth user exists and was created in the last 10 minutes.
    const lookup = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
      { headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` } }
    );
    if (!lookup.ok) {
      return new Response(JSON.stringify({ error: 'Lookup failed' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const lookupData = await lookup.json().catch(() => ({}));
    const u = (lookupData?.users ?? []).find((x: any) => String(x?.email ?? '').toLowerCase() === email);
    // Uniform success to prevent account enumeration — never reveal whether
    // an email exists or how recently it was created.
    if (!u) return UNIFORM_OK;
    const createdAt = new Date(u.created_at).getTime();
    if (!createdAt || Date.now() - createdAt > 10 * 60 * 1000) return UNIFORM_OK;

    // Per-email throttle: at most 1 welcome email every 5 minutes, max 3 total.
    const throttleRes = await fetch(
      `${SUPABASE_URL}/rest/v1/welcome_email_sends?email=eq.${encodeURIComponent(email)}&select=last_sent_at,send_count`,
      { headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` } },
    );
    const throttleRows = throttleRes.ok ? await throttleRes.json().catch(() => []) : [];
    const prev = Array.isArray(throttleRows) && throttleRows[0];
    if (prev) {
      const last = new Date(prev.last_sent_at).getTime();
      if (Date.now() - last < 5 * 60 * 1000 || (prev.send_count ?? 0) >= 3) {
        // Uniform success — never expose throttling state.
        return UNIFORM_OK;
      }
    }

    const safeName = escape(username);
    const features: Array<[string, string]> = [
      ['Millions of songs', 'A deep, ad-light catalog across every genre.'],
      ['Follow artists', 'Get their new releases the moment they drop.'],
      ['Live charts', 'Real trending and viral songs from around the world.'],
      ['Offline downloads', 'Save what you love and play it anywhere.'],
    ];
    const rowsHtml = features.map(([t, d]) => `
      <tr><td style="padding:12px 0;border-top:1px solid rgba(255,255,255,0.06)">
        <div style="font:600 14px/1.35 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#fff">${t}</div>
        <div style="font:400 13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#a1a1a6;margin-top:2px">${d}</div>
      </td></tr>`).join('');

    const html = `<!doctype html><html><body style="margin:0;padding:0;background:#050506;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#fff">
  <div style="max-width:600px;margin:0 auto;padding:40px 18px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:22px"><tr><td align="center">
      <img src="https://universflow.in/pwa-512x512.png" width="56" height="56" alt="Universflow" style="display:block;border-radius:14px;box-shadow:0 10px 28px rgba(255,45,85,0.28)">
      <div style="margin-top:12px;font:700 20px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;letter-spacing:-0.3px">
        <span style="background:linear-gradient(135deg,#FF2D55,#BF5AF2,#5E5CE6);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:#FF2D55">Univers</span><span style="color:#fff;font-weight:300;margin-left:3px">Flow</span>
      </div>
    </td></tr></table>

    <div style="background:linear-gradient(180deg,#141418 0%,#0a0a0c 100%);border:1px solid rgba(255,255,255,0.08);border-radius:24px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,0.55)">
      <div style="padding:44px 34px 6px;text-align:center;background:radial-gradient(120% 80% at 50% 0%, rgba(255,45,85,0.14) 0%, transparent 65%)">
        <div style="display:inline-block;font-size:11px;letter-spacing:.28em;text-transform:uppercase;color:#FF2D55;background:rgba(255,45,85,0.12);border:1px solid rgba(255,45,85,0.30);padding:7px 14px;border-radius:999px">You're in</div>
        <h1 style="margin:22px 0 12px;font-size:28px;font-weight:700;letter-spacing:-0.5px;line-height:1.2">Welcome, ${safeName}.</h1>
        <p style="font-size:15px;line-height:1.65;color:#a1a1a6;margin:0 auto 28px;max-width:440px">
          Your account is ready. Stream millions of songs, follow your favourite artists, and discover what's trending right now around the world.
        </p>
        <a href="https://universflow.in/home" style="display:inline-block;background:linear-gradient(135deg,#FF2D55,#BF5AF2);color:#fff;text-decoration:none;padding:15px 40px;border-radius:999px;font-weight:600;font-size:15px;letter-spacing:.01em;box-shadow:0 14px 34px rgba(255,45,85,0.40)">Open Universflow</a>
        <p style="margin:14px 0 34px;font-size:11px;color:#6e6e73;letter-spacing:.04em">Free forever · Premium optional</p>
      </div>
      <div style="margin:0 30px 26px;padding:6px 22px 14px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:18px">
        <p style="margin:16px 0 4px;font-size:11px;color:#8e8e93;letter-spacing:.18em;text-transform:uppercase">What you get</p>
        <table style="width:100%;border-collapse:collapse" cellpadding="0" cellspacing="0">${rowsHtml}</table>
      </div>
      <div style="padding:0 32px 34px;text-align:center">
        <p style="margin:0;font-size:11px;color:#48484a;line-height:1.7">If you didn't create this account, you can safely ignore this email.</p>
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
        subject: 'Welcome to Universflow 🎉',
        html,
      }),
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return new Response(JSON.stringify({ error: 'Unable to send welcome email.' }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Record the send for throttling.
    await fetch(`${SUPABASE_URL}/rest/v1/welcome_email_sends`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        email,
        last_sent_at: new Date().toISOString(),
        send_count: ((prev?.send_count ?? 0) + 1),
      }),
    }).catch(() => {});

    return new Response(JSON.stringify({ success: true, id: data?.id ?? null }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('send-welcome-email error', err);
    return new Response(JSON.stringify({ error: 'Unable to send welcome email.' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
