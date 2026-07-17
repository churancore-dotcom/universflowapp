export type ArtistSocialLinks = {
  instagram?: string | null;
  youtube?: string | null;
  spotify?: string | null;
  apple_music?: string | null;
  tiktok?: string | null;
  twitter?: string | null;
  facebook?: string | null;
  soundcloud?: string | null;
  [key: string]: string | null | undefined;
};

export type ArtistProfile = {
  id: string;
  user_id: string;
  stage_name: string;
  slug: string;
  bio: string | null;
  avatar_url: string | null;
  banner_url: string | null;
  social_links: ArtistSocialLinks | null;
  tagline?: string | null;
  accent_color?: string | null;
  genres?: string[] | null;
  location?: string | null;
  pronouns?: string | null;
  website?: string | null;
};

export type ArtistSong = {
  id: string;
  title: string;
  cover_url: string | null;
  stream_url: string;
  duration: number | null;
  play_count: number;
  like_count: number;
  download_count: number;
  view_count: number;
  status: 'live' | 'taken_down';
  takedown_reason?: string | null;
  created_at: string;
};

export function fmt(n: number) {
  if (n == null || isNaN(n as unknown as number)) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}
