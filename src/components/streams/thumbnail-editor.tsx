"use client";

import { useActionState, useRef } from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import type { FormState } from "@/app/(auth)/actions";
import { removeThumbnailAction, uploadThumbnailAction } from "@/app/(app)/streams/actions";
import { Button } from "@/components/ui/button";
import { StreamThumb } from "./stream-row";

const idle: FormState = { status: "idle" };

export function ThumbnailEditor({ streamId, title, url }: { streamId: string; title: string; url: string | null }) {
  const [upState, upload, uploading] = useActionState(uploadThumbnailAction.bind(null, streamId), idle);
  const [rmState, remove, removing] = useActionState<FormState>(removeThumbnailAction.bind(null, streamId), idle);
  const formRef = useRef<HTMLFormElement>(null);
  const error = upState.fieldErrors?.thumbnail?.[0] ?? (upState.status === "error" ? upState.message : undefined) ??
    (rmState.status === "error" ? rmState.message : undefined);

  return (
    <div className="grid gap-3">
      <div className="[&>*]:w-full">
        <StreamThumb title={title} url={url} />
      </div>
      <div className="flex flex-wrap gap-2">
        <form ref={formRef} action={upload}>
          <label className="inline-flex">
            <input
              type="file"
              name="thumbnail"
              accept="image/jpeg,image/png,image/webp"
              className="peer sr-only"
              onChange={(e) => e.currentTarget.files?.length && formRef.current?.requestSubmit()}
              disabled={uploading}
            />
            <span className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border bg-background px-3 text-sm font-medium shadow-xs hover:bg-accent peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50">
              {uploading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ImagePlus className="size-4" aria-hidden />}
              {url ? "Replace" : "Upload"}
            </span>
          </label>
        </form>
        {url && (
          <form action={remove}>
            <Button type="submit" variant="ghost" size="sm" disabled={removing}>
              <Trash2 aria-hidden /> Remove
            </Button>
          </form>
        )}
      </div>
      <p className="text-xs" aria-live="polite">
        {error ? <span className="text-destructive">{error}</span> : <span className="text-muted-foreground">JPEG, PNG or WebP, up to 2 MB.</span>}
      </p>
    </div>
  );
}
