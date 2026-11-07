import { motion } from 'framer-motion';

/**
 * Branded loading screen shared across every artist page.
 * Replaces the previous pure-black `<div className="bg-background" />`
 * placeholder that looked like a crashed/blank screen — especially right
 * after submitting an application when Status.tsx polls for up to ~7s.
 */
export default function ArtistLoading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="min-h-[100dvh] bg-background text-foreground relative overflow-hidden flex flex-col items-center justify-center px-6">
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(120% 80% at 0% 0%, hsl(340 100% 55% / 0.18) 0%, transparent 55%),' +
            'radial-gradient(80% 60% at 100% 100%, hsl(28 100% 60% / 0.10) 0%, transparent 60%)',
        }}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="relative flex flex-col items-center gap-4"
      >
        <div className="relative w-14 h-14">
          <span
            className="absolute inset-0 rounded-full"
            style={{
              background: 'radial-gradient(closest-side, rgba(255,45,85,0.55), transparent 70%)',
              filter: 'blur(6px)',
            }}
          />
          <motion.span
            className="absolute inset-2 rounded-full border-2 border-white/15 border-t-white"
            animate={{ rotate: 360 }}
            transition={{ duration: 1.1, ease: 'linear', repeat: Infinity }}
          />
        </div>
        <p className="text-[12px] uppercase tracking-[0.28em] text-white/55 font-semibold">
          {label}
        </p>
      </motion.div>
    </div>
  );
}
