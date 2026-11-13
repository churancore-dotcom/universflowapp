import { useState, useEffect, useCallback, useContext } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AuthContext } from '@/contexts/AuthContext';
import { setRuntimePremium } from '@/lib/premiumState';

export type SubscriptionType = 'free' | 'premium_monthly' | 'premium_yearly';
export type SubscriptionStatus = 'active' | 'expired' | 'cancelled' | 'pending';

interface Subscription {
  id: string;
  subscription_type: SubscriptionType;
  status: SubscriptionStatus;
  expires_at: string | null;
  platform: string;
}

type SubscriptionRow = Record<string, unknown> | null;

interface UsePremiumReturn {
  isPremium: boolean;
  subscription: Subscription | null;
  verifiedStatus: boolean;
  subscriptionRow: SubscriptionRow;
  lastRealtimeUpdate: string | null;
  lastCheckedAt: string | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

const CACHE_KEY = 'uf_premium_cache_v1';

interface CachedPremium {
  userId: string;
  subscription: Subscription | null;
  cachedAt: number;
}

const readCache = (userId: string | undefined): Subscription | null | undefined => {
  if (!userId) return undefined;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as CachedPremium;
    if (parsed.userId !== userId) return undefined;
    if (Date.now() - parsed.cachedAt > 24 * 60 * 60 * 1000) return undefined;
    return parsed.subscription;
  } catch {
    return undefined;
  }
};

const writeCache = (userId: string, subscription: Subscription | null) => {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ userId, subscription, cachedAt: Date.now() } satisfies CachedPremium),
    );
  } catch { /* ignore */ }
};

// ---- Singleton store: ONE fetch + ONE realtime channel for the whole app ----
interface PremiumState {
  isPremium: boolean;
  subscription: Subscription | null;
  subscriptionRow: SubscriptionRow;
  lastRealtimeUpdate: string | null;
  lastCheckedAt: string | null;
  isLoading: boolean;
  error: Error | null;
}

const initialState: PremiumState = {
  isPremium: false,
  subscription: null,
  subscriptionRow: null,
  lastRealtimeUpdate: null,
  lastCheckedAt: null,
  isLoading: true,
  error: null,
};

let store: PremiumState = { ...initialState };
const subscribers = new Set<(s: PremiumState) => void>();
let currentUserId: string | null = null;
let currentChannel: ReturnType<typeof supabase.channel> | null = null;
let inflight: Promise<void> | null = null;
let lastFetchAt = 0;

const emit = () => {
  subscribers.forEach((cb) => { try { cb(store); } catch { /* noop */ } });
};

const setStore = (patch: Partial<PremiumState>) => {
  store = { ...store, ...patch };
  emit();
};

let identityGeneration = 0;
let inflightUserId: string | null = null;
let expiryTimer: ReturnType<typeof setTimeout> | null = null;

const scheduleExpiryRefresh = (userId: string, expiresAt: string | null | undefined) => {
  if (expiryTimer) { clearTimeout(expiryTimer); expiryTimer = null; }
  if (!expiresAt) return;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return;
  // setTimeout caps at ~24.8 days; re-check at most daily until expiry.
  expiryTimer = setTimeout(() => {
    expiryTimer = null;
    if (currentUserId === userId) void fetchOnce(userId);
  }, Math.min(ms + 1000, 24 * 60 * 60 * 1000));
};

const fetchOnce = async (userId: string | null): Promise<void> => {
  if (!userId) {
    setStore({ ...initialState, isLoading: false });
    setRuntimePremium(false);
    try { localStorage.removeItem(CACHE_KEY); } catch { /* ignore */ }
    return;
  }
  if (inflight && inflightUserId === userId) return inflight;
  const generation = identityGeneration;
  const isCurrent = () => generation === identityGeneration && currentUserId === userId;
  inflightUserId = userId;
  const run = (async () => {
    try {
      const [premiumResult, subscriptionResult] = await Promise.all([
        supabase.rpc('has_premium_subscription', { _user_id: userId }),
        supabase.from('user_subscriptions').select('*').eq('user_id', userId).maybeSingle(),
      ]);
      if (premiumResult.error) throw premiumResult.error;
      if (subscriptionResult.error) throw subscriptionResult.error;

      const verified = premiumResult.data === true;
      let next: Subscription | null = null;
      const row = subscriptionResult.data ?? null;
      if (row) {
        const isExpired = row.expires_at && new Date(row.expires_at) < new Date();
        next = {
          id: row.id,
          subscription_type: row.subscription_type as SubscriptionType,
          status: isExpired ? 'expired' : (row.status as SubscriptionStatus),
          expires_at: row.expires_at,
          platform: row.platform,
        };
      }
      if (!isCurrent()) return;
      writeCache(userId, next);
      scheduleExpiryRefresh(userId, verified ? row?.expires_at : null);
      setStore({
        isPremium: verified,
        subscription: next,
        subscriptionRow: row as SubscriptionRow,
        lastCheckedAt: new Date().toISOString(),
        isLoading: false,
        error: null,
      });
      setRuntimePremium(verified);
      lastFetchAt = Date.now();
    } catch (err) {
      if (!isCurrent()) return;
      setStore({
        isPremium: false,
        error: err instanceof Error ? err : new Error('Failed to fetch subscription'),
        isLoading: false,
      });
      setRuntimePremium(false);
    } finally {
      if (inflight === run) { inflight = null; inflightUserId = null; }
    }
  })();
  inflight = run;
  return run;
};

const bindUser = (userId: string | null) => {
  if (currentUserId === userId) return;
  currentUserId = userId;
  identityGeneration += 1;
  if (expiryTimer) { clearTimeout(expiryTimer); expiryTimer = null; }
  if (currentChannel) {
    try { supabase.removeChannel(currentChannel); } catch { /* noop */ }
    currentChannel = null;
  }
  if (!userId) {
    setStore({ ...initialState, isLoading: false });
    setRuntimePremium(false);
    return;
  }
  // Seed from cache instantly
  // Never carry the previous account's entitlement into this one.
  setStore({ ...initialState, isLoading: true });
  setRuntimePremium(false);
  const cached = readCache(userId);
  if (cached !== undefined) {
    setStore({ subscription: cached ?? null });
  }
  void fetchOnce(userId);
  currentChannel = supabase
    .channel(`premium-status-${userId}`)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'user_subscriptions',
      filter: `user_id=eq.${userId}`,
    }, () => {
      setStore({ lastRealtimeUpdate: new Date().toISOString() });
      void fetchOnce(userId);
    })
    .subscribe();
};

// Soft refetch when the user returns to the tab if data is stale.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    const expired = store.isPremium && store.subscription?.expires_at && new Date(store.subscription.expires_at).getTime() <= Date.now();
    if (document.visibilityState === 'visible' && currentUserId && (expired || Date.now() - lastFetchAt > 5 * 60 * 1000)) {
      void fetchOnce(currentUserId);
    }
  });
}

export const usePremium = (): UsePremiumReturn => {
  const authContext = useContext(AuthContext);
  const user = authContext?.user ?? null;
  const [snapshot, setSnapshot] = useState<PremiumState>(store);

  useEffect(() => {
    bindUser(user?.id ?? null);
  }, [user?.id]);

  useEffect(() => {
    const cb = (s: PremiumState) => setSnapshot(s);
    subscribers.add(cb);
    setSnapshot(store);
    return () => { subscribers.delete(cb); };
  }, []);

  const refetch = useCallback(async () => {
    await fetchOnce(currentUserId);
  }, []);

  return {
    isPremium: snapshot.isPremium,
    subscription: snapshot.subscription,
    verifiedStatus: snapshot.isPremium,
    subscriptionRow: snapshot.subscriptionRow,
    lastRealtimeUpdate: snapshot.lastRealtimeUpdate,
    lastCheckedAt: snapshot.lastCheckedAt,
    isLoading: snapshot.isLoading,
    error: snapshot.error,
    refetch,
  };
};

export default usePremium;
