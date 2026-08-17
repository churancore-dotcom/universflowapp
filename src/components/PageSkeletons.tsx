import { memo } from 'react';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * App-wide skeleton screens. All shimmer styling lives in the shared
 * `<Skeleton />` primitive so every loading state looks identical.
 */

const Row = ({ delay = 0 }: { delay?: number }) => (
  <div
    className="flex items-center gap-3 px-3 py-2.5 rounded-2xl"
    style={{ animation: `fade-in 0.32s ease-out ${delay}s both` }}
  >
    <Skeleton className="w-12 h-12 rounded-xl flex-shrink-0" />
    <div className="flex-1 min-w-0 space-y-1.5">
      <Skeleton className="h-3.5 w-3/4 rounded-md" />
      <Skeleton className="h-2.5 w-1/2 rounded-md" />
    </div>
    <Skeleton className="w-7 h-7 rounded-full flex-shrink-0" />
  </div>
);

// Shimmery section-header line — mirrors the real "Title · subtitle · See all" row.
const RailHeader = ({ wide = false }: { wide?: boolean }) => (
  <div className="flex items-center justify-between mb-3 px-1">
    <div className="space-y-1.5">
      <Skeleton className={`h-3.5 ${wide ? 'w-40' : 'w-28'} rounded-md`} />
      <Skeleton className="h-2.5 w-20 rounded-md" />
    </div>
    <Skeleton className="h-2.5 w-12 rounded-md" />
  </div>
);

// ── Home — bento hero + multiple horizontal rails + artist circles + viral list
// Matches the real Home composition: hero panel, recently played,
// TrendingNow, FreshReleases, FeaturedArtists circles, MadeForYou.
export const HomeSkeleton = memo(() => (
  <div className="space-y-5 font-body" style={{ animation: 'fade-in 0.32s ease-out both' }}>
    {/* Bento hero — Continue Listening card (~180px) */}
    <div className="relative rounded-3xl overflow-hidden p-5 h-[180px] border border-white/[0.06] bg-white/[0.025]">
      <div className="flex items-start gap-4">
        <div className="flex-1 min-w-0 space-y-2.5">
          <Skeleton className="h-2.5 w-24 rounded-md" />
          <Skeleton className="h-6 w-4/5 rounded-md" />
          <Skeleton className="h-3 w-1/2 rounded-md" />
        </div>
        <Skeleton className="w-[88px] h-[88px] rounded-xl flex-shrink-0" />
      </div>
      <div className="flex items-center gap-3 mt-7">
        <Skeleton className="w-10 h-10 rounded-full flex-shrink-0" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-[3px] w-full rounded-full" />
          <div className="flex justify-between">
            <Skeleton className="h-2 w-8 rounded-md" />
            <Skeleton className="h-2 w-8 rounded-md" />
          </div>
        </div>
      </div>
    </div>

    {/* Bento 2-col big tiles (~210px) — Featured + Up Next */}
    <div className="grid grid-cols-2 gap-3">
      {Array.from({ length: 2 }).map((_, i) => (
        <div
          key={`big-${i}`}
          className="rounded-3xl overflow-hidden h-[210px] border border-white/[0.06] bg-white/[0.025] p-4 flex flex-col justify-between"
          style={{ animation: `fade-in 0.32s ease-out ${0.04 + i * 0.04}s both` }}
        >
          <Skeleton className="h-2.5 w-16 rounded-md" />
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-4/5 rounded-md" />
            <Skeleton className="h-2.5 w-1/2 rounded-md" />
          </div>
        </div>
      ))}
    </div>

    {/* Bento 2-col mid tiles (~178px) — Moods + Quick actions */}
    <div className="grid grid-cols-2 gap-3">
      {Array.from({ length: 2 }).map((_, i) => (
        <div
          key={`mid-${i}`}
          className="rounded-3xl h-[178px] border border-white/[0.06] bg-white/[0.025] p-4 space-y-2.5"
          style={{ animation: `fade-in 0.32s ease-out ${0.10 + i * 0.04}s both` }}
        >
          <Skeleton className="h-2.5 w-14 rounded-md" />
          <Skeleton className="h-3 w-3/4 rounded-md" />
          <div className="space-y-1.5 pt-1">
            {Array.from({ length: 3 }).map((__, k) => (
              <div key={k} className="flex items-center gap-2">
                <Skeleton className="w-7 h-7 rounded-md flex-shrink-0" />
                <Skeleton className="h-2.5 flex-1 rounded-md" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>

    {/* Fresh Releases — horizontal rail, 130×130 cards */}
    <div style={{ animation: 'fade-in 0.32s ease-out 0.18s both' }}>
      <RailHeader />
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex-shrink-0 w-[130px] space-y-2">
            <Skeleton className="w-[130px] h-[130px] rounded-2xl" />
            <Skeleton className="h-3 w-24 rounded-md" />
            <Skeleton className="h-2.5 w-16 rounded-md" />
          </div>
        ))}
      </div>
    </div>

    {/* Trending Now — horizontal rail */}
    <div style={{ animation: 'fade-in 0.32s ease-out 0.22s both' }}>
      <RailHeader wide />
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex-shrink-0 w-[130px] space-y-2">
            <Skeleton className="w-[130px] h-[130px] rounded-2xl" />
            <Skeleton className="h-3 w-20 rounded-md" />
            <Skeleton className="h-2.5 w-14 rounded-md" />
          </div>
        ))}
      </div>
    </div>

    {/* Featured Artists — circles rail */}
    <div style={{ animation: 'fade-in 0.32s ease-out 0.26s both' }}>
      <RailHeader />
      <div className="flex gap-4 overflow-hidden">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex-shrink-0 flex flex-col items-center gap-2 w-[78px]">
            <Skeleton className="w-[72px] h-[72px] rounded-full" />
            <Skeleton className="h-2.5 w-14 rounded-md" />
          </div>
        ))}
      </div>
    </div>


    {/* Country Viral — list rows */}
    <div style={{ animation: 'fade-in 0.32s ease-out 0.30s both' }}>
      <RailHeader wide />
      <div className="space-y-1">
        {Array.from({ length: 4 }).map((_, i) => (
          <Row key={i} delay={0.32 + i * 0.03} />
        ))}
      </div>
    </div>
  </div>
));
HomeSkeleton.displayName = 'HomeSkeleton';

// ── Library list — songs / downloads
export const LibrarySkeleton = memo(() => (
  <div className="space-y-1">
    {Array.from({ length: 8 }).map((_, i) => (
      <Row key={i} delay={i * 0.035} />
    ))}
  </div>
));
LibrarySkeleton.displayName = 'LibrarySkeleton';

// ── Library artists grid
export const LibraryArtistsSkeleton = memo(() => (
  <div className="grid grid-cols-3 gap-3">
    {Array.from({ length: 6 }).map((_, i) => (
      <div
        key={i}
        className="flex flex-col items-center p-3 rounded-2xl"
        style={{
          background: 'rgba(255,255,255,0.03)',
          border: '0.5px solid rgba(255,255,255,0.04)',
          animation: `fade-in 0.32s ease-out ${i * 0.04}s both`,
        }}
      >
        <Skeleton className="w-16 h-16 rounded-full mb-2" />
        <Skeleton className="w-16 h-3 rounded-md" />
      </div>
    ))}
  </div>
));
LibraryArtistsSkeleton.displayName = 'LibraryArtistsSkeleton';

// ── Search results
export const SearchSkeleton = memo(() => (
  <div className="space-y-1">
    <div className="flex items-center gap-2 mb-3">
      <Skeleton className="w-4 h-4 rounded-md" />
      <Skeleton className="w-40 h-3.5 rounded-md" />
    </div>
    {Array.from({ length: 8 }).map((_, i) => (
      <Row key={i} delay={i * 0.03} />
    ))}
  </div>
));
SearchSkeleton.displayName = 'SearchSkeleton';

// ── Artists grid (search → artists tab, /artists page)
export const ArtistGridSkeleton = memo(() => (
  <div className="grid grid-cols-2 gap-3">
    {Array.from({ length: 6 }).map((_, i) => (
      <div
        key={i}
        className="p-3 rounded-2xl flex flex-col items-center"
        style={{
          background: 'rgba(255,255,255,0.03)',
          border: '0.5px solid rgba(255,255,255,0.04)',
          animation: `fade-in 0.32s ease-out ${i * 0.04}s both`,
        }}
      >
        <Skeleton className="w-20 h-20 rounded-full mb-3" />
        <Skeleton className="h-3 w-24 rounded-md mb-1.5" />
        <Skeleton className="h-2.5 w-16 rounded-md" />
      </div>
    ))}
  </div>
));
ArtistGridSkeleton.displayName = 'ArtistGridSkeleton';

// ── Playlist grid
export const PlaylistGridSkeleton = memo(() => (
  <div className="space-y-1">
    {Array.from({ length: 6 }).map((_, i) => (
      <Row key={i} delay={i * 0.035} />
    ))}
  </div>
));
PlaylistGridSkeleton.displayName = 'PlaylistGridSkeleton';

/**
 * Per-rail skeleton. Home's rails each own their own query, so a rail that is
 * still fetching used to render `null` — the screen looked frozen/blank even
 * though the page shell had mounted. Every rail now renders this instead.
 *
 * `layout` mirrors the real rail composition so nothing jumps on swap:
 *  - poster: big lead card + ranked carousel (Trending Now)
 *  - grid:   2-column artwork grid (New Releases)
 *  - mix:    hero panel + stacked rows (Made For You)
 */
type RailSkeletonProps = { layout?: 'poster' | 'grid' | 'mix'; title?: string };

export const RailSkeleton = memo(
  ({ layout = 'poster', title = 'w-40' }: RailSkeletonProps) => (
    <section style={{ animation: 'fade-in 0.32s ease-out both' }}>
      {/* Matches RailHeader: 19px title + 12px subtitle, mb-3.5 */}
      <div className="flex items-center justify-between gap-3 mb-3.5">
        <div className="space-y-1.5 min-w-0">
          <Skeleton className={`h-5 ${title} rounded-md`} />
          <Skeleton className="h-3 w-32 rounded-md" />
        </div>
        <Skeleton className="h-3 w-14 rounded-md shrink-0" />
      </div>

      {layout === 'poster' && (
        <>
          <Skeleton className="w-full h-[210px] rounded-[20px]" />
          <div className="flex gap-3 mt-4 overflow-hidden">
            {[0, 1, 2].map((i) => (
              <div key={i} className="shrink-0 w-[132px] space-y-2">
                <Skeleton className="w-[132px] h-[132px] rounded-[14px]" />
                <Skeleton className="h-3 w-3/4 rounded-md" />
                <Skeleton className="h-2.5 w-1/2 rounded-md" />
              </div>
            ))}
          </div>
        </>
      )}

      {layout === 'grid' && (
        <div className="grid grid-cols-2 gap-3.5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="space-y-2.5">
              <Skeleton className="w-full aspect-square rounded-[14px]" />
              <Skeleton className="h-3 w-3/4 rounded-md" />
              <Skeleton className="h-2.5 w-1/2 rounded-md" />
            </div>
          ))}
        </div>
      )}

      {layout === 'mix' && (
        <>
          <Skeleton className="w-full h-[164px] rounded-[20px]" />
          <div className="mt-3.5 rounded-[20px] overflow-hidden">
            {[0, 1, 2, 3].map((i) => (
              <Row key={i} delay={i * 0.04} />
            ))}
          </div>
        </>
      )}

    </section>
  ),
);
RailSkeleton.displayName = 'RailSkeleton';
