"use client";

import { useActionState, useState } from "react";
import { Loader2, RefreshCw, Trash2 } from "lucide-react";
import type { FormState } from "@/app/(auth)/actions";
import { deleteStreamAction, resetLinkAction } from "@/app/(app)/streams/actions";
import { FormMessage } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";

const idle: FormState = { status: "idle" };

export function DangerZone({ streamId, isLive }: { streamId: string; isLive: boolean }) {
  const [resetState, reset, resetting] = useActionState<FormState>(resetLinkAction.bind(null, streamId), idle);
  const [delState, del, deleting] = useActionState<FormState>(deleteStreamAction.bind(null, streamId), idle);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="grid gap-5">
      <FormMessage state={resetState} />
      <FormMessage state={delState} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium">Reset viewer link</p>
          <p className="text-sm text-muted-foreground">Creates a new link and QR code. The old ones stop working.</p>
        </div>
        <form action={reset} onSubmit={() => setConfirmReset(false)}>
          {confirmReset ? (
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmReset(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" size="sm" disabled={resetting}>
                {resetting ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
                Yes, reset link
              </Button>
            </div>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={() => setConfirmReset(true)}>
              <RefreshCw aria-hidden /> Reset link
            </Button>
          )}
        </form>
      </div>
      <div className="flex flex-col gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium">Delete stream</p>
          <p className="text-sm text-muted-foreground">
            {isLive ? "End the broadcast first." : "Removes the stream, its stats and recordings. This can't be undone."}
          </p>
        </div>
        <form action={del}>
          {confirmDelete ? (
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" size="sm" disabled={deleting}>
                {deleting ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
                Yes, delete
              </Button>
            </div>
          ) : (
            <Button type="button" variant="outline" size="sm" disabled={isLive} onClick={() => setConfirmDelete(true)} className="text-destructive">
              <Trash2 aria-hidden /> Delete stream
            </Button>
          )}
        </form>
      </div>
    </div>
  );
}
