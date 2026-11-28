import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { json } from "@/server/http";
import { recordingLinks } from "@/server/streams/recording-service";

/** Host-only: redirects to a short-lived link to watch (default) or download (?download=1) a recording. */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/recordings/[sessionId]">) {
  const user = await getCurrentUser();
  if (!user) return json({ error: "unauthenticated" }, 401);
  const { sessionId } = await ctx.params;
  try {
    const links = await recordingLinks(sessionId, user.id);
    const target = request.nextUrl.searchParams.get("download") ? links.download : links.watch;
    if (!target) return json({ error: "not_configured" }, 503);
    const res = NextResponse.redirect(target);
    res.headers.set("Cache-Control", "no-store");
    res.headers.set("Referrer-Policy", "no-referrer");
    return res;
  } catch {
    return json({ error: "not_found" }, 404);
  }
}
