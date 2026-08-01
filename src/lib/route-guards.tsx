/**
 * Route guards — optimized with lazy loading for better initial page load.
 */
import { useState, useEffect, lazy, Suspense } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Navigate } from '@/lib/router-compat';
import { useAuth } from '@/contexts/AuthContext';
import { getArtistDestination, hasArtistSignupIntent, type ArtistDestination } from '@/lib/artistRouting';
import { isMedianApp } from '@/lib/median';
import NotFound from '@/pages/NotFound';

// Lazy load heavy page components
const Home = lazy(() => import('@/pages/Home'));
const GetApp = lazy(() => import('@/pages/GetApp'));

export const LazyFallback = () => <div className="min-h-screen bg-background" />;

export const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, isLoading, emailVerified } = useAuth();
  if (isLoading) return <LazyFallback />;
  if (!user) return <Navigate to="/auth" replace />;
  if (emailVerified === null) return <LazyFallback />;
  if (emailVerified === false) return <Navigate to="/check-email" replace />;
  return <>{children}</>;
};

export const ArtistProtectedRoute = ({ children, requireArtistRole = false }: { children: React.ReactNode; requireArtistRole?: boolean }) => {
  const { user, isLoading, emailVerified } = useAuth();
  const [verifiedArtist, setVerifiedArtist] = useState<null | boolean>(null);

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
    setVerifiedArtist(null);
    (async () => {
      try {
        const { data, error } = await supabase.rpc('has_role', {
          _user_id: user.id,
          _role: 'artist',
        });
        if (!error && data) {
          if (!cancelled) setVerifiedArtist(true);
          return;
        }
        const { data: mem } = await supabase
          .from('artist_team_members')
          .select('id')
          .eq('user_id', user.id)
          .eq('status', 'active')
          .limit(1)
          .maybeSingle();
        if (!cancelled) setVerifiedArtist(!!mem);
      } catch {
        if (!cancelled) setVerifiedArtist(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, emailVerified, requireArtistRole]);

  if (isLoading) return <LazyFallback />;
  if (!user) return <Navigate to="/artist/auth" replace />;
  if (emailVerified === null) return <LazyFallback />;
  if (emailVerified === false) return <Navigate to="/check-email" replace />;
  if (verifiedArtist === null) return <LazyFallback />;
  if (!verifiedArtist) return <Navigate to="/artist/status" replace />;
  return <>{children}</>;
};

export const ListenerRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, isLoading, emailVerified } = useAuth();
  const [artistDestination, setArtistDestination] = useState<ArtistDestination | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    if (!user || emailVerified !== true) {
      setArtistDestination(undefined);
      return;
    }
    setArtistDestination(undefined);
    getArtistDestination(user).then((destination) => {
      if (!cancelled) setArtistDestination(destination);
    });
    return () => { cancelled = true; };
  }, [user, emailVerified]);

  if (isLoading) return <LazyFallback />;
  if (!user) return <Navigate to="/auth" replace />;
  if (emailVerified === false) return <Navigate to="/check-email" replace />;
  if (emailVerified === null || artistDestination === undefined) return <LazyFallback />;
  if (artistDestination) return <Navigate to={artistDestination} replace />;
  return <>{children}</>;
};

export const AdminRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, isLoading } = useAuth();
  const [verified, setVerified] = useState<null | boolean>(null);

  useEffect(() => {
    let cancelled = false;
    if (!user) { setVerified(false); return; }
    (async () => {
      try {
        const { data, error } = await supabase.rpc('has_role', {
          _user_id: user.id,
          _role: 'admin',
        });
        if (!cancelled) setVerified(!error && !!data);
      } catch {
        if (!cancelled) setVerified(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  if (isLoading || verified === null) return <LazyFallback />;
  if (!user) return <Navigate to="/auth" replace />;
  if (!verified) return <NotFound />;
  return <>{children}</>;
};

const WEB_LANDING_HOSTS = new Set(['universflow.in', 'www.universflow.in']);
const isWebLanding = () => typeof window !== 'undefined'
  && WEB_LANDING_HOSTS.has(window.location.hostname.toLowerCase());

export const RootGate = () => {
  const { user, isLoading, emailVerified } = useAuth();
  const [artistDestination, setArtistDestination] = useState<ArtistDestination | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    if (!user || emailVerified !== true) {
      setArtistDestination(undefined);
      return;
    }
    setArtistDestination(undefined);
    getArtistDestination(user).then((destination) => {
      if (!cancelled) setArtistDestination(destination);
    });
    return () => { cancelled = true; };
  }, [user, emailVerified]);

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
  if (typeof window !== 'undefined' && (isMedianApp || !isWebLanding())) {
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
  if (typeof window !== 'undefined' && (isMedianApp || !isWebLanding())) {
    return <Navigate to={user ? "/" : "/auth"} replace />;
  }
  return (
    <Suspense fallback={<LazyFallback />}>
      <GetApp />
    </Suspense>
  );
};
