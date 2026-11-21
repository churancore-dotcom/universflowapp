import { Link } from "@/lib/router-compat";
import { Play, Music2, Flame, Headphones, Download, ChevronRight } from "lucide-react";
import SEOHead from "@/components/SEOHead";

const PAGE_URL = "https://universflow.in/blog/new-hindi-songs-2026";
const PUBLISHED = "2026-07-18";

const ARTISTS = [
  { name: "Arijit Singh", note: "Bollywood's most-streamed voice, behind many of the best-loved romantic songs." },
  { name: "Pritam", note: "Composer behind many of Bollywood's biggest film soundtracks." },
  { name: "Jubin Nautiyal", note: "Radio-ready ballads that remain Hindi favourites." },
  { name: "Shreya Ghoshal", note: "Timeless vocals across decades of film soundtracks." },
  { name: "Neha Kakkar", note: "Party anthems and wedding-season smashes with billions of streams." },
  { name: "King", note: "The Hindi hip-hop crossover star behind “Maan Meri Jaan”." },
];

const HITS = [
  { title: "Tum Hi Ho", artist: "Arijit Singh" },
  { title: "Kesariya", artist: "Arijit Singh, Pritam" },
  { title: "Apna Bana Le", artist: "Arijit Singh" },
  { title: "Raatan Lambiyan", artist: "Jubin Nautiyal, Asees Kaur" },
  { title: "Chaleya", artist: "Arijit Singh, Shilpa Rao" },
  { title: "Heeriye", artist: "Jasleen Royal, Arijit Singh" },
  { title: "Maan Meri Jaan", artist: "King" },
  { title: "Tere Vaaste", artist: "Varun Jain, Sachin-Jigar" },
  { title: "Pasoori Nu", artist: "Arijit Singh, Tulsi Kumar" },
  { title: "Ranjha", artist: "B Praak, Jasleen Royal" },
  { title: "O Bedardeya", artist: "Arijit Singh" },
  { title: "Satranga", artist: "Arijit Singh" },
];

const PLAYLIST_IDEAS = [
  { title: "Hindi Love Classics", desc: "Arijit, Jubin and Shreya ballads that never get old." },
  { title: "Hindi Romantic Hits", desc: "The softest Arijit, Jubin and Shreya cuts for late-night listens." },
  { title: "Bollywood Party", desc: "Wedding-season bangers and dance-floor fillers." },
  { title: "Hindi Chill Vibes", desc: "Lo-fi Bollywood, acoustic ballads and slow-burn Hindi indie." },
];

const JSONLD = {
  "@context": "https://schema.org",
  "@type": "BlogPosting",
  headline: "Hindi Songs to Stream in 2026 — Popular Bollywood Hits",
  description:
    "A guide to popular Bollywood and Hindi-pop songs worth streaming in 2026, plus where to find this week's new releases in Universflow.",
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

const BlogNewHindiSongs2026 = () => {
  return (
    <div className="min-h-[100dvh] bg-black text-white">
      <SEOHead
        title="Hindi Songs to Stream in 2026 — Popular Bollywood Hits | Universflow"
        description="Popular Hindi and Bollywood songs by Arijit Singh, Pritam, Jubin Nautiyal and more. For current releases, open New Releases in the Universflow app."
        keywords="new hindi songs, new hindi songs 2026, hindi songs download, latest bollywood songs, new songs, arijit singh, hindi music, free hindi songs, bollywood 2026"
        url={PAGE_URL}
        path="/blog/new-hindi-songs-2026"
        type="article"
        jsonLd={JSONLD}
        jsonLdId="blog-new-hindi-2026-jsonld"
      />

      <header className="px-5 pt-10 pb-6 max-w-3xl mx-auto">
        <Link to="/" className="text-xs text-white/50 hover:text-white/80 inline-flex items-center gap-1">
          <ChevronRight className="w-3 h-3 rotate-180" /> Universflow
        </Link>
        <div className="mt-4 flex items-center gap-2 text-xs text-rose-300/80">
          <Flame className="w-3.5 h-3.5" /> Published {PUBLISHED} · Popular hits guide
        </div>
        <h1 className="mt-3 text-4xl sm:text-5xl font-bold leading-tight tracking-tight">
          Hindi Songs to Stream in 2026 — Popular Bollywood Hits
        </h1>
        <p className="mt-4 text-white/70 text-base leading-relaxed">
          These are popular Hindi songs from recent years that listeners keep coming back to — not
          a list of brand-new releases. For songs released this week, open New Releases on the
          Universflow home screen, which comes from dated release listings.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            to="/search?q=hindi+songs"
            className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-rose-500 hover:bg-rose-400 text-white text-sm font-semibold transition"
          >
            <Play className="w-4 h-4 fill-white" /> Stream on Universflow
          </Link>
          <Link
            to="/get"
            className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-white/10 hover:bg-white/15 text-white text-sm font-semibold transition"
          >
            <Download className="w-4 h-4" /> Get the app
          </Link>
        </div>
      </header>

      <section className="px-5 py-8 max-w-3xl mx-auto">
        <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
          <Flame className="w-5 h-5 text-rose-400" /> Hindi artists worth knowing
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
          <Music2 className="w-5 h-5 text-rose-400" /> Popular Hindi songs to play first
        </h2>
        <p className="text-sm text-white/60 mb-4">
          Tap any track to open it in Universflow — free streaming, no signup wall, and download for
          offline listening anytime.
        </p>
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
                <Play className="w-3.5 h-3.5" /> Stream on Universflow
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <section className="px-5 py-8 max-w-3xl mx-auto">
        <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
          <Headphones className="w-5 h-5 text-rose-400" /> Hindi playlists worth saving
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

      <section className="px-5 py-8 max-w-3xl mx-auto">
        <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
          <Download className="w-5 h-5 text-rose-400" /> Hindi songs download — free & offline
        </h2>
        <p className="text-white/70 text-sm leading-relaxed">
          Every song listed above can be saved for offline play inside Universflow. No paywalls on
          downloads, no watermarks on audio, and no ads interrupting your listening. Just tap the
          download icon on any track and it's yours on the flight, in the metro, or anywhere your
          data drops.
        </p>
      </section>

      <section className="px-5 py-10 max-w-3xl mx-auto">
        <div className="rounded-3xl bg-gradient-to-br from-rose-600/20 to-rose-400/10 border border-rose-400/20 p-6">
          <h2 className="text-xl font-bold">Stream Hindi favourites on Universflow</h2>
          <p className="text-white/70 text-sm mt-2">
            Free streaming. Offline downloads. Built for India — Hindi, Punjabi, indie and more, all in one app.
          </p>
          <div className="mt-4 flex gap-3 flex-wrap">
            <Link
              to="/get"
              className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-white text-black text-sm font-semibold"
            >
              Get the app
            </Link>
            <Link
              to="/search?q=hindi"
              className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-white/10 hover:bg-white/15 text-sm font-semibold"
            >
              Browse Hindi
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
};

export default BlogNewHindiSongs2026;
