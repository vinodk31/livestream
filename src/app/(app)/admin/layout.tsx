import { NavLinks } from "@/components/app/nav-links";
import { Toaster } from "@/components/admin/toaster";
import { Badge } from "@/components/ui/badge";
import { requireAdmin } from "@/server/auth/session";

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  await requireAdmin();
  return (
    <div className="grid min-w-0 gap-6 [&>*]:min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          Admin <Badge variant="secondary">Staff only</Badge>
        </h1>
        <NavLinks
          className="flex max-w-full gap-1 overflow-x-auto text-sm"
          items={[
            { href: "/admin/overview", label: "Overview" },
            { href: "/admin/users", label: "Users" },
            { href: "/admin/streams", label: "Streams" },
            { href: "/admin/reports", label: "Reports" },
            { href: "/admin/audit", label: "Audit log" },
          ]}
        />
      </div>
      {children}
      <Toaster />
    </div>
  );
}
