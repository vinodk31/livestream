import { NextResponse, type NextRequest } from "next/server";
import { REFRESH_COOKIE, clearAuthCookies, writeAuthCookies } from "@/server/auth/cookies";
import { refreshSession } from "@/server/auth/session-store";
import { rateLimit } from "@/server/rate-limit";
import { metaFromHeaders } from "@/server/request";

/** Lets client code (e.g. a long-running studio tab) renew its session without a navigation. */
export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const meta = metaFromHeaders(request.headers);
  if (!(await rateLimit("refresh", meta.ip ?? "unknown")).success) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const token = request.cookies.get(REFRESH_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const result = await refreshSession(token, meta);
  if (!result.ok) {
    const res = NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    clearAuthCookies(res.cookies);
    return res;
  }
  const res = NextResponse.json({ ok: true });
  writeAuthCookies(res.cookies, result.tokens);
  res.headers.set("Cache-Control", "no-store");
  return res;
}
