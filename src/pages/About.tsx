import { ArrowLeft } from "lucide-react";
import { Link } from "@/lib/router-compat";

const SECTIONS: { heading: string; body: string }[] = [
  {
    heading: "What Universflow is",
    body: "Universflow is a free music streaming and download app built for listeners who want the whole world's music on a phone that may not always have a connection. You can search any song, artist or album, play it instantly, queue up an auto-generated mix, save it to your library, and download it for fully offline playback. It runs as a mobile-first web app at universflow.in and as a native Android app that shares the same account, library, queue and playback position.",
  },
  {
    heading: "Why we built it",
    body: "Mainstream services are strong on major-label catalog and weak on everything else. Regional, independent and self-released music — Bhojpuri, Punjabi, Haryanvi, Tamil, Telugu, small-town hip-hop and bedroom pop — is often either missing or buried. Universflow indexes music broadly, aggregates real global and regional charts automatically, and gives verified artists a way to upload and publish their own catalog directly, so listeners can find work that never reached a big distributor.",
  },
  {
    heading: "How personalization works",
    body: "Your feed is built from what you actually listen to on your device and account: recent plays, repeat listens, skips and dislikes, followed artists, and the genres and eras that dominate your history. Those signals produce named shelves — More from an artist, a genre mix, a late-night mix, fresh picks — instead of one generic recommendation rail. Artists you dislike or repeatedly skip are suppressed, and shelves rotate over time so the home feed does not pin itself to the same tracks forever.",
  },
  {
    heading: "Premium and artists",
    body: "Universflow Premium removes ads and unlocks the studio equalizer with real acoustic space profiles, harmonic and stereo master-chain processing, higher streaming and download quality, playback speed control, and premium-only releases. Artists can apply for verification, publish releases, manage a label or team, and see their music surfaced on editorial and personalized shelves. Verification uses liveness checks and platform proof; government ID material is never retained.",
  },
  {
    heading: "Contact and policies",
    body: "Universflow is operated by the Univers Flow team in India. Reach us at universflow.in@gmail.com for support, artist verification, takedown requests or partnership questions. Our privacy policy and terms of service are public, and machine-readable descriptions of the product are published at /llms.txt and /sitemap.xml for search engines, answer engines and AI agents.",
  },
];

export default function About() {
  return (
    <div className="min-h-dvh bg-background text-foreground pb-24">
      <header className="sticky top-0 z-10 flex items-center gap-3 bg-background/85 px-4 py-4 backdrop-blur-xl">
        <Link
          to="/"
          aria-label="Back"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="font-display text-[26px] font-black uppercase tracking-tight">
          About Universflow
        </h1>
      </header>

      <main className="space-y-8 px-5 pt-2">
        <p className="text-[15px] leading-relaxed text-muted-foreground">
          Free music streaming and offline downloads — for every listener, and every artist
          the big services skipped.
        </p>

        {SECTIONS.map((section) => (
          <section key={section.heading} className="space-y-2">
            <h2 className="text-[17px] font-bold">{section.heading}</h2>
            <p className="text-[14px] leading-relaxed text-muted-foreground">{section.body}</p>
          </section>
        ))}

        <nav className="flex flex-wrap gap-3 pt-2 text-[13px] font-semibold">
          <Link to="/support" className="rounded-full border border-border px-4 py-2">Support</Link>
          <Link to="/legal/privacy" className="rounded-full border border-border px-4 py-2">Privacy</Link>
          <Link to="/legal/terms" className="rounded-full border border-border px-4 py-2">Terms</Link>
          <Link to="/premium" className="rounded-full border border-border px-4 py-2">Premium</Link>
        </nav>
      </main>
    </div>
  );
}
