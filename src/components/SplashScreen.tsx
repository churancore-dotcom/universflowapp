import { forwardRef, useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import appLogo from '@/assets/app-logo.webp';

interface SplashScreenProps {
  onComplete: () => void;
}

/**
 * A single opacity-only handoff, not a second native launch animation.
 * The route tree stays mounted and interactive beneath this visual cover.
 */
const SplashScreen = forwardRef<HTMLDivElement, SplashScreenProps>(({ onComplete }, ref) => {
  const coverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      onComplete();
      return;
    }
    const cover = coverRef.current;
    if (!cover) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let completed = false;
    const finish = () => {
      if (completed) return;
      completed = true;
      onComplete();
    };
    const animation = cover.animate(
      [{ opacity: 1, offset: 0 }, { opacity: 1, offset: 0.45 }, { opacity: 0, offset: 1 }],
      { duration: reduced ? 120 : 480, easing: 'ease-out', fill: 'forwards' },
    );
    animation.onfinish = finish;
    const cap = window.setTimeout(finish, reduced ? 200 : 650);
    return () => {
      animation.onfinish = null;
      animation.cancel();
      window.clearTimeout(cap);
    };
  }, [onComplete]);

  return (
    <div
      ref={(node) => {
        coverRef.current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) ref.current = node;
      }}
      role="status"
      aria-label="Loading Universflow"
      className="fixed inset-0 z-50 flex h-[100dvh] w-full flex-col items-center justify-center overflow-hidden bg-background pointer-events-none"
    >
      <div className="flex flex-col items-center justify-center">
        <div
          className="h-24 w-24 overflow-hidden rounded-full"
        >
          <img
            src={appLogo}
            alt="Univers Flow"
            width={96}
            height={96}
            loading="eager"
            decoding="async"
            {...({ fetchPriority: 'high' } as React.ImgHTMLAttributes<HTMLImageElement>)}
            className="h-full w-full object-cover"
            draggable={false}
          />
        </div>
        <div
          className="mt-5 font-display text-xl font-semibold text-foreground"
        >
          UNIVERS FLOW
        </div>
      </div>
    </div>
  );
});

SplashScreen.displayName = 'SplashScreen';

export default SplashScreen;
