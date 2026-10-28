import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';

type Msg = { role: 'user' | 'assistant'; content: string };

export const askAdminCopilot = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { messages: Msg[] }) => {
    const messages = (input?.messages ?? [])
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-12)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
    if (!messages.length) throw new Error('Ask a question');
    return { messages };
  })
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: isAdmin } = await sb.rpc('has_role', { _user_id: context.userId, _role: 'admin' });
    if (!isAdmin) throw new Error('Admins only');

    const now = Date.now();
    const d1 = new Date(now - 864e5).toISOString();
    const d7 = new Date(now - 7 * 864e5).toISOString();
    const count = async (table: string, f?: (q: any) => any) => {
      let q: any = (sb as any).from(table).select('*', { count: 'exact', head: true });
      if (f) q = f(q);
      const { count: c } = await q;
      return c ?? 0;
    };

    const [users, newUsers24h, newUsers7d, premium, pendingPay, openReports, pendingArtists, openChats, plays24h, plays7d, perfErrors24h, reviewsRes, topRes, payRes] =
      await Promise.all([
        count('profiles'),
        count('profiles', (q) => q.gte('created_at', d1)),
        count('profiles', (q) => q.gte('created_at', d7)),
        count('user_subscriptions', (q) => q.eq('status', 'active').gt('expires_at', new Date().toISOString())),
        count('payment_requests', (q) => q.eq('status', 'pending')),
        count('content_reports', (q) => q.eq('status', 'pending')),
        count('artist_applications', (q) => q.eq('status', 'pending')),
        count('support_chats', (q) => q.gt('unread_for_admin', 0)),
        count('song_play_events', (q) => q.gte('created_at', d1)),
        count('song_play_events', (q) => q.gte('created_at', d7)),
        count('perf_events', (q) => q.gte('created_at', d1).eq('severity', 'error')),
        sb.from('app_reviews').select('rating').limit(500),
        sb.from('song_play_events').select('title,artist,country_code').gte('created_at', d1).limit(2000),
        sb.from('payment_requests').select('amount_paise,status,created_at').gte('created_at', d7).limit(500),
      ]);

    const ratings = (reviewsRes.data ?? []).map((r: any) => r.rating as number);
    const avgRating = ratings.length ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(2) : 'n/a';
    const songMap = new Map<string, number>();
    const countryMap = new Map<string, number>();
    for (const e of topRes.data ?? []) {
      const k = `${e.title} — ${e.artist}`;
      songMap.set(k, (songMap.get(k) ?? 0) + 1);
      if (e.country_code) countryMap.set(e.country_code, (countryMap.get(e.country_code) ?? 0) + 1);
    }
    const top = (m: Map<string, number>, n: number) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
    const approvedRevenue7d = (payRes.data ?? []).filter((p: any) => p.status === 'approved').reduce((s: number, p: any) => s + p.amount_paise, 0) / 100;

    const snapshot = {
      generated_at: new Date().toISOString(),
      users_total: users, new_users_24h: newUsers24h, new_users_7d: newUsers7d,
      active_premium: premium,
      pending_payment_requests: pendingPay, approved_upi_revenue_7d_inr: approvedRevenue7d,
      pending_reports: openReports, pending_artist_applications: pendingArtists, unread_support_chats: openChats,
      play_events_24h: plays24h, play_events_7d: plays7d,
      playback_errors_24h: perfErrors24h,
      app_rating_avg: avgRating, app_rating_count: ratings.length,
      top_songs_24h: top(songMap, 10), top_countries_24h: top(countryMap, 8),
    };

    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error('AI is not configured');
    const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          {
            role: 'system',
            content:
              'You are the admin copilot for Univers Flow, a music streaming app. Answer ONLY from the live data snapshot below; if data is missing say so plainly, never invent numbers. Be short, use bullet points, highlight risks and give 1-3 concrete next actions pointing to admin pages (Payment Requests, Moderation, Support Inbox, Artist Verification, Performance Monitor). Reply in the language the admin writes in.\n\nLIVE SNAPSHOT:\n' +
              JSON.stringify(snapshot),
          },
          ...data.messages,
        ],
      }),
    });
    if (res.status === 429) throw new Error('Too many requests, try again in a minute');
    if (res.status === 402) throw new Error('AI credits are used up for this workspace');
    if (!res.ok) throw new Error(`AI request failed (${res.status})`);
    const json: any = await res.json();
    return { reply: String(json.choices?.[0]?.message?.content ?? ''), snapshot };
  });
