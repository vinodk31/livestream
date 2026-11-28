"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/server/auth/session";
import { getRequestMeta } from "@/server/request";
import {
  AdminError,
  deleteUserAsAdmin,
  markUserVerified,
  resolveReport,
  setStreamDisabled,
  setUserDisabled,
} from "@/server/admin/service";

export type AdminResult = { ok: true; message: string } | { ok: false; message: string };

const MESSAGES: Record<AdminError["code"], string> = {
  not_found: "That no longer exists.",
  self: "You can't do that to your own account.",
  is_admin: "Admins can't be disabled or deleted here. Remove their admin role first.",
  rate_limited: "Too many actions. Try again shortly.",
};

/** Every admin action re-checks the role on the server; the UI hiding buttons is not security. */
async function asAdmin(fn: (adminId: string) => Promise<string>): Promise<AdminResult> {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return { ok: false, message: "Not allowed." };
  try {
    const message = await fn(user.id);
    revalidatePath("/admin", "layout");
    return { ok: true, message };
  } catch (err) {
    if (err instanceof AdminError) return { ok: false, message: MESSAGES[err.code] };
    console.error("[admin]", err);
    return { ok: false, message: "Something went wrong." };
  }
}

const clean = (s: string | null | undefined) => (s ?? "").trim().slice(0, 500) || null;

export async function disableUserAction(userId: string, reason: string | null) {
  return asAdmin(async (adminId) => {
    await setUserDisabled(adminId, userId, true, clean(reason), await getRequestMeta());
    return "User disabled and signed out.";
  });
}

export async function enableUserAction(userId: string) {
  return asAdmin(async (adminId) => {
    await setUserDisabled(adminId, userId, false, null, await getRequestMeta());
    return "User re-enabled.";
  });
}

export async function verifyUserAction(userId: string) {
  return asAdmin(async (adminId) => {
    await markUserVerified(adminId, userId, await getRequestMeta());
    return "Email marked as verified.";
  });
}

export async function deleteUserAction(userId: string) {
  return asAdmin(async (adminId) => {
    await deleteUserAsAdmin(adminId, userId, await getRequestMeta());
    return "User and their streams deleted.";
  });
}

export async function disableStreamAction(streamId: string, reason: string | null) {
  return asAdmin(async (adminId) => {
    await setStreamDisabled(adminId, streamId, true, clean(reason), await getRequestMeta());
    return "Stream disabled.";
  });
}

export async function enableStreamAction(streamId: string) {
  return asAdmin(async (adminId) => {
    await setStreamDisabled(adminId, streamId, false, null, await getRequestMeta());
    return "Stream re-enabled.";
  });
}

export async function resolveReportAction(reportId: string, action: "dismiss" | "disable_stream", note: string | null) {
  return asAdmin(async (adminId) => {
    await resolveReport(adminId, reportId, action, clean(note), await getRequestMeta());
    return action === "dismiss" ? "Report dismissed." : "Stream disabled and its reports resolved.";
  });
}
