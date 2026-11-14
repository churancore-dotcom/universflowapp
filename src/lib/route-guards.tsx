/**
 * Route guards — optimized with lazy loading for better initial page load.
 */
import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { rememberOfflineReturn } from '@/lib/offlineReturn';
import { supabase } from '@/integrations/supabase/client';
import { Navigate } from '@/lib/router-compat';
import { useAuth } from '@/contexts/AuthContext';
import { getArtistDestination, hasArtistSignupIntent, type ArtistDestination } from '@/lib/artistRouting';
import { getAccess, peekAccess } from '@/lib/accessCache';
import { isMedianApp } from '@/lib/median';
import NotFound from '@/pages/NotFound';
import PageLoader from '@/components/PageLoader';

// Lazy load heavy page components
const Home = lazy(() => import('@/pages/Home'));
const GetApp = lazy(() => import('@/pages/GetApp'));

export const LazyFallback = PageLoader;

/**
 * State tagged with the user it was computed for. Reading it under a
 * different user yields `fallback`, so a freshly switched account can never
 * render even one frame with the previous account's access result.
 */
function useUserScopedState<T>(userId: string | undefined, init: () => T, fallback: T) {
  const [state, setState] = useState<{ userId: string | undefined; value: T }>(() => ({ userId, value: init() }));
  const value = state.userId === userId ? state.value : fallback;
  const set = useCallback((next: T) => setState({ userId, value: next }), [userId]);
  return [value, set] as const;
}

function OfflineRedirect() {
  if (typeof window !== 'undefined') {
    rememberOfflineReturn(window.location.pathname + window.location.search + window.location.hash);
  }
  return <Navigate to="/offline-player" replace />;
}

export const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, isLoading, emailVerified, isOffline } = useAuth();
  if (isOffline) return <OfflineRedirect />;
  if (isLoading) return <LazyFallback />;
  if (!user) return <Navigate to="/auth" replace />;
  if (emailVerified === null) return <LazyFallback />;
  if (emailVerified === false) return <Navigate to="/check-email" replace />;
  return <>{children}</>;
};

export const ArtistProtectedRoute = ({ children, requireArtistRole = false }: { children: React.ReactNode; requireArtistRole?: boolean }) => {
  const { user, isLoading, emailVerified } = useAuth();
  const [verifiedArtist, setVerifiedArtist] = useUserScopedState<null | boolean>(
    user?.id,
    () => (requireArtistRole ? peekAccess<boolean>(user?.id, 'artist-access') ?? null : true),
    null,
  );

  useEffect(() => {
    let cancelled = false;
    if (!requireArtistRole) {
      setVerifiedArtist(true);
      return;
    }
    if (!user || emailVerified !== true) {
      setVerifiedArtist(false);
      return;
    }
    // Render instantly on repeat navigation instead of flashing a blank screen.
    const cached = peekAccess<boolean>(user.id, 'artist-access');
    setVerifiedArtist(cached ?? null);
    getAccess<boolean>(user.id, 'artist-access', async () => {
      const { data, error } = await supabase.rpc('has_role', {
        _user_id: user.id,
        _role: 'artist',
      });
      if (!error && data) return true;
      const { data: mem } = await supabase
        .from('artist_team_members')
        .select('id')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle();
      return !!mem;
    })
      .then((allowed) => { if (!cancelled) setVerifiedArtist(allowed); })
      .catch(() => { if (!cancelled) setVerifiedArtist(false); });
    return () => { cancelled = true; };
  }, [user, emailVerified, requireArtistRole, setVerifiedArtist]);

  if (isLoading) return <LazyFallback />;
  if (!user) return <Navigate to="/artist/auth" replace />;
  if (emailVerified === null) return <LazyFallback />;
  if (emailVerified === false) return <Navigate to="/check-email" replace />;
  if (verifiedArtist === null) return <LazyFallback />;
  if (!verifiedArtist) return <Navigate to="/artist/status" replace />;
  return <>{children}</>;
};

export const ListenerRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, isLoading, emailVerified, isOffline } = useAuth();
  const [artistDestination, setArtistDestination] = useUserScopedState<ArtistDestination | undefined>(
    user?.id,
    () => peekAccess<ArtistDestination>(user?.id, 'artist-destination'),
    undefined,
  );

  useEffect(() => {
    let cancelled = false;
    if (!user || emailVerified !== true) {
      setArtistDestination(undefined);
      return;
    }
    setArtistDestination(peekAccess<ArtistDestination>(user.id, 'artist-destination'));
    getArtistDestination(user).then((destination) => {
      if (!cancelled) setArtistDestination(destination);
    });
    return () => { cancelled = true; };
  }, [user, emailVerified, setArtistDestination]);

  if (isOffline) return <OfflineRedirect />;
  if (isLoading) return <LazyFallback />;
  if (!user) return <Navigate to="/auth" replace />;
  if (emailVerified === false) return <Navigate to="/check-email" replace />;
  if (emailVerified === null || artistDestination === undefined) return <LazyFallback />;
  if (artistDestination) return <Navigate to={artistDestination} replace />;
  return <>{children}</>;
};

export const AdminRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, isLoading } = useAuth();
  const [verified, setVerified] = useUserScopedState<null | boolean>(
    user?.id,
    () => peekAccess<boolean>(user?.id, 'admin-access') ?? null,
    null,
  );

  useEffect(() => {
    let cancelled = false;
    if (!user) { setVerified(false); return; }
    setVerified(peekAccess<boolean>(user.id, 'admin-access') ?? null);
    getAccess<boolean>(user.id, 'admin-access', async () => {
      const { data, error } = await supabase.rpc('has_role', {
        _user_id: user.id,
        _role: 'admin',
      });
      return !error && !!data;
    })
      .then((allowed) => { if (!cancelled) setVerified(allowed); })
      .catch(() => { if (!cancelled) setVerified(false); });
    return () => { cancelled = true; };
  }, [user, setVerified]);

  if (isLoading || verified === null) return <LazyFallback />;
  if (!user) return <Navigate to="/auth" replace />;
  if (!verified) return <NotFound />;
  return <>{children}</>;
};

// Every public marketing domain must serve the landing / APK page. Missing a
// custom domain here silently bounced real visitors straight to /auth.
const WEB_LANDING_HOSTS = new Set([
  'universflow.in',
  'www.universflow.in',
  'universflow.cyou',
  'www.universflow.cyou',
]);
const isWebLanding = () => typeof window !== 'undefined'
  && WEB_LANDING_HOSTS.has(window.location.hostname.toLowerCase());

/**
 * True only after hydration. Host-based redirects MUST wait for this, otherwise
 * the server renders the landing page while the first client render returns a
 * <Navigate>, which makes React discard and rebuild the entire tree
 * ("Hydration failed…") on every cold load.
 */
const useHydrated = () => {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { setHydrated(true); }, []);
  return hydrated;
};


export const RootGate = () => {
  const { user, isLoading, emailVerified, isOffline } = useAuth();
  const hydrated = useHydrated();
  const [artistDestination, setArtistDestination] = useState<ArtistDestination | undefined>(
    () => peekAccess<ArtistDestination>(user?.id, 'artist-destination'),
  );

  useEffect(() => {
    let cancelled = false;
    if (!user || emailVerified !== true) {
      setArtistDestination(undefined);
      return;
    }
    setArtistDestination(peekAccess<ArtistDestination>(user.id, 'artist-destination'));
    getArtistDestination(user).then((destination) => {
      if (!cancelled) setArtistDestination(destination);
    });
    return () => { cancelled = true; };
  }, [user, emailVerified]);

  if (isOffline) return <OfflineRedirect />;
  if (isLoading) return <LazyFallback />;
  if (user) {
    if (emailVerified === null) return <LazyFallback />;
    if (emailVerified === false) return <Navigate to="/check-email" replace />;
    if (artistDestination === undefined) return <LazyFallback />;
    if (artistDestination) return <Navigate to={artistDestination} replace />;
    return (
      <Suspense fallback={<LazyFallback />}>
        <Home />
      </Suspense>
    );
  }
  if (hydrated && (isMedianApp || !isWebLanding())) {
    return <Navigate to="/auth" replace />;
  }
  return (
    <Suspense fallback={<LazyFallback />}>
      <GetApp />
    </Suspense>
  );
};

export const GetAppGate = () => {
  const { user } = useAuth();
  const hydrated = useHydrated();
  if (hydrated && (isMedianApp || !isWebLanding())) {
    return <Navigate to={user ? "/" : "/auth"} replace />;
  }
  return (
    <Suspense fallback={<LazyFallback />}>
      <GetApp />
    </Suspense>
  );
};

