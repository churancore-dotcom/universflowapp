import { useEffect } from 'react';
import { useLocation, useNavigate } from '@/lib/router-compat';
import { useAuth } from '@/contexts/AuthContext';

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
    if (!isOffline) return;
    if (!OFFLINE_ALLOWED.has(location.pathname)) {
      navigate('/offline-player', { replace: true });
    }
  }, [isOffline, location.pathname, navigate]);

  return null;
};

export default OfflineGate;
