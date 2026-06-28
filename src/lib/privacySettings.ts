// Client-side privacy controls. Toggles live in localStorage so the gate is
// instant and works even offline. Clearing actions also hit the cloud tables.
import { supabase } from "@/integrations/supabase/client";
import { clearLocalRecent } from "@/lib/localRecentlyPlayed";

const PAUSE_HISTORY_KEY = "uf_pause_history";
const ANON_MODE_KEY = "uf_anonymous_mode";
const HIDE_EXPLICIT_KEY = "uf_hide_explicit";
const ROMANIZE_KEY = "uf_romanize_lyrics";
const LYRICS_PROVIDER_KEY = "uf_lyrics_provider"; // 'auto' | 'lrclib' | 'kugou' | 'netease'

export const isHistoryPaused = () => {
  try { return localStorage.getItem(PAUSE_HISTORY_KEY) === "true"; } catch { return false; }
};
export const setHistoryPaused = (val: boolean) => {
  try { localStorage.setItem(PAUSE_HISTORY_KEY, String(val)); } catch { /* ignore */ }
};

export const isAnonymousMode = () => {
  try { return localStorage.getItem(ANON_MODE_KEY) === "true"; } catch { return false; }
};
export const setAnonymousMode = (val: boolean) => {
  try { localStorage.setItem(ANON_MODE_KEY, String(val)); } catch { /* ignore */ }
};

export const isHideExplicit = () => {
  try { return localStorage.getItem(HIDE_EXPLICIT_KEY) === "true"; } catch { return false; }
};
export const setHideExplicit = (val: boolean) => {
  try { localStorage.setItem(HIDE_EXPLICIT_KEY, String(val)); } catch { /* ignore */ }
};

export const isRomanizeLyrics = () => {
  try { return localStorage.getItem(ROMANIZE_KEY) === "true"; } catch { return false; }
};
export const setRomanizeLyrics = (val: boolean) => {
  try { localStorage.setItem(ROMANIZE_KEY, String(val)); } catch { /* ignore */ }
};

export type LyricsProvider = "auto" | "lrclib" | "kugou" | "netease";
export const getLyricsProvider = (): LyricsProvider => {
  try { return (localStorage.getItem(LYRICS_PROVIDER_KEY) as LyricsProvider) || "auto"; } catch { return "auto"; }
};
export const setLyricsProvider = (val: LyricsProvider) => {
  try { localStorage.setItem(LYRICS_PROVIDER_KEY, val); } catch { /* ignore */ }
};

/** Wipes both local Jump Back In and cloud listening history for the current user. */
export async function clearListeningHistory(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    clearLocalRecent(null);
    return;
  }
  clearLocalRecent(user.id);
  await Promise.allSettled([
    supabase.from("recently_played").delete().eq("user_id", user.id),
    supabase.from("song_play_events").delete().eq("user_id", user.id),
  ]);
  window.dispatchEvent(new CustomEvent("universflow:recently-played-changed"));
}
