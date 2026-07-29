import { motion, Transition } from 'framer-motion';
import { ReactNode, forwardRef, useRef, useMemo } from 'react';
import { useLocation } from '@/lib/router-compat';
import { NavDirectionContext, useNavDirection } from '@/contexts/NavDirectionContext';

interface PageTransitionProps {
  children: ReactNode;
  className?: string;
}

const pageSpring: Transition = {
  type: "spring" as const,
  stiffness: 400,
  damping: 38,
  mass: 0.6,
};

const pageTiming: Transition = {
  duration: 0.35,
  ease: [0.25, 0.46, 0.45, 0.94],
};

// Tab order for directional transitions
const TAB_ORDER = ['/home', '/search', '/library', '/profile'];

export const NavDirectionProvider = ({ children }: { children: ReactNode }) => {
  const location = useLocation();
  const prevIndexRef = useRef(TAB_ORDER.indexOf(location.pathname));

  const direction = useMemo(() => {
    const currentIndex = TAB_ORDER.indexOf(location.pathname);
    if (currentIndex === -1) return 0;
    const prev = prevIndexRef.current;
    prevIndexRef.current = currentIndex;
    if (prev === -1) return 0;
    return currentIndex > prev ? 1 : currentIndex < prev ? -1 : 0;
  }, [location.pathname]);

  return (
    <NavDirectionContext.Provider value={direction}>
      {children}
    </NavDirectionContext.Provider>
  );
};

const PageTransition = ({ children, className = '' }: PageTransitionProps) => {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, x: 60, scale: 0.98 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: -30, scale: 0.98 }}
      transition={pageSpring}
    >
      {children}
    </motion.div>
  );
};

export const SheetTransition = ({ children, className = '' }: PageTransitionProps) => {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: "8%", scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: "5%", scale: 0.98 }}
      transition={pageSpring}
    >
      {children}
    </motion.div>
  );
};

export const FadeTransition = forwardRef<HTMLDivElement, PageTransitionProps>(({ children, className = '' }, ref) => {
  return (
    <motion.div
      ref={ref}
      className={className}
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.02 }}
      transition={pageTiming}
    >
      {children}
    </motion.div>
  );
});
FadeTransition.displayName = 'FadeTransition';

export const TabTransition = ({ children, className = '' }: PageTransitionProps) => {
  useNavDirection();
  return (
    <motion.div
      className={className}
      style={{ willChange: 'transform, opacity' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
};

export default PageTransition;
