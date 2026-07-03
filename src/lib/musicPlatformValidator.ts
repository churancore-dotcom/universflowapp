// Validates a music-platform artist page URL. Accepts Spotify artist,
// Apple Music artist, YouTube channel/@handle/music, SoundCloud, Deezer,
// Amazon Music, Tidal, JioSaavn, Gaana. Everything else is rejected so
// spam links can't slip through verification.

export type MusicPlatform =
  | 'spotify' | 'apple_music' | 'youtube_music' | 'youtube' | 'soundcloud'
  | 'deezer' | 'amazon_music' | 'tidal' | 'jiosaavn' | 'gaana';

export interface MusicPlatformCheck {
  ok: boolean;
  platform: MusicPlatform | null;
  normalized: string;
  label: string;
  reason?: string;
}

const HOST_RULES: Array<{ host: RegExp; platform: MusicPlatform; label: string; pathHint?: RegExp }> = [
  { host: /(?:^|\.)open\.spotify\.com$/i,           platform: 'spotify',       label: 'Spotify Artist',       pathHint: /\/artist\/[a-z0-9]{15,}/i },
  { host: /(?:^|\.)spotify\.com$/i,                 platform: 'spotify',       label: 'Spotify Artist',       pathHint: /\/artist\/[a-z0-9]{15,}/i },
  { host: /(?:^|\.)music\.apple\.com$/i,            platform: 'apple_music',   label: 'Apple Music Artist',   pathHint: /\/artist\// },
  { host: /(?:^|\.)music\.youtube\.com$/i,          platform: 'youtube_music', label: 'YouTube Music Artist', pathHint: /\/channel\/UC[a-z0-9_-]{15,}/i },
  { host: /(?:^|\.)youtube\.com$/i,                 platform: 'youtube',       label: 'YouTube Channel',      pathHint: /\/(?:channel\/UC[a-z0-9_-]{15,}|@[a-z0-9._-]+|c\/[a-z0-9._-]+|user\/[a-z0-9._-]+)/i },
  { host: /(?:^|\.)youtu\.be$/i,                    platform: 'youtube',       label: 'YouTube' },
  { host: /(?:^|\.)soundcloud\.com$/i,              platform: 'soundcloud',    label: 'SoundCloud' },
  { host: /(?:^|\.)deezer\.com$/i,                  platform: 'deezer',        label: 'Deezer Artist',        pathHint: /\/artist\/\d+/ },
  { host: /(?:^|\.)music\.amazon\.(?:com|in|co\.uk|de)$/i, platform: 'amazon_music', label: 'Amazon Music Artist', pathHint: /\/artists\// },
  { host: /(?:^|\.)tidal\.com$/i,                   platform: 'tidal',         label: 'Tidal Artist',         pathHint: /\/artist\/\d+/ },
  { host: /(?:^|\.)jiosaavn\.com$/i,                platform: 'jiosaavn',      label: 'JioSaavn Artist' },
  { host: /(?:^|\.)saavn\.com$/i,                   platform: 'jiosaavn',      label: 'JioSaavn Artist' },
  { host: /(?:^|\.)gaana\.com$/i,                   platform: 'gaana',         label: 'Gaana Artist' },
];

const PLATFORM_LABEL: Record<MusicPlatform, string> = {
  spotify: 'Spotify Artist',
  apple_music: 'Apple Music Artist',
  youtube_music: 'YouTube Music Artist',
  youtube: 'YouTube Channel',
  soundcloud: 'SoundCloud',
  deezer: 'Deezer Artist',
  amazon_music: 'Amazon Music Artist',
  tidal: 'Tidal Artist',
  jiosaavn: 'JioSaavn Artist',
  gaana: 'Gaana Artist',
};

export function validateMusicPlatformUrl(raw: string): MusicPlatformCheck {
  const value = (raw || '').trim();
  if (!value) return { ok: false, platform: null, normalized: '', label: '', reason: 'Paste a link to your artist page.' };

  let normalized = value;
  if (!/^https?:\/\//i.test(normalized)) normalized = `https://${normalized}`;

  let url: URL;
  try { url = new URL(normalized); }
  catch { return { ok: false, platform: null, normalized: value, label: '', reason: 'This does not look like a valid URL.' }; }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, platform: null, normalized: value, label: '', reason: 'Only http/https links are allowed.' };
  }

  const rule = HOST_RULES.find((r) => r.host.test(url.host));
  if (!rule) {
    return {
      ok: false, platform: null, normalized: value, label: '',
      reason: 'Use your artist page on Spotify, Apple Music, YouTube, SoundCloud, Deezer, Amazon Music, Tidal, JioSaavn or Gaana.',
    };
  }

  if (rule.pathHint && !rule.pathHint.test(url.pathname)) {
    return {
      ok: false, platform: rule.platform, normalized: url.toString(), label: rule.label,
      reason: `That looks like a ${rule.label.split(' ')[0]} link, but not an artist page. Paste the URL of your artist profile.`,
    };
  }

  return {
    ok: true, platform: rule.platform, normalized: url.toString(), label: rule.label,
  };
}

export function musicPlatformLabel(platform: MusicPlatform | null | undefined): string {
  if (!platform) return 'Music platform';
  return PLATFORM_LABEL[platform] || 'Music platform';
}
