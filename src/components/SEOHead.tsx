import { useEffect } from 'react';
import { useLocation } from '@/lib/router-compat';

interface SEOHeadProps {
  title?: string;
  description?: string;
  keywords?: string;
  image?: string;
  /** Absolute URL. If omitted, derived from current pathname. */
  url?: string;
  /** Path override when a parent doesn't have a router context. */
  path?: string;
  type?: string;
  /** Optional JSON-LD structured data (object or array of objects). Injected into <head>. */
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
  /** Stable id for the JSON-LD <script> tag so it can be replaced on re-render. */
  jsonLdId?: string;
}

const SITE_ORIGIN = 'https://universflow.in';

const DEFAULT_IMAGE =
  'https://storage.googleapis.com/gpt-engineer-file-uploads/d6CK1hptEYS0iYCrQMmYcx7HukD2/social-images/social-1768315544947-Screenshot%202026-01-13%20201134.png';

const SEOHead = ({
  title = 'Univers Flow — Free Music Streaming & Downloads',
  description = 'Stream and download unlimited music for free with Univers Flow. Discover millions of songs, build playlists, and listen offline.',
  keywords = 'free music app, music app, song app, song download app, mp3 song download app, mp3 download app, mp3 music download app, music download app, music player, free music download, free music apps, online music app, music streaming app, offline music app, music app for Android, free music app for Android, gana wala apps, mp3 gana, hindi songs app, punjabi songs app, bollywood music app, spotify alternative, jiosaavn alternative, gaana alternative, wynk alternative, Universflow',
  image = DEFAULT_IMAGE,
  url,
  path,
  type = 'website',
  jsonLd,
  jsonLdId,
}: SEOHeadProps) => {
  const location = useLocation();
  const resolvedPath = path ?? location.pathname ?? '/';
  const resolvedUrl = url ?? `${SITE_ORIGIN}${resolvedPath}`;

  useEffect(() => {
    document.title = title;

    const updateMeta = (name: string, content: string, isProperty = false) => {
      const attr = isProperty ? 'property' : 'name';
      let meta = document.querySelector(`meta[${attr}="${name}"]`) as HTMLMetaElement | null;
      if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute(attr, name);
        document.head.appendChild(meta);
      }
      meta.content = content;
    };

    updateMeta('description', description);
    updateMeta('keywords', keywords);
    updateMeta('author', 'Universflow Team');
    updateMeta('robots', 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1');
    updateMeta('googlebot', 'index, follow');

    updateMeta('og:title', title, true);
    updateMeta('og:description', description, true);
    updateMeta('og:image', image, true);
    updateMeta('og:url', resolvedUrl, true);
    updateMeta('og:type', type, true);
    updateMeta('og:site_name', 'Univers Flow', true);
    updateMeta('og:locale', 'en_US', true);

    updateMeta('twitter:card', 'summary_large_image');
    updateMeta('twitter:title', title);
    updateMeta('twitter:description', description);
    updateMeta('twitter:image', image);
    updateMeta('twitter:url', resolvedUrl);
    updateMeta('twitter:creator', '@UniversFlow');

    updateMeta('application-name', 'Univers Flow');
    updateMeta('apple-mobile-web-app-title', 'Univers Flow');
    updateMeta('mobile-web-app-capable', 'yes');
    updateMeta('apple-mobile-web-app-capable', 'yes');

    let canonical = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.appendChild(canonical);
    }
    canonical.href = resolvedUrl;

    // Per-route JSON-LD (MusicGroup, CollectionPage, etc.)
    const ldId = jsonLdId ?? 'seohead-jsonld';
    let ldEl = document.getElementById(ldId) as HTMLScriptElement | null;
    if (jsonLd) {
      if (!ldEl) {
        ldEl = document.createElement('script');
        ldEl.type = 'application/ld+json';
        ldEl.id = ldId;
        document.head.appendChild(ldEl);
      }
      ldEl.textContent = JSON.stringify(jsonLd);
    } else if (ldEl) {
      ldEl.remove();
    }
  }, [title, description, keywords, image, resolvedUrl, type, jsonLd, jsonLdId]);

  return null;
};

export default SEOHead;
