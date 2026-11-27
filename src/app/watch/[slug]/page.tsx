import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { Logo } from "@/components/logo";
import { PasscodeGate } from "@/components/live/passcode-gate";
import { PlayerLoader } from "@/components/live/loaders";
import { accessCookieName, hasViewerAccess, getViewerStream } from "@/server/streams/broadcast";
import { getPublicStream } from "@/server/streams/public";

export async function generateMetadata({ params }: PageProps<"/watch/[slug]">): Promise<Metadata> {
  const stream = await getPublicStream((await params).slug);
  if (!stream) return { title: "Stream not found", robots: { index: false } };
  const isPrivate = stream.privacy === "private";
  return {
    title: isPrivate ? "Private stream" : stream.title,
    description: isPrivate ? undefined : (stream.description ?? `A live stream by ${stream.hostName}`),
    robots: { index: stream.privacy === "public", follow: false },
    referrer: "no-referrer",
  };
}

export default async function WatchPage({ params }: PageProps<"/watch/[slug]">) {
  const { slug } = await params;
  const [stream, access] = await Promise.all([getPublicStream(slug), getViewerStream(slug)]);
  if (!stream || !access) notFound();
  const jar = await cookies();
  const unlocked = hasViewerAccess(access, jar.get(accessCookieName(access.id))?.value);

  return (
    <div className="flex min-h-svh flex-col bg-neutral-950 text-white">
      <header className="flex h-14 items-center px-4">
        <Logo className="text-white" />
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-10">
        {unlocked ? (
          <>
            <PlayerLoader
              slug={slug}
              initialStatus={stream.status}
              title={stream.title}
              hostName={stream.hostName}
              thumbnailUrl={stream.thumbnailUrl}
              chatEnabled={stream.chatEnabled}
            />
            {stream.description && (
              <p className="mt-4 max-w-3xl text-sm whitespace-pre-line text-white/80">{stream.description}</p>
            )}
          </>
        ) : (
          <div className="mx-auto max-w-4xl">
            <PasscodeGate slug={slug} />
          </div>
        )}
      </main>
    </div>
  );
}
