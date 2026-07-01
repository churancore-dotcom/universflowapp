import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

interface Body {
  slug?: string;
  song_id?: string | null;
  title?: string;
  body?: string;
}

const COOLDOWN_MS = 24 * 60 * 60 * 1000;
const EVENT_KIND = 'manual_promo';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);

  // Verify caller
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) return json({ error: 'Unauthorized' }, 401);
  const userId = userData.user.id;

  let body: Body = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const title = String(body.title ?? '').slice(0, 120).trim();
  const message = String(body.body ?? '').slice(0, 300).trim();
  if (!title || !message) return json({ error: 'Title and body are required.' }, 400);

  const admin = createClient(url, serviceKey);

  // Verify this user is an artist (owns an artist_profile) and resolve slug
  const { data: prof, error: profErr } = await admin
    .from('artist_profiles')
    .select('user_id, slug, stage_name')
    .eq('user_id', userId)
    .maybeSingle();
  if (profErr) return json({ error: profErr.message }, 500);
  if (!prof) return json({ error: 'Not an artist account.' }, 403);

  // Throttle: 24h cooldown
  const { data: thr } = await admin
    .from('artist_push_throttle')
    .select('last_notified_at')
    .eq('artist_user_id', userId)
    .eq('event_kind', EVENT_KIND)
    .maybeSingle();
  if (thr?.last_notified_at) {
    const elapsed = Date.now() - new Date(thr.last_notified_at).getTime();
    if (elapsed < COOLDOWN_MS) {
      const waitMin = Math.ceil((COOLDOWN_MS - elapsed) / 60000);
      return json({ error: `Cooldown — try again in ~${waitMin} minutes.` }, 429);
    }
  }

  // Followers
  const { data: followers, error: followErr } = await admin
    .from('artist_followers')
    .select('follower_user_id')
    .eq('artist_user_id', userId);
  if (followErr) return json({ error: followErr.message }, 500);
  const ids = Array.from(new Set((followers ?? []).map((r) => r.follower_user_id).filter(Boolean) as string[]));

  if (ids.length === 0) {
    // Still update throttle so spam clicks don't bombard the function
    await admin.from('artist_push_throttle').upsert({
      artist_user_id: userId,
      event_kind: EVENT_KIND,
      last_notified_at: new Date().toISOString(),
      count_since_last: 0,
    }, { onConflict: 'artist_user_id,event_kind' });
    return json({ ok: true, notified: 0 });
  }

  const songId = typeof body.song_id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(body.song_id)
    ? body.song_id
    : null;
  const safeSlug = encodeURIComponent(prof.slug);
  const deepLink = songId
    ? `/a/${safeSlug}?song=${encodeURIComponent(songId)}`
    : `/a/${safeSlug}`;

  // Send via existing RPC (security definer, talks to system push edge fn)
  const { error: pushErr } = await admin.rpc('notify_system_push', {
    _user_ids: ids,
    _title: title,
    _body: message,
    _deep_link: deepLink,
  });
  if (pushErr) return json({ error: pushErr.message }, 500);

  await admin.from('artist_push_throttle').upsert({
    artist_user_id: userId,
    event_kind: EVENT_KIND,
    last_notified_at: new Date().toISOString(),
    count_since_last: 0,
  }, { onConflict: 'artist_user_id,event_kind' });

  return json({ ok: true, notified: ids.length });
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
