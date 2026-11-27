import type { NextRequest } from "next/server";
import { crossOrigin, errorResponse, json } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";
import { metaFromHeaders } from "@/server/request";
import { accessCookieName, getViewerStream, joinAsViewer } from "@/server/streams/broadcast";

/** Issues a watch-only token. Body: { name?: string } (shown in chat). */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/public/watch/[slug]/join">) {
  if (crossOrigin(request)) return json({ error: "forbidden" }, 403);
  const meta = metaFromHeaders(request.headers);
  if (!(await rateLimit("viewerJoin", meta.ip ?? "unknown")).success) return json({ error: "rate_limited" }, 429);
  const { slug } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as { name?: unknown };
  try {
    const stream = await getViewerStream(slug);
    if (!stream) return json({ error: "not_found" }, 404);
    const conn = await joinAsViewer(
      slug,
      request.cookies.get(accessCookieName(stream.id))?.value,
      typeof body.name === "string" ? body.name : "",
      { ...meta, country: request.headers.get("x-vercel-ip-country") },
    );
    return json(conn);
  } catch (err) {
    return errorResponse(err, "watch.join");
  }
}
