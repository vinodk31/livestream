"use client";

import { useActionState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import type { FormState } from "@/app/(auth)/actions";
import { deleteRecordingAction } from "@/app/(app)/streams/actions";
import { Button } from "@/components/ui/button";

export function DeleteRecordingButton({ streamId, sessionId }: { streamId: string; sessionId: string }) {
  const [state, action, pending] = useActionState<FormState>(deleteRecordingAction.bind(null, streamId, sessionId), {
    status: "idle",
  });
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm("Delete this recording? Viewers will no longer see the replay.")) e.preventDefault();
      }}
    >
      <Button type="submit" variant="ghost" size="sm" disabled={pending} className="text-destructive">
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />} Delete
      </Button>
      {state.status === "error" && <span className="text-xs text-destructive">{state.message}</span>}
    </form>
  );
}
