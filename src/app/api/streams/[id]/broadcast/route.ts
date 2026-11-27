import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { crossOrigin, errorResponse, json } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";
import { metaFromHeaders } from "@/server/request";
import { endBroadcast, startBroadcast } from "@/server/streams/broadcast";
import { getStreamForHost } from "@/server/streams/service";

/** Start (or resume) a broadcast. Body: { source: "browser" | "obs" }. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/streams/[id]/broadcast">) {
  if (crossOrigin(request)) return json({ error: "forbidden" }, 403);
  const user = await getCurrentUser();
  if (!user) return json({ error: "unauthenticated" }, 401);
  if (!(await rateLimit("broadcastControl", user.id)).success) return json({ error: "rate_limited" }, 429);
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as { source?: unknown };
  const source = body.source === "obs" ? "obs" : "browser";
  try {
    const conn = await startBroadcast(id, user.id, source, metaFromHeaders(request.headers));
    return json(conn);
  } catch (err) {
    return errorResponse(err, "broadcast.start");
  }
}

/** End the broadcast. */
export async function DELETE(request: NextRequest, ctx: RouteContext<"/api/streams/[id]/broadcast">) {
  if (crossOrigin(request)) return json({ error: "forbidden" }, 403);
  const user = await getCurrentUser();
  if (!user) return json({ error: "unauthenticated" }, 401);
  const { id } = await ctx.params;
  try {
    await getStreamForHost(id, user.id);
    await endBroadcast(id, user.id, "host_ended", metaFromHeaders(request.headers));
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err, "broadcast.end");
  }
}
