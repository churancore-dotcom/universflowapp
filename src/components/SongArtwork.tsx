import React, { memo, useEffect, useMemo, useState } from 'react';
import { Music2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { videoIdOf } from '@/lib/railQuality';
import { artworkCandidates } from '@/lib/artworkUrl';

interface Props {
  song: { id?: string; title?: string; cover_url?: string | null; audio_url?: string | null };
  className?: string;
  /** Rendered box size in px — used to request an artwork of the right size. */
  size?: number;
  alt?: string;
}

/**
 * Song artwork with a real fallback ladder.
 *
 * Queue rows used to render a blurred/empty tile whenever a mix track arrived
 * without `cover_url`, or when a single upgraded URL 404'd — the old code hid
 * the <img> and left the gradient behind. Here every source is tried in order
 * (upgraded provider URL → YouTube hq → mq → default) before falling back to a
 * labelled note tile, so a queue never shows a blank square.
 */
function candidatesFor(song: Props['song'], size: number): string[] {
  const out: string[] = [];
  const cover = song.cover_url || '';
  // Bar-free candidates only: `hqdefault`/`sddefault`/`default` bake black
  // letterbox bars into the pixels, which is what made square tiles look
  // cropped or padded (see src/lib/artworkUrl.ts).
  out.push(...artworkCandidates(cover, size));
  const vid = videoIdOf(song);
  if (vid) {
    out.push(`https://i.ytimg.com/vi/${vid}/maxresdefault.jpg`);
    out.push(`https://i.ytimg.com/vi/${vid}/hq720.jpg`);
    out.push(`https://i.ytimg.com/vi/${vid}/mqdefault.jpg`);
  }
  return [...new Set(out.filter(Boolean))];
}


const SongArtwork = memo(({ song, className, size = 44, alt }: Props) => {
  const sources = useMemo(() => candidatesFor(song, size), [song.cover_url, song.id, song.audio_url, size]);
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => { setIndex(0); setLoaded(false); }, [sources.join('|')]);

  const src = sources[index];

  return (
    <div className={cn('relative overflow-hidden bg-gradient-to-br from-primary/25 to-accent/25', className)}>
      {/* Neutral placeholder while the real art decodes, so a row never looks
          like a smeared/blurred tile. */}
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Music2 className="w-1/2 h-1/2 text-foreground/30" />
        </div>
      )}
      {src ? (
        <img
          src={src}
          alt={alt || song.title || 'Album artwork'}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          draggable={false}
          className={cn('relative w-full h-full object-cover transition-opacity duration-200', loaded ? 'opacity-100' : 'opacity-0')}
          onLoad={(e) => {
            // YouTube serves a 120x90 grey "no thumbnail" bitmap instead of a
            // 404; upscaling it is exactly the blur users reported. Fall
            // through to the next candidate when a better one exists.
            const img = e.currentTarget;
            if (img.naturalWidth > 0 && img.naturalWidth <= 130 && index < sources.length - 1) {
              setIndex((i) => i + 1);
              return;
            }
            setLoaded(true);
          }}
          onError={() => setIndex((i) => i + 1)}
        />
      ) : null}
    </div>
  );

});

SongArtwork.displayName = 'SongArtwork';
export default SongArtwork;
