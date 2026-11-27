"use client";

import { useActionState, useId, useState } from "react";
import { Globe, ImagePlus, Link2, Loader2, Lock } from "lucide-react";
import type { FormState } from "@/app/(auth)/actions";
import { FormMessage } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { Privacy } from "@/lib/validation/stream";

const PRIVACY: { value: Privacy; icon: typeof Globe; label: string; hint: string }[] = [
  { value: "unlisted", icon: Link2, label: "Unlisted", hint: "Anyone with the link can watch" },
  { value: "private", icon: Lock, label: "Private", hint: "Link plus a passcode you share" },
  { value: "public", icon: Globe, label: "Public", hint: "Anyone with the link; may be listed later" },
];

export type StreamFormDefaults = {
  title: string;
  description: string;
  privacy: Privacy;
  chatEnabled: boolean;
  recordingEnabled: boolean;
  hasPasscode: boolean;
};

const EMPTY: StreamFormDefaults = {
  title: "",
  description: "",
  privacy: "unlisted",
  chatEnabled: true,
  recordingEnabled: true,
  hasPasscode: false,
};

function FieldError({ id, errors }: { id: string; errors?: string[] }) {
  return errors?.length ? (
    <p id={id} className="text-sm text-destructive">
      {errors[0]}
    </p>
  ) : null;
}

export function StreamForm({
  action,
  mode,
  defaults = EMPTY,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  mode: "create" | "edit";
  defaults?: StreamFormDefaults;
}) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" });
  const v = state.values;
  const [privacy, setPrivacy] = useState<Privacy>((v?.privacy as Privacy) || defaults.privacy);
  const [preview, setPreview] = useState<string | null>(null);
  // Hide a previous thumbnail error once the user picks another file (until the next submit).
  const [thumbErrorFor, setThumbErrorFor] = useState<FormState | null>(null);
  const uid = useId();
  const fe = state.fieldErrors ?? {};
  const ids = {
    title: `${uid}-title`,
    description: `${uid}-description`,
    passcode: `${uid}-passcode`,
    thumbnail: `${uid}-thumb`,
  };

  return (
    <form action={formAction} className="grid gap-6" noValidate>
      <FormMessage state={state} />

      <div className="grid gap-2">
        <Label htmlFor={ids.title}>Title</Label>
        <Input
          id={ids.title}
          name="title"
          required
          maxLength={120}
          placeholder="e.g. Sunday Morning Service"
          defaultValue={v?.title ?? defaults.title}
          aria-invalid={fe.title ? true : undefined}
          aria-describedby={fe.title ? `${ids.title}-err` : undefined}
          autoFocus={mode === "create"}
        />
        <FieldError id={`${ids.title}-err`} errors={fe.title} />
      </div>

      <div className="grid gap-2">
        <Label htmlFor={ids.description}>
          Description <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Textarea
          id={ids.description}
          name="description"
          maxLength={2000}
          rows={3}
          placeholder="What's this stream about?"
          defaultValue={v?.description ?? defaults.description}
          aria-invalid={fe.description ? true : undefined}
        />
        <FieldError id={`${ids.description}-err`} errors={fe.description} />
      </div>

      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">Who can watch?</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {PRIVACY.map(({ value, icon: Icon, label, hint }) => (
            <label
              key={value}
              className={cn(
                "flex cursor-pointer flex-col gap-1 rounded-lg border p-3 transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
                privacy === value ? "border-primary bg-accent" : "hover:bg-accent/50",
              )}
            >
              <input
                type="radio"
                name="privacy"
                value={value}
                checked={privacy === value}
                onChange={() => setPrivacy(value)}
                className="sr-only"
              />
              <span className="flex items-center gap-2 text-sm font-medium">
                <Icon className="size-4" aria-hidden /> {label}
              </span>
              <span className="text-xs text-muted-foreground">{hint}</span>
            </label>
          ))}
        </div>
        <FieldError id={`${uid}-privacy-err`} errors={fe.privacy} />
      </fieldset>

      {privacy === "private" && (
        <div className="grid gap-2">
          <Label htmlFor={ids.passcode}>{defaults.hasPasscode ? "New passcode" : "Viewer passcode"}</Label>
          <Input
            id={ids.passcode}
            name="passcode"
            autoComplete="off"
            minLength={4}
            maxLength={32}
            placeholder={defaults.hasPasscode ? "Leave blank to keep the current passcode" : "At least 4 characters"}
            aria-invalid={fe.passcode ? true : undefined}
            aria-describedby={`${ids.passcode}-hint`}
          />
          {fe.passcode ? (
            <FieldError id={`${ids.passcode}-hint`} errors={fe.passcode} />
          ) : (
            <p id={`${ids.passcode}-hint`} className="text-xs text-muted-foreground">
              Viewers enter this once before watching. Share it alongside the link.
            </p>
          )}
        </div>
      )}

      {mode === "create" && (
        <div className="grid gap-2">
          <Label htmlFor={ids.thumbnail}>
            Thumbnail <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <label
            htmlFor={ids.thumbnail}
            className="flex cursor-pointer items-center gap-4 rounded-lg border border-dashed p-3 hover:bg-accent/50 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50"
          >
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
              <img src={preview} alt="" className="aspect-video w-32 rounded-md object-cover" />
            ) : (
              <span className="flex aspect-video w-32 items-center justify-center rounded-md bg-muted">
                <ImagePlus className="size-5 text-muted-foreground" aria-hidden />
              </span>
            )}
            <span className="text-sm text-muted-foreground">
              {preview ? "Choose a different image" : "Choose an image"}
              <br />
              <span className="text-xs">JPEG, PNG or WebP, up to 2 MB. 16:9 looks best.</span>
            </span>
            <input
              id={ids.thumbnail}
              name="thumbnail"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              aria-invalid={fe.thumbnail ? true : undefined}
              onChange={(e) => {
                const f = e.target.files?.[0];
                setThumbErrorFor(state);
                setPreview((old) => {
                  if (old) URL.revokeObjectURL(old);
                  return f ? URL.createObjectURL(f) : null;
                });
              }}
            />
          </label>
          <FieldError id={`${ids.thumbnail}-err`} errors={thumbErrorFor === state ? undefined : fe.thumbnail} />
        </div>
      )}

      <div className="grid gap-2">
        <Switch
          id={`${uid}-chat`}
          name="chatEnabled"
          defaultChecked={v ? v.chatEnabled === "on" : defaults.chatEnabled}
          label="Live chat"
          description="Viewers can send messages during the stream."
        />
        <Switch
          id={`${uid}-rec`}
          name="recordingEnabled"
          defaultChecked={v ? v.recordingEnabled === "on" : defaults.recordingEnabled}
          label="Record the stream"
          description="Save a replay you can share after the stream ends."
        />
      </div>

      <Button type="submit" disabled={pending} className="w-full sm:w-fit">
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        {mode === "create" ? "Create stream" : "Save changes"}
      </Button>
    </form>
  );
}
