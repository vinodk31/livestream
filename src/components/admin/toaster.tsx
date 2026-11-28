"use client";

import { useEffect, useState } from "react";
import { CircleAlert, CircleCheck } from "lucide-react";
import { cn } from "@/lib/utils";

type Toast = { id: number; ok: boolean; message: string };
const EVENT = "admin-toast";

/** Fire-and-forget notifications that survive the row they came from disappearing on refresh. */
export function toast(ok: boolean, message: string) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { ok, message } }));
}

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => {
    let n = 0;
    const onToast = (e: Event) => {
      const { ok, message } = (e as CustomEvent<{ ok: boolean; message: string }>).detail;
      const id = ++n;
      setToasts((t) => [...t, { id, ok, message }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
    };
    window.addEventListener(EVENT, onToast);
    return () => window.removeEventListener(EVENT, onToast);
  }, []);
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={cn(
            "pointer-events-auto flex items-center gap-2 rounded-lg border bg-background px-4 py-2.5 text-sm shadow-lg",
            t.ok ? "text-foreground" : "border-destructive/40 text-destructive",
          )}
        >
          {t.ok ? <CircleCheck className="size-4 text-success" aria-hidden /> : <CircleAlert className="size-4" aria-hidden />}
          {t.message}
        </div>
      ))}
    </div>
  );
}
