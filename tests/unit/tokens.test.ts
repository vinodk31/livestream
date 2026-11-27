import { describe, expect, it } from "vitest";
import { generateCode, generateToken, hashCode, safeEqual, sha256 } from "@/server/auth/tokens";
import { signAccessToken, verifyAccessToken } from "@/server/auth/jwt";
import { SignJWT } from "jose";

describe("tokens", () => {
  it("generates unique url-safe tokens with 256 bits of entropy", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("hashes deterministically to 64 hex chars", () => {
    expect(sha256("abc")).toBe(sha256("abc"));
    expect(sha256("abc")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("one-time codes", () => {
  it("are always 6 digits, including leading zeros", () => {
    for (let i = 0; i < 2000; i++) expect(generateCode()).toMatch(/^\d{6}$/);
  });

  it("hash differently per user and purpose", () => {
    const h = hashCode("verify_email", "u1", "123456");
    expect(h).toBe(hashCode("verify_email", "u1", "123456"));
    expect(h).not.toBe(hashCode("verify_email", "u2", "123456"));
    expect(h).not.toBe(hashCode("reset_password", "u1", "123456"));
    expect(safeEqual(h, hashCode("verify_email", "u1", "123456"))).toBe(true);
    expect(safeEqual(h, "short")).toBe(false);
  });
});

describe("access tokens", () => {
  const claims = { sub: "11111111-1111-1111-1111-111111111111", role: "host" as const, sid: "fam", ev: true };

  it("round-trips claims", async () => {
    const token = await signAccessToken(claims);
    expect(await verifyAccessToken(token)).toEqual(claims);
  });

  it("rejects tampered, missing and foreign-signed tokens", async () => {
    const token = await signAccessToken(claims);
    const [h, p, s] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...claims, role: "admin" })).toString("base64url");
    expect(await verifyAccessToken(`${h}.${forged}.${s}`)).toBeNull();
    expect(await verifyAccessToken(`${h}.${p}`)).toBeNull();
    expect(await verifyAccessToken(undefined)).toBeNull();

    const foreign = await new SignJWT({ role: "admin", sid: "x" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(claims.sub)
      .setIssuer("instantlive")
      .setAudience("instantlive:app")
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode("some-other-secret-some-other-secret!!"));
    expect(await verifyAccessToken(foreign)).toBeNull();
  });

  it("rejects expired tokens", async () => {
    const expired = await new SignJWT({ role: "host", sid: "x" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(claims.sub)
      .setIssuer("instantlive")
      .setAudience("instantlive:app")
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode(process.env.AUTH_SECRET!));
    expect(await verifyAccessToken(expired)).toBeNull();
  });
});
