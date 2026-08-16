import { Link } from "@/lib/router-compat";
import { Download, Share2 } from "lucide-react";
import SEOHead from "@/components/SEOHead";
import appLogo from "@/assets/app-logo.webp";


const APK_URL = "https://universflow.in/api/public/apk";
const VERSION = "1.0.0";
const SIZE = "11 MB";

const SHOTS = [
  { src: "/screenshots/home.png", alt: "Universflow home feed with personalized rails" },
  { src: "/screenshots/search.png", alt: "Search results with instant like buttons" },
  { src: "/screenshots/library.png", alt: "Your Library — liked songs" },
  { src: "/screenshots/playlist.png", alt: "Playlist detail screen" },
  { src: "/screenshots/downloads.png", alt: "Offline downloads screen" },
  { src: "/screenshots/premium.png", alt: "Universflow Premium plans" },
  { src: "/screenshots/profile.png", alt: "Profile and listening stats" },
  { src: "/screenshots/settings.png", alt: "Playback and download settings" },
];

const handleShare = async () => {
  const data = { title: "Universflow", text: "Universflow — music app for Android", url: "https://universflow.in/get" };
  try {
    if (navigator.share) await navigator.share(data);
    else await navigator.clipboard.writeText(data.url);
  } catch { /* ignore */ }
};

const GetApp = () => {
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "MobileApplication",
      name: "Universflow",
      operatingSystem: "ANDROID",
      applicationCategory: "MusicApplication",
      url: "https://universflow.in/get",
      installUrl: APK_URL,
      downloadUrl: APK_URL,
      softwareVersion: VERSION,
      fileSize: SIZE,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      image: "https://universflow.in/pwa-512x512.png",
      screenshot: SHOTS.map((s) => `https://universflow.in${s.src}`),
      description: "Universflow — free music streaming app for Android. Stream songs, build playlists, listen offline.",
    },
  ];

  return (
    <>
      <SEOHead
        title="Universflow APK — Music App for Android"
        description="Download Universflow APK for Android. Stream songs, build playlists and listen offline. Free."
        path="/get"
        keywords="Universflow APK, Universflow Android, Universflow music app, download Universflow"
        type="website"
        jsonLd={jsonLd}
        jsonLdId="getapp-jsonld"
      />

      <main className="ethereal-page min-h-[100dvh] w-full text-foreground overflow-y-auto overflow-x-hidden">

        {/* ─── HERO ───────────────────────────────────────────── */}
        <section className="relative px-5 pt-10 pb-12">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-[520px] h-[520px] rounded-full opacity-60"
            style={{
              background: "radial-gradient(closest-side, rgba(255,45,85,0.55), rgba(255,45,85,0.0) 70%)",
              filter: "blur(40px)",
            }}
          />

          <div className="relative flex flex-col items-center text-center">
            {/* Real app logo, not an AI icon */}
            <div className="w-[88px] h-[88px] rounded-full overflow-hidden bg-gradient-to-br from-[#FF2D55]/30 to-black border border-white/10 shadow-[0_20px_60px_-15px_rgba(255,45,85,0.55)] flex items-center justify-center">
              <img
                src={appLogo}
                alt="Universflow app icon — free music streaming and download for Android"
                className="w-[78%] h-[78%] object-contain"
                width={88}
                height={88}
                loading="eager"
                decoding="async"
                {...({ fetchPriority: "high" } as React.ImgHTMLAttributes<HTMLImageElement>)}
              />
            </div>

            <h1 className="mt-6 text-[40px] leading-[1.05] font-black tracking-tight">
              Universflow <br />
              <span className="bg-gradient-to-r from-[#FF2D55] via-[#FF6A88] to-[#FF2D55] bg-clip-text text-transparent">
                for Android.
              </span>
            </h1>

            <p className="mt-4 max-w-[300px] text-[15px] leading-relaxed text-white/70">
              Music app. Direct APK. No store, no sign-up to install.
            </p>

            <a
              href={APK_URL}
              download
              className="mt-7 inline-flex items-center justify-center gap-2 w-full max-w-[320px] py-4 rounded-2xl bg-[#FF2D55] text-white font-bold text-[16px] tracking-wide active:scale-[0.97] transition shadow-[0_20px_60px_-15px_rgba(255,45,85,0.7)]"
            >
              <Download className="w-5 h-5" />
              Download APK
              <span className="ml-1 text-[11px] font-medium text-white/80">· {SIZE}</span>
            </a>

            <div className="mt-3 flex items-center gap-4 text-[11px] text-white/55">
              <span>v{VERSION}</span>
              <span className="w-1 h-1 rounded-full bg-white/30" />
              <span>Android 5.1+</span>
              <span className="w-1 h-1 rounded-full bg-white/30" />
              <span>Free</span>
            </div>

            <div className="mt-5 flex items-center gap-5">
              <button onClick={handleShare} className="flex items-center gap-1.5 text-xs text-white/70 active:text-white">
                <Share2 className="w-4 h-4" /> Share
              </button>
              <Link to="/auth" className="text-xs text-white/70 underline underline-offset-4 decoration-white/20">
                Try in browser
              </Link>
            </div>
          </div>
        </section>

        {/* ─── SCREENSHOTS ───────────────────────────────────── */}
        <section className="pb-14 -mt-2">
          <div className="flex gap-4 overflow-x-auto no-scrollbar px-6 snap-x snap-mandatory pb-2">
            {SHOTS.map((s, i) => (
              <div
                key={i}
                className="snap-center shrink-0 w-[62vw] max-w-[260px] aspect-[9/19.5] rounded-[28px] overflow-hidden border border-white/10 bg-black shadow-[0_30px_80px_-20px_rgba(255,45,85,0.35)]"
                style={{ transform: i % 2 === 0 ? "translateY(0) rotate(-2deg)" : "translateY(12px) rotate(2deg)" }}
              >
                <img
                  src={s.src}
                  alt={s.alt}
                  loading={i === 0 ? "eager" : "lazy"}
                  decoding="async"
                  className="w-full h-full object-cover"
                  width={260}
                  height={563}
                  {...((i === 0 ? { fetchPriority: "high" } : {}) as React.ImgHTMLAttributes<HTMLImageElement>)}
                />
              </div>
            ))}
          </div>
        </section>

        {/* ─── INSTALL ─────────────────────────────────────────── */}
        <section className="px-5 pb-14">
          <div className="mb-5">
            <p className="text-[11px] font-semibold tracking-widest text-[#FF2D55]">INSTALL</p>
            <h2 className="mt-1 text-2xl font-extrabold">Four taps.</h2>
          </div>

          <ol className="relative pl-7 space-y-5 before:content-[''] before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-px before:bg-gradient-to-b before:from-[#FF2D55]/60 before:to-transparent">
            {[
              { t: "Download APK", b: "11 MB file in your Downloads folder." },
              { t: "Open the file", b: "Tap the download notification." },
              { t: "Allow this source", b: "First time only — Android will ask." },
              { t: "Install · Open · Play", b: "Done." },
            ].map((s, i) => (
              <li key={i} className="relative">
                <span className="absolute -left-7 top-0 flex items-center justify-center w-[22px] h-[22px] rounded-full bg-[#FF2D55] text-[11px] font-black text-white shadow-[0_0_0_4px_rgba(255,45,85,0.15)]">
                  {i + 1}
                </span>
                <p className="text-[14px] font-bold leading-tight">{s.t}</p>
                <p className="mt-1 text-[12px] text-white/60 leading-relaxed">{s.b}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* ─── FINAL CTA ───────────────────────────────────────── */}
        <section className="px-5 pb-12">
          <div className="relative rounded-3xl overflow-hidden p-8 text-center border border-white/10 bg-gradient-to-br from-[#1a0a14] to-black">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-50"
              style={{ background: "radial-gradient(circle at 50% 0%, rgba(255,45,85,0.4), transparent 60%)" }}
            />
            <div className="relative">
              <div className="w-[56px] h-[56px] mx-auto rounded-full overflow-hidden bg-black/40 border border-white/10 flex items-center justify-center">
                <img src={appLogo} alt="Universflow app logo" className="w-[78%] h-[78%] object-contain" />
              </div>
              <h2 className="mt-4 text-2xl font-extrabold leading-tight">Get Universflow</h2>
              <a
                href={APK_URL}
                download
                className="mt-6 inline-flex items-center justify-center gap-2 w-full py-4 rounded-2xl bg-white text-black font-bold text-[16px] active:scale-[0.97] transition"
              >
                <Download className="w-5 h-5" />
                Download · {SIZE}
              </a>
              <p className="mt-3 text-[10px] text-white/40 tracking-wider uppercase">Free · No sign-up to install</p>
            </div>
          </div>
        </section>

        <footer className="px-5 py-8 text-center text-[11px] text-white/60 border-t border-white/5">
          <div className="flex items-center justify-center gap-2 mb-3">
            <img src={appLogo} alt="" className="w-4 h-4 rounded-full object-contain" />
            <span className="font-bold tracking-widest text-white/80">UNIVERSFLOW</span>
          </div>
          <div className="space-x-3">
            <Link to="/premium" className="hover:text-white">Premium</Link>
            <Link to="/support" className="hover:text-white">Support</Link>
            <Link to="/auth" className="hover:text-white">Sign in</Link>
          </div>
          <div className="mt-3 text-white/40">v{VERSION} · © Universflow</div>
        </footer>
      </main>
    </>
  );
};

export default GetApp;
