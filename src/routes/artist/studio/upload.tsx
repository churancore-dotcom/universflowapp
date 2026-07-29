import { createFileRoute } from "@tanstack/react-router";
import ArtistUploadPage from "@/pages/artist/Upload";

export const Route = createFileRoute("/artist/studio/upload")({ component: ArtistUploadPage });
