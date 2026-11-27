"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import type { FormState } from "@/app/(auth)/actions";
import {
  changePasswordAction,
  deleteAccountAction,
  revokeOtherSessionsAction,
  updateProfileAction,
} from "@/app/(app)/settings/actions";
import { Field, FormMessage } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";

const idle: FormState = { status: "idle" };

function Submit({ pending, children, variant }: { pending: boolean; children: React.ReactNode; variant?: "destructive" | "outline" }) {
  return (
    <Button type="submit" disabled={pending} variant={variant} className="w-fit">
      {pending && <Loader2 className="animate-spin" aria-hidden />}
      {children}
    </Button>
  );
}

export function ProfileForm({ name, email }: { name: string; email: string }) {
  const [state, action, pending] = useActionState(updateProfileAction, { ...idle, values: { name } });
  return (
    <form action={action} className="grid max-w-md gap-4" noValidate>
      <FormMessage state={state} />
      <Field name="name" label="Display name" autoComplete="name" required maxLength={100} state={state} />
      <Field
        name="email"
        label="Email"
        type="email"
        value={email}
        readOnly
        disabled
        hint="Contact support to change your email address."
        state={idle}
      />
      <Submit pending={pending}>Save profile</Submit>
    </form>
  );
}

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, idle);
  return (
    <form action={action} className="grid max-w-md gap-4" noValidate>
      <FormMessage state={state} />
      <Field name="currentPassword" label="Current password" type="password" autoComplete="current-password" required state={state} />
      <Field
        name="password"
        label="New password"
        type="password"
        autoComplete="new-password"
        required
        hint="At least 10 characters, with a letter and a number."
        state={state}
      />
      <Field name="confirmPassword" label="Confirm new password" type="password" autoComplete="new-password" required state={state} />
      <Submit pending={pending}>Change password</Submit>
    </form>
  );
}

export function RevokeSessionsForm({ otherDevices }: { otherDevices: number }) {
  const [state, action, pending] = useActionState<FormState>(revokeOtherSessionsAction, idle);
  return (
    <form action={action} className="grid gap-3">
      <FormMessage state={state} />
      <p className="text-sm text-muted-foreground">
        {otherDevices === 0
          ? "You're only signed in on this device."
          : `You're signed in on ${otherDevices} other ${otherDevices === 1 ? "device" : "devices"}.`}
      </p>
      <Submit pending={pending} variant="outline">
        Sign out other devices
      </Submit>
    </form>
  );
}

export function DeleteAccountForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState(deleteAccountAction, idle);
  return (
    <form action={action} className="grid max-w-md gap-4" noValidate>
      <FormMessage state={state} />
      <Field
        name="confirmEmail"
        label={`Type ${email} to confirm`}
        type="email"
        autoComplete="off"
        required
        state={state}
      />
      <Field name="password" label="Password" type="password" autoComplete="current-password" required state={state} />
      <Submit pending={pending} variant="destructive">
        Delete my account
      </Submit>
    </form>
  );
}
