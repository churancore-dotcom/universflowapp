import { createFileRoute } from "@tanstack/react-router";
import LegalPrivacy from "@/pages/legal/Privacy";

export const Route = createFileRoute("/legal/privacy")({ component: LegalPrivacy });
