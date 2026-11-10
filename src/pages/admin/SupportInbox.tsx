import { useEffect, useState, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { MessageSquare, Send, Loader2, Search, Inbox, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface Chat {
  id: string;
  user_id: string;
  status: string;
  last_message_at: string;
  unread_for_admin: number;
}

interface ProfileLite {
  user_id: string;
  username: string | null;
  email: string | null;
  avatar_url: string | null;
}

interface Message {
  id: string;
  chat_id: string;
  sender_id: string;
  sender_role: 'user' | 'support';
  body: string;
  created_at: string;
}

const timeAgo = (iso: string) => {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
};

const SupportInbox = () => {
  const { user } = useAuth();
  const [chats, setChats] = useState<Chat[]>([]);
  const [profiles, setProfiles] = useState<Record<string, ProfileLite>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadChats = useCallback(async () => {
    setLoading(true);
    const { data: chatRows } = await supabase
      .from('support_chats')
      .select('*')
      .order('last_message_at', { ascending: false })
      .limit(200);
    const list = (chatRows || []) as Chat[];
    setChats(list);
    if (list.length) {
      const ids = list.map(c => c.user_id);
      const { data: profRows } = await supabase
        .from('profiles')
        .select('user_id, username, email, avatar_url')
        .in('user_id', ids);
      const map: Record<string, ProfileLite> = {};
      (profRows || []).forEach((p) => { map[p.user_id] = p as ProfileLite; });
      setProfiles(map);
    }
    setLoading(false);
  }, []);

  const latestChatRef = useRef<string | null>(null);
  const loadMessages = useCallback(async (chatId: string) => {
    latestChatRef.current = chatId;
    setMessages([]);
    // Newest 500, shown oldest-first; older replies must never hide recent ones.
    const { data, error } = await supabase
      .from('support_messages')
      .select('*')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: false })
      .limit(500);
    if (latestChatRef.current !== chatId || error) return;
    setMessages(((data || []) as Message[]).reverse());
    await supabase.from('support_chats').update({ unread_for_admin: 0 }).eq('id', chatId);
  }, []);

  useEffect(() => {
    loadChats();
    const ch = supabase.channel('admin_support_inbox')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_chats' }, loadChats)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_messages' }, (payload) => {
        const msg = payload.new as Message;
        if (msg.chat_id === activeId) {
          setMessages(prev => prev.find(m => m.id === msg.id) ? prev : [...prev, msg]);
        }
        loadChats();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [loadChats, activeId]);

  useEffect(() => {
    if (activeId) loadMessages(activeId);
  }, [activeId, loadMessages]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const send = async () => {
    if (!draft.trim() || !activeId || !user || sending) return;
    setSending(true);
    const body = draft.trim();
    setDraft('');
    const { error } = await supabase.from('support_messages').insert({
      chat_id: activeId,
      sender_id: user.id,
      sender_role: 'support',
      body,
    });
    setSending(false);
    if (error) {
      toast.error('Failed to send');
      setDraft(body);
    }
  };

  const filteredChats = chats.filter(c => {
    if (!search) return true;
    const p = profiles[c.user_id];
    const q = search.toLowerCase();
    return p?.username?.toLowerCase().includes(q) || p?.email?.toLowerCase().includes(q);
  });

  const activeChat = chats.find(c => c.id === activeId);
  const activeProfile = activeChat ? profiles[activeChat.user_id] : null;

  return (
    <div className="p-4 md:p-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-display font-bold flex items-center gap-3">
            <MessageSquare className="w-8 h-8 text-primary" />
            Support Inbox
          </h1>
          <p className="text-muted-foreground mt-1">Real-time conversations with users.</p>
        </div>
        <Button variant="outline" size="sm" onClick={loadChats} disabled={loading}>
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4 h-[calc(100vh-220px)] min-h-[500px]">
        {/* Chat list */}
        <div className="glass rounded-2xl flex flex-col overflow-hidden">
          <div className="p-3 border-b border-border/40">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search users…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-9"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="p-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-primary" /></div>
            ) : filteredChats.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                <Inbox className="w-8 h-8 mx-auto mb-2 opacity-50" />
                No conversations yet
              </div>
            ) : filteredChats.map(c => {
              const p = profiles[c.user_id];
              const isActive = c.id === activeId;
              const initial = (p?.username || p?.email || 'U')[0].toUpperCase();
              return (
                <button
                  key={c.id}
                  onClick={() => setActiveId(c.id)}
                  className={`w-full text-left px-3 py-3 flex items-start gap-3 border-b border-border/30 transition-colors ${
                    isActive ? 'bg-primary/10' : 'hover:bg-muted/30'
                  }`}
                >
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-primary-foreground flex-shrink-0"
                    style={{ background: `linear-gradient(135deg, hsl(${(p?.user_id || '').length * 31 % 360} 70% 45%), hsl(var(--primary)))` }}>
                    {initial}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold truncate">{p?.username || p?.email?.split('@')[0] || 'User'}</p>
                      <span className="text-[10px] text-muted-foreground flex-shrink-0">{timeAgo(c.last_message_at)}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground truncate">{p?.email || c.user_id.slice(0, 8)}</p>
                  </div>
                  {c.unread_for_admin > 0 && (
                    <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                      {c.unread_for_admin > 9 ? '9+' : c.unread_for_admin}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Active chat */}
        <div className="glass rounded-2xl flex flex-col overflow-hidden">
          {!activeChat ? (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
              Select a conversation to reply
            </div>
          ) : (
            <>
              <div className="p-4 border-b border-border/40 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-primary-foreground"
                  style={{ background: `linear-gradient(135deg, hsl(${activeChat.user_id.length * 31 % 360} 70% 45%), hsl(var(--primary)))` }}>
                  {(activeProfile?.username || activeProfile?.email || 'U')[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm">{activeProfile?.username || activeProfile?.email?.split('@')[0] || 'User'}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{activeProfile?.email}</p>
                </div>
              </div>
              <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
                {messages.map(m => {
                  const isSupport = m.sender_role === 'support';
                  return (
                    <motion.div
                      key={m.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`flex ${isSupport ? 'justify-end' : 'justify-start'}`}
                    >
                      <div className={`max-w-[70%] px-3.5 py-2.5 rounded-2xl text-sm ${
                        isSupport ? 'bg-primary text-primary-foreground rounded-br-md' : 'bg-muted/60 rounded-bl-md'
                      }`}>
                        {m.body}
                        <div className={`text-[10px] mt-1 opacity-60 ${isSupport ? 'text-right' : 'text-left'}`}>
                          {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
                {messages.length === 0 && (
                  <p className="text-center text-sm text-muted-foreground py-8">No messages yet</p>
                )}
              </div>
              <div className="p-3 border-t border-border/40 flex items-center gap-2">
                <Input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                  placeholder="Reply as support…"
                  className="flex-1"
                />
                <Button onClick={send} disabled={!draft.trim() || sending}>
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default SupportInbox;
