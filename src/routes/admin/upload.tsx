import { createFileRoute } from "@tanstack/react-router";
import UploadMusic from "@/pages/admin/UploadMusic";

export const Route = createFileRoute("/admin/upload")({ component: UploadMusic });
