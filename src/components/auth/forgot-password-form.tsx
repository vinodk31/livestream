"use client";

import { useActionState } from "react";
import { forgotPasswordAction } from "@/app/(auth)/actions";
import { Field, FormMessage, SubmitButton, initialFormState } from "./form-parts";

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(forgotPasswordAction, initialFormState);
  if (state.status === "success") return <FormMessage state={state} />;
  return (
    <form action={action} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      <Field name="email" label="Email" type="email" autoComplete="email" required autoFocus state={state} />
      <SubmitButton pending={pending}>Send reset link</SubmitButton>
    </form>
  );
}
