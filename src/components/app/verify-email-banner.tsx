"use client";

import { useActionState, useState } from "react";
import { Loader2, MailWarning } from "lucide-react";
import { resendVerificationAction, verifyEmailAction, type FormState } from "@/app/(auth)/actions";
import { codeInputProps } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const idle: FormState = { status: "idle" };

export function VerifyEmailBanner({ email }: { email: string }) {
  const [verifyState, verify, verifying] = useActionState(verifyEmailAction, idle);
  const [resendState, resend, resending] = useActionState<FormState>(resendVerificationAction, idle);
  // Show feedback from whichever action the user triggered last.
  const [last, setLast] = useState<"verify" | "resend" | null>(null);
  const codeError =
    last === "verify"
      ? (verifyState.fieldErrors?.code?.[0] ?? (verifyState.status === "error" ? verifyState.message : undefined))
      : undefined;
  const resendMessage = last === "resend" ? resendState.message : undefined;

  return (
    <section aria-labelledby="verify-heading" className="border-b border-warning/40 bg-warning/10">
      <div className="mx-auto grid max-w-6xl gap-3 px-4 py-3 text-sm md:flex md:items-center md:gap-6">
        <div className="flex flex-1 items-start gap-3">
          <MailWarning className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            <p id="verify-heading" className="font-medium">
              Verify your email to go live
            </p>
            <p className="text-muted-foreground">
              Enter the 6-digit code we sent to <span className="font-medium text-foreground">{email}</span>.
            </p>
          </div>
        </div>
        <div className="grid gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <form action={verify} onSubmit={() => setLast("verify")} className="flex items-center gap-2" noValidate>
              <label htmlFor="verify-code" className="sr-only">
                Verification code
              </label>
              <Input
                id="verify-code"
                name="code"
                required
                aria-invalid={codeError ? true : undefined}
                aria-describedby={codeError ? "verify-code-error" : undefined}
                {...codeInputProps}
                className="h-9 w-40 bg-background text-base tracking-[0.3em] placeholder:tracking-[0.3em] md:text-base"
              />
              <Button type="submit" size="sm" className="h-9" disabled={verifying}>
                {verifying && <Loader2 className="animate-spin" aria-hidden />}
                Verify
              </Button>
            </form>
            <form action={resend} onSubmit={() => setLast("resend")}>
              <Button type="submit" size="sm" variant="ghost" className="h-9" disabled={resending}>
                {resending ? "Sending…" : "Resend code"}
              </Button>
            </form>
          </div>
          <p aria-live="polite" className="min-h-0 text-xs">
            {codeError ? (
              <span id="verify-code-error" className="text-destructive">
                {codeError}
              </span>
            ) : resendMessage ? (
              <span className={resendState.status === "error" ? "text-destructive" : "text-muted-foreground"}>
                {resendMessage}
              </span>
            ) : null}
          </p>
        </div>
      </div>
    </section>
  );
}
