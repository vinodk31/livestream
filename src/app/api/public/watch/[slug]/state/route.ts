import type { NextRequest } from "next/server";
import { errorResponse, json } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";
import { metaFromHeaders } from "@/server/request";
import { accessCookieName, getViewerState, getViewerStream } from "@/server/streams/broadcast";

/** Polled by the viewer page while waiting for the host to go live. */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/public/watch/[slug]/state">) {
  const meta = metaFromHeaders(request.headers);
  if (!(await rateLimit("viewerPoll", meta.ip ?? "unknown")).success) return json({ error: "rate_limited" }, 429);
  const { slug } = await ctx.params;
  try {
    const stream = await getViewerStream(slug);
    if (!stream) return json({ error: "not_found" }, 404);
    const state = await getViewerState(slug, request.cookies.get(accessCookieName(stream.id))?.value, meta);
    return state ? json(state) : json({ error: "not_found" }, 404);
  } catch (err) {
    return errorResponse(err, "watch.state");
  }
}
