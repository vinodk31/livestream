"use client";

import { useActionState } from "react";
import { resetPasswordAction } from "@/app/(auth)/actions";
import { Field, FormMessage, SubmitButton, initialFormState } from "./form-parts";

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPasswordAction, initialFormState);
  return (
    <form action={action} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="token" value={token} />
      <Field
        name="password"
        label="New password"
        type="password"
        autoComplete="new-password"
        required
        autoFocus
        hint="At least 10 characters, with a letter and a number."
        state={state}
      />
      <Field name="confirmPassword" label="Confirm new password" type="password" autoComplete="new-password" required state={state} />
      <SubmitButton pending={pending}>Set new password</SubmitButton>
    </form>
  );
}
