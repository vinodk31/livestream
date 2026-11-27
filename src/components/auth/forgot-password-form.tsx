"use client";

import { useActionState } from "react";
import { forgotPasswordAction } from "@/app/(auth)/actions";
import { Field, FormMessage, SubmitButton, initialFormState } from "./form-parts";

export function ForgotPasswordForm({ defaultEmail }: { defaultEmail?: string }) {
  const [state, action, pending] = useActionState(forgotPasswordAction, {
    ...initialFormState,
    values: defaultEmail ? { email: defaultEmail } : undefined,
  });
  return (
    <form action={action} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      <Field name="email" label="Email" type="email" autoComplete="email" required autoFocus state={state} />
      <SubmitButton pending={pending}>Send code</SubmitButton>
    </form>
  );
}
