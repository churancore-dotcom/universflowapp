import { forwardRef, useEffect, useRef, useState } from 'react';
import appLogo from '@/assets/app-logo.webp';

interface SplashScreenProps {
  onComplete: () => void;
}

/**
 * SplashScreen — a short, self-contained logo reveal. The entire route tree
 * remains mounted beneath it, so this overlay must unmount synchronously.
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
    const cap = window.setTimeout(finish, 1100);
    const t1 = window.setTimeout(() => setPhase('hold'), 120);
    const t2 = window.setTimeout(() => setPhase('out'), 520);
    const t3 = window.setTimeout(finish, 720);
    return () => {
      window.clearTimeout(cap);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = phase !== 'in';
  return (
    <div
      ref={ref}
      className="fixed inset-0 z-50 flex h-[100dvh] w-full flex-col items-center justify-center overflow-hidden bg-black pointer-events-none"
    >
      <div className="flex flex-col items-center justify-center">
        <div
          className="h-40 w-40 rounded-full overflow-hidden"
          style={{ opacity: visible ? 1 : 0 }}
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
        </div>
        <div
          className="mt-8 text-white"
          style={{
            fontSize: 30,
            letterSpacing: '0.34em',
            fontWeight: 700,
            opacity: visible ? 1 : 0,
          }}
        >
          UNIVERS FLOW
        </div>
      </div>
    </div>
  );
});

SplashScreen.displayName = 'SplashScreen';

export default SplashScreen;
