import { createFileRoute } from "@tanstack/react-router";
import ArtistPublic from "@/pages/artist/ArtistPublic";
import { getArtistSeo } from "@/lib/artistSeo.functions";
import { SITE_ORIGIN } from "@/lib/routeSeo";

export const Route = createFileRoute("/a/$slug")({
  loader: async ({ params }) => ({ artist: await getArtistSeo({ data: { slug: params.slug } }).catch(() => null) }),
  head: ({ params, loaderData }) => {
    const a = loaderData?.artist;
    const name = a?.stage_name || "Artist";
    const title = `${name} — Songs & Profile | Universflow`;
    const description = (a?.bio?.trim() || `Listen to ${name}'s songs, latest releases and profile on Universflow.`).slice(0, 160);
    const url = `${SITE_ORIGIN}/a/${params.slug}`;
    const image = a?.avatar_url && /^https:\/\//.test(a.avatar_url) ? a.avatar_url : null;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "profile" },
        { property: "og:url", content: url },
        { name: "twitter:card", content: image ? "summary_large_image" : "summary" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        ...(image ? [{ property: "og:image", content: image }, { name: "twitter:image", content: image }] : []),
      ],
      links: [{ rel: "canonical", href: url }],
      scripts: [{
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "MusicGroup",
          name,
          url,
          ...(a?.bio ? { description: a.bio.slice(0, 300) } : {}),
          ...(image ? { image } : {}),
        }),
      }],
    };
  },
  component: ArtistPublic,
});
