"use client";

import { useState } from "react";
import { Flag, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const REASONS = [
  ["spam", "Spam or scam"],
  ["harassment", "Harassment or bullying"],
  ["hate", "Hate speech"],
  ["violence", "Violence or dangerous acts"],
  ["sexual", "Sexual content"],
  ["copyright", "Copyright infringement"],
  ["other", "Something else"],
] as const;

/** Lets anonymous viewers flag a stream for the admin review queue. */
export function ReportButton({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason) return;
    setState("sending");
    try {
      const res = await fetch(`/api/public/watch/${slug}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason, details }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        setState("error");
        setMessage(body.message ?? "Couldn't send the report.");
        return;
      }
      setState("sent");
    } catch {
      setState("error");
      setMessage("Couldn't send the report. Check your connection.");
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-xs text-white/50 underline-offset-4 hover:text-white/80 hover:underline"
      >
        <Flag className="size-3.5" aria-hidden /> Report this stream
      </button>
    );
  }

  return (
    <div role="dialog" aria-label="Report this stream" className="max-w-md rounded-xl border border-white/10 bg-white/5 p-4 text-sm">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-medium">Report this stream</p>
        <button onClick={() => setOpen(false)} aria-label="Close" className="text-white/60 hover:text-white">
          <X className="size-4" />
        </button>
      </div>
      {state === "sent" ? (
        <p className="text-white/80">Thanks. Our team will review this stream.</p>
      ) : (
        <form onSubmit={submit} className="grid gap-3">
          <fieldset className="grid gap-1.5">
            <legend className="mb-1 text-xs text-white/60">What&apos;s wrong?</legend>
            {REASONS.map(([value, label]) => (
              <label key={value} className="flex items-center gap-2">
                <input type="radio" name="reason" value={value} checked={reason === value} onChange={() => setReason(value)} />
                {label}
              </label>
            ))}
          </fieldset>
          <Textarea
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            maxLength={1000}
            rows={2}
            placeholder="Anything else we should know? (optional)"
            aria-label="Details"
            className="border-white/15 bg-white/10 text-white placeholder:text-white/40"
          />
          {state === "error" && <p className="text-red-300">{message}</p>}
          <Button type="submit" variant="secondary" size="sm" disabled={!reason || state === "sending"} className="w-fit">
            {state === "sending" && <Loader2 className="animate-spin" aria-hidden />} Send report
          </Button>
        </form>
      )}
    </div>
  );
}
