"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export type NavItem = { href: string; label: string };

export function NavLinks({ items, className, itemClassName }: { items: NavItem[]; className?: string; itemClassName?: string }) {
  const pathname = usePathname();
  return (
    <div className={className}>
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 whitespace-nowrap transition-colors hover:bg-accent hover:text-foreground",
              active ? "bg-accent font-medium text-foreground" : "text-muted-foreground",
              itemClassName,
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
