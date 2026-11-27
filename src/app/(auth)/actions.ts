"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  type FieldErrors,
} from "@/lib/validation/auth";
import { safeRedirectPath } from "@/lib/utils";
import { REFRESH_COOKIE, clearAuthCookies, writeAuthCookies } from "@/server/auth/cookies";
import * as auth from "@/server/auth/service";
import { getCurrentUser } from "@/server/auth/session";
import { rateLimit } from "@/server/rate-limit";
import { getRequestMeta } from "@/server/request";

export type FormState = {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: FieldErrors;
  /** Echo non-secret fields back so the form keeps them after an error. */
  values?: Record<string, string>;
};

const TOO_MANY = "Too many attempts. Please wait a few minutes and try again.";

function fieldErrors(error: z.ZodError): FieldErrors {
  return z.flattenError(error).fieldErrors as FieldErrors;
}

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v : "";
}

export async function registerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = { name: str(formData, "name"), email: str(formData, "email") };
  const parsed = registerSchema.safeParse({ ...values, password: str(formData, "password") });
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrors(parsed.error), values };

  const meta = await getRequestMeta();
  if (!(await rateLimit("register", meta.ip ?? "unknown")).success) {
    return { status: "error", message: TOO_MANY, values };
  }

  try {
    const { tokens } = await auth.register(parsed.data, meta);
    writeAuthCookies(await cookies(), tokens);
  } catch (err) {
    if (err instanceof auth.AuthError && err.code === "email_taken") {
      return {
        status: "error",
        fieldErrors: { email: ["An account with this email already exists. Try signing in."] },
        values,
      };
    }
    console.error("[register]", err);
    return { status: "error", message: "Something went wrong. Please try again.", values };
  }
  redirect("/dashboard?welcome=1");
}

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = { email: str(formData, "email") };
  const next = safeRedirectPath(str(formData, "next"));
  const parsed = loginSchema.safeParse({ ...values, password: str(formData, "password") });
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrors(parsed.error), values };

  const meta = await getRequestMeta();
  const [ipLimit, accountLimit] = await Promise.all([
    rateLimit("loginIp", meta.ip ?? "unknown"),
    rateLimit("loginAccount", parsed.data.email),
  ]);
  if (!ipLimit.success || !accountLimit.success) return { status: "error", message: TOO_MANY, values };

  try {
    const { tokens } = await auth.login(parsed.data, meta);
    writeAuthCookies(await cookies(), tokens);
  } catch (err) {
    if (err instanceof auth.AuthError) {
      const message =
        err.code === "account_disabled"
          ? "This account has been disabled. Contact support if you think this is a mistake."
          : "Incorrect email or password.";
      return { status: "error", message, values };
    }
    console.error("[login]", err);
    return { status: "error", message: "Something went wrong. Please try again.", values };
  }
  redirect(next);
}

export async function logoutAction(): Promise<void> {
  const jar = await cookies();
  try {
    await auth.logout(jar.get(REFRESH_COOKIE)?.value, await getRequestMeta());
  } finally {
    clearAuthCookies(jar);
  }
  redirect("/login");
}

export async function forgotPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = { email: str(formData, "email") };
  const parsed = forgotPasswordSchema.safeParse(values);
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrors(parsed.error), values };

  const meta = await getRequestMeta();
  const [ipLimit, accountLimit] = await Promise.all([
    rateLimit("forgotIp", meta.ip ?? "unknown"),
    rateLimit("forgotAccount", parsed.data.email),
  ]);
  if (!ipLimit.success) return { status: "error", message: TOO_MANY, values };

  // Silently skip when the per-account limit is hit so responses stay identical.
  if (accountLimit.success) {
    try {
      await auth.requestPasswordReset(parsed.data.email, meta);
    } catch (err) {
      console.error("[forgot-password]", err);
    }
  }
  return {
    status: "success",
    message: "If an account exists for that email, we've sent a link to reset your password.",
  };
}

export async function resetPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = resetPasswordSchema.safeParse({
    token: str(formData, "token"),
    password: str(formData, "password"),
    confirmPassword: str(formData, "confirmPassword"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrors(parsed.error) };

  const meta = await getRequestMeta();
  if (!(await rateLimit("resetPassword", meta.ip ?? "unknown")).success) {
    return { status: "error", message: TOO_MANY };
  }
  try {
    await auth.resetPassword(parsed.data.token, parsed.data.password, meta);
  } catch (err) {
    if (err instanceof auth.AuthError) {
      return { status: "error", message: "This reset link is invalid or has expired. Request a new one." };
    }
    console.error("[reset-password]", err);
    return { status: "error", message: "Something went wrong. Please try again." };
  }
  clearAuthCookies(await cookies());
  redirect("/login?reset=1");
}

export async function resendVerificationAction(): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return { status: "error", message: "Please sign in again." };
  if (user.emailVerified) return { status: "success", message: "Your email is already verified." };
  if (!(await rateLimit("resendVerification", user.id)).success) {
    return { status: "error", message: "You've requested several emails already. Check your inbox and spam folder." };
  }
  try {
    await auth.resendVerification(user.id);
  } catch (err) {
    console.error("[resend-verification]", err);
    return { status: "error", message: "Couldn't send the email. Please try again." };
  }
  return { status: "success", message: `Verification email sent to ${user.email}.` };
}
