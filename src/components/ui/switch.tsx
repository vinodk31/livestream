"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/** Accessible on/off toggle backed by a native checkbox, so it works in plain <form> posts. */
export function Switch({
  id,
  name,
  defaultChecked,
  label,
  description,
}: {
  id: string;
  name: string;
  defaultChecked?: boolean;
  label: string;
  description?: string;
}) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border p-3">
      <span className="grid gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        {description && <span className="text-xs text-muted-foreground">{description}</span>}
      </span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input id={id} name={name} type="checkbox" role="switch" defaultChecked={defaultChecked} className="peer sr-only" />
        <span
          aria-hidden
          className={cn(
            "h-5 w-9 rounded-full bg-input transition-colors peer-checked:bg-primary",
            "peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50",
            "after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-background after:shadow-sm after:transition-transform peer-checked:after:translate-x-4",
          )}
        />
      </span>
    </label>
  );
}
