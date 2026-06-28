import { memo, useCallback, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { Flame, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Song, usePlayer } from '@/contexts/PlayerContext';
import { getGeoTopTracks, prefetchIndexedTrack, type IndexedTrack } from '@/lib/musicIndexer';
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

function detectFallbackCountry(): string {
  try {
    const locale = (Intl.DateTimeFormat().resolvedOptions().locale || '').toUpperCase();
    const m = locale.match(/-([A-Z]{2})\b/);
    return m?.[1] || 'IN';
  } catch {
    return 'IN';
  }
}

// Deezer's public API does not send CORS headers, so calling it from the
// browser is blocked and pollutes the console. Trending uses Last.fm only.


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

  // Real trending tracks only: live chart metadata + YouTube Music search + JioSaavn search.
  // No manual/admin pinned rows, no mocked fallback list.
  const { data: tracks = [], isLoading: loading } = useQuery({

    queryKey: ['trending-tracks-real', country ?? ''],
    enabled: !!country,
    staleTime: 2 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchInterval: 3 * 60 * 1000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    queryFn: async () => {
      const TARGET = 24;
      const name = COUNTRY_NAMES[country!] || COUNTRY_NAMES.IN;

      // ONLY real charts — Last.fm geo top + Deezer global chart.
      // No keyword YouTube/JioSaavn searches: those returned random/unpopular results.
      const [geoRes, deezerRes] = await Promise.allSettled([
        getGeoTopTracks(name, TARGET * 2),
        getDeezerChart(TARGET),
      ]);

      const geo = geoRes.status === 'fulfilled' ? geoRes.value : [];
      const deezer = deezerRes.status === 'fulfilled' ? deezerRes.value : [];

      // Quality gate: Last.fm tracks must have meaningful listenership.
      // Deezer chart is curated by Deezer so it's trusted as-is.
      const MIN_LISTENERS = 25_000;
      const geoFiltered = geo.filter((t) => !t.listeners || t.listeners >= MIN_LISTENERS);

      const merged: IndexedTrack[] = [];
      const seenKeys = new Set<string>();
      const norm = (s = '') => s.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 70);
      const add = (track?: IndexedTrack) => {
        if (!track?.title || !track.artist || !track.cover_url) return;
        const key = `${norm(track.artist)}|${norm(track.title)}`;
        if (seenKeys.has(key)) return;
        seenKeys.add(key);
        merged.push(track);
      };
      const max = Math.max(geoFiltered.length, deezer.length);
      for (let i = 0; i < max && merged.length < TARGET; i++) {
        add(geoFiltered[i]);
        add(deezer[i]);
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
