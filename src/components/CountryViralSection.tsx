import { memo, useCallback, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { Flame, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Song, usePlayer } from '@/contexts/PlayerContext';
import { getGeoTopTracks, getTopIndexedTracks, prefetchIndexedTrack, type IndexedTrack } from '@/lib/musicIndexer';
import { triggerHaptic } from '@/hooks/useHaptics';
import { detectCountrySilently } from '@/lib/geoCountry';

// ISO-3166 alpha-2 → English country name (limited to common Last.fm-supported names)
const COUNTRY_NAMES: Record<string, string> = {
  IN: 'India', US: 'United States', GB: 'United Kingdom', CA: 'Canada', AU: 'Australia',
  DE: 'Germany', FR: 'France', BR: 'Brazil', MX: 'Mexico', JP: 'Japan', KR: 'South Korea',
  ES: 'Spain', IT: 'Italy', NL: 'Netherlands', SE: 'Sweden', NO: 'Norway', PL: 'Poland',
  RU: 'Russia', PT: 'Portugal', AR: 'Argentina', CL: 'Chile', CO: 'Colombia', ZA: 'South Africa',
  NG: 'Nigeria', EG: 'Egypt', TR: 'Turkey', ID: 'Indonesia', PH: 'Philippines', TH: 'Thailand',
  VN: 'Vietnam', MY: 'Malaysia', SG: 'Singapore', PK: 'Pakistan', BD: 'Bangladesh', LK: 'Sri Lanka',
  NP: 'Nepal', AE: 'United Arab Emirates', SA: 'Saudi Arabia', IE: 'Ireland', NZ: 'New Zealand',
};

// Deezer's public API does not send CORS headers, so calling it from the
// browser is blocked and pollutes the console. Trending uses our aggregated
// chart cache first and never forces India/US as a hidden fallback.


const CountryViralSection = memo(function CountryViralSection() {
  const { user } = useAuth();
  const { currentSong, isPlaying, playSong, togglePlay } = usePlayer();


  // Country resolution is cached forever per user — it never changes mid-session.
  // Priority: explicit profile country → silent edge-IP detection → locale fallback.
  const { data: country } = useQuery({
    queryKey: ['viral-country', user?.id ?? 'anon'],
    queryFn: async () => {
      let cc: string | null = null;
      if (user) {
        const { data } = await supabase.from('profiles').select('country_code').eq('user_id', user.id).maybeSingle();
        cc = (data?.country_code || '').toUpperCase() || null;
      }
      if (cc) return cc;
      return await detectCountrySilently();
    },
    staleTime: Infinity,
    gcTime: Infinity,
  });

  // Real trending: aggregated Apple Music "Most Played" per country (via chart_tracks).
  // Last.fm geo is scrobble-spammed by fanbases, so we only use it as an empty-state fallback.
  const { data: tracks = [], isLoading: loading } = useQuery({

    queryKey: ['trending-tracks-real', country ?? 'GLOBAL'],
    enabled: country !== undefined,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    queryFn: async () => {
      const TARGET = 24;
      const norm = (s = '') => s.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 70);
      const seenKeys = new Set<string>();
      const merged: IndexedTrack[] = [];
      const add = (track?: Partial<IndexedTrack> & { title?: string; artist?: string; cover_url?: string | null }) => {
        if (!track?.title || !track.artist || !track.cover_url) return;
        const key = `${norm(track.artist)}|${norm(track.title)}`;
        if (seenKeys.has(key)) return;
        seenKeys.add(key);
        merged.push({
          id: `chart-trending-${key}`,
          title: track.title,
          artist: track.artist,
          cover_url: track.cover_url,
        } as IndexedTrack);
      };

      const chartCountry = country || 'GLOBAL';

      // 1) Aggregated chart_tracks (Apple Most-Played) for the user's country, then GLOBAL.
      const readAggregated = async (cc: string) => {
        const { data } = await supabase
          .from('chart_tracks')
          .select('title, artist, cover_url, rank')
          .eq('chart_type', 'trending')
          .eq('country_code', cc)
          .order('rank', { ascending: true })
          .limit(TARGET * 2);
        return data ?? [];
      };

      let rows = await readAggregated(chartCountry).catch(() => [] as any[]);
      if (rows.length === 0 && chartCountry !== 'GLOBAL') {
        rows = await readAggregated('GLOBAL').catch(() => [] as any[]);
      }
      // Per-artist cap so a single act can't own the rail.
      const perArtist: Record<string, number> = {};
      for (const r of rows) {
        const a = norm(r.artist);
        if ((perArtist[a] || 0) >= 2) continue;
        perArtist[a] = (perArtist[a] || 0) + 1;
        add(r);
        if (merged.length >= TARGET) break;
      }

      // 2) Empty-state fallback ONLY: app-wide indexed top tracks, then Last.fm
      // geo for known countries. Never silently falls back to India.
      if (merged.length === 0) {
        const top = await getTopIndexedTracks(TARGET * 2).catch(() => [] as IndexedTrack[]);
        for (const t of top) {
          add(t);
          if (merged.length >= TARGET) break;
        }
      }

      if (merged.length === 0 && chartCountry !== 'GLOBAL' && COUNTRY_NAMES[chartCountry]) {
        const geo = await getGeoTopTracks(COUNTRY_NAMES[chartCountry], TARGET * 2).catch(() => [] as IndexedTrack[]);
        const MIN_LISTENERS = 25_000;
        for (const t of geo.filter((x) => !x.listeners || x.listeners >= MIN_LISTENERS)) {
          add(t);
          if (merged.length >= TARGET) break;
        }
      }

      return merged.slice(0, TARGET);
    },
  });

  // Pre-resolve top 6 streams so taps feel instant
  useEffect(() => {
    tracks.slice(0, 6).forEach((t) => prefetchIndexedTrack(t.artist, t.title));
  }, [tracks]);

  // ── Silent time/day personalization (zero-PII) ──
  // Deterministically rotate which slice of the chart we show based on the
  // user's local hour bucket + weekday. No tracking, no storage, just a
  // different "view" of the same public chart so the feed feels alive.
  const { label, rotated } = useMemo(() => {
    const now = new Date();
    const h = now.getHours();
    const dow = now.getDay();
    const isWeekend = dow === 0 || dow === 6;
    const dayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][dow];
    let b: 'morning'|'afternoon'|'evening'|'night';
    let timeWord: string;
    if (h < 6)        { b = 'night';     timeWord = 'Late Night'; }
    else if (h < 12)  { b = 'morning';   timeWord = 'Morning';    }
    else if (h < 17)  { b = 'afternoon'; timeWord = 'Afternoon';  }
    else if (h < 22)  { b = 'evening';   timeWord = 'Evening';    }
    else              { b = 'night';     timeWord = 'Tonight';    }
    const lbl = isWeekend
      ? `Trending this ${dayName} ${timeWord}`
      : `Trending ${timeWord}`;
    const bucketIdx = { morning:0, afternoon:1, evening:2, night:3 }[b];
    const offset = (bucketIdx * 3) % Math.max(tracks.length, 1);
    const rot = tracks.length > 0
      ? [...tracks.slice(offset), ...tracks.slice(0, offset)]
      : tracks;
    return { label: lbl, rotated: isWeekend ? [...rot].reverse() : rot };
  }, [tracks]);

  // Build queue from the *rotated* view so taps line up with what's visible.
  const queueAsSongs: Song[] = useMemo(() => rotated.map((t) => ({
    id: t.id,
    title: t.title,
    artist: t.artist,
    album: t.album,
    cover_url: t.cover_url,
    audio_url: t.audio_url || 'resolving',
    duration: t.duration,
    source: 'indexed' as const,
  })), [rotated]);

  const handleTap = useCallback((track: IndexedTrack, idx: number) => {
    triggerHaptic('impactLight');
    const song = queueAsSongs[idx];
    if (!song) return;
    if (currentSong?.id === song.id) togglePlay();
    else playSong(song, undefined, queueAsSongs);
  }, [queueAsSongs, currentSong?.id, togglePlay, playSong]);

  const hasViral = loading || rotated.length > 0;


  return (
    <div className="space-y-6">
      {hasViral && (
        <section className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <Flame className="w-4 h-4" style={{ color: '#FF6B2D' }} />
              <h2 className="text-sm font-bold text-foreground">{label}</h2>
            </div>
          </div>




          {loading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="flex gap-3 overflow-x-auto hide-scrollbar pb-1">
              {rotated.map((track, i) => {
                const active = currentSong?.id === track.id;
                return (
                  <button
                    key={track.id}
                    type="button"
                    onClick={() => handleTap(track, i)}
                    className="w-32 flex-shrink-0 text-left active:scale-[0.96] transition-transform"
                  >
                    <div className={`relative mb-2 aspect-square overflow-hidden rounded-3xl bg-muted/50 ${active ? 'ring-2 ring-primary' : ''}`}>
                      <img src={track.cover_url!} alt={`${track.title} cover`} className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
                      <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-md bg-black/60 backdrop-blur-md text-[10px] font-bold text-white">
                        #{i + 1}
                      </div>
                      {active && isPlaying && (
                        <div className="absolute bottom-1.5 right-1.5 rounded-full bg-primary px-1.5 py-0.5 text-[9px] font-bold text-primary-foreground">
                          ▶
                        </div>
                      )}
                    </div>
                    <p className={`truncate text-[12px] font-semibold ${active ? 'text-primary' : 'text-foreground'}`}>{track.title}</p>
                    <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{track.artist}</p>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      )}

    </div>
  );
});

export default CountryViralSection;
