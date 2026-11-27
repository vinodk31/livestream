import { ACCESS_TOKEN_TTL_SEC, REFRESH_TOKEN_TTL_SEC } from "./jwt";

const secure = process.env.NODE_ENV === "production";

// The __Host- prefix makes browsers reject the cookie unless it is Secure, host-only and Path=/.
export const ACCESS_COOKIE = secure ? "__Host-il_at" : "il_at";
export const REFRESH_COOKIE = secure ? "__Host-il_rt" : "il_rt";

type CookieOptions = {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
};

export const accessCookieOptions: CookieOptions = {
  httpOnly: true,
  secure,
  sameSite: "lax",
  path: "/",
  maxAge: ACCESS_TOKEN_TTL_SEC,
};

export const refreshCookieOptions: CookieOptions = {
  httpOnly: true,
  secure,
  sameSite: "lax",
  path: "/",
  maxAge: REFRESH_TOKEN_TTL_SEC,
};

/** Minimal cookie-writer shape shared by next/headers cookies() and NextResponse.cookies. */
export type CookieWriter = {
  set(name: string, value: string, options?: Partial<CookieOptions>): unknown;
};

export function writeAuthCookies(
  jar: CookieWriter,
  tokens: { accessToken: string; refreshToken?: string },
) {
  jar.set(ACCESS_COOKIE, tokens.accessToken, accessCookieOptions);
  if (tokens.refreshToken) jar.set(REFRESH_COOKIE, tokens.refreshToken, refreshCookieOptions);
}

/**
 * Expire both cookies. We re-send the full attributes because browsers ignore a
 * __Host- cookie deletion that lacks Secure and Path=/ (a bare delete() would).
 */
export function clearAuthCookies(jar: CookieWriter) {
  jar.set(ACCESS_COOKIE, "", { ...accessCookieOptions, maxAge: 0 });
  jar.set(REFRESH_COOKIE, "", { ...refreshCookieOptions, maxAge: 0 });
}
