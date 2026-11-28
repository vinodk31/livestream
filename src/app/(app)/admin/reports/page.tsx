import type { Metadata } from "next";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ActionButton } from "@/components/admin/action-button";
import { FilterTabs, Pager, buildHref, one } from "@/components/admin/admin-toolbar";
import { formatRelative } from "@/lib/format";
import { listReports } from "@/server/admin/service";
import { requireAdmin } from "@/server/auth/session";
import { resolveReportAction } from "../actions";

export const metadata: Metadata = { robots: { index: false } };
type Status = "open" | "dismissed" | "actioned";
const FILTERS: { value: Status; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "actioned", label: "Actioned" },
  { value: "dismissed", label: "Dismissed" },
];
const REASON: Record<string, string> = {
  spam: "Spam or scam",
  harassment: "Harassment or bullying",
  hate: "Hate speech",
  violence: "Violence or dangerous acts",
  sexual: "Sexual content",
  copyright: "Copyright",
  other: "Other",
};

export default async function AdminReports({ searchParams }: PageProps<"/admin/reports">) {
  const [, sp] = await Promise.all([requireAdmin(), searchParams]);
  const status = (FILTERS.find((f) => f.value === one(sp.filter))?.value ?? "open") as Status;
  const page = Number(one(sp.page)) || 1;
  const { rows, total, pageCount } = await listReports({ status, page });
  const now = new Date();

  return (
    <div className="grid min-w-0 gap-4 [&>*]:min-w-0">
      <FilterTabs path="/admin/reports" current={status} options={FILTERS} />
      <p className="text-sm text-muted-foreground">
        {total} {status} reports
      </p>
      <Card className="py-2">
        <CardContent className="px-0">
          <ul className="divide-y">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="grid min-w-0 gap-1 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="destructive">{REASON[r.reason] ?? r.reason}</Badge>
                    <span className="font-medium break-words">{r.streamTitle}</span>
                    {r.streamDisabled && <Badge variant="outline">Stream disabled</Badge>}
                    {r.streamStatus === "live" && <Badge variant="live">LIVE</Badge>}
                  </div>
                  {r.details && <p className="whitespace-pre-line text-muted-foreground">&ldquo;{r.details}&rdquo;</p>}
                  <span className="text-xs text-muted-foreground">
                    Reported {formatRelative(r.createdAt, now)} · host {r.hostEmail}
                    {r.resolvedAt ? ` · resolved ${formatRelative(r.resolvedAt, now)}` : ""}
                    {r.resolutionNote ? ` · note: ${r.resolutionNote}` : ""}
                  </span>
                </div>
                <div className="flex flex-wrap items-start gap-2">
                  <a
                    href={`/watch/${r.streamSlug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <ExternalLink className="size-4" aria-hidden /> View stream
                  </a>
                  {status === "open" && (
                    <>
                      <ActionButton label="Dismiss" askReason="Dismiss this report. Note (optional):" run={resolveReportAction.bind(null, r.id, "dismiss")} />
                      <ActionButton
                        label="Disable stream"
                        variant="destructive"
                        askReason="Disable the stream and resolve all its open reports. Reason (shown to the host):"
                        run={resolveReportAction.bind(null, r.id, "disable_stream")}
                      />
                    </>
                  )}
                </div>
              </li>
            ))}
            {rows.length === 0 && (
              <li className="px-4 py-10 text-center text-sm text-muted-foreground">
                {status === "open" ? "No open reports. All clear." : "Nothing here yet."}
              </li>
            )}
          </ul>
        </CardContent>
      </Card>
      <Pager page={page} pageCount={pageCount} href={(p) => buildHref("/admin/reports", { filter: status, page: p })} />
    </div>
  );
}
