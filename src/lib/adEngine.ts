// Ad engine — decides WHEN an ad break happens and which campaign runs.
//
// Rules that keep playback fast (the #1 user complaint):
//  * Ads NEVER block a user tap. They only fire on auto-advance, i.e. between
//    songs, after a song finished playing.
//  * Premium users never see an ad (checked against runtime premium state,
//    which is written only after a server fetch).
//  * Everything the admin controls (image, duration, interval, skip) lives in
//    the ad_campaigns table, so no redeploy is needed to change a campaign.

import { supabase } from '@/integrations/supabase/client';
import { getRuntimePremium } from '@/lib/premiumState';

export interface AdCampaign {
  id: string;
  name: string;
  advertiser: string | null;
  kind: 'premium' | 'brand';
  headline: string;
  subtext: string | null;
  image_url: string | null;
  cta_label: string;
  cta_url: string;
  duration_seconds: number;
  songs_interval: number;
  skippable: boolean;
  skip_after_seconds: number;
  is_active: boolean;
  priority: number;
  starts_at: string | null;
  ends_at: string | null;
}

const COUNTER_KEY = 'uf_ad_songs_since_v1';
const CACHE_TTL = 5 * 60 * 1000;

let cached: AdCampaign | null = null;
let cachedAt = 0;
let inflight: Promise<AdCampaign | null> | null = null;

const SELECT_COLS =
  'id,name,advertiser,kind,headline,subtext,image_url,cta_label,cta_url,duration_seconds,songs_interval,skippable,skip_after_seconds,is_active,priority,starts_at,ends_at';

const isLive = (c: AdCampaign): boolean => {
  const now = Date.now();
  if (c.starts_at && new Date(c.starts_at).getTime() > now) return false;
  if (c.ends_at && new Date(c.ends_at).getTime() < now) return false;
  return c.is_active;
};

/** Fetches (and caches) the highest-priority live campaign. */
export const loadAdCampaign = async (force = false): Promise<AdCampaign | null> => {
  if (!force && cached && Date.now() - cachedAt < CACHE_TTL) return cached;
  if (inflight && !force) return inflight;
  inflight = (async () => {
    try {
      const { data, error } = await supabase
        .from('ad_campaigns')
        .select(SELECT_COLS)
        .eq('is_active', true)
        .order('priority', { ascending: false })
        .limit(10);
      if (error) throw error;
      const live = ((data ?? []) as unknown as AdCampaign[]).filter(isLive);
      cached = live[0] ?? null;
      cachedAt = Date.now();
    } catch {
      // Network/RLS failure must never break playback — just no ads.
      cached = cached ?? null;
      cachedAt = Date.now();
    } finally {
      inflight = null;
    }
    return cached;
  })();
  return inflight;
};

/** Cached campaign for synchronous decisions (may be null before priming). */
export const getAdCampaignSync = (): AdCampaign | null => cached;

export const primeAdEngine = (): void => {
  if (getRuntimePremium()) return;
  void loadAdCampaign();
};

/** Clears the cache so admin edits show up immediately. */
export const invalidateAdCampaign = (): void => {
  cached = null;
  cachedAt = 0;
};

const readCounter = (): number => {
  try {
    return Number(localStorage.getItem(COUNTER_KEY) ?? '0') || 0;
  } catch {
    return 0;
  }
};

const writeCounter = (value: number): void => {
  try {
    localStorage.setItem(COUNTER_KEY, String(value));
  } catch {
    /* ignore */
  }
};

export const resetAdCounter = (): void => writeCounter(0);

/**
 * Call once for every song that finished playing.
 * Returns true when the next song should be preceded by an ad break.
 */
export const noteSongCompleted = (): boolean => {
  if (getRuntimePremium()) {
    writeCounter(0);
    return false;
  }
  const campaign = cached;
  // Keep the cache warm for the next break even if we can't show one now.
  primeAdEngine();
  const next = readCounter() + 1;
  if (!campaign) {
    writeCounter(next);
    return false;
  }
  const interval = Math.max(1, campaign.songs_interval);
  if (next < interval) {
    writeCounter(next);
    return false;
  }
  writeCounter(0);
  return true;
};

export type AdAction = 'view' | 'skip' | 'click' | 'complete';

export const recordAdEvent = (campaignId: string, action: AdAction): void => {
  supabase.rpc('record_ad_event', { _campaign_id: campaignId, _action: action }).then(
    () => {},
    () => {},
  );
};
