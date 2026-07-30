import { forwardRef, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import appLogo from '@/assets/app-logo.webp';

interface SplashScreenProps {
  onComplete: () => void;
}

/**
 * SplashScreen — clean logo reveal that shares a layout transition with the
 * Auth page logo (layoutId="uf-brand-logo" / "uf-brand-wordmark"). When the
 * splash unmounts, the logo morphs smoothly into the Auth screen logo.
 */
const SplashScreen = forwardRef<HTMLDivElement, SplashScreenProps>(({ onComplete }, ref) => {
  const doneRef = useRef(false);
  const [phase, setPhase] = useState<'in' | 'hold' | 'out'>('in');

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onComplete();
  };

  useEffect(() => {
    const cap = window.setTimeout(finish, 3500);
    const t1 = window.setTimeout(() => setPhase('hold'), 500);
    const t2 = window.setTimeout(() => setPhase('out'), 1700);
    const t3 = window.setTimeout(finish, 2100);
    return () => {
      window.clearTimeout(cap);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = phase !== 'in';
  const ease = [0.22, 1, 0.36, 1] as const;

  return (
    <motion.div
      ref={ref}
      className="fixed inset-0 z-50 flex h-[100dvh] w-full flex-col items-center justify-center overflow-hidden bg-black"
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.45, ease }}
    >
      <div className="flex flex-col items-center justify-center">
        <motion.div
          layoutId="uf-brand-logo"
          className="h-40 w-40 rounded-full overflow-hidden"
          style={{ opacity: visible ? 1 : 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 32, mass: 0.7 }}
        >
          <img
            src={appLogo}
            alt="Univers Flow"
            width={160}
            height={160}
            loading="eager"
            decoding="async"
            {...({ fetchPriority: 'high' } as React.ImgHTMLAttributes<HTMLImageElement>)}
            className="h-full w-full object-cover"
            draggable={false}
          />
        </motion.div>
        <motion.div
          layoutId="uf-brand-wordmark"
          className="mt-8 text-white"
          style={{
            fontSize: 30,
            letterSpacing: '0.34em',
            fontWeight: 700,
            opacity: visible ? 1 : 0,
          }}
          transition={{ type: 'spring', stiffness: 260, damping: 32, mass: 0.7 }}
        >
          UNIVERS FLOW
        </motion.div>
      </div>
    </motion.div>
  );
});

SplashScreen.displayName = 'SplashScreen';

export default SplashScreen;
