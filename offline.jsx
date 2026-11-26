import { createFileRoute } from "@tanstack/react-router";
import SyncDashboard from "@/components/offline/SyncDashboard";

export const Route = createFileRoute("/_authed/offline")({
  ssr: false,
  head: () => ({ meta: [{ title: "Offline & sync — PadalaPay" }] }),
  component: SyncDashboard,
});