import { useState, useRef, useEffect } from 'react';
import { Sparkles, Send, Loader2 } from 'lucide-react';
import { useServerFn } from '@tanstack/react-start';
import { askAdminCopilot } from '@/lib/adminCopilot.functions';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

type Msg = { role: 'user' | 'assistant'; content: string };

const SUGGESTIONS = [
  'Give me today\u2019s app health briefing',
  'What needs my attention right now?',
  'How is growth this week?',
  'Which songs and countries are hot today?',
  'Any risks with payments or errors?',
];

export default function CommandCenter() {
  const ask = useServerFn(askAdminCopilot);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || loading) return;
    const next = [...messages, { role: 'user' as const, content: q }];
    setMessages(next);
    setInput('');
    setLoading(true);
    try {
      const r = await ask({ data: { messages: next } });
      setMessages([...next, { role: 'assistant', content: r.reply || 'No answer.' }]);
      setStats(r.snapshot);
    } catch (e) {
      setMessages([...next, { role: 'assistant', content: `\u26a0\ufe0f ${(e as Error).message}` }]);
    } finally {
      setLoading(false);
    }
  };

  const tiles: [string, string][] = stats
    ? [
        ['Users', 'users_total'], ['New 24h', 'new_users_24h'], ['Premium', 'active_premium'],
        ['Plays 24h', 'play_events_24h'], ['Pending pay', 'pending_payment_requests'], ['Errors 24h', 'playback_errors_24h'],
      ]
    : [];

  return (
    <div className="flex flex-col gap-4 p-4 max-w-3xl mx-auto min-h-[80dvh]">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-primary/15 text-primary grid place-items-center"><Sparkles className="h-5 w-5" /></div>
        <div>
          <h1 className="text-xl font-bold text-foreground">AI Command Center</h1>
          <p className="text-xs text-muted-foreground">Ask anything about your app — answers use live data.</p>
        </div>
      </div>

      {tiles.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {tiles.map(([label, k]) => (
            <div key={k} className="rounded-xl border border-border bg-card p-2.5">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
              <div className="text-lg font-semibold text-foreground">{String(stats?.[k] ?? '—')}</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex-1 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => send(s)} className="text-xs rounded-full border border-border bg-card px-3 py-1.5 text-foreground hover:border-primary">
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm ${m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-card border border-border text-foreground'}`}>
              {m.content.replace(/\*\*/g, '')}
            </div>
          </div>
        ))}
        {loading && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Reading live data…</div>}
        <div ref={endRef} />
      </div>

      <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="sticky bottom-2 flex gap-2 rounded-2xl border border-border bg-background/95 p-2 backdrop-blur">
        <Textarea value={input} onChange={(e) => setInput(e.target.value)} rows={1} placeholder="e.g. Why did plays drop today?"
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
          className="min-h-10 resize-none border-0 bg-transparent focus-visible:ring-0" />
        <Button type="submit" size="icon" disabled={loading || !input.trim()}><Send className="h-4 w-4" /></Button>
      </form>
    </div>
  );
}
