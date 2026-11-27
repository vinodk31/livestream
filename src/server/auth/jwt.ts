// Edge-safe (no Node-only imports): used by both the proxy and server code.
import { SignJWT, jwtVerify } from "jose";

export const ACCESS_TOKEN_TTL_SEC = 15 * 60;
export const REFRESH_TOKEN_TTL_SEC = 30 * 24 * 60 * 60;

const ISSUER = "instantlive";
const AUDIENCE = "instantlive:app";

export type AccessClaims = {
  sub: string;
  role: "host" | "admin";
  /** Refresh-token family (one per login). */
  sid: string;
  /** Email verified at issue time (UI hint only; authorization re-checks the DB). */
  ev: boolean;
};

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET must be set to at least 32 characters.");
  return new TextEncoder().encode(s);
}

export async function signAccessToken(claims: AccessClaims): Promise<string> {
  return new SignJWT({ role: claims.role, sid: claims.sid, ev: claims.ev })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SEC}s`)
    .sign(secret());
}

export async function verifyAccessToken(token: string | undefined): Promise<AccessClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["HS256"],
    });
    if (typeof payload.sub !== "string" || typeof payload.sid !== "string") return null;
    const role = payload.role === "admin" ? "admin" : "host";
    return { sub: payload.sub, role, sid: payload.sid, ev: payload.ev === true };
  } catch {
    return null;
  }
}
