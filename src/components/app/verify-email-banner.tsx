"use client";

import { useActionState } from "react";
import { MailWarning } from "lucide-react";
import { resendVerificationAction, type FormState } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";

export function VerifyEmailBanner({ email }: { email: string }) {
  const [state, action, pending] = useActionState<FormState>(resendVerificationAction, { status: "idle" });
  return (
    <div className="border-b border-warning/40 bg-warning/10">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 text-sm">
        <MailWarning className="size-4 shrink-0" aria-hidden />
        <p className="flex-1">
          {state.message ?? (
            <>
              Verify your email to go live. We sent a link to <strong>{email}</strong>.
            </>
          )}
        </p>
        {state.status !== "success" && (
          <form action={action}>
            <Button size="sm" variant="outline" disabled={pending}>
              {pending ? "Sending…" : "Resend email"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
