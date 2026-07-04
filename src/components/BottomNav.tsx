import { useState, useEffect, useRef, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Headphones, Search, Library, User } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { usePlayer } from '@/contexts/PlayerContext';
import { triggerHaptic } from '@/hooks/useHaptics';

const navItems = [
  { icon: Headphones, label: 'Lestine', path: '/home' },
  { icon: Search, label: 'Search', path: '/search' },
  { icon: Library, label: 'Library', path: '/library' },
  { icon: User, label: 'Profile', path: '/profile' },
];

const BottomNav = memo(function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const { currentSong } = usePlayer();
  const [isVisible, setIsVisible] = useState(true);
  const lastScrollY = useRef(0);
  const scrollThreshold = 10;

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      const scrollDelta = currentScrollY - lastScrollY.current;
      if (Math.abs(scrollDelta) > scrollThreshold) {
        if (scrollDelta > 0 && currentScrollY > 100) {
          setIsVisible(false);
        } else {
          setIsVisible(true);
        }
        lastScrollY.current = currentScrollY;
      }
    };

    const scrollContainers = document.querySelectorAll('[data-scroll-container]');
    window.addEventListener('scroll', handleScroll, { passive: true });
    scrollContainers.forEach(c => c.addEventListener('scroll', handleScroll, { passive: true }));
    return () => {
      window.removeEventListener('scroll', handleScroll);
      scrollContainers.forEach(c => c.removeEventListener('scroll', handleScroll));
    };
  }, []);

  return (
    <AnimatePresence>
      <motion.nav
        className="fixed left-0 right-0 z-50 pointer-events-none flex justify-center"
        style={{
          bottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)',
          paddingLeft: 'calc(env(safe-area-inset-left, 0px) + 12px)',
          paddingRight: 'calc(env(safe-area-inset-right, 0px) + 12px)',
        }}
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: isVisible ? 0 : 120, opacity: isVisible ? 1 : 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
      >
        <div
          className="pointer-events-auto relative flex flex-nowrap items-center gap-0.5 px-1.5 py-1.5 rounded-full overflow-hidden w-auto max-w-full"
          style={{
            background: 'linear-gradient(180deg, hsl(0 0% 8% / 0.92) 0%, hsl(0 0% 4% / 0.96) 100%)',
            backdropFilter: 'blur(24px) saturate(180%)',
            WebkitBackdropFilter: 'blur(24px) saturate(180%)',
            border: '0.5px solid hsl(0 0% 100% / 0.10)',
            boxShadow:
              '0 20px 50px -12px hsl(0 0% 0% / 0.7), 0 0 0 0.5px hsl(0 0% 100% / 0.04), inset 0 1px 0 hsl(0 0% 100% / 0.08)',
          }}
        >
          {/* Soft cover glow */}
          {currentSong?.cover_url && (
            <img
              src={currentSong.cover_url}
              alt=""
              aria-hidden
              className="absolute inset-0 w-full h-full object-cover pointer-events-none opacity-20"
              style={{ filter: 'blur(30px) saturate(160%)' }}
            />
          )}

          {navItems.map((item) => {
            const path = location.pathname;
            const isHomeRoute = path === '/' || path === '/index' || path === '/home';
            const isActive = item.path === '/home' ? isHomeRoute : path === item.path || path.startsWith(item.path + '/');
            const Icon = item.icon;

            return (
              <motion.button
                key={item.path}
                type="button"
                aria-label={item.label}
                aria-current={isActive ? 'page' : undefined}
                onClick={() => {
                  triggerHaptic('selection');
                  navigate(item.path);
                }}
                whileTap={{ scale: 0.9 }}
                className="relative flex items-center justify-center h-10 rounded-full shrink-0"
                animate={{
                  paddingLeft: isActive ? 12 : 11,
                  paddingRight: isActive ? 14 : 11,
                }}
                transition={{ type: 'spring', stiffness: 500, damping: 32 }}
              >
                {isActive && (
                  <motion.div
                    layoutId="pill-active"
                    className="absolute inset-0 rounded-full"
                    style={{
                      background:
                        'linear-gradient(180deg, hsl(346 100% 58% / 0.95), hsl(346 100% 46% / 0.95))',
                      boxShadow:
                        '0 8px 20px -6px hsl(346 100% 50% / 0.55), inset 0 1px 0 hsl(0 0% 100% / 0.25)',
                    }}
                    transition={{ type: 'spring', stiffness: 500, damping: 34 }}
                  />
                )}

                <div className="relative flex items-center gap-1">
                  <Icon
                    className={`w-5 h-5 transition-colors duration-200 ${
                      isActive ? 'text-white' : 'text-white/65'
                    }`}
                    strokeWidth={isActive ? 2.2 : 1.9}
                  />
                  <AnimatePresence initial={false}>
                    {isActive && (
                      <motion.span
                        key="label"
                        initial={{ width: 0, opacity: 0 }}
                        animate={{ width: 'auto', opacity: 1 }}
                        exit={{ width: 0, opacity: 0 }}
                        transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
                        className="overflow-hidden whitespace-nowrap text-[13px] font-semibold text-white tracking-tight"
                      >
                        {item.label}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </div>
              </motion.button>
            );
          })}
        </div>
      </motion.nav>
    </AnimatePresence>
  );
});

export default BottomNav;
