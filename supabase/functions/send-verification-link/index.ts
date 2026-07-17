// Sends a branded "verify your email" link via Resend.
// Public endpoint — caller passes email + username; we cap at 1 email / 60s per address.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const APP_ORIGIN = 'https://universflow.in';
const LOGO_URL = 'https://universflow.in/pwa-512x512.png';
const FROM_ADDRESS = 'Universflow <noreply@universflow.in>';
const REPLY_TO = 'support@universflow.in';

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
    return new Response(JSON.stringify({ error: 'Email service not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body?.email ?? '').trim().toLowerCase();
    const username = String(body?.username ?? '').trim().slice(0, 40) || 'there';
    const accountType: 'artist' | 'listener' =
      String(body?.accountType ?? '').toLowerCase() === 'artist' ? 'artist' : 'listener';

    const UNIFORM_OK = new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

    try {
      const ipUuid = await idToUuid(clientIp(req));
      const rl = await fetch(`${SUPABASE_URL}/rest/v1/rpc/check_and_increment_rate_limit`, {
        method: 'POST',
        headers: {
          apikey: SERVICE_ROLE,
          Authorization: `Bearer ${SERVICE_ROLE}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ _user_id: ipUuid, _endpoint: 'send_verification_link', _max_per_minute: 10 }),
      });
      const allowed = await rl.json().catch(() => true);
      if (allowed === false) return UNIFORM_OK;
    } catch (_) { /* fail-open */ }

    if (!isEmail(email)) return UNIFORM_OK;

    const lookup = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
      { headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` } }
    );
    if (!lookup.ok) { console.error('user lookup failed', lookup.status); return UNIFORM_OK; }
    const lookupData = await lookup.json().catch(() => ({}));
    const u = (lookupData?.users ?? []).find((x: any) => String(x?.email ?? '').toLowerCase() === email);
    if (!u) return UNIFORM_OK;
    const userId = u.id as string;

    const profRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${userId}&select=email_verified`,
      { headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` } }
    );
    const prof = await profRes.json().catch(() => []);
    if (prof?.[0]?.email_verified) return UNIFORM_OK;

    const existingRes = await fetch(
      `${SUPABASE_URL}/rest/v1/email_verifications?user_id=eq.${userId}&select=last_sent_at`,
      { headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` } }
    );
    const existing = await existingRes.json().catch(() => []);
    if (existing?.[0]?.last_sent_at) {
      const ageMs = Date.now() - new Date(existing[0].last_sent_at).getTime();
      if (ageMs < 60_000) return UNIFORM_OK;
    }

    const tokenBytes = new Uint8Array(32);
    crypto.getRandomValues(tokenBytes);
    const token = Array.from(tokenBytes).map(b => b.toString(16).padStart(2, '0')).join('');
    const tokenHash = await sha256(token);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const upsert = await fetch(`${SUPABASE_URL}/rest/v1/email_verifications`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        user_id: userId,
        email,
        code_hash: tokenHash,
        expires_at: expiresAt,
        attempts: 0,
        last_sent_at: new Date().toISOString(),
      }),
    });
    if (!upsert.ok) {
      const t = await upsert.text();
      console.error('upsert verification failed', upsert.status, t);
      return UNIFORM_OK;
    }

    const verifyUrl = `${APP_ORIGIN}/verify?token=${token}`;
    const safeName = escape(username);
    const isArtist = accountType === 'artist';

    const accent = isArtist ? '#BF5AF2' : '#FF2D55';
    const accentSoft = isArtist ? 'rgba(191,90,242,0.14)' : 'rgba(255,45,85,0.12)';
    const accentBorder = isArtist ? 'rgba(191,90,242,0.32)' : 'rgba(255,45,85,0.30)';
    const buttonGrad = isArtist
      ? 'linear-gradient(135deg,#BF5AF2,#5E5CE6)'
      : 'linear-gradient(135deg,#FF2D55,#BF5AF2)';
    const buttonShadow = isArtist
      ? '0 14px 34px rgba(94,92,230,0.42)'
      : '0 14px 34px rgba(255,45,85,0.40)';
    const tag = isArtist ? 'Artist application · Verify email' : 'Verify your email';
    const headline = isArtist
      ? `Welcome to Universflow for Artists, ${safeName}.`
      : `Hey ${safeName}, welcome in.`;
    const sub = isArtist
      ? `You're one tap away from your artist account. Confirm this email to continue your verification, upload your first track, and reach listeners worldwide.`
      : `Your Universflow account is ready. Confirm this email and start streaming millions of songs, following your favourite artists, and discovering what's trending right now.`;
    const cta = isArtist ? 'Verify & continue application' : 'Confirm & start listening';
    const featuresTitle = isArtist ? 'Your artist toolkit' : 'What you get';
    const features: Array<[string, string]> = isArtist
      ? [
          ['Verified artist profile', 'A public page with your catalog, links and stats.'],
          ['Live analytics', 'Plays, saves and followers updated in real time.'],
          ['Share kit', 'Story cards, QR codes and a smart bio link.'],
          ['Reach your listeners', 'Push a notification when you drop new music.'],
        ]
      : [
          ['Millions of songs', 'A deep, ad-light catalog across every genre.'],
          ['Follow artists', 'Get their new releases the moment they drop.'],
          ['Live charts', "Real trending and viral songs from around the world."],
          ['Offline downloads', 'Save what you love and play it anywhere.'],
        ];

    const rowsHtml = features.map(([t, d]) => `
      <tr>
        <td style="padding:12px 0;border-top:1px solid rgba(255,255,255,0.06)">
          <div style="font:600 14px/1.35 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#fff">${t}</div>
          <div style="font:400 13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#a1a1a6;margin-top:2px">${d}</div>
        </td>
      </tr>`).join('');

    const html = `<!doctype html><html><body style="margin:0;padding:0;background:#050506;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#fff">
  <div style="max-width:600px;margin:0 auto;padding:40px 18px">

    <!-- Brand header -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:22px">
      <tr>
        <td align="center">
          <img src="${LOGO_URL}" width="56" height="56" alt="Universflow" style="display:block;border-radius:14px;box-shadow:0 10px 28px rgba(255,45,85,0.28)">
          <div style="margin-top:12px;font:700 20px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;letter-spacing:-0.3px">
            <span style="background:linear-gradient(135deg,#FF2D55,#BF5AF2,#5E5CE6);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:#FF2D55">Univers</span><span style="color:#fff;font-weight:300;margin-left:3px">Flow</span>
          </div>
        </td>
      </tr>
    </table>

    <!-- Card -->
    <div style="background:linear-gradient(180deg,#141418 0%,#0a0a0c 100%);border:1px solid rgba(255,255,255,0.08);border-radius:24px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,0.55)">
      <div style="padding:44px 34px 6px;text-align:center;background:radial-gradient(120% 80% at 50% 0%, ${accentSoft} 0%, transparent 65%)">
        <div style="display:inline-block;font-size:11px;letter-spacing:.28em;text-transform:uppercase;color:${accent};background:${accentSoft};border:1px solid ${accentBorder};padding:7px 14px;border-radius:999px">${tag}</div>
        <h1 style="margin:22px 0 12px;font-size:28px;font-weight:700;letter-spacing:-0.5px;line-height:1.2">${headline}</h1>
        <p style="font-size:15px;line-height:1.65;color:#a1a1a6;margin:0 auto 28px;max-width:460px">${sub}</p>
        <a href="${verifyUrl}" style="display:inline-block;background:${buttonGrad};color:#fff;text-decoration:none;padding:15px 40px;border-radius:999px;font-weight:600;font-size:15px;letter-spacing:.01em;box-shadow:${buttonShadow}">${cta}</a>
        <p style="margin:14px 0 34px;font-size:11px;color:#6e6e73;letter-spacing:.04em">Single-use link · expires in 24 hours</p>
      </div>

      <div style="margin:0 30px 26px;padding:6px 22px 14px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:18px">
        <p style="margin:16px 0 4px;font-size:11px;color:#8e8e93;letter-spacing:.18em;text-transform:uppercase">${featuresTitle}</p>
        <table style="width:100%;border-collapse:collapse" cellpadding="0" cellspacing="0">${rowsHtml}</table>
      </div>

      ${isArtist ? `<div style="margin:0 30px 26px;padding:16px 20px;background:rgba(191,90,242,0.06);border:1px solid rgba(191,90,242,0.16);border-radius:14px">
        <p style="margin:0;font-size:13px;color:#c9c9cf;line-height:1.55"><span style="color:#fff;font-weight:600">Next step —</span> after verifying you'll return to the verification flow exactly where you left off. Your details are saved.</p>
      </div>` : ''}

      <div style="padding:0 32px 34px;text-align:center">
        <p style="margin:18px 0 0;font-size:11.5px;color:#5a5a60;line-height:1.7">If the button doesn't work, paste this link into your browser:<br><a href="${verifyUrl}" style="color:#8e8e93;word-break:break-all;text-decoration:none">${verifyUrl}</a></p>
        <p style="margin:16px 0 0;font-size:11px;color:#48484a;line-height:1.7">${isArtist ? "Didn't start an artist application?" : "Didn't sign up?"} You can safely ignore this email.</p>
      </div>
    </div>

    <!-- Footer -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:22px">
      <tr><td align="center" style="font-size:11px;color:#48484a;line-height:1.8">
        Sent to <span style="color:#6e6e73">${escape(email)}</span><br>
        © Universflow · <a href="https://universflow.in" style="color:#6e6e73;text-decoration:none">universflow.in</a>
      </td></tr>
    </table>
  </div>
</body></html>`;

    const subject = isArtist
      ? 'Verify your artist account · Universflow'
      : 'Confirm your email · Universflow';

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        reply_to: REPLY_TO,
        to: [email],
        subject,
        html,
      }),
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) console.error('Resend failed', r.status, data);

    return UNIFORM_OK;
  } catch (err) {
    console.error('send-verification-link error', err);
    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
