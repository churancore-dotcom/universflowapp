import { AnimatePresence, motion } from 'framer-motion';
import { Check, Copy, MessageCircle, Share2, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { Song } from '@/contexts/PlayerContext';
import { Button } from '@/components/ui/button';
import SongArtwork from './SongArtwork';

interface SocialShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  song: Song | null;
}

const APP_URL = 'https://universflow.in';

export default function SocialShareModal({ isOpen, onClose, song }: SocialShareModalProps) {
  const [copied, setCopied] = useState(false);
  if (!song) return null;

  const shareText = `Listening to “${song.title}” by ${song.artist} on UniversFlow 🎧\n${APP_URL}`;

  const copyAppLink = async () => {
    try {
      await navigator.clipboard.writeText(APP_URL);
      setCopied(true);
      toast.success('App link copied');
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy the app link');
    }
  };

  const shareSystem = async () => {
    try {
      const { Capacitor } = await import('@capacitor/core');
      if (Capacitor.isNativePlatform()) {
        const { Share } = await import('@capacitor/share');
        await Share.share({ title: `${song.title} — ${song.artist}`, text: shareText, url: APP_URL, dialogTitle: 'Share UniversFlow' });
        return;
      }
      if (navigator.share) {
        await navigator.share({ title: `${song.title} — ${song.artist}`, text: shareText, url: APP_URL });
        return;
      }
      await copyAppLink();
    } catch (error) {
      if ((error as Error)?.name !== 'AbortError') toast.error('Could not open sharing');
    }
  };

  const openShare = (url: string) => window.open(url, '_blank', 'noopener,noreferrer');

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            className="fixed inset-0 z-[70] bg-background/80 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.section
            role="dialog"
            aria-modal="true"
            aria-label="Share song"
            className="fixed inset-x-3 bottom-[max(env(safe-area-inset-bottom),12px)] z-[71] mx-auto max-w-md rounded-lg border border-border bg-card p-4 shadow-2xl"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
          >
            <div className="mb-5 flex items-start gap-3">
              <SongArtwork song={song} size={144} className="h-16 w-16 shrink-0 rounded-md" />
              <div className="min-w-0 flex-1 pt-1">
                <h2 className="truncate text-base font-semibold text-card-foreground">{song.title}</h2>
                <p className="truncate text-sm text-muted-foreground">{song.artist}</p>
                <p className="mt-1 text-xs text-muted-foreground">Share UniversFlow</p>
              </div>
              <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close share menu">
                <X />
              </Button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <Button variant="secondary" className="h-16 flex-col gap-1" onClick={() => openShare(`https://wa.me/?text=${encodeURIComponent(shareText)}`)}>
                <MessageCircle />
                <span className="text-xs">WhatsApp</span>
              </Button>
              <Button variant="secondary" className="h-16 flex-col gap-1" onClick={() => openShare(`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`)}>
                <span className="text-lg font-semibold leading-none" aria-hidden="true">𝕏</span>
                <span className="text-xs">X</span>
              </Button>
              <Button variant="secondary" className="h-16 flex-col gap-1" onClick={shareSystem}>
                <Share2 />
                <span className="text-xs">More</span>
              </Button>
            </div>

            <Button className="mt-3 w-full" onClick={copyAppLink}>
              {copied ? <Check /> : <Copy />}
              {copied ? 'App Link Copied' : 'Copy App Link'}
            </Button>
          </motion.section>
        </>
      )}
    </AnimatePresence>
  );
}