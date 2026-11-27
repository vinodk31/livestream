import Link from "next/link";
import { LogOut } from "lucide-react";
import { logoutAction } from "@/app/(auth)/actions";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import type { CurrentUser } from "@/server/auth/session";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/streams", label: "My Streams" },
  { href: "/settings", label: "Settings" },
];

export function AppHeader({ user }: { user: CurrentUser }) {
  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
        <Logo />
        <nav className="hidden items-center gap-1 text-sm sm:flex" aria-label="Main">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
          {user.role === "admin" && (
            <Link
              href="/admin"
              className="rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              Admin
            </Link>
          )}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden max-w-48 truncate text-sm text-muted-foreground md:inline" title={user.email}>
            {user.name}
          </span>
          <form action={logoutAction}>
            <Button variant="ghost" size="sm" type="submit">
              <LogOut aria-hidden />
              Sign out
            </Button>
          </form>
        </div>
      </div>
      <nav className="flex gap-1 overflow-x-auto px-2 pb-2 text-sm sm:hidden" aria-label="Main mobile">
        {NAV.map((item) => (
          <Link key={item.href} href={item.href} className="rounded-md px-3 py-1.5 text-muted-foreground hover:bg-accent">
            {item.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
