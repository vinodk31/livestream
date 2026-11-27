"use client";

import * as React from "react";
import { CircleAlert, CircleCheck, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FormState } from "@/app/(auth)/actions";

export function Field({
  name,
  label,
  state,
  hint,
  labelAction,
  ...inputProps
}: {
  name: string;
  label: string;
  state: FormState;
  hint?: string;
  labelAction?: React.ReactNode;
} & React.ComponentProps<typeof Input>) {
  const id = React.useId();
  const errors = state.fieldErrors?.[name];
  const describedBy = errors?.length ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between">
        <Label htmlFor={id}>{label}</Label>
        {labelAction}
      </div>
      <Input
        id={id}
        name={name}
        aria-invalid={errors?.length ? true : undefined}
        aria-describedby={describedBy}
        defaultValue={state.values?.[name]}
        {...inputProps}
      />
      {errors?.length ? (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {errors[0]}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Props for a 6-digit one-time-code input (phones show a number pad and can autofill from SMS/email). */
export const codeInputProps = {
  inputMode: "numeric",
  autoComplete: "one-time-code",
  pattern: "[0-9 ]*",
  maxLength: 7,
  placeholder: "123456",
  className: "font-mono text-lg tracking-[0.4em] placeholder:tracking-[0.4em]",
} as const;

export function FormMessage({ state }: { state: FormState }) {
  if (!state.message) return null;
  const success = state.status === "success";
  return (
    <Alert variant={success ? "success" : "destructive"} aria-live="polite">
      {success ? <CircleCheck /> : <CircleAlert />}
      <AlertDescription>{state.message}</AlertDescription>
    </Alert>
  );
}

export function SubmitButton({ pending, children }: { pending: boolean; children: React.ReactNode }) {
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending && <Loader2 className="animate-spin" aria-hidden />}
      {children}
    </Button>
  );
}

export const initialFormState: FormState = { status: "idle" };
