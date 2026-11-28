"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { FormState } from "@/app/(auth)/actions";
import type { FieldErrors } from "@/lib/validation/auth";
import { streamFormSchema } from "@/lib/validation/stream";
import { getCurrentUser } from "@/server/auth/session";
import { rateLimit } from "@/server/rate-limit";
import { getRequestMeta } from "@/server/request";
import { MAX_IMAGE_BYTES, StorageError } from "@/server/storage";
import { deleteRecording } from "@/server/streams/recording-service";
import {
  StreamError,
  createStream,
  deleteStream,
  resetStreamLink,
  setThumbnail,
  updateStream,
} from "@/server/streams/service";

const SIGNED_OUT: FormState = { status: "error", message: "Your session expired. Please sign in again." };
const TOO_MANY: FormState = { status: "error", message: "You're doing that a lot. Please wait a few minutes." };

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v : "";
}

function formValues(formData: FormData): Record<string, string> {
  return {
    title: str(formData, "title"),
    description: str(formData, "description"),
    privacy: str(formData, "privacy"),
    chatEnabled: str(formData, "chatEnabled"),
    recordingEnabled: str(formData, "recordingEnabled"),
  };
}

async function fileBytes(formData: FormData, key: string): Promise<Uint8Array | null | "too_large"> {
  const file = formData.get(key);
  if (!(file instanceof File) || file.size === 0) return null;
  if (file.size > MAX_IMAGE_BYTES) return "too_large";
  return new Uint8Array(await file.arrayBuffer());
}

function errorState(err: unknown, values?: Record<string, string>): FormState {
  if (err instanceof StreamError) {
    switch (err.code) {
      case "passcode_required":
        return { status: "error", fieldErrors: { passcode: ["Private streams need a passcode"] }, values };
      case "limit_reached":
        return { status: "error", message: "You've reached your plan's stream limit. Delete an old stream first.", values };
      case "is_live":
        return { status: "error", message: "End the broadcast before deleting this stream." };
      case "not_found":
        return { status: "error", message: "This stream no longer exists." };
    }
  }
  if (err instanceof StorageError) {
    const message =
      err.code === "not_configured"
        ? "Image uploads aren't set up yet (connect Vercel Blob)."
        : err.code === "too_large"
          ? "That image is over 2 MB."
          : "Use a JPEG, PNG or WebP image.";
    return { status: "error", fieldErrors: { thumbnail: [message] }, values };
  }
  console.error("[streams]", err);
  return { status: "error", message: "Something went wrong. Please try again.", values };
}

export async function createStreamAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return SIGNED_OUT;
  const values = formValues(formData);
  const parsed = streamFormSchema.safeParse({ ...values, passcode: str(formData, "passcode") });
  if (!parsed.success) {
    return { status: "error", fieldErrors: z.flattenError(parsed.error).fieldErrors as FieldErrors, values };
  }
  if (!(await rateLimit("streamWrite", user.id)).success) return { ...TOO_MANY, values };

  const thumbnail = await fileBytes(formData, "thumbnail");
  if (thumbnail === "too_large") return { status: "error", fieldErrors: { thumbnail: ["That image is over 2 MB."] }, values };

  let id: string;
  try {
    id = (await createStream(user.id, parsed.data, await getRequestMeta(), thumbnail)).id;
  } catch (err) {
    return errorState(err, values);
  }
  revalidatePath("/streams");
  revalidatePath("/dashboard");
  redirect(`/streams/${id}?created=1`);
}

export async function updateStreamAction(streamId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return SIGNED_OUT;
  const values = formValues(formData);
  const parsed = streamFormSchema.safeParse({ ...values, passcode: str(formData, "passcode") });
  if (!parsed.success) {
    return { status: "error", fieldErrors: z.flattenError(parsed.error).fieldErrors as FieldErrors, values };
  }
  if (!(await rateLimit("streamWrite", user.id)).success) return { ...TOO_MANY, values };
  try {
    await updateStream(streamId, user.id, parsed.data, await getRequestMeta());
  } catch (err) {
    return errorState(err, values);
  }
  revalidatePath(`/streams/${streamId}`);
  revalidatePath("/streams");
  return { status: "success", message: "Changes saved.", values };
}

export async function uploadThumbnailAction(streamId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return SIGNED_OUT;
  if (!(await rateLimit("upload", user.id)).success) return TOO_MANY;
  const bytes = await fileBytes(formData, "thumbnail");
  if (bytes === "too_large") return { status: "error", fieldErrors: { thumbnail: ["That image is over 2 MB."] } };
  if (!bytes) return { status: "error", fieldErrors: { thumbnail: ["Choose an image to upload."] } };
  try {
    await setThumbnail(streamId, user.id, bytes, await getRequestMeta());
  } catch (err) {
    return errorState(err);
  }
  revalidatePath(`/streams/${streamId}`);
  revalidatePath("/streams");
  return { status: "success", message: "Thumbnail updated." };
}

export async function removeThumbnailAction(streamId: string): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return SIGNED_OUT;
  try {
    await setThumbnail(streamId, user.id, null, await getRequestMeta());
  } catch (err) {
    return errorState(err);
  }
  revalidatePath(`/streams/${streamId}`);
  revalidatePath("/streams");
  return { status: "success", message: "Thumbnail removed." };
}

export async function resetLinkAction(streamId: string): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return SIGNED_OUT;
  if (!(await rateLimit("streamWrite", user.id)).success) return TOO_MANY;
  try {
    await resetStreamLink(streamId, user.id, await getRequestMeta());
  } catch (err) {
    return errorState(err);
  }
  revalidatePath(`/streams/${streamId}`);
  return { status: "success", message: "New link created. The old link no longer works." };
}

export async function deleteStreamAction(streamId: string): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return SIGNED_OUT;
  try {
    await deleteStream(streamId, user.id, await getRequestMeta());
  } catch (err) {
    return errorState(err);
  }
  revalidatePath("/streams");
  revalidatePath("/dashboard");
  redirect("/streams?deleted=1");
}

export async function deleteRecordingAction(streamId: string, sessionId: string): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return SIGNED_OUT;
  try {
    await deleteRecording(sessionId, user.id, await getRequestMeta());
  } catch (err) {
    console.error("[recording.delete]", err);
    return { status: "error", message: "Couldn't delete the recording. Please try again." };
  }
  revalidatePath(`/streams/${streamId}`);
  return { status: "success", message: "Recording deleted." };
}
