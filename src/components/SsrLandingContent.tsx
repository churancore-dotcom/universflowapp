import { useEffect, useState } from "react";

/**
 * Server-rendered, no-JavaScript content for "/".
 *
 * The landing page (and the signed-in Home feed) are lazy + client-gated, so a
 * crawler that does not execute JavaScript previously received an almost empty
 * document. This block ships real prose + an H1 in the initial HTML, then
 * removes itself after hydration so the interactive UI (and its own H1) is
 * completely unchanged visually.
 */
export const LANDING_SSR_HEADING = "Universflow — Free Music Streaming and Offline Downloads";

export const LANDING_SSR_PARAGRAPHS = [
  "Universflow is a free music streaming and download app for Android and the web. Listeners can search millions of songs by title, artist or album, play them instantly, build personal playlists, follow the artists they care about, and download tracks for offline playback when they have no connection. The web app runs at https://universflow.in and the same account works inside the native Android app, so playback position, queue and library stay in sync across devices.",
  "The catalog covers Hindi, Punjabi, Bhojpuri, Tamil, Telugu and international pop, plus independent and regional releases uploaded directly by verified artists — music that is often missing from mainstream services. Global and regional charts are aggregated automatically, and personalized shelves such as Recently Played, Made For You and artist or genre mixes are generated from real listening history rather than editorial guesswork.",
  "Universflow Premium adds ad-free listening, a studio equalizer with real acoustic space profiles, higher streaming and download quality, and premium-only releases. Artists can apply for a verified artist profile, upload their own catalog, invite label or team members, and reach listeners directly. Support, privacy and terms pages are public, and machine-readable descriptions of the product live at /llms.txt and /sitemap.xml.",
];

export default function SsrLandingContent() {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  if (hydrated) return null;

  return (
    <div
      data-ssr-seo="landing"
      style={{
        position: "absolute",
        width: 1,
        height: 1,
        margin: -1,
        padding: 0,
        overflow: "hidden",
        clip: "rect(0 0 0 0)",
        whiteSpace: "nowrap",
        border: 0,
      }}
    >
      <h1>{LANDING_SSR_HEADING}</h1>
      {LANDING_SSR_PARAGRAPHS.map((text) => (
        <p key={text.slice(0, 24)}>{text}</p>
      ))}
      <ul>
        <li><a href="/search">Search songs, artists and albums</a></li>
        <li><a href="/artists">Discover and follow artists</a></li>
        <li><a href="/premium">Universflow Premium</a></li>
        <li><a href="/about">About Universflow</a></li>
        <li><a href="/support">Help and contact</a></li>
        <li><a href="/llms.txt">Agent instructions (llms.txt)</a></li>
        <li><a href="/sitemap.xml">Sitemap</a></li>
      </ul>
    </div>
  );
}
