import Link from "next/link";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function buildHref(path: string, params: Record<string, string | number | undefined>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "" && v !== "all" && !(k === "page" && v === 1)) sp.set(k, String(v));
  const qs = sp.toString();
  return qs ? `${path}?${qs}` : path;
}

export function FilterTabs<T extends string>({
  path,
  current,
  options,
  query,
}: {
  path: string;
  current: T;
  options: { value: T; label: string }[];
  query?: string;
}) {
  return (
    <nav aria-label="Filter" className="flex gap-1 overflow-x-auto rounded-lg bg-muted p-1 text-sm">
      {options.map((o) => (
        <Link
          key={o.value}
          href={buildHref(path, { filter: o.value, q: query })}
          aria-current={current === o.value ? "page" : undefined}
          className={cn(
            "rounded-md px-3 py-1 whitespace-nowrap",
            current === o.value ? "bg-background font-medium shadow-xs" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </Link>
      ))}
    </nav>
  );
}

export function SearchBox({ path, query, filter, placeholder }: { path: string; query: string; filter?: string; placeholder: string }) {
  return (
    <form role="search" action={path} className="relative sm:w-72">
      {filter && filter !== "all" && <input type="hidden" name="filter" value={filter} />}
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input name="q" type="search" defaultValue={query} placeholder={placeholder} aria-label={placeholder} className="bg-background pl-9" />
    </form>
  );
}

export function Pager({ page, pageCount, href }: { page: number; pageCount: number; href: (p: number) => string }) {
  if (pageCount <= 1) return null;
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between text-sm">
      <Button variant="outline" size="sm" asChild className={cn(page <= 1 && "pointer-events-none opacity-50")}>
        <Link href={href(page - 1)} aria-disabled={page <= 1}>
          <ChevronLeft aria-hidden /> Previous
        </Link>
      </Button>
      <span className="text-muted-foreground">
        Page {page} of {pageCount}
      </span>
      <Button variant="outline" size="sm" asChild className={cn(page >= pageCount && "pointer-events-none opacity-50")}>
        <Link href={href(page + 1)} aria-disabled={page >= pageCount}>
          Next <ChevronRight aria-hidden />
        </Link>
      </Button>
    </nav>
  );
}

export function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}
