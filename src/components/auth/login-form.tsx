"use client";

import Link from "next/link";
import { useActionState } from "react";
import { loginAction } from "@/app/(auth)/actions";
import { Field, FormMessage, SubmitButton, initialFormState } from "./form-parts";

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(loginAction, initialFormState);
  return (
    <form action={action} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      {next && <input type="hidden" name="next" value={next} />}
      <Field name="email" label="Email" type="email" autoComplete="email" required autoFocus state={state} />
      <Field
        name="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        required
        state={state}
        labelAction={
          <Link href="/forgot-password" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
            Forgot password?
          </Link>
        }
      />
      <SubmitButton pending={pending}>Sign in</SubmitButton>
    </form>
  );
}
