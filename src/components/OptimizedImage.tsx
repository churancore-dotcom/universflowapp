import React, { memo, useState, useRef, useEffect, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { artworkCandidates } from '@/lib/artworkUrl';

interface OptimizedImageProps {
  src: string | undefined;
  alt: string;
  className?: string;
  placeholderClassName?: string;
  eager?: boolean; // Skip lazy loading for above-the-fold content
  onLoad?: () => void;
}

const OptimizedImage = memo(({ 
  src, 
  alt, 
  className, 
  placeholderClassName,
  eager = false,
  onLoad 
}: OptimizedImageProps) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [shouldLoad, setShouldLoad] = useState(eager);
  const [hasError, setHasError] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Bar-free candidates, best quality first. A missing `maxresdefault` 404s, so
  // onError walks down the list instead of showing the error tile.
  const candidates = useMemo(() => artworkCandidates(src), [src]);
  const [candidateIndex, setCandidateIndex] = useState(0);
  useEffect(() => { setCandidateIndex(0); setIsLoaded(false); setHasError(false); }, [candidates.join('|')]);

  // Use Intersection Observer for lazy loading
  useEffect(() => {
    if (eager || !containerRef.current) {
      setShouldLoad(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShouldLoad(true);
          observer.disconnect();
        }
      },
      {
        rootMargin: '150px', // Start loading 150px before visible
        threshold: 0.01,
      }
    );

    observer.observe(containerRef.current);

    return () => observer.disconnect();
  }, [eager]);

  const handleLoad = () => {
    setIsLoaded(true);
    onLoad?.();
  };

  const handleError = () => {
    if (candidateIndex < candidates.length - 1) {
      setCandidateIndex((i) => i + 1);
      return;
    }
    setHasError(true);
    setIsLoaded(true);
  };

  // A thumbnail that never answers (blocked host, dead CDN edge) used to leave a
  // pure-black hole in the card. After 6s we show the real fallback tile.
  useEffect(() => {
    if (!shouldLoad || isLoaded || hasError) return;
    const t = window.setTimeout(() => { setHasError(true); setIsLoaded(true); }, 6000);
    return () => window.clearTimeout(t);
  }, [shouldLoad, isLoaded, hasError, candidateIndex]);

  const fallbackTile = (
    <div className="absolute inset-0 bg-gradient-to-br from-primary/35 via-primary/10 to-accent/25 flex items-center justify-center">
      <span className="text-foreground/70 text-2xl font-semibold">
        {(alt || '♪').trim().charAt(0).toUpperCase() || '♪'}
      </span>
    </div>
  );

  if (!src) {
    return (
      <div className={cn("relative overflow-hidden", className)}>{fallbackTile}</div>
    );
  }

  return (
    <div ref={containerRef} className={cn("relative overflow-hidden", className)}>
      {/* Placeholder skeleton */}
      {!isLoaded && (
        <div
          className={cn(
            "absolute inset-0 bg-muted animate-pulse",
            placeholderClassName
          )}
        />
      )}
      
      {/* Actual image - only rendered when shouldLoad is true */}
      {shouldLoad && !hasError && (() => {
        // Guard against generic/empty/filename alt text so images always
        // have a meaningful accessible description.
        const rawAlt = (alt ?? "").trim();
        const looksGeneric =
          !rawAlt ||
          /^(image|photo|picture|img|thumbnail|cover|artwork)$/i.test(rawAlt) ||
          /\.(jpe?g|png|webp|gif|svg|avif)$/i.test(rawAlt);
        const safeAlt = looksGeneric ? "Album artwork" : rawAlt;
        return (
        <img
          ref={imgRef}
          src={candidates[candidateIndex] ?? src}
          alt={safeAlt}
          className={cn(
            // Absolute fill so the artwork always covers the card box exactly,
            // whatever the source image's aspect ratio is.
            "absolute inset-0 w-full h-full object-cover object-center transition-opacity duration-300",
            isLoaded ? "opacity-100" : "opacity-0"
          )}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          onLoad={handleLoad}
          onError={handleError}
          draggable={false}
          referrerPolicy="no-referrer"
        />
        );
      })()}

      {/* Error fallback */}
      {hasError && fallbackTile}
    </div>
  );
});

OptimizedImage.displayName = 'OptimizedImage';

export default OptimizedImage;
