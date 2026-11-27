import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StudioLoader } from "@/components/live/loaders";
import { requireUser } from "@/server/auth/session";
import { isLiveKitConfigured } from "@/server/livekit";
import { StreamError, getStreamForHost } from "@/server/streams/service";
import { watchUrl } from "@/server/streams/share";

export const metadata: Metadata = { title: "Studio" };

export default async function StudioPage({ params }: PageProps<"/studio/[id]">) {
  const { id } = await params;
  const user = await requireUser(`/studio/${id}`);
  const stream = await getStreamForHost(id, user.id).catch((err) => {
    if (err instanceof StreamError) notFound();
    throw err;
  });

  const blockedReason = !isLiveKitConfigured()
    ? "Live streaming isn't set up on this server yet. Add LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET in Vercel and redeploy."
    : stream.disabledAt
      ? "This stream was disabled by an administrator, so it can't go live."
      : !user.emailVerified
        ? "Verify your email (see the banner above) before going live."
        : undefined;

  return (
    <StudioLoader
      streamId={stream.id}
      title={stream.title}
      watchUrl={watchUrl(stream.slug)}
      chatEnabled={stream.chatEnabled}
      hostName={user.name}
      initiallyLive={stream.status === "live"}
      canGoLive={!blockedReason}
      blockedReason={blockedReason}
    />
  );
}
