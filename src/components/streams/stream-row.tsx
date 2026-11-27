import Link from "next/link";
import { Eye, Radio } from "lucide-react";
import { formatCount, formatRelative } from "@/lib/format";
import type { StreamListItem } from "@/server/streams/queries";
import { PrivacyBadge, StatusBadge } from "./stream-badges";

export function StreamThumb({ title, url }: { title: string; url: string | null }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element -- user-uploaded thumbnails (module 4)
    return <img src={url} alt="" className="aspect-video w-28 shrink-0 rounded-md object-cover sm:w-36" />;
  }
  return (
    <div
      aria-hidden
      className="flex aspect-video w-28 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-neutral-800 to-neutral-600 text-lg font-semibold text-white/80 sm:w-36"
    >
      {title.trim().charAt(0).toUpperCase() || "•"}
    </div>
  );
}

export function StreamRow({ stream, now }: { stream: StreamListItem; now: Date }) {
  const when = stream.lastLiveAt
    ? stream.status === "live"
      ? "Live now"
      : `Last live ${formatRelative(stream.lastLiveAt, now)}`
    : `Created ${formatRelative(stream.createdAt, now)}`;
  return (
    <li>
      <Link
        href={`/streams/${stream.id}`}
        className="flex items-center gap-4 rounded-lg p-3 transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <StreamThumb title={stream.title} url={stream.thumbnailUrl} />
        <div className="grid min-w-0 flex-1 gap-1.5">
          <p className="truncate font-medium">{stream.title}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge status={stream.status} disabled={stream.disabled} />
            <PrivacyBadge privacy={stream.privacy} />
          </div>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{when}</span>
            <span className="inline-flex items-center gap-1">
              <Eye className="size-3" aria-hidden /> {formatCount(stream.totalViews)} views
            </span>
            {stream.broadcasts > 1 && (
              <span className="inline-flex items-center gap-1">
                <Radio className="size-3" aria-hidden /> {stream.broadcasts} broadcasts
              </span>
            )}
          </p>
        </div>
      </Link>
    </li>
  );
}
