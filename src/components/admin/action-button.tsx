"use client";

import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AdminResult } from "@/app/(app)/admin/actions";
import { toast } from "./toaster";

/**
 * Runs one admin server action with an optional confirm and/or reason prompt.
 * The outcome is shown as a toast, since the row may vanish when the page re-renders.
 */
export function ActionButton({
  label,
  run,
  confirmText,
  askReason,
  variant = "outline",
}: {
  label: string;
  run: (reason: string | null) => Promise<AdminResult>;
  confirmText?: string;
  askReason?: string;
  variant?: "outline" | "destructive" | "ghost" | "secondary";
}) {
  const [pending, start] = useTransition();
  return (
      <Button
        type="button"
        size="sm"
        variant={variant}
        disabled={pending}
        onClick={() => {
          let reason: string | null = null;
          if (askReason) {
            reason = window.prompt(askReason);
            if (reason === null) return;
          } else if (confirmText && !window.confirm(confirmText)) {
            return;
          }
          start(async () => {
            const result = await run(reason);
            toast(result.ok, result.message);
          });
        }}
      >
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        {label}
      </Button>
  );
}
