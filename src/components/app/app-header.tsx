import { LogOut } from "lucide-react";
import { logoutAction } from "@/app/(auth)/actions";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import type { CurrentUser } from "@/server/auth/session";
import { NavLinks, type NavItem } from "./nav-links";

export function AppHeader({ user }: { user: CurrentUser }) {
  const nav: NavItem[] = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/streams", label: "My Streams" },
    { href: "/settings", label: "Settings" },
    ...(user.role === "admin" ? [{ href: "/admin", label: "Admin" }] : []),
  ];
  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
        <Logo />
        <nav aria-label="Main" className="hidden sm:block">
          <NavLinks items={nav} className="flex items-center gap-1 text-sm" />
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
      <nav aria-label="Main" className="sm:hidden">
        <NavLinks items={nav} className="flex gap-1 overflow-x-auto px-2 pb-2 text-sm" />
      </nav>
    </header>
  );
}
