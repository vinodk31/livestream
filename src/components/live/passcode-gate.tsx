"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function PasscodeGate({ slug }: { slug: string }) {
  const router = useRouter();
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!passcode.trim()) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/watch/${slug}/unlock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        setError(body.message ?? "That passcode isn't right.");
        return;
      }
      router.refresh();
    } catch {
      setError("Couldn't check the passcode. Check your connection.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-xl bg-neutral-900 px-6">
      <form onSubmit={submit} className="grid w-full max-w-xs justify-items-center gap-3 text-center text-white" noValidate>
        <Lock className="size-8" aria-hidden />
        <p className="text-lg font-medium">This stream is private</p>
        <p className="text-sm text-white/70">Enter the passcode the host shared with you.</p>
        <label htmlFor="passcode" className="sr-only">
          Passcode
        </label>
        <Input
          id="passcode"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          autoComplete="off"
          autoFocus
          maxLength={64}
          placeholder="Passcode"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "passcode-error" : undefined}
          className="border-white/20 bg-white/10 text-center text-white placeholder:text-white/40"
        />
        {error && (
          <p id="passcode-error" className="text-sm text-red-300" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" variant="secondary" disabled={pending || !passcode.trim()} className="w-full">
          {pending && <Loader2 className="animate-spin" aria-hidden />} Watch
        </Button>
      </form>
    </div>
  );
}
