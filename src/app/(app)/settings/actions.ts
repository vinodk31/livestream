"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { FormState } from "@/app/(auth)/actions";
import { changePasswordSchema, deleteAccountSchema, profileSchema, type FieldErrors } from "@/lib/validation/auth";
import { deleteAccount, revokeOtherSessions, updateProfile } from "@/server/account/service";
import { clearAuthCookies, writeAuthCookies } from "@/server/auth/cookies";
import { AuthError, changePassword } from "@/server/auth/service";
import { getCurrentUser, getSession } from "@/server/auth/session";
import { rateLimit } from "@/server/rate-limit";
import { getRequestMeta } from "@/server/request";

const TOO_MANY = "Too many attempts. Please wait a few minutes and try again.";
const SIGNED_OUT: FormState = { status: "error", message: "Your session expired. Please sign in again." };

function fieldErrors(error: z.ZodError): FieldErrors {
  return z.flattenError(error).fieldErrors as FieldErrors;
}

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v : "";
}

export async function updateProfileAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return SIGNED_OUT;
  const values = { name: str(formData, "name") };
  const parsed = profileSchema.safeParse(values);
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrors(parsed.error), values };
  await updateProfile(user.id, parsed.data, await getRequestMeta());
  revalidatePath("/", "layout");
  return { status: "success", message: "Profile saved.", values: { name: parsed.data.name } };
}

export async function changePasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return SIGNED_OUT;
  const parsed = changePasswordSchema.safeParse({
    currentPassword: str(formData, "currentPassword"),
    password: str(formData, "password"),
    confirmPassword: str(formData, "confirmPassword"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrors(parsed.error) };
  if (!(await rateLimit("changePassword", user.id)).success) return { status: "error", message: TOO_MANY };

  try {
    const tokens = await changePassword(
      user.id,
      parsed.data.currentPassword,
      parsed.data.password,
      await getRequestMeta(),
    );
    writeAuthCookies(await cookies(), tokens);
  } catch (err) {
    if (err instanceof AuthError) {
      return { status: "error", fieldErrors: { currentPassword: ["That's not your current password."] } };
    }
    console.error("[change-password]", err);
    return { status: "error", message: "Something went wrong. Please try again." };
  }
  revalidatePath("/settings");
  return { status: "success", message: "Password changed. Other devices have been signed out." };
}

export async function revokeOtherSessionsAction(): Promise<FormState> {
  const [user, session] = await Promise.all([getCurrentUser(), getSession()]);
  if (!user || !session) return SIGNED_OUT;
  const devices = await revokeOtherSessions(user.id, session.sid, await getRequestMeta());
  revalidatePath("/settings");
  return {
    status: "success",
    message:
      devices === 0
        ? "No other devices were signed in."
        : `Signed out ${devices} other ${devices === 1 ? "device" : "devices"}.`,
  };
}

export async function deleteAccountAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return SIGNED_OUT;
  const values = { confirmEmail: str(formData, "confirmEmail") };
  const parsed = deleteAccountSchema.safeParse({ ...values, password: str(formData, "password") });
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrors(parsed.error), values };
  if (parsed.data.confirmEmail !== user.email.toLowerCase()) {
    return { status: "error", fieldErrors: { confirmEmail: ["Type your account email exactly."] }, values };
  }
  if (!(await rateLimit("deleteAccount", user.id)).success) return { status: "error", message: TOO_MANY, values };

  try {
    await deleteAccount(user.id, parsed.data.password, await getRequestMeta());
  } catch (err) {
    if (err instanceof AuthError) {
      return { status: "error", fieldErrors: { password: ["Incorrect password."] }, values };
    }
    console.error("[delete-account]", err);
    return { status: "error", message: "Something went wrong. Please try again.", values };
  }
  clearAuthCookies(await cookies());
  redirect("/?deleted=1");
}
