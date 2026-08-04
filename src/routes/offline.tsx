import { createFileRoute } from "@tanstack/react-router";
import Offline from "@/pages/Offline";

// Deliberately NOT auth-gated: this screen exists for the case where the
// device has no usable connection, and /auth cannot complete without one.
export const Route = createFileRoute("/offline")({
  component: Offline,
});
