import { createFileRoute } from "@tanstack/react-router";
import ManageSongs from "@/pages/admin/ManageSongs";

export const Route = createFileRoute("/admin/songs")({
  component: ManageSongs,
  head: () => ({ meta: [
    { title: 'UniversFlow Admin — Song Catalog' },
    { name: 'description', content: 'Review UniversFlow catalog quality, sort and export songs, and manage visibility.' },
    { property: 'og:title', content: 'UniversFlow Admin — Song Catalog' },
    { property: 'og:description', content: 'UniversFlow catalog management and song review.' },
    { property: 'og:type', content: 'website' },
    { name: 'twitter:card', content: 'summary' },
  ] }),
});
