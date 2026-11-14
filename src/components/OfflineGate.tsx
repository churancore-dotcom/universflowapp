import { useEffect } from 'react';
import { useLocation, useNavigate } from '@/lib/router-compat';
import { useAuth } from '@/contexts/AuthContext';
import { forgetOfflineReturn, rememberOfflineReturn, takeOfflineReturn } from '@/lib/offlineReturn';

/**
 * When offline, the app collapses to a single screen: the standalone
 * OfflinePlayerShell at /offline-player. Auth pages stay reachable so the
 * user can sign in once they reconnect. Everything else redirects there —
 * no Home, Library, Search, Profile etc. when there's no network.
 */
const OFFLINE_ALLOWED = new Set<string>(['/offline-player', '/auth']);

const OfflineGate = () => {
  const { isOffline } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (isOffline) {
      if (!OFFLINE_ALLOWED.has(location.pathname)) {
        rememberOfflineReturn(location.pathname + location.search + location.hash);
        navigate('/offline-player', { replace: true });
      } else if (location.pathname === '/auth') {
        // The user chose to go elsewhere; don't yank them back later.
        forgetOfflineReturn();
      }
      return;
    }
    // Back online: return to where we auto-redirected from, if anywhere.
    const destination = takeOfflineReturn();
    if (destination && location.pathname === '/offline-player') {
      navigate(destination, { replace: true });
    }
  }, [isOffline, location.pathname, location.search, location.hash, navigate]);

  return null;
};

export default OfflineGate;
