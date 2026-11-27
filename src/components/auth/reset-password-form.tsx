"use client";

import { useActionState } from "react";
import { forgotPasswordAction, resetPasswordAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, SubmitButton, codeInputProps, initialFormState } from "./form-parts";

export function ResetPasswordForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState(resetPasswordAction, initialFormState);
  const [resendState, resend, resending] = useActionState(forgotPasswordAction, initialFormState);
  return (
    <div className="grid gap-4">
      <form action={action} className="grid gap-4" noValidate>
        <FormMessage state={state} />
        <FormMessage state={resendState} />
        <input type="hidden" name="email" value={email} />
        <Field name="code" label="6-digit code" required autoFocus state={state} {...codeInputProps} />
        <Field
          name="password"
          label="New password"
          type="password"
          autoComplete="new-password"
          required
          hint="At least 10 characters, with a letter and a number."
          state={state}
        />
        <Field
          name="confirmPassword"
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          required
          state={state}
        />
        <SubmitButton pending={pending}>Set new password</SubmitButton>
      </form>
      <form action={resend} className="text-center text-sm text-muted-foreground">
        <input type="hidden" name="email" value={email} />
        Didn&apos;t get it? Check spam, or{" "}
        <Button type="submit" variant="link" className="h-auto p-0" disabled={resending}>
          {resending ? "sending…" : "send a new code"}
        </Button>
      </form>
    </div>
  );
}
