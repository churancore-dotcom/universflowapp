import { createFileRoute } from "@tanstack/react-router";
import LegalTerms from "@/pages/legal/Terms";

export const Route = createFileRoute("/legal/terms")({ component: LegalTerms });
