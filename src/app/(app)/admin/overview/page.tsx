import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCount, formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getPlatformStats } from "@/server/admin/service";

export const metadata: Metadata = { robots: { index: false } };

export default async function AdminOverview() {
  const s = await getPlatformStats();
  const tiles = [
    { label: "Users", value: formatCount(s.users.total), hint: `${s.users.new7d} new in 7 days · ${s.users.verified} verified`, href: "/admin/users" },
    { label: "Live now", value: String(s.streams.live), hint: `${formatCount(s.streams.total)} streams total`, href: "/admin/streams?filter=live", live: s.streams.live > 0 },
    { label: "Open reports", value: String(s.openReports), hint: "Waiting for review", href: "/admin/reports", alert: s.openReports > 0 },
    { label: "Broadcasts", value: formatCount(s.last30d.broadcasts), hint: "Last 30 days" },
    { label: "Views", value: formatCount(s.last30d.views), hint: "Last 30 days" },
    { label: "Watch time", value: formatDuration(s.last30d.watchSeconds), hint: "Last 30 days" },
    { label: "Peak viewers", value: formatCount(s.last30d.peakViewers), hint: "Single broadcast, last 30 days" },
    { label: "Disabled", value: `${s.users.disabled} / ${s.streams.disabled}`, hint: "Users / streams" },
  ];
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {tiles.map((t) => {
        const body = (
          <Card className={cn("h-full gap-2 py-5", t.href && "transition-colors hover:bg-accent/50")}>
            <CardHeader className="px-5">
              <CardDescription>{t.label}</CardDescription>
            </CardHeader>
            <CardContent className="px-5">
              <p className={cn("text-2xl font-semibold tabular-nums", t.live && "text-live", t.alert && "text-destructive")}>{t.value}</p>
              <p className="text-xs text-muted-foreground">{t.hint}</p>
            </CardContent>
          </Card>
        );
        return t.href ? (
          <Link key={t.label} href={t.href} className="rounded-xl focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
            {body}
          </Link>
        ) : (
          <div key={t.label}>{body}</div>
        );
      })}
      <Card className="col-span-2 lg:col-span-4">
        <CardHeader>
          <CardTitle>Making someone an admin</CardTitle>
          <CardDescription>
            Run <code className="text-xs">UPDATE users SET role = &apos;admin&apos; WHERE lower(email) = &apos;them@example.com&apos;;</code> in
            the Neon SQL editor, or <code className="text-xs">npm run db:make-admin -- them@example.com</code> locally.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
