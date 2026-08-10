import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Send, Loader2, Headphones } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { triggerHaptic } from '@/hooks/useHaptics';
import { toast } from 'sonner';

interface Message {
  id: string;
  chat_id: string;
  sender_id: string;
  sender_role: 'user' | 'support';
  body: string;
  created_at: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const SupportChatModal = ({ isOpen, onClose }: Props) => {
  const { user } = useAuth();
  const [chatId, setChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const ensureChat = useCallback(async () => {
    if (!user) return null;
    const { data: existing } = await supabase
      .from('support_chats')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (existing) return existing.id;
    const { data: created, error } = await supabase
      .from('support_chats')
      .insert({ user_id: user.id })
      .select('id')
      .single();
    if (error) { console.error(error); return null; }
    return created.id;
  }, [user]);

  const loadMessages = useCallback(async (cid: string) => {
    const { data } = await supabase
      .from('support_messages')
      .select('*')
      .eq('chat_id', cid)
      .order('created_at', { ascending: true })
      .limit(200);
    setMessages((data || []) as Message[]);
    setLoading(false);
    // Reset unread for user
    await supabase.from('support_chats').update({ unread_for_user: 0 }).eq('id', cid);
  }, []);

  useEffect(() => {
    if (!isOpen || !user) return;
    setLoading(true);
    let channel: ReturnType<typeof supabase.channel> | null = null;
    (async () => {
      const cid = await ensureChat();
      if (!cid) { setLoading(false); return; }
      setChatId(cid);
      await loadMessages(cid);

      channel = supabase
        .channel(`support_chat_${cid}`)
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'support_messages',
          filter: `chat_id=eq.${cid}`,
        }, (payload) => {
          const newMsg = payload.new as Message & { sender_role?: string };
          setMessages(prev => {
            if (prev.find(m => m.id === newMsg.id)) return prev;
            return [...prev, newMsg as Message];
          });
          if (newMsg.sender_role === 'support') {
            triggerHaptic('impactLight');
            supabase.from('support_chats').update({ unread_for_user: 0 }).eq('id', cid);
          }
        })
        .subscribe();
    })();
    return () => { if (channel) supabase.removeChannel(channel); };
  }, [isOpen, user, ensureChat, loadMessages]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const send = async () => {
    if (!draft.trim() || !chatId || !user || sending) return;
    setSending(true);
    const body = draft.trim();
    setDraft('');
    triggerHaptic('impactLight');
    const { error } = await supabase.from('support_messages').insert({
      chat_id: chatId,
      sender_id: user.id,
      sender_role: 'user',
      body,
    });
    setSending(false);
    if (error) {
      toast.error('Could not send message');
      setDraft(body);
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[220] flex items-end"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={onClose}
          style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(20px)' }}
        >
          <motion.div
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full h-[85vh] rounded-t-3xl bg-card border-t border-border/50 flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-border/40">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg, hsl(var(--primary)), hsl(var(--accent)))' }}>
                  <Headphones className="w-5 h-5 text-primary-foreground" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold">Support Team</h3>
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    Usually replies within a few hours
                  </p>
                </div>
              </div>
              <button onClick={onClose} className="w-9 h-9 rounded-full bg-muted/40 flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3" style={{ WebkitOverflowScrolling: 'touch' }}>
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                </div>
              ) : messages.length === 0 ? (
                <div className="text-center py-8 px-4">
                  <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
                    <Headphones className="w-7 h-7 text-primary" />
                  </div>
                  <h4 className="text-sm font-bold mb-1">How can we help?</h4>
                  <p className="text-xs text-muted-foreground">
                    Send your question and our support team will reply soon.
                  </p>
                </div>
              ) : messages.map((m) => {
                const mine = m.sender_role === 'user';
                return (
                  <motion.div
                    key={m.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`flex ${mine ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[78%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${
                        mine
                          ? 'bg-primary text-primary-foreground rounded-br-md'
                          : 'bg-muted/50 text-foreground rounded-bl-md'
                      }`}
                    >
                      {m.body}
                      <div className={`text-[10px] mt-1 opacity-60 ${mine ? 'text-right' : 'text-left'}`}>
                        {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>

            {/* Composer */}
            <div className="p-3 border-t border-border/40 safe-area-pb">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={onKey}
                  placeholder="Type your message…"
                  aria-label="Message"
                  maxLength={2000}
                  className="flex-1 h-11 px-4 rounded-2xl bg-muted/40 border border-border/50 text-sm focus:outline-none focus:border-primary/60"
                />
                <button
                  onClick={send}
                  disabled={!draft.trim() || sending}
                  className="w-11 h-11 rounded-2xl bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40 active:scale-95 transition-transform"
                >
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default SupportChatModal;
