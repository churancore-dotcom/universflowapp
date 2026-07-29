import { memo, lazy, Suspense } from 'react';
import { useLocation } from '@/lib/router-compat';
import MiniPlayer from './MiniPlayer';

const FullscreenPlayer = lazy(() => import('./FullscreenPlayer'));

/**
 * App-level mount for MiniPlayer + FullscreenPlayer.
 * Persisting these across route changes prevents the mount/unmount
 * flicker that happened when each page mounted its own copy.
 */
const GlobalPlayerLayer = memo(function GlobalPlayerLayer() {
  const { pathname } = useLocation();

  // Hide on routes where the player UI shouldn't appear.
  // NOTE: '/' was previously hidden, which broke the MiniPlayer on the
  // landing route since Home is mounted at both '/' and '/home'. The
  // player must materialise the instant a song starts from Home.
  const hidden =
    pathname === '/auth' ||
    pathname === '/verify' ||
    pathname === '/check-email' ||
    pathname.startsWith('/admin') ||
    pathname.startsWith('/artist/') ||
    pathname.startsWith('/legal/artist-') ||
    pathname === '/offline-player';

  if (hidden) return null;

  return (
    <>
      <MiniPlayer />
      <Suspense fallback={null}>
        <FullscreenPlayer />
      </Suspense>
    </>
  );
});

export default GlobalPlayerLayer;
