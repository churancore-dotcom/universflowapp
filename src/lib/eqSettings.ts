import { useEffect, useSyncExternalStore } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { StudioSpaceId } from '@/lib/audioEngine';

export const EQ_SETTINGS_KEY = 'eq_settings';

export interface EQSettings {
  bands: number[];
  bassBoost: number;
  reverb: number;
  playbackSpeed: number;
  spatialAudio: boolean;
  studioSpace: StudioSpaceId;
  lateNight: boolean;
  headphoneSurround: boolean;
  activePreset: string;
}

export const DEFAULT_EQ_SETTINGS: EQSettings = {
  bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  bassBoost: 0,
  reverb: 0,
  playbackSpeed: 1,
  spatialAudio: false,
  studioSpace: 'off',
  lateNight: false,
  headphoneSurround: false,
  activePreset: 'flat',
};

const listeners = new Set<() => void>();
let currentSettings: EQSettings = readLocalSettings();

function clamp(value: unknown, min: number, max: number, fallback: number) {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, n));
}

export function normalizeEQSettings(input: Partial<EQSettings> | null | undefined): EQSettings {
  const rawBands = Array.isArray(input?.bands) ? input!.bands : DEFAULT_EQ_SETTINGS.bands;
  const bands = DEFAULT_EQ_SETTINGS.bands.map((fallback, i) => clamp(rawBands[i], -12, 12, fallback));
  return {
    bands,
    bassBoost: clamp(input?.bassBoost, 0, 100, DEFAULT_EQ_SETTINGS.bassBoost),
    reverb: clamp(input?.reverb, 0, 45, DEFAULT_EQ_SETTINGS.reverb),
    playbackSpeed: clamp(input?.playbackSpeed, 0.5, 2, DEFAULT_EQ_SETTINGS.playbackSpeed),
    spatialAudio: !!input?.spatialAudio,
    studioSpace: (input?.studioSpace as StudioSpaceId) || DEFAULT_EQ_SETTINGS.studioSpace,
    lateNight: !!input?.lateNight,
    headphoneSurround: !!input?.headphoneSurround,
    activePreset: input?.activePreset || DEFAULT_EQ_SETTINGS.activePreset,
  };
}

function readLocalSettings(): EQSettings {
  try {
    const stored = localStorage.getItem(EQ_SETTINGS_KEY);
    if (stored) return normalizeEQSettings(JSON.parse(stored));
  } catch {}
  return DEFAULT_EQ_SETTINGS;
}

function writeLocalSettings(settings: EQSettings) {
  try {
    localStorage.setItem(EQ_SETTINGS_KEY, JSON.stringify(settings));
  } catch {}
}

export function getEQSettings() {
  return currentSettings;
}

export function setEQSettings(update: Partial<EQSettings> | ((current: EQSettings) => EQSettings | Partial<EQSettings>)) {
  const patch = typeof update === 'function' ? update(currentSettings) : update;
  const next = normalizeEQSettings({ ...currentSettings, ...patch });
  if (JSON.stringify(next) === JSON.stringify(currentSettings)) return;
  currentSettings = next;
  writeLocalSettings(next);
  listeners.forEach((listener) => listener());
  try { window.dispatchEvent(new CustomEvent('uf-eq-changed', { detail: next })); } catch {}
}

export function subscribeEQSettings(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useEQSettings() {
  return useSyncExternalStore(subscribeEQSettings, getEQSettings, getEQSettings);
}

/**
 * True when the user has any audio processing turned on. When this is FALSE
 * (flat EQ, no reverb, no spatial, no studio space, no late-night, 1x speed)
 * the player MUST play directly through HTMLAudioElement and NOT through
 * the WebAudio graph — otherwise Android WebView suspends the AudioContext
 * on lock screen / background and audio gaps 2-4s.
 */
export function isEqActive(settings = currentSettings): boolean {
  if (hasWebAudioEffects(settings)) return true;
  if (settings.playbackSpeed && settings.playbackSpeed !== 1) return true;
  return false;
}

export function hasWebAudioEffects(settings = currentSettings): boolean {
  if (!settings) return false;
  if (settings.bands?.some((gain) => Math.abs(gain) >= 0.5)) return true;
  if (settings.bassBoost > 0) return true;
  if (settings.reverb > 0) return true;
  if (settings.spatialAudio) return true;
  if (settings.studioSpace && settings.studioSpace !== 'off') return true;
  if (settings.lateNight) return true;
  if (settings.headphoneSurround) return true;
  return false;
}

export function getEQPresetLabel(settings = currentSettings) {
  if (settings.activePreset && settings.activePreset !== 'custom') return settings.activePreset.replace(/-/g, ' ');
  if (settings.studioSpace && settings.studioSpace !== 'off') return settings.studioSpace.replace(/-/g, ' ');
  if (isEqActive(settings)) return 'custom';
  return 'flat';
}

export function useUserEQSettingsSync(userId?: string | null) {
  useEffect(() => {
    if (!userId) return;

    let cancelled = false;
    let saveTimer: number | null = null;
    let lastRemoteJSON = '';

    const loadRemote = async () => {
      const { data } = await supabase
        .from('user_eq_settings')
        .select('settings, updated_at')
        .eq('user_id', userId)
        .maybeSingle();
      if (cancelled) return;
      if (data?.settings) {
        const remote = normalizeEQSettings(data.settings as Partial<EQSettings>);
        lastRemoteJSON = JSON.stringify(remote);
        setEQSettings(remote);
      } else {
        await supabase.from('user_eq_settings').upsert({ user_id: userId, settings: getEQSettings() as never }, { onConflict: 'user_id' });
      }
    };

    const unsubscribe = subscribeEQSettings(() => {
      const settings = getEQSettings();
      const json = JSON.stringify(settings);
      if (json === lastRemoteJSON) return;
      if (saveTimer) window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(async () => {
        lastRemoteJSON = JSON.stringify(getEQSettings());
        await supabase.from('user_eq_settings').upsert({ user_id: userId, settings: getEQSettings() as never }, { onConflict: 'user_id' });
      }, 350);
    });

    const channel = supabase
      .channel(`user-eq-settings-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_eq_settings', filter: `user_id=eq.${userId}` }, (payload) => {
        const settings = normalizeEQSettings((payload.new as { settings?: unknown })?.settings);
        lastRemoteJSON = JSON.stringify(settings);
        setEQSettings(settings);
      })
      .subscribe();

    loadRemote();

    return () => {
      cancelled = true;
      if (saveTimer) window.clearTimeout(saveTimer);
      unsubscribe();
      supabase.removeChannel(channel);
    };
  }, [userId]);
}