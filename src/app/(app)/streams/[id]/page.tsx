import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CircleCheck, Download, Eye, Radio } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CopyField } from "@/components/streams/copy-field";
import { DangerZone } from "@/components/streams/danger-zone";
import { PrivacyBadge, StatusBadge } from "@/components/streams/stream-badges";
import { StreamForm } from "@/components/streams/stream-form";
import { ThumbnailEditor } from "@/components/streams/thumbnail-editor";
import { formatCount, formatDuration, formatRelative } from "@/lib/format";
import { requireUser } from "@/server/auth/session";
import { StreamError, getStreamForHost } from "@/server/streams/service";
import { qrSvg, watchUrl } from "@/server/streams/share";
import { getStreamStats } from "@/server/streams/queries";
import { updateStreamAction } from "../actions";

export const metadata: Metadata = { title: "Stream" };

export default async function StreamDetailsPage({ params, searchParams }: PageProps<"/streams/[id]">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const user = await requireUser(`/streams/${id}`);
  const stream = await getStreamForHost(id, user.id).catch((err) => {
    if (err instanceof StreamError) notFound();
    throw err;
  });

  const url = watchUrl(stream.slug);
  const [svg, stats] = await Promise.all([qrSvg(url), getStreamStats(stream.id)]);
  const now = new Date();

  return (
    <div className="grid gap-6">
      <Button variant="ghost" size="sm" asChild className="w-fit">
        <Link href="/streams">
          <ArrowLeft aria-hidden /> My Streams
        </Link>
      </Button>

      {sp.created === "1" && (
        <Alert variant="success">
          <CircleCheck />
          <AlertDescription>
            Stream created. Share the link below. Viewers will see a waiting screen until you go live.
          </AlertDescription>
        </Alert>
      )}
      {stream.disabledAt && (
        <Alert variant="destructive">
          <AlertDescription>
            This stream was disabled by an administrator{stream.disabledReason ? `: ${stream.disabledReason}` : "."}
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-2">
          <h1 className="text-2xl font-semibold tracking-tight break-words">{stream.title}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <StatusBadge status={stream.status} disabled={stream.disabledAt != null} />
            <PrivacyBadge privacy={stream.privacy} />
            <span>
              {stream.lastLiveAt ? `Last live ${formatRelative(stream.lastLiveAt, now)}` : `Created ${formatRelative(stream.createdAt, now)}`}
            </span>
          </div>
        </div>
        <Button variant="live" disabled title="Going live arrives in the next update">
          <Radio aria-hidden /> Go live
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="grid gap-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Share with viewers</CardTitle>
              <CardDescription>
                {stream.privacy === "private"
                  ? "Viewers need this link and the passcode. No account or app needed."
                  : "Anyone with this link can watch. No account or app needed."}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5">
              <CopyField value={url} label="Viewer link" />
              <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
                <div
                  className="size-40 shrink-0 rounded-lg border bg-white p-1 [&>svg]:size-full"
                  role="img"
                  aria-label={`QR code for ${url}`}
                  dangerouslySetInnerHTML={{ __html: svg }}
                />
                <div className="grid gap-3 text-sm">
                  <p className="text-muted-foreground">
                    Put the QR code on a slide, poster or printed program. Scanning it opens the stream on any phone.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" asChild>
                      <a href={`/streams/${stream.id}/qr?format=png`} download>
                        <Download aria-hidden /> PNG
                      </a>
                    </Button>
                    <Button variant="outline" size="sm" asChild>
                      <a href={`/streams/${stream.id}/qr?format=svg`} download>
                        <Download aria-hidden /> SVG
                      </a>
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
              <CardDescription>Changes apply immediately, even while live.</CardDescription>
            </CardHeader>
            <CardContent>
              <StreamForm
                mode="edit"
                action={updateStreamAction.bind(null, stream.id)}
                defaults={{
                  title: stream.title,
                  description: stream.description ?? "",
                  privacy: stream.privacy,
                  chatEnabled: stream.chatEnabled,
                  recordingEnabled: stream.recordingEnabled,
                  hasPasscode: stream.passcodeHash != null,
                }}
              />
            </CardContent>
          </Card>
        </div>

        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Thumbnail</CardTitle>
              <CardDescription>Shown on the viewer page before you go live.</CardDescription>
            </CardHeader>
            <CardContent>
              <ThumbnailEditor streamId={stream.id} title={stream.title} url={stream.thumbnailUrl} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Eye className="size-4" aria-hidden /> Stats
              </CardTitle>
              <CardDescription>All broadcasts of this stream.</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-muted-foreground">Views</dt>
                  <dd className="text-xl font-semibold tabular-nums">{formatCount(stats.views)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Peak viewers</dt>
                  <dd className="text-xl font-semibold tabular-nums">{formatCount(stats.peakViewers)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Watch time</dt>
                  <dd className="text-xl font-semibold tabular-nums">{formatDuration(stats.watchSeconds)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Broadcasts</dt>
                  <dd className="text-xl font-semibold tabular-nums">{stats.broadcasts}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle>Danger zone</CardTitle>
        </CardHeader>
        <CardContent>
          <DangerZone streamId={stream.id} isLive={stream.status === "live"} />
        </CardContent>
      </Card>
    </div>
  );
}
