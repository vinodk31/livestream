"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";

// LiveKit is browser-only (WebRTC, media devices), so these never render on the server.
const loading = () => (
  <div className="flex aspect-video items-center justify-center rounded-xl bg-neutral-900">
    <Loader2 className="size-6 animate-spin text-white" aria-label="Loading" />
  </div>
);

export const StudioLoader = dynamic(() => import("./studio").then((m) => m.Studio), { ssr: false, loading });
export const PlayerLoader = dynamic(() => import("./player").then((m) => m.Player), { ssr: false, loading });
