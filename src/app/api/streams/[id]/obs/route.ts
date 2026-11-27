import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { crossOrigin, errorResponse, json } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";
import { getOrCreateObsSettings } from "@/server/streams/broadcast";

/** Returns the RTMP server URL and stream key for OBS. Body: { regenerate?: boolean }. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/streams/[id]/obs">) {
  if (crossOrigin(request)) return json({ error: "forbidden" }, 403);
  const user = await getCurrentUser();
  if (!user) return json({ error: "unauthenticated" }, 401);
  if (!(await rateLimit("broadcastControl", user.id)).success) return json({ error: "rate_limited" }, 429);
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as { regenerate?: unknown };
  try {
    return json(await getOrCreateObsSettings(id, user.id, body.regenerate === true));
  } catch (err) {
    return errorResponse(err, "obs");
  }
}
