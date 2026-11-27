import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { crossOrigin, errorResponse, json } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";
import { metaFromHeaders } from "@/server/request";
import { heartbeat } from "@/server/streams/broadcast";

export async function POST(request: NextRequest, ctx: RouteContext<"/api/streams/[id]/heartbeat">) {
  if (crossOrigin(request)) return json({ error: "forbidden" }, 403);
  const user = await getCurrentUser();
  if (!user) return json({ error: "unauthenticated" }, 401);
  if (!(await rateLimit("heartbeat", user.id)).success) return json({ error: "rate_limited" }, 429);
  const { id } = await ctx.params;
  try {
    return json(await heartbeat(id, user.id, metaFromHeaders(request.headers)));
  } catch (err) {
    return errorResponse(err, "heartbeat");
  }
}
