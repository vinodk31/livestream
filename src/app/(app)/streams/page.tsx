import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, CircleCheck, Plus, Radio, Search } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { StreamRow } from "@/components/streams/stream-row";
import { cn } from "@/lib/utils";
import { requireUser } from "@/server/auth/session";
import { listStreams, type StreamStatusFilter } from "@/server/streams/queries";

export const metadata: Metadata = { title: "My Streams" };

const FILTERS: { value: StreamStatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "live", label: "Live" },
  { value: "idle", label: "Ready" },
  { value: "ended", label: "Ended" },
];

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function StreamsPage({ searchParams }: PageProps<"/streams">) {
  const [user, params] = await Promise.all([requireUser("/streams"), searchParams]);
  const statusParam = one(params.status);
  const status: StreamStatusFilter = FILTERS.some((f) => f.value === statusParam)
    ? (statusParam as StreamStatusFilter)
    : "all";
  const query = (one(params.q) ?? "").slice(0, 100);
  const page = Number.parseInt(one(params.page) ?? "1", 10) || 1;

  const now = new Date();
  const result = await listStreams(user.id, { status, query, page });
  const filtered = status !== "all" || query !== "";

  const href = (next: { status?: StreamStatusFilter; page?: number }) => {
    const sp = new URLSearchParams();
    const s = next.status ?? status;
    if (s !== "all") sp.set("status", s);
    if (query) sp.set("q", query);
    if (next.page && next.page > 1) sp.set("page", String(next.page));
    const qs = sp.toString();
    return qs ? `/streams?${qs}` : "/streams";
  };

  return (
    <div className="grid gap-6">
      {one(params.deleted) === "1" && (
        <Alert variant="success">
          <CircleCheck />
          <AlertDescription>Stream deleted.</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My Streams</h1>
          <p className="text-muted-foreground">
            {result.total} {result.total === 1 ? "stream" : "streams"}
            {filtered ? " matching" : ""}
          </p>
        </div>
        <Button asChild>
          <Link href="/streams/new">
            <Plus aria-hidden /> New stream
          </Link>
        </Button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <nav aria-label="Filter by status" className="flex gap-1 overflow-x-auto rounded-lg bg-muted p-1 text-sm">
          {FILTERS.map((f) => (
            <Link
              key={f.value}
              href={href({ status: f.value, page: 1 })}
              aria-current={status === f.value ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-1 whitespace-nowrap transition-colors",
                status === f.value ? "bg-background font-medium shadow-xs" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
            </Link>
          ))}
        </nav>
        <form role="search" action="/streams" className="relative sm:w-72">
          {status !== "all" && <input type="hidden" name="status" value={status} />}
          <label htmlFor="stream-search" className="sr-only">
            Search streams
          </label>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input id="stream-search" name="q" type="search" placeholder="Search by title" defaultValue={query} className="bg-background pl-9" />
        </form>
      </div>

      <Card className="py-3">
        <CardContent className="px-3">
          {result.items.length ? (
            <ul className="grid gap-1">
              {result.items.map((s) => (
                <StreamRow key={s.id} stream={s} now={now} />
              ))}
            </ul>
          ) : (
            <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
              <Radio className="size-6 text-muted-foreground" aria-hidden />
              {filtered ? (
                <>
                  <p className="font-medium">No streams match</p>
                  <Button variant="outline" size="sm" asChild>
                    <Link href="/streams">Clear filters</Link>
                  </Button>
                </>
              ) : (
                <>
                  <div>
                    <p className="font-medium">No streams yet</p>
                    <p className="text-sm text-muted-foreground">Create a stream to get a link you can share.</p>
                  </div>
                  <Button size="sm" asChild>
                    <Link href="/streams/new">
                      <Plus aria-hidden /> Create stream
                    </Link>
                  </Button>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {result.pageCount > 1 && (
        <nav aria-label="Pagination" className="flex items-center justify-between text-sm">
          <Button variant="outline" size="sm" asChild className={cn(result.page <= 1 && "pointer-events-none opacity-50")}>
            <Link href={href({ page: result.page - 1 })} aria-disabled={result.page <= 1}>
              <ChevronLeft aria-hidden /> Previous
            </Link>
          </Button>
          <span className="text-muted-foreground">
            Page {result.page} of {result.pageCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            asChild
            className={cn(result.page >= result.pageCount && "pointer-events-none opacity-50")}
          >
            <Link href={href({ page: result.page + 1 })} aria-disabled={result.page >= result.pageCount}>
              Next <ChevronRight aria-hidden />
            </Link>
          </Button>
        </nav>
      )}
    </div>
  );
}
