import type { Metadata } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { FilterTabs, Pager, buildHref, one } from "@/components/admin/admin-toolbar";
import { listAuditLog } from "@/server/admin/service";
import { requireAdmin } from "@/server/auth/session";

export const metadata: Metadata = { robots: { index: false } };
type Filter = "all" | "auth" | "account" | "stream" | "admin" | "report" | "recording";
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "admin", label: "Admin" },
  { value: "auth", label: "Sign-in" },
  { value: "stream", label: "Streams" },
  { value: "report", label: "Reports" },
  { value: "account", label: "Accounts" },
  { value: "recording", label: "Recordings" },
];
const timeFmt = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "medium" });

export default async function AdminAudit({ searchParams }: PageProps<"/admin/audit">) {
  const [, sp] = await Promise.all([requireAdmin(), searchParams]);
  const filter = (FILTERS.find((f) => f.value === one(sp.filter))?.value ?? "all") as Filter;
  const page = Number(one(sp.page)) || 1;
  const { rows, total, pageCount } = await listAuditLog({ action: filter === "all" ? undefined : `${filter}.`, page });

  return (
    <div className="grid min-w-0 gap-4 [&>*]:min-w-0">
      <FilterTabs path="/admin/audit" current={filter} options={FILTERS} />
      <p className="text-sm text-muted-foreground">{total} events</p>
      <Card className="py-2">
        <CardContent className="overflow-x-auto px-0">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">When</th>
                <th className="px-4 py-2 font-medium">Action</th>
                <th className="px-4 py-2 font-medium">Who</th>
                <th className="px-4 py-2 font-medium">Target</th>
                <th className="px-4 py-2 font-medium">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">{timeFmt.format(r.createdAt)}</td>
                  <td className="px-4 py-2 font-mono text-xs">{r.action}</td>
                  <td className="px-4 py-2">{r.actorEmail ?? <span className="text-muted-foreground">system / deleted</span>}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{r.targetType ? `${r.targetType} ${r.targetId?.slice(0, 8)}` : ""}</td>
                  <td className="max-w-xs px-4 py-2 font-mono text-xs break-words text-muted-foreground">
                    {r.metadata ? JSON.stringify(r.metadata) : ""}
                    {r.ip ? ` ${r.ip}` : ""}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                    No events.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <Pager page={page} pageCount={pageCount} href={(p) => buildHref("/admin/audit", { filter, page: p })} />
    </div>
  );
}
