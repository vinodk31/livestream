import type { NextRequest } from "next/server";
import { crossOrigin, json } from "@/server/http";
import { recordViewerPing } from "@/server/streams/broadcast";

/** Called every 30s while a viewer is watching. Body: { viewerId, pingKey }. */
export async function POST(request: NextRequest) {
  if (crossOrigin(request)) return json({ error: "forbidden" }, 403);
  const body = (await request.json().catch(() => ({}))) as { viewerId?: unknown; pingKey?: unknown };
  if (typeof body.viewerId !== "string" || typeof body.pingKey !== "string") return json({ error: "bad_request" }, 400);
  const ok = await recordViewerPing(body.viewerId, body.pingKey).catch(() => false);
  return json({ ok });
}
