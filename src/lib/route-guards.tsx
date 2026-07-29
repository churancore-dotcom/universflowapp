/**
 * Route guards — ported verbatim from the pre-migration src/App.tsx.
 * These wrap individual route components in src/routes/* files.
 */
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Navigate } from '@/lib/router-compat';
import { useAuth } from '@/contexts/AuthContext';
import { getArtistDestination, hasArtistSignupIntent, type ArtistDestination } from '@/lib/artistRouting';
import { isMedianApp } from '@/lib/median';
import Home from '@/pages/Home';
import GetApp from '@/pages/GetApp';
import NotFound from '@/pages/NotFound';

export const LazyFallback = () => <div className="min-h-screen bg-background" />;

export const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, isLoading, emailVerified } = useAuth();
  if (isLoading) return <LazyFallback />;
  if (!user) return <Navigate to="/auth" replace />;
  // Wait for the profile check to finish before rendering anything. Without
  // this, the user sees Home flash for a second on login and then gets bounced
  // to the verification screen because emailVerified is briefly null.
  if (emailVerified === null) return <LazyFallback />;
  if (emailVerified === false) return <Navigate to="/check-email" replace />;
  return <>{children}</>;
};

// Same as ProtectedRoute but unauth users bounce to /artist/auth instead of /auth.
// This keeps artists inside the artist sign-in flow and prevents any guest access
// to artist pages.
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
        // Team members (manager/editor/analyst/viewer) don't have the 'artist'
        // user_role but should still access the studio via active membership.
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
  // Server-side re-verification on every admin mount. Cached `isAdmin` from
  // context is not trusted on its own — we hit the SECURITY DEFINER RPC
  // (`has_role`) which queries the `user_roles` table directly. If the role
  // was revoked mid-session, this catches it immediately.
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
  // Cloak: if the fresh backend role check fails, render 404 instead of
  // redirecting. URL guessing reveals nothing about /admin existence.
  if (!verified) return <NotFound />;
  return <>{children}</>;
};

// Hostnames where the public APK landing page (/get) is allowed to render.
// EVERYWHERE else — APK webview, Capacitor (localhost), lovable previews,
// dev — we go straight to the app. APK must NEVER show /get.
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
    return <Home />;
  }
  // During SSR (no window) render the landing page so crawlers on
  // universflow.in get real content; the client corrects for app shells.
  if (typeof window !== 'undefined' && (isMedianApp || !isWebLanding())) {
    return <Navigate to="/auth" replace />;
  }
  return <GetApp />;
};

export const GetAppGate = () => {
  const { user } = useAuth();
  if (typeof window !== 'undefined' && (isMedianApp || !isWebLanding())) {
    return <Navigate to={user ? "/" : "/auth"} replace />;
  }
  return <GetApp />;
};
