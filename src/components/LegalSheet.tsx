import { ReactNode, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import {
  UserTermsBody,
  UserPrivacyBody,
  ArtistTermsBody,
  ArtistPrivacyBody,
  USER_TERMS_UPDATED,
  ARTIST_TERMS_UPDATED,
  SUPPORT_EMAIL,
} from '@/pages/legal/legalContent';

export type LegalDocKey = 'user-terms' | 'user-privacy' | 'artist-terms' | 'artist-privacy';

const META: Record<LegalDocKey, { title: string; updated: string; body: () => ReactNode }> = {
  'user-terms':     { title: 'Terms of Service',       updated: USER_TERMS_UPDATED,   body: UserTermsBody },
  'user-privacy':   { title: 'Privacy Policy',         updated: USER_TERMS_UPDATED,   body: UserPrivacyBody },
  'artist-terms':   { title: 'Artist Terms',           updated: ARTIST_TERMS_UPDATED, body: ArtistTermsBody },
  'artist-privacy': { title: 'Artist Privacy Policy',  updated: ARTIST_TERMS_UPDATED, body: ArtistPrivacyBody },
};

interface LegalSheetProps {
  doc: LegalDocKey | null;
  onClose: () => void;
}

/**
 * Full-screen bottom sheet that renders legal copy in place without
 * navigating away. Used inside multi-step flows (Artist Apply) so users
 * never lose their progress just to read Terms/Privacy.
 */
export default function LegalSheet({ doc, onClose }: LegalSheetProps) {
  // Lock body scroll while open so tapping the backdrop doesn't scroll the page underneath.
  useEffect(() => {
    if (!doc) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [doc]);

  return (
    <AnimatePresence>
      {doc && (() => {
        const meta = META[doc];
        const Body = meta.body;
        return (
          <motion.div
            key={doc}
            className="fixed inset-0 z-[70] flex items-end justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {/* Backdrop */}
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            />

            {/* Sheet */}
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label={meta.title}
              className="relative w-full max-w-md h-[92dvh] rounded-t-[28px] bg-background border-t border-white/10 flex flex-col overflow-hidden"
              style={{ boxShadow: '0 -30px 80px rgba(0,0,0,0.55)' }}
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 320, damping: 34 }}
            >
              <div className="pt-2.5 pb-1 flex justify-center shrink-0">
                <span className="h-1 w-10 rounded-full bg-white/25" />
              </div>

              <header className="px-5 pt-2 pb-3 flex items-center gap-3 border-b border-white/5 shrink-0">
                <div className="flex-1 min-w-0">
                  <h2 className="text-[17px] font-semibold tracking-tight leading-tight truncate">{meta.title}</h2>
                  <p className="text-[11px] text-muted-foreground">Updated {meta.updated} · {SUPPORT_EMAIL}</p>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="w-9 h-9 rounded-full grid place-items-center bg-white/[0.06] active:scale-95 transition"
                >
                  <X className="w-4.5 h-4.5" />
                </button>
              </header>

              <div
                className="flex-1 overflow-y-auto overscroll-contain px-5 py-5 legal-body"
                style={{ WebkitOverflowScrolling: 'touch', paddingBottom: 'calc(env(safe-area-inset-bottom) + 24px)' }}
              >
                <div className="prose prose-invert prose-sm max-w-none
                    prose-headings:font-display prose-headings:tracking-tight
                    prose-h2:text-[15px] prose-h2:mt-6 prose-h2:mb-2 prose-h2:text-foreground
                    prose-p:text-[13.5px] prose-p:leading-relaxed prose-p:text-foreground/80
                    prose-li:text-[13.5px] prose-li:text-foreground/80
                    prose-strong:text-foreground prose-a:text-primary">
                  <Body />
                </div>
              </div>
            </motion.div>
          </motion.div>
        );
      })()}
    </AnimatePresence>
  );
}
