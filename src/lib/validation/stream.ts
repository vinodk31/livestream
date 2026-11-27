import { z } from "zod";

export const PRIVACY_OPTIONS = ["public", "unlisted", "private"] as const;
export type Privacy = (typeof PRIVACY_OPTIONS)[number];

/** HTML checkboxes send "on" when ticked and nothing at all when not. */
const checkbox = z
  .string()
  .nullish()
  .transform((v) => v === "on" || v === "true");

export const streamFormSchema = z
  .object({
    title: z.string().trim().min(1, "Give your stream a title").max(120, "Keep the title under 120 characters"),
    description: z
      .string()
      .trim()
      .max(2000, "Keep the description under 2,000 characters")
      .transform((v) => v || null),
    privacy: z.enum(PRIVACY_OPTIONS, "Choose who can watch"),
    passcode: z
      .string()
      .trim()
      .max(32, "Use at most 32 characters")
      .refine((v) => v === "" || v.length >= 4, "Use at least 4 characters")
      .transform((v) => v || null),
    chatEnabled: checkbox,
    recordingEnabled: checkbox,
  });

export type StreamFormInput = z.infer<typeof streamFormSchema>;
