import React, { memo, useEffect, useMemo, useState } from 'react';
import { Music2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { videoIdOf } from '@/lib/railQuality';

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
  const dpr = typeof window !== 'undefined' ? Math.min(3, Math.max(1, window.devicePixelRatio || 1)) : 2;
  if (cover) {
    if (cover.includes('googleusercontent.com')) {
      // Ask for a genuinely high-res crop (never smaller than 240px) so a 44px
      // tile stays sharp on 3x screens instead of upscaling a thumbnail.
      const px = Math.max(240, Math.min(720, Math.round(size * dpr * 2)));
      out.push(cover.replace(/=w\d+-h\d+[^&]*/i, `=w${px}-h${px}-l90-rj`));
    }
    if (/i\.ytimg\.com\/vi\//.test(cover)) {
      // Upgrade any low-res YouTube thumbnail already stored on the row.
      out.push(cover.replace(/\/(default|mqdefault|sddefault|hq720)\.jpg/, '/hqdefault.jpg'));
    }
    out.push(cover);
  }
  const vid = videoIdOf(song);
  if (vid) {
    // Highest-quality YouTube stills first; each 404 falls through to the next.
    out.push(`https://i.ytimg.com/vi/${vid}/sddefault.jpg`);
    out.push(`https://i.ytimg.com/vi/${vid}/hqdefault.jpg`);
    out.push(`https://i.ytimg.com/vi/${vid}/mqdefault.jpg`);
    out.push(`https://i.ytimg.com/vi/${vid}/default.jpg`);
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
      {src ? (
        <img
          src={src}
          alt={alt || song.title || 'Album artwork'}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          draggable={false}
          className={cn('w-full h-full object-cover transition-opacity duration-200', loaded ? 'opacity-100' : 'opacity-0')}
          onLoad={() => setLoaded(true)}
          onError={() => setIndex((i) => i + 1)}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <Music2 className="w-1/2 h-1/2 text-foreground/35" />
        </div>
      )}
    </div>
  );
});

SongArtwork.displayName = 'SongArtwork';
export default SongArtwork;
