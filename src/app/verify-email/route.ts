import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE } from "@/server/auth/cookies";
import { verifyAccessToken } from "@/server/auth/jwt";
import { AuthError, verifyEmail } from "@/server/auth/service";
import { metaFromHeaders } from "@/server/request";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const base = request.nextUrl.origin;
  if (!token) return NextResponse.redirect(new URL("/login?verify=invalid", base));
  try {
    await verifyEmail(token, metaFromHeaders(request.headers));
    // The dashboard re-reads verification status from the database.
    const res = NextResponse.redirect(new URL("/dashboard?verified=1", base));
    res.headers.set("Referrer-Policy", "no-referrer");
    return res;
  } catch (err) {
    if (!(err instanceof AuthError)) console.error("[verify-email]", err);
    const signedIn = await verifyAccessToken(request.cookies.get(ACCESS_COOKIE)?.value);
    return NextResponse.redirect(new URL(signedIn ? "/dashboard?verify=invalid" : "/login?verify=invalid", base));
  }
}
