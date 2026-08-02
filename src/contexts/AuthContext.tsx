import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getAuthError } from '@/lib/errorMessages';
import { setSentryUser } from '@/lib/sentry';
import { clearAccessCache } from '@/lib/accessCache';
import type { User, Session } from '@supabase/supabase-js';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  isAdmin: boolean;
  // null = unknown (still loading), true/false once profile checked.
  // We only redirect to the verification screen when this is explicitly `false`
  // so legacy accounts without the column set don't get locked out.
  emailVerified: boolean | null;
  isLoading: boolean;
  isOffline: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null; isAdmin?: boolean }>;
  signUp: (
    email: string,
    password: string,
    username: string,
    countryCode?: string,
    extraMetadata?: Record<string, unknown>,
  ) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshEmailVerified: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [emailVerified, setEmailVerified] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // Trust navigator.onLine only for the "true" (online) signal. It reports
  // false positives constantly (Capacitor webviews, brief network transitions,
  // VPN handoffs), so we always verify an "offline" claim with a real reachability
  // ping before locking the user into the offline shell.
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let verifyTimer: ReturnType<typeof setTimeout> | null = null;

    const reachable = async (): Promise<boolean> => {
      const targets = [
        'https://www.google.com/generate_204',
        'https://cloudflare.com/cdn-cgi/trace',
        'https://www.gstatic.com/generate_204',
      ];
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 3500);
      try {
        const results = await Promise.allSettled(
          targets.map((u) =>
            fetch(u, { method: 'GET', mode: 'no-cors', cache: 'no-store', signal: controller.signal })
          )
        );
        clearTimeout(t);
        // no-cors → opaque responses resolve fulfilled even on 204/opaque
        return results.some((r) => r.status === 'fulfilled');
      } catch {
        clearTimeout(t);
        return false;
      }
    };

    const verifyOffline = () => {
      if (verifyTimer) clearTimeout(verifyTimer);
      // Debounce: brief flaps shouldn't kick users to the offline page.
      verifyTimer = setTimeout(async () => {
        const ok = await reachable();
        if (cancelled) return;
        setIsOffline(!ok);
      }, 1500);
    };

    const onOnline = () => {
      if (verifyTimer) clearTimeout(verifyTimer);
      setIsOffline(false);
    };
    const onOffline = () => verifyOffline();

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    // On boot: if the browser claims offline, verify before trusting it.
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      verifyOffline();
    }

    return () => {
      cancelled = true;
      if (verifyTimer) clearTimeout(verifyTimer);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const ensureUserProfile = useCallback(async (sessionUser: User) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, account_type')
        .eq('user_id', sessionUser.id)
        .maybeSingle();

      const metadata = (sessionUser.user_metadata || {}) as Record<string, unknown>;
      const accountType = metadata.account_type === 'artist' ? 'artist' : 'listener';

      if (error) return;
      if (data) {
        if (accountType === 'artist' && data.account_type !== 'artist') {
          await supabase.from('profiles').update({ account_type: 'artist' }).eq('user_id', sessionUser.id);
        }
        return;
      }

      const { error: insertError } = await supabase.from('profiles').insert({
        user_id: sessionUser.id,
        email: sessionUser.email ?? null,
        account_type: accountType,
      });

      if (insertError && insertError.code !== '23505') {
        console.error('Profile bootstrap failed:', insertError);
      }
    } catch (error) {
      console.error('Profile bootstrap failed:', error);
    }
  }, []);

  const checkAdminRole = useCallback(async (userId: string) => {
    try {
      const { data } = await supabase.rpc('has_role', { _user_id: userId, _role: 'admin' });
      setIsAdmin(!!data);
      return !!data;
    } catch {
      setIsAdmin(false);
      return false;
    }
  }, []);

  const loadEmailVerified = useCallback(async (userId: string) => {
    try {
      // Admins bypass the verification gate entirely — they manage the platform
      // and must always reach /admin (and the app) even if their profile row
      // hasn't been flipped (seeded accounts, magic-link logins, etc.).
      try {
        const { data: adminFlag } = await supabase.rpc('has_role', { _user_id: userId, _role: 'admin' });
        if (adminFlag) { setEmailVerified(true); return; }
      } catch { /* fall through to normal check */ }

      const { data } = await supabase
        .from('profiles')
        .select('email_verified')
        .eq('user_id', userId)
        .maybeSingle();
      // Treat NULL as verified so legacy accounts aren't blocked. Only explicit
      // `false` triggers the verification gate.
      setEmailVerified(data && data.email_verified === false ? false : true);
    } catch {
      setEmailVerified(true);
    }
  }, []);

  const refreshEmailVerified = useCallback(async () => {
    if (!user) { setEmailVerified(null); return; }
    await loadEmailVerified(user.id);
  }, [user, loadEmailVerified]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, nextSession) => {
      // CRITICAL: never wipe the local session as a side effect of being offline.
      // When the device has no internet, Supabase's auto-refresh fails and emits
      // SIGNED_OUT / TOKEN_REFRESHED with a null session — that would log the user
      // out of the APK every time they open it without WiFi. Keep the cached
      // session so they can still play their downloaded songs.
      if (!nextSession && !navigator.onLine && event !== 'SIGNED_OUT') {
        setIsLoading(false);
        return;
      }
      // Also ignore an offline-driven SIGNED_OUT that wasn't user-initiated.
      // (A user-initiated signOut() also clears state in the signOut callback.)
      if (event === 'SIGNED_OUT' && !navigator.onLine) {
        setIsLoading(false);
        return;
      }

      // Cached role/routing decisions belong to the previous identity.
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        clearAccessCache();
      }

      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      setSentryUser(nextSession?.user ? { id: nextSession.user.id, email: nextSession.user.email } : null);

      if (nextSession?.user) {
        setTimeout(() => {
          void Promise.allSettled([
            ensureUserProfile(nextSession.user),
            checkAdminRole(nextSession.user.id),
            loadEmailVerified(nextSession.user.id),
          ]);
        }, 0);
      } else {
        setIsAdmin(false);
        setEmailVerified(null);
      }

      setIsLoading(false);
    });

    supabase.auth.getSession().then(async ({ data: { session: existingSession } }) => {
      setSession(existingSession);
      setUser(existingSession?.user ?? null);

      if (existingSession?.user) {
        await Promise.allSettled([
          ensureUserProfile(existingSession.user),
          checkAdminRole(existingSession.user.id),
          loadEmailVerified(existingSession.user.id),
        ]);

        // Validate the refresh token while online. If it's invalid (signed out
        // elsewhere, rotated keys, stale session), sign out cleanly instead of
        // looping on 401s from authenticated edge functions like music-indexer.
        if (navigator.onLine) {
          void supabase.auth.refreshSession().then(({ error: refreshErr }) => {
            if (refreshErr) return supabase.auth.signOut().then(() => undefined).catch(() => undefined);
            return undefined;
          });
        }
      }

      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [checkAdminRole, ensureUserProfile, loadEmailVerified]);

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        const { auditLog } = await import('@/lib/auditLog');
        auditLog.loginFailed(email, error.message);
        return { error: new Error(getAuthError(error)) };
      }

      if (data.user) {
        await ensureUserProfile(data.user);

        const { data: profile } = await supabase
          .from('profiles')
          .select('status, email_verified')
          .eq('user_id', data.user.id)
          .maybeSingle();

        // Banned / suspended — always block, sign out and surface error.
        if (profile?.status === 'banned') {
          await supabase.auth.signOut();
          return { error: new Error('Your account has been banned. Contact support for help.') };
        }
        if (profile?.status === 'suspended') {
          await supabase.auth.signOut();
          return { error: new Error('Your account is temporarily suspended. Please try again later.') };
        }

        // Unverified: keep the session alive so the verification screen can
        // poll + auto-advance once they tap the email link. The route gate
        // redirects them to /check-email until profile.email_verified flips.
        if (profile && profile.email_verified === false) {
          localStorage.setItem('uf_pending_verify_email', email);
          return { error: new Error('EMAIL_NOT_VERIFIED') };
        }

        const { auditLog } = await import('@/lib/auditLog');
        auditLog.loginSuccess(email);
      }

      const admin = data.user ? await checkAdminRole(data.user.id) : false;
      return { error: null, isAdmin: admin };
    } catch (error) {
      return { error: new Error(getAuthError(error)) };
    }
  }, [checkAdminRole, ensureUserProfile]);

  const signUp = useCallback(async (
    email: string,
    password: string,
    username: string,
    countryCode?: string,
    extraMetadata: Record<string, unknown> = {},
  ) => {
    try {
      const trimmedUsername = username.trim();
      if (trimmedUsername.length < 3 || trimmedUsername.length > 20) {
        return { error: new Error('Username must be 3-20 characters') };
      }
      if (!/^[a-zA-Z0-9_.]+$/.test(trimmedUsername)) {
        return { error: new Error('Username can only contain letters, numbers, dots and underscores') };
      }

      // Pre-flight uniqueness check (case-insensitive). Race-safe because the DB has a unique index too.
      const { data: existing } = await supabase
        .from('profiles')
        .select('user_id')
        .ilike('username', trimmedUsername)
        .maybeSingle();
      if (existing) {
        return { error: new Error('That username is already taken') };
      }

      const { data: signUpData, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: window.location.origin,
          data: {
            ...extraMetadata,
            username: trimmedUsername,
            country_code: countryCode ? countryCode.toUpperCase().slice(0, 2) : undefined,
          },
        },
      });

      if (error) {
        // The unique-username DB index throws this if there was a race
        if (/duplicate key|unique constraint|profiles_username_lower_unique/i.test(error.message)) {
          return { error: new Error('That username is already taken') };
        }
        return { error: new Error(getAuthError(error)) };
      }

      // Avatars are rendered from initials + a deterministic gradient per user id.
      // No animated presets, no storage, no cost. Nothing to assign here.

      // Keep the freshly-created Supabase session alive so that once the user
      // clicks the verification link they land back in the app already signed
      // in. Access to protected routes is gated by `profiles.email_verified`
      // (see ProtectedRoute) — not by the absence of a session.
      localStorage.setItem('uf_pending_verify_email', email);

      return { error: null };
    } catch (error) {
      return { error: new Error(getAuthError(error)) };
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await supabase.auth.signOut();
    } finally {
      setUser(null);
      setSession(null);
      setIsAdmin(false);
      setEmailVerified(null);
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, session, isAdmin, emailVerified, isLoading, isOffline, signIn, signUp, signOut, refreshEmailVerified }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
};
