import { NextResponse, type NextRequest } from "next/server";
import { writeAuthCookies } from "@/server/auth/cookies";
import { getTestLoginConfig, testLogin, testLoginKeyMatches } from "@/server/auth/test-login";
import { rateLimit } from "@/server/rate-limit";
import { metaFromHeaders } from "@/server/request";

// TEMPORARY: one-link sign-in for testing. 404s unless TEST_LOGIN_KEY and TEST_LOGIN_EMAIL are set.
export async function GET(request: NextRequest) {
  const config = getTestLoginConfig();
  const notFound = () => new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  if (!config) return notFound();

  const meta = metaFromHeaders(request.headers);
  if (!(await rateLimit("loginIp", meta.ip ?? "unknown")).success) {
    return new NextResponse("Too many attempts", { status: 429 });
  }
  if (!testLoginKeyMatches(request.nextUrl.searchParams.get("key"), config)) return notFound();

  try {
    const tokens = await testLogin(config, meta);
    const res = NextResponse.redirect(new URL("/dashboard", request.url));
    writeAuthCookies(res.cookies, tokens);
    // Keep the key out of browser history sharing and referrers.
    res.headers.set("Referrer-Policy", "no-referrer");
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (err) {
    console.error("[test-login]", err);
    return new NextResponse("Test login failed. Check the server logs.", { status: 500 });
  }
}
