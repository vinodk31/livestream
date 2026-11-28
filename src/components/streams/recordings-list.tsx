import { Download, Film, Play } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCount, formatDuration } from "@/lib/format";
import type { RecordingRow } from "@/server/streams/recording-service";
import { DeleteRecordingButton } from "./delete-recording-button";

const dateFmt = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

function size(bytes: number | null): string {
  if (!bytes) return "";
  const mb = bytes / 1_048_576;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.max(1, Math.round(mb))} MB`;
}

const STATUS: Record<RecordingRow["recordingStatus"], { label: string; variant: "secondary" | "outline" | "destructive" }> = {
  none: { label: "Not recorded", variant: "outline" },
  recording: { label: "Recording", variant: "secondary" },
  processing: { label: "Processing…", variant: "secondary" },
  ready: { label: "Ready", variant: "outline" },
  failed: { label: "Failed", variant: "destructive" },
  deleted: { label: "Deleted", variant: "outline" },
};

export function RecordingsList({
  streamId,
  rows,
  configured,
  recordingEnabled,
}: {
  streamId: string;
  rows: RecordingRow[];
  configured: boolean;
  recordingEnabled: boolean;
}) {
  if (!configured) {
    return (
      <p className="text-sm text-muted-foreground">
        Recording isn&apos;t set up on this server yet. Add the <code className="text-xs">RECORDING_S3_*</code> settings in
        Vercel (see the README) and future broadcasts will be recorded automatically.
      </p>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Film className="size-5 shrink-0" aria-hidden />
        {recordingEnabled
          ? "No recordings yet. Your next broadcast will be recorded, and the replay will appear here and on the viewer link."
          : "Recording is turned off for this stream. Turn on “Record the stream” in Details to save replays."}
      </div>
    );
  }
  return (
    <ul className="grid gap-3">
      {rows.map((r) => {
        const st = STATUS[r.recordingStatus];
        return (
          <li key={r.id} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="grid gap-1 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{dateFmt.format(r.startedAt)}</span>
                <Badge variant={st.variant}>{st.label}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {[
                  r.recordingDurationSec ? formatDuration(r.recordingDurationSec) : null,
                  size(r.recordingSizeBytes),
                  `${formatCount(r.totalJoins)} views`,
                  r.recordingStatus === "ready" && r.recordingExpiresAt
                    ? `kept until ${r.recordingExpiresAt.toISOString().slice(0, 10)}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            {r.recordingStatus === "ready" && (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" asChild>
                  <a href={`/api/recordings/${r.id}`} target="_blank" rel="noopener noreferrer">
                    <Play aria-hidden /> Watch
                  </a>
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <a href={`/api/recordings/${r.id}?download=1`}>
                    <Download aria-hidden /> Download
                  </a>
                </Button>
                <DeleteRecordingButton streamId={streamId} sessionId={r.id} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
