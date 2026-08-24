import { useLocation } from "@/lib/router-compat";
import { useEffect } from "react";

/**
 * 404 page. The server responds with a real HTTP 404 for unknown paths; this
 * body also gives non-human clients (AI agents, crawlers) a short, plainly
 * worded map of where to look next instead of a bare "not found".
 */
const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="ethereal-page flex min-h-dvh items-center justify-center px-5 py-12">
      <div className="glass-ultra w-full max-w-md rounded-3xl px-7 py-10 text-center">
        <h1 className="ethereal-title mb-3 text-5xl font-bold">404</h1>
        <p className="mb-2 text-xl text-muted-foreground">Page not found</p>
        <p className="mb-6 text-sm text-muted-foreground">
          This URL does not exist on Universflow. Use one of the entry points below to find
          what you were looking for.
        </p>

        <ul className="mb-6 space-y-2 text-left text-sm">
          <li>
            <a className="text-primary underline" href="/">Home</a>
            <span className="text-muted-foreground"> — music feed and app download</span>
          </li>
          <li>
            <a className="text-primary underline" href="/search">Search</a>
            <span className="text-muted-foreground"> — find any song, artist or album</span>
          </li>
          <li>
            <a className="text-primary underline" href="/sitemap.xml">/sitemap.xml</a>
            <span className="text-muted-foreground"> — every public URL on this site</span>
          </li>
          <li>
            <a className="text-primary underline" href="/llms.txt">/llms.txt</a>
            <span className="text-muted-foreground"> — agent instructions and when to use Universflow</span>
          </li>
          <li>
            <a className="text-primary underline" href="/about">/about</a>
            <span className="text-muted-foreground"> — what this product is</span>
          </li>
          <li>
            <a className="text-primary underline" href="/support">/support</a>
            <span className="text-muted-foreground"> — help and contact</span>
          </li>
        </ul>

        <a href="/" className="text-primary underline hover:text-primary/90">
          Return to Home
        </a>
      </div>
    </div>
  );
};

export default NotFound;
