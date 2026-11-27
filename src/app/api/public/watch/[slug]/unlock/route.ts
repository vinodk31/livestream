import type { NextRequest } from "next/server";
import { crossOrigin, errorResponse, json } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";
import { metaFromHeaders } from "@/server/request";
import { accessCookieName, unlockWithPasscode } from "@/server/streams/broadcast";

/** Checks a private stream's passcode and remembers it in an httpOnly cookie for this browser. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/public/watch/[slug]/unlock">) {
  if (crossOrigin(request)) return json({ error: "forbidden" }, 403);
  const { slug } = await ctx.params;
  const meta = metaFromHeaders(request.headers);
  if (!(await rateLimit("passcode", `${meta.ip ?? "unknown"}:${slug}`)).success) {
    return json({ error: "rate_limited", message: "Too many tries. Wait a few minutes and try again." }, 429);
  }
  const body = (await request.json().catch(() => ({}))) as { passcode?: unknown };
  const passcode = typeof body.passcode === "string" ? body.passcode.slice(0, 64) : "";
  try {
    const { streamId, cookie } = await unlockWithPasscode(slug, passcode);
    const res = json({ ok: true });
    if (cookie) {
      res.cookies.set(accessCookieName(streamId), cookie, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 7,
      });
    }
    return res;
  } catch (err) {
    return errorResponse(err, "watch.unlock");
  }
}
