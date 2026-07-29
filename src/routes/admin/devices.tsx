import { createFileRoute } from "@tanstack/react-router";
import RegisteredDevices from "@/pages/admin/RegisteredDevices";

export const Route = createFileRoute("/admin/devices")({ component: RegisteredDevices });
