import { NextResponse, type NextRequest } from "next/server";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  accessCookieOptions,
  clearAuthCookies,
  refreshCookieOptions,
} from "@/server/auth/cookies";
import { verifyAccessToken } from "@/server/auth/jwt";
import { refreshSession } from "@/server/auth/session-store";
import { metaFromHeaders } from "@/server/request";

const PROTECTED_PREFIXES = ["/dashboard", "/streams", "/settings", "/admin", "/studio"];
const GUEST_ONLY = ["/login", "/register", "/forgot-password"];

function matches(pathname: string, prefixes: string[]) {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Optimistic auth gate. It keeps sessions alive by rotating an expired access token
 * using the refresh token, and redirects obviously signed-out users.
 * Real authorization happens in the Data Access Layer (src/server/auth/session.ts).
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  let claims = await verifyAccessToken(request.cookies.get(ACCESS_COOKIE)?.value);
  let newTokens: { accessToken: string; refreshToken?: string } | null = null;
  let clearCookies = false;

  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
  if (!claims && refreshToken) {
    try {
      const result = await refreshSession(refreshToken, metaFromHeaders(request.headers));
      if (result.ok) {
        newTokens = result.tokens;
        claims = await verifyAccessToken(result.tokens.accessToken);
      } else {
        clearCookies = true;
      }
    } catch (err) {
      // Database hiccup: let the request through as signed-out rather than failing it.
      console.error("[proxy] refresh failed", err);
    }
  }

  let response: NextResponse;
  if (!claims && matches(pathname, PROTECTED_PREFIXES)) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", pathname + search);
    response = NextResponse.redirect(url);
  } else if (claims && matches(pathname, GUEST_ONLY)) {
    response = NextResponse.redirect(new URL("/dashboard", request.url));
  } else {
    if (newTokens) {
      // Make the fresh token visible to Server Components rendering this same request.
      request.cookies.set(ACCESS_COOKIE, newTokens.accessToken);
    } else if (clearCookies) {
      request.cookies.delete(ACCESS_COOKIE);
    }
    response = NextResponse.next({ request: { headers: request.headers } });
  }

  if (newTokens) {
    response.cookies.set(ACCESS_COOKIE, newTokens.accessToken, accessCookieOptions);
    if (newTokens.refreshToken) {
      response.cookies.set(REFRESH_COOKIE, newTokens.refreshToken, refreshCookieOptions);
    }
  } else if (clearCookies) {
    clearAuthCookies(response.cookies);
  }
  return response;
}

export const config = {
  // Skip static assets, images and the public watch/API endpoints that never need a host session.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|watch|api/public|api/livekit|api/cron|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|txt|xml)$).*)",
  ],
};
