import { Link } from "@/lib/router-compat";
import { Play, Music2, Flame, Headphones, ChevronRight } from "lucide-react";
import SEOHead from "@/components/SEOHead";

const PAGE_URL = "https://universflow.in/blog/trending-punjabi-songs-2026";
const PUBLISHED = "2026-06-14";

const ARTISTS = [
  { name: "Diljit Dosanjh", note: "Global Punjabi superstar — Coachella-tested, chart-dominant in 2026." },
  { name: "AP Dhillon", note: "Brown Munde era cemented him as the voice of new-wave Punjabi pop." },
  { name: "Karan Aujla", note: "Punchy lyricism and chart-topping collabs across the diaspora." },
  { name: "Sidhu Moose Wala", note: "Catalogue legend — still the most-streamed Punjabi artist year over year." },
  { name: "Shubh", note: "Toronto-based, viral on Reels with melodic Punjabi rap." },
  { name: "Imran Khan", note: "Amplifier-era classics that never leave the charts." },
];

const HITS = [
  { title: "Brown Munde", artist: "AP Dhillon, Gurinder Gill, Shinda Kahlon" },
  { title: "Softly", artist: "Karan Aujla" },
  { title: "Naina", artist: "Diljit Dosanjh" },
  { title: "Cheques", artist: "Shubh" },
  { title: "295", artist: "Sidhu Moose Wala" },
  { title: "Excuses", artist: "AP Dhillon" },
  { title: "Tauba Tauba", artist: "Karan Aujla" },
  { title: "GOAT", artist: "Diljit Dosanjh" },
  { title: "Amplifier", artist: "Imran Khan" },
  { title: "No Love", artist: "Shubh" },
];

const PLAYLIST_IDEAS = [
  { title: "Punjabi Hits 2026", desc: "The freshest Punjabi pop, rap and R&B blends — refreshed weekly." },
  { title: "Punjabi Party Anthems", desc: "Bhangra, house and club-ready Punjabi heaters for the dancefloor." },
  { title: "Punjabi Chill", desc: "Lo-fi, acoustic and slow-burn Punjabi cuts for late-night drives." },
  { title: "Sidhu Moose Wala Forever", desc: "A curated journey through Sidhu's defining tracks." },
];

const JSONLD = {
  "@context": "https://schema.org",
  "@type": "BlogPosting",
  headline: "Trending Punjabi Songs 2026 — Top Artists, Hits & Playlists",
  description:
    "The biggest Punjabi songs, artists and playlists trending in 2026. Stream the latest Punjabi hits free on Universflow.",
  datePublished: PUBLISHED,
  dateModified: PUBLISHED,
  mainEntityOfPage: PAGE_URL,
  author: { "@type": "Organization", name: "Universflow" },
  publisher: {
    "@type": "Organization",
    name: "Universflow",
    logo: { "@type": "ImageObject", url: "https://universflow.in/pwa-512x512.png" },
  },
};

const BlogTrendingPunjabiSongs2026 = () => {
  return (
    <div className="min-h-[100dvh] bg-black text-white">
      <SEOHead
        title="Trending Punjabi Songs 2026 — Top Hits | Universflow"
        description="Discover the biggest Punjabi songs of 2026 — Diljit, AP Dhillon, Karan Aujla, Shubh and more. Stream the latest Punjabi hits free on Universflow."
        keywords="punjabi songs, latest punjabi hits, trending punjabi songs 2026, diljit dosanjh, ap dhillon, karan aujla, sidhu moose wala, punjabi playlist, free punjabi music"
        url={PAGE_URL}
        path="/blog/trending-punjabi-songs-2026"
        type="article"
        jsonLd={JSONLD}
        jsonLdId="blog-punjabi-2026-jsonld"
      />

      <header className="px-5 pt-10 pb-6 max-w-3xl mx-auto">
        <Link to="/" className="text-xs text-white/50 hover:text-white/80 inline-flex items-center gap-1">
          <ChevronRight className="w-3 h-3 rotate-180" /> Universflow
        </Link>
        <div className="mt-4 flex items-center gap-2 text-xs text-rose-300/80">
          <Flame className="w-3.5 h-3.5" /> Trending guide · Updated {PUBLISHED}
        </div>
        <h1 className="mt-3 text-4xl sm:text-5xl font-bold leading-tight tracking-tight">
          Trending Punjabi Songs 2026
        </h1>
        <p className="mt-4 text-white/70 text-base leading-relaxed">
          Punjabi music has gone fully global — from Diljit at Coachella to AP Dhillon and Karan Aujla
          ruling the charts. Here are the artists, hits and playlists driving Punjabi streaming in 2026,
          all playable free inside Universflow.
        </p>
        <Link
          to="/search?q=punjabi"
          className="mt-6 inline-flex items-center gap-2 px-5 py-3 rounded-full bg-rose-500 hover:bg-rose-400 text-white text-sm font-semibold transition"
        >
          <Play className="w-4 h-4 fill-white" /> Play Punjabi hits in Universflow
        </Link>
      </header>

      <section className="px-5 py-8 max-w-3xl mx-auto">
        <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
          <Flame className="w-5 h-5 text-rose-400" /> Top Punjabi artists right now
        </h2>
        <div className="grid gap-3">
          {ARTISTS.map((a) => (
            <div key={a.name} className="rounded-2xl bg-white/[0.04] border border-white/[0.06] p-4">
              <div className="font-semibold">{a.name}</div>
              <div className="text-sm text-white/60 mt-1">{a.note}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="px-5 py-8 max-w-3xl mx-auto">
        <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
          <Music2 className="w-5 h-5 text-rose-400" /> 10 trending Punjabi tracks to play first
        </h2>
        <ol className="space-y-2">
          {HITS.map((h, i) => (
            <li
              key={h.title}
              className="flex items-center gap-3 rounded-xl bg-white/[0.03] border border-white/[0.05] px-4 py-3"
            >
              <span className="text-rose-400 font-bold w-6 text-center">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{h.title}</div>
                <div className="text-xs text-white/50 truncate">{h.artist}</div>
              </div>
              <Link
                to={`/search?q=${encodeURIComponent(h.title + " " + h.artist)}`}
                className="text-xs text-rose-300 hover:text-rose-200 inline-flex items-center gap-1"
              >
                <Play className="w-3.5 h-3.5" /> Play
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <section className="px-5 py-8 max-w-3xl mx-auto">
        <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
          <Headphones className="w-5 h-5 text-rose-400" /> Punjabi playlists worth saving
        </h2>
        <div className="grid gap-3">
          {PLAYLIST_IDEAS.map((p) => (
            <div key={p.title} className="rounded-2xl bg-white/[0.04] border border-white/[0.06] p-4">
              <div className="font-semibold">{p.title}</div>
              <div className="text-sm text-white/60 mt-1">{p.desc}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="px-5 py-10 max-w-3xl mx-auto">
        <div className="rounded-3xl bg-gradient-to-br from-rose-600/20 to-rose-400/10 border border-rose-400/20 p-6">
          <h2 className="text-xl font-bold">Stream every Punjabi hit free on Universflow</h2>
          <p className="text-white/70 text-sm mt-2">
            Free streaming. Offline downloads. No ads on premium. Built for India.
          </p>
          <div className="mt-4 flex gap-3">
            <Link
              to="/get"
              className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-white text-black text-sm font-semibold"
            >
              Get the app
            </Link>
            <Link
              to="/search?q=punjabi"
              className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-white/10 hover:bg-white/15 text-sm font-semibold"
            >
              Browse Punjabi
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
};

export default BlogTrendingPunjabiSongs2026;
