import type { NextRequest } from "next/server";
import { WebhookReceiver } from "livekit-server-sdk";
import { json } from "@/server/http";
import { egressInfoToResult } from "@/server/livekit";
import { applyEgressResult } from "@/server/streams/recording-service";

/**
 * Optional: add https://<your-site>/api/livekit/webhook in LiveKit → Settings → Webhooks so
 * replays become available the moment LiveKit finishes the file. Without it, the app checks
 * the recording status the next time someone opens the stream or its replay.
 */
export async function POST(request: NextRequest) {
  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  if (!key || !secret) return json({ error: "not_configured" }, 503);
  const body = await request.text();
  let event;
  try {
    event = await new WebhookReceiver(key, secret).receive(body, request.headers.get("authorization") ?? undefined);
  } catch {
    return json({ error: "invalid_signature" }, 401);
  }
  if (event.event === "egress_ended" && event.egressInfo) {
    await applyEgressResult(event.egressInfo.egressId, egressInfoToResult(event.egressInfo));
  }
  return json({ ok: true });
}
