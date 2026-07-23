import React, { memo, useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';

interface OptimizedImageProps {
  src: string | undefined;
  alt: string;
  className?: string;
  placeholderClassName?: string;
  eager?: boolean; // Skip lazy loading for above-the-fold content
  onLoad?: () => void;
}

function upgradeArtworkUrl(url?: string) {
  if (!url) return url;
  if (url.includes('googleusercontent.com')) {
    return url.replace(/=w\d+-h\d+[^&]*/i, '=w544-h544-l90-rj');
  }
  return url
    .replace(/\/default\.jpg/i, '/hqdefault.jpg')
    .replace(/\/mqdefault\.jpg/i, '/hqdefault.jpg');
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
    setHasError(true);
    setIsLoaded(true);
  };

  if (!src) {
    return (
      <div 
        className={cn(
          "bg-gradient-to-br from-primary/20 to-accent/20",
          className
        )}
      />
    );
  }

  return (
    <div ref={containerRef} className={cn("relative overflow-hidden", className)}>
      {/* Placeholder skeleton */}
      {!isLoaded && (
        <div 
          className={cn(
            "absolute inset-0 bg-muted/50 animate-pulse",
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
          src={upgradeArtworkUrl(src)}
          alt={safeAlt}
          className={cn(
            "w-full h-full object-cover transition-opacity duration-300",
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
      {hasError && (
        <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center">
          <span className="text-muted-foreground/50 text-2xl">♪</span>
        </div>
      )}
    </div>
  );
});

OptimizedImage.displayName = 'OptimizedImage';

export default OptimizedImage;
