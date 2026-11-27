"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
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

/** Config problems are the site owner's to fix; say so plainly instead of "something went wrong". */
function configProblem(err: unknown): string | null {
  const msg = err instanceof Error ? err.message : "";
  if (msg.includes("AUTH_SECRET")) return "Sign-in isn't configured on this server yet (AUTH_SECRET). If you run this site, see /api/health.";
  if (msg.includes("DATABASE_URL")) return "The database isn't connected yet. If you run this site, see /api/health.";
  return null;
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
    return { status: "error", message: configProblem(err) ?? "Something went wrong. Please try again.", values };
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
    return { status: "error", message: configProblem(err) ?? "Something went wrong. Please try again.", values };
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

  // Silently skip when the per-account limit is hit so the response never reveals anything.
  if (accountLimit.success) {
    try {
      await auth.requestPasswordReset(parsed.data.email, meta);
    } catch (err) {
      console.error("[forgot-password]", err);
    }
  }
  // Same destination whether or not the account exists.
  redirect(`/reset-password?email=${encodeURIComponent(parsed.data.email)}`);
}

export async function resetPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = { email: str(formData, "email") };
  const parsed = resetPasswordSchema.safeParse({
    email: values.email,
    code: str(formData, "code"),
    password: str(formData, "password"),
    confirmPassword: str(formData, "confirmPassword"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrors(parsed.error), values };

  const meta = await getRequestMeta();
  const [ipLimit, accountLimit] = await Promise.all([
    rateLimit("resetPassword", meta.ip ?? "unknown"),
    rateLimit("resetPasswordAccount", parsed.data.email),
  ]);
  if (!ipLimit.success || !accountLimit.success) return { status: "error", message: TOO_MANY, values };

  try {
    await auth.resetPassword(parsed.data, meta);
  } catch (err) {
    if (err instanceof auth.AuthError) {
      return { status: "error", fieldErrors: { code: [codeErrorMessage(err)] }, values };
    }
    console.error("[reset-password]", err);
    return { status: "error", message: "Something went wrong. Please try again.", values };
  }
  clearAuthCookies(await cookies());
  redirect("/login?reset=1");
}

function codeErrorMessage(err: auth.AuthError): string {
  if (err.attemptsLeft && err.attemptsLeft > 0) {
    return `That code isn't right. ${err.attemptsLeft} ${err.attemptsLeft === 1 ? "try" : "tries"} left.`;
  }
  return "This code has expired or been used up. Request a new one.";
}

export async function verifyEmailAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return { status: "error", message: "Please sign in again." };
  if (user.emailVerified) redirect("/dashboard?verified=1");

  const parsed = verifyEmailSchema.safeParse({ code: str(formData, "code") });
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrors(parsed.error) };
  if (!(await rateLimit("verifyCode", user.id)).success) return { status: "error", message: TOO_MANY };

  try {
    await auth.verifyEmail(user.id, parsed.data.code, await getRequestMeta());
  } catch (err) {
    if (err instanceof auth.AuthError) {
      return { status: "error", fieldErrors: { code: [codeErrorMessage(err)] } };
    }
    console.error("[verify-email]", err);
    return { status: "error", message: "Something went wrong. Please try again." };
  }
  // The signed-in layout renders the banner, so make sure it re-renders with the new status.
  revalidatePath("/", "layout");
  redirect("/dashboard?verified=1");
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
  return { status: "success", message: `New code sent to ${user.email}.` };
}
