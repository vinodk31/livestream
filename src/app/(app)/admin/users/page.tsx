import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ActionButton } from "@/components/admin/action-button";
import { FilterTabs, Pager, SearchBox, buildHref, one } from "@/components/admin/admin-toolbar";
import { formatRelative } from "@/lib/format";
import { listUsers } from "@/server/admin/service";
import { requireAdmin } from "@/server/auth/session";
import { deleteUserAction, disableUserAction, enableUserAction, verifyUserAction } from "../actions";

export const metadata: Metadata = { robots: { index: false } };
type Filter = "all" | "disabled" | "unverified" | "admins";
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "unverified", label: "Unverified" },
  { value: "disabled", label: "Disabled" },
  { value: "admins", label: "Admins" },
];

export default async function AdminUsers({ searchParams }: PageProps<"/admin/users">) {
  const [me, sp] = await Promise.all([requireAdmin(), searchParams]);
  const q = (one(sp.q) ?? "").slice(0, 100);
  const filter = (FILTERS.find((f) => f.value === one(sp.filter))?.value ?? "all") as Filter;
  const page = Number(one(sp.page)) || 1;
  const { rows, total, pageCount } = await listUsers({ query: q, filter, page });
  const now = new Date();

  return (
    <div className="grid min-w-0 gap-4 [&>*]:min-w-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <FilterTabs path="/admin/users" current={filter} options={FILTERS} query={q} />
        <SearchBox path="/admin/users" query={q} filter={filter} placeholder="Search name or email" />
      </div>
      <p className="text-sm text-muted-foreground">{total} users</p>
      <Card className="py-2">
        <CardContent className="px-0">
          <ul className="divide-y">
            {rows.map((u) => (
              <li key={u.id} className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="grid min-w-0 gap-1 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{u.name}</span>
                    {u.role === "admin" && <Badge>Admin</Badge>}
                    {u.disabledAt && <Badge variant="destructive">Disabled</Badge>}
                    {!u.emailVerifiedAt && <Badge variant="outline">Unverified</Badge>}
                  </div>
                  <span className="truncate text-muted-foreground">{u.email}</span>
                  <span className="text-xs text-muted-foreground">
                    Joined {formatRelative(u.createdAt, now)} · {u.streams} streams ·{" "}
                    {u.lastLoginAt ? `last sign-in ${formatRelative(u.lastLoginAt, now)}` : "never signed in"}
                    {u.disabledReason ? ` · reason: ${u.disabledReason}` : ""}
                  </span>
                </div>
                {u.id !== me.id && u.role !== "admin" && (
                  <div className="flex flex-wrap gap-2">
                    {!u.emailVerifiedAt && <ActionButton label="Mark verified" run={verifyUserAction.bind(null, u.id)} />}
                    {u.disabledAt ? (
                      <ActionButton label="Enable" run={enableUserAction.bind(null, u.id)} />
                    ) : (
                      <ActionButton
                        label="Disable"
                        askReason={`Disable ${u.email}? They'll be signed out and their live streams ended. Reason (optional):`}
                        run={disableUserAction.bind(null, u.id)}
                      />
                    )}
                    <ActionButton
                      label="Delete"
                      variant="destructive"
                      confirmText={`Permanently delete ${u.email} and all their streams and recordings? This can't be undone.`}
                      run={deleteUserAction.bind(null, u.id)}
                    />
                  </div>
                )}
              </li>
            ))}
            {rows.length === 0 && <li className="px-4 py-10 text-center text-sm text-muted-foreground">No users match.</li>}
          </ul>
        </CardContent>
      </Card>
      <Pager page={page} pageCount={pageCount} href={(p) => buildHref("/admin/users", { q, filter, page: p })} />
    </div>
  );
}
