import { createFileRoute } from "@tanstack/react-router";
import { getSongSeo } from "@/lib/songSeo.functions";
import { SITE_ORIGIN } from "@/lib/routeSeo";

function SongLanding() {
  const { song } = Route.useLoaderData();
  const title = song?.title || "This song";
  const artist = song?.artist || "Universflow";

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col items-center justify-center gap-6 px-6 py-12 text-center">
        {song?.cover_url ? (
          <img
            src={song.cover_url}
            alt={`${song.title} cover art`}
            className="h-44 w-44 rounded-2xl border border-border object-cover shadow-lg"
          />
        ) : (
          <div className="flex h-44 w-44 items-center justify-center rounded-2xl border border-border bg-muted text-5xl shadow-lg">
            🎵
          </div>
        )}

        <div className="space-y-1">
          <h1 className="text-2xl font-bold leading-tight break-words">{title}</h1>
          <p className="text-muted-foreground">{artist}</p>
        </div>

        <p className="text-sm text-muted-foreground">
          Listen free on Universflow — stream, download and take your music offline.
        </p>

        <div className="flex w-full flex-col gap-3">
          <a
            href={`${SITE_ORIGIN}/get`}
            className="w-full rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground"
          >
            Get the app
          </a>
          <a
            href={`${SITE_ORIGIN}/`}
            className="w-full rounded-xl border border-border bg-card px-6 py-3 font-semibold text-card-foreground"
          >
            Open in browser
          </a>
        </div>

        <p className="text-xs text-muted-foreground">Universflow · Free music streaming</p>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/song/$songId")({
  loader: async ({ params }) => ({ song: await getSongSeo({ data: { songId: params.songId } }).catch(() => null) }),
  head: ({ params, loaderData }) => {
    const song = loaderData?.song;
    const name = song?.title || "A song";
    const title = `${name}${song?.artist ? ` — ${song.artist}` : ""} | Universflow`;
    const description = song?.artist
      ? `Listen to ${song.title} by ${song.artist} free on Universflow. Stream, download and listen offline.`
      : `Listen to this song free on Universflow. Stream, download and listen offline.`;
    const url = `${SITE_ORIGIN}/song/${encodeURIComponent(params.songId)}`;
    const image = song?.cover_url && /^https:\/\//.test(song.cover_url) ? song.cover_url : null;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        ...(song ? [] : [{ name: "robots", content: "noindex, follow" }]),
        { property: "og:type", content: "music.song" },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:url", content: url },
        { name: "twitter:card", content: image ? "summary_large_image" : "summary" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        ...(image ? [{ property: "og:image", content: image }, { name: "twitter:image", content: image }] : []),
      ],
      links: [{ rel: "canonical", href: url }],
    };
  },
  component: SongLanding,
});
