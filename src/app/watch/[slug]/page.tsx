import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Lock, Radio } from "lucide-react";
import { Logo } from "@/components/logo";
import { getPublicStream } from "@/server/streams/public";

// Interim viewer page: shows the stream card. The live player and passcode entry arrive in module 6.

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
  const stream = await getPublicStream((await params).slug);
  if (!stream) notFound();
  const isPrivate = stream.privacy === "private";

  return (
    <div className="flex min-h-svh flex-col bg-neutral-950 text-white">
      <header className="flex h-14 items-center px-4">
        <Logo className="text-white" />
      </header>
      <main className="mx-auto grid w-full max-w-4xl flex-1 content-start gap-6 px-4 py-6">
        <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-xl bg-neutral-900">
          {stream.thumbnailUrl && !isPrivate && (
            // eslint-disable-next-line @next/next/no-img-element -- user-uploaded thumbnail
            <img src={stream.thumbnailUrl} alt="" className="absolute inset-0 size-full object-cover opacity-40" />
          )}
          <div className="relative grid justify-items-center gap-3 px-6 text-center">
            {isPrivate ? (
              <>
                <Lock className="size-8" aria-hidden />
                <p className="text-lg font-medium">This stream is private</p>
                <p className="text-sm text-white/70">You&apos;ll be asked for the passcode here.</p>
              </>
            ) : stream.status === "live" ? (
              <>
                <span className="inline-flex items-center gap-2 rounded bg-live px-2 py-1 text-xs font-semibold">
                  <span className="size-1.5 animate-pulse rounded-full bg-white" aria-hidden /> LIVE
                </span>
                <p className="text-lg font-medium">The player is coming in the next update.</p>
              </>
            ) : (
              <>
                <Radio className="size-8" aria-hidden />
                <p className="text-lg font-medium">
                  {stream.status === "ended" ? "This stream has ended" : "This stream hasn't started yet"}
                </p>
                <p className="text-sm text-white/70">Keep this page open. It will start when the host goes live.</p>
              </>
            )}
          </div>
        </div>
        {!isPrivate && (
          <div className="grid gap-1">
            <h1 className="text-xl font-semibold break-words">{stream.title}</h1>
            <p className="text-sm text-white/60">{stream.hostName}</p>
            {stream.description && <p className="mt-2 text-sm whitespace-pre-line text-white/80">{stream.description}</p>}
          </div>
        )}
      </main>
    </div>
  );
}
