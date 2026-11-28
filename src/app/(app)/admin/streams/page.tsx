import type { Metadata } from "next";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ActionButton } from "@/components/admin/action-button";
import { FilterTabs, Pager, SearchBox, buildHref, one } from "@/components/admin/admin-toolbar";
import { PrivacyBadge, StatusBadge } from "@/components/streams/stream-badges";
import { formatRelative } from "@/lib/format";
import { listAllStreams } from "@/server/admin/service";
import { requireAdmin } from "@/server/auth/session";
import { disableStreamAction, enableStreamAction } from "../actions";

export const metadata: Metadata = { robots: { index: false } };
type Filter = "all" | "live" | "reported" | "disabled";
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "live", label: "Live" },
  { value: "reported", label: "Reported" },
  { value: "disabled", label: "Disabled" },
];

export default async function AdminStreams({ searchParams }: PageProps<"/admin/streams">) {
  const [, sp] = await Promise.all([requireAdmin(), searchParams]);
  const q = (one(sp.q) ?? "").slice(0, 100);
  const filter = (FILTERS.find((f) => f.value === one(sp.filter))?.value ?? "all") as Filter;
  const page = Number(one(sp.page)) || 1;
  const { rows, total, pageCount } = await listAllStreams({ query: q, filter, page });
  const now = new Date();

  return (
    <div className="grid min-w-0 gap-4 [&>*]:min-w-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <FilterTabs path="/admin/streams" current={filter} options={FILTERS} query={q} />
        <SearchBox path="/admin/streams" query={q} filter={filter} placeholder="Title, host email or link id" />
      </div>
      <p className="text-sm text-muted-foreground">{total} streams</p>
      <Card className="py-2">
        <CardContent className="px-0">
          <ul className="divide-y">
            {rows.map((s) => (
              <li key={s.id} className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="grid min-w-0 gap-1 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium break-words">{s.title}</span>
                    <StatusBadge status={s.status} disabled={s.disabledAt != null} />
                    <PrivacyBadge privacy={s.privacy} />
                    {s.openReports > 0 && <Badge variant="destructive">{s.openReports} open reports</Badge>}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {s.hostName} ({s.hostEmail}) · created {formatRelative(s.createdAt, now)}
                    {s.lastLiveAt ? ` · last live ${formatRelative(s.lastLiveAt, now)}` : ""}
                    {s.disabledReason ? ` · reason: ${s.disabledReason}` : ""}
                  </span>
                </div>
                <div className="flex flex-wrap items-start gap-2">
                  <a
                    href={`/watch/${s.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <ExternalLink className="size-4" aria-hidden /> View
                  </a>
                  {s.disabledAt ? (
                    <ActionButton label="Enable" run={enableStreamAction.bind(null, s.id)} />
                  ) : (
                    <ActionButton
                      label={s.status === "live" ? "End & disable" : "Disable"}
                      variant="destructive"
                      askReason={`Disable "${s.title}"? ${s.status === "live" ? "The live broadcast ends now. " : ""}Viewers will see "not found". Reason (shown to the host):`}
                      run={disableStreamAction.bind(null, s.id)}
                    />
                  )}
                </div>
              </li>
            ))}
            {rows.length === 0 && <li className="px-4 py-10 text-center text-sm text-muted-foreground">No streams match.</li>}
          </ul>
        </CardContent>
      </Card>
      <Pager page={page} pageCount={pageCount} href={(p) => buildHref("/admin/streams", { q, filter, page: p })} />
    </div>
  );
}
