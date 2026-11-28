import { NextResponse, type NextRequest } from "next/server";
import { clearAuthCookies } from "@/server/auth/cookies";
import { safeRedirectPath } from "@/lib/utils";

/**
 * Clears auth cookies and goes to the login page. Used when a still-valid access token belongs
 * to an account that was disabled or deleted (otherwise /login would bounce back to the app).
 */
export async function GET(request: NextRequest) {
  const next = safeRedirectPath(request.nextUrl.searchParams.get("next"), "");
  const url = new URL("/login", request.url);
  url.searchParams.set("reason", "signed_out");
  if (next) url.searchParams.set("next", next);
  const res = NextResponse.redirect(url);
  clearAuthCookies(res.cookies);
  res.headers.set("Cache-Control", "no-store");
  return res;
}
