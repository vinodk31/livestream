"use client";

import { useActionState } from "react";
import { registerAction } from "@/app/(auth)/actions";
import { Field, FormMessage, SubmitButton, initialFormState } from "./form-parts";

export function RegisterForm() {
  const [state, action, pending] = useActionState(registerAction, initialFormState);
  return (
    <form action={action} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      <Field name="name" label="Name" autoComplete="name" required autoFocus maxLength={100} state={state} />
      <Field name="email" label="Email" type="email" autoComplete="email" required state={state} />
      <Field
        name="password"
        label="Password"
        type="password"
        autoComplete="new-password"
        required
        minLength={10}
        hint="At least 10 characters, with a letter and a number."
        state={state}
      />
      <SubmitButton pending={pending}>Create account</SubmitButton>
    </form>
  );
}
