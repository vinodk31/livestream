import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { auditLogs, emailTokens, refreshTokens, users } from "@/server/db/schema";
import { sentEmails } from "@/server/email";
import * as auth from "@/server/auth/service";
import { verifyAccessToken } from "@/server/auth/jwt";
import { sha256 } from "@/server/auth/tokens";
import { setupTestDb } from "../support/db";

const meta = { ip: "203.0.113.7", userAgent: "vitest" };
const PASSWORD = "correct-horse-1";

let t: Awaited<ReturnType<typeof setupTestDb>>;

beforeAll(async () => {
  t = await setupTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  sentEmails.length = 0;
});

function codeFromLastEmail(): string {
  const email = sentEmails.at(-1);
  expect(email).toBeDefined();
  const match = email!.text.match(/code is: (\d{6})/);
  expect(match).not.toBeNull();
  return match![1]!;
}

function wrongCode(code: string): string {
  return code === "000000" ? "111111" : "000000";
}

async function registerAlice() {
  return auth.register({ name: "Alice", email: "Alice@Example.com", password: PASSWORD }, meta);
}

describe("registration", () => {
  it("creates an unverified host, issues tokens and sends a verification email", async () => {
    const { user, tokens } = await registerAlice();
    expect(user.email).toBe("alice@example.com");
    expect(user.role).toBe("host");
    expect(user.emailVerifiedAt).toBeNull();
    expect(user.passwordHash).not.toContain(PASSWORD);

    const claims = await verifyAccessToken(tokens.accessToken);
    expect(claims).toMatchObject({ sub: user.id, role: "host", ev: false });
    expect(tokens.refreshToken).toBeTruthy();

    // Only the hash of the refresh token is stored.
    const [stored] = await t.db.select().from(refreshTokens).where(eq(refreshTokens.userId, user.id));
    expect(stored!.tokenHash).toBe(sha256(tokens.refreshToken!));

    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]!.to).toBe("alice@example.com");
    expect(sentEmails[0]!.subject).toMatch(/verification code/i);
  });

  it("rejects a duplicate email regardless of case", async () => {
    await registerAlice();
    await expect(
      auth.register({ name: "Other", email: "ALICE@example.COM", password: PASSWORD }, meta),
    ).rejects.toMatchObject({ code: "email_taken" });
  });
});

describe("login", () => {
  it("accepts correct credentials case-insensitively and audits it", async () => {
    const { user } = await registerAlice();
    const { tokens } = await auth.login({ email: "alice@EXAMPLE.com", password: PASSWORD }, meta);
    expect((await verifyAccessToken(tokens.accessToken))?.sub).toBe(user.id);
    const logs = await t.db.select().from(auditLogs).where(eq(auditLogs.action, "auth.login"));
    expect(logs).toHaveLength(1);
  });

  it("gives the same error for wrong password and unknown email", async () => {
    await registerAlice();
    await expect(auth.login({ email: "alice@example.com", password: "wrong-pass-1" }, meta)).rejects.toMatchObject({
      code: "invalid_credentials",
    });
    await expect(auth.login({ email: "nobody@example.com", password: PASSWORD }, meta)).rejects.toMatchObject({
      code: "invalid_credentials",
    });
  });

  it("blocks disabled accounts", async () => {
    const { user } = await registerAlice();
    await t.db.update(users).set({ disabledAt: new Date() }).where(eq(users.id, user.id));
    await expect(auth.login({ email: "alice@example.com", password: PASSWORD }, meta)).rejects.toMatchObject({
      code: "account_disabled",
    });
  });
});

describe("refresh token rotation", () => {
  it("rotates the refresh token and keeps the same login family", async () => {
    const { tokens } = await registerAlice();
    const r = await auth.refreshSession(tokens.refreshToken!, meta);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tokens.refreshToken).toBeTruthy();
    expect(r.tokens.refreshToken).not.toBe(tokens.refreshToken);
    const before = await verifyAccessToken(tokens.accessToken);
    const after = await verifyAccessToken(r.tokens.accessToken);
    expect(after?.sid).toBe(before?.sid);

    const r2 = await auth.refreshSession(r.tokens.refreshToken!, meta);
    expect(r2.ok).toBe(true);
  });

  it("tolerates a parallel reuse within the grace window without rotating again", async () => {
    const { tokens } = await registerAlice();
    const first = await auth.refreshSession(tokens.refreshToken!, meta);
    const second = await auth.refreshSession(tokens.refreshToken!, meta);
    expect(first.ok && second.ok).toBe(true);
    if (!second.ok || !first.ok) return;
    expect(second.tokens.refreshToken).toBeUndefined();
    // The newly-issued token from the first call still works.
    expect((await auth.refreshSession(first.tokens.refreshToken!, meta)).ok).toBe(true);
  });

  it("revokes the whole family when a rotated token is replayed after the grace window", async () => {
    const { tokens } = await registerAlice();
    const first = await auth.refreshSession(tokens.refreshToken!, meta);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // Simulate the grace window having passed.
    await t.db
      .update(refreshTokens)
      .set({ revokedAt: new Date(Date.now() - 60_000) })
      .where(eq(refreshTokens.tokenHash, sha256(tokens.refreshToken!)));

    expect(await auth.refreshSession(tokens.refreshToken!, meta)).toEqual({ ok: false, reason: "reused" });
    // The attacker's (or victim's) newer token is now dead too.
    expect(await auth.refreshSession(first.tokens.refreshToken!, meta)).toMatchObject({ ok: false });
    const logs = await t.db.select().from(auditLogs).where(eq(auditLogs.action, "auth.refresh_reuse_detected"));
    expect(logs).toHaveLength(1);
  });

  it("rejects unknown, expired and disabled-user tokens", async () => {
    expect(await auth.refreshSession("nope", meta)).toEqual({ ok: false, reason: "invalid" });

    const { user, tokens } = await registerAlice();
    await t.db
      .update(refreshTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(refreshTokens.userId, user.id));
    expect(await auth.refreshSession(tokens.refreshToken!, meta)).toEqual({ ok: false, reason: "expired" });

    const again = await auth.login({ email: "alice@example.com", password: PASSWORD }, meta);
    await t.db.update(users).set({ disabledAt: new Date() }).where(eq(users.id, user.id));
    expect(await auth.refreshSession(again.tokens.refreshToken!, meta)).toEqual({ ok: false, reason: "disabled" });
  });

  it("logout revokes the session", async () => {
    const { tokens } = await registerAlice();
    await auth.logout(tokens.refreshToken, meta);
    const r = await auth.refreshSession(tokens.refreshToken!, meta);
    expect(r.ok).toBe(false);
  });
});

describe("email verification", () => {
  it("emails a 6-digit code that verifies the account exactly once", async () => {
    const { user } = await registerAlice();
    expect(sentEmails[0]!.subject).toMatch(/^\d{6} is your InstantLive verification code$/);
    const code = codeFromLastEmail();
    await auth.verifyEmail(user.id, code, meta);
    const [row] = await t.db.select().from(users).where(eq(users.id, user.id));
    expect(row!.emailVerifiedAt).toBeInstanceOf(Date);
    await expect(auth.verifyEmail(user.id, code, meta)).rejects.toMatchObject({ code: "invalid_code" });
  });

  it("stores only a keyed hash of the code", async () => {
    const { user } = await registerAlice();
    const code = codeFromLastEmail();
    const [row] = await t.db.select().from(emailTokens).where(eq(emailTokens.userId, user.id));
    expect(row!.tokenHash).not.toContain(code);
    expect(row!.tokenHash).not.toBe(sha256(code));
  });

  it("counts wrong guesses and burns the code after 5", async () => {
    const { user } = await registerAlice();
    const code = codeFromLastEmail();
    for (let left = auth.MAX_CODE_ATTEMPTS - 1; left >= 0; left--) {
      await expect(auth.verifyEmail(user.id, wrongCode(code), meta)).rejects.toMatchObject({
        code: "invalid_code",
        attemptsLeft: left,
      });
    }
    // Even the right code no longer works.
    await expect(auth.verifyEmail(user.id, code, meta)).rejects.toMatchObject({ code: "invalid_code" });
    // A new code resets the counter.
    await auth.resendVerification(user.id);
    await auth.verifyEmail(user.id, codeFromLastEmail(), meta);
  });

  it("rejects expired codes and codes belonging to someone else", async () => {
    const { user } = await registerAlice();
    const aliceCode = codeFromLastEmail();
    const bob = await auth.register({ name: "Bob", email: "bob@example.com", password: PASSWORD }, meta);
    await expect(auth.verifyEmail(bob.user.id, aliceCode, meta)).rejects.toMatchObject({ code: "invalid_code" });

    await t.db.update(emailTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(emailTokens.userId, user.id));
    await expect(auth.verifyEmail(user.id, aliceCode, meta)).rejects.toMatchObject({ code: "invalid_code" });
  });

  it("invalidates the previous code when a new one is requested", async () => {
    const { user } = await registerAlice();
    const oldCode = codeFromLastEmail();
    await auth.resendVerification(user.id);
    const newCode = codeFromLastEmail();
    if (oldCode !== newCode) {
      await expect(auth.verifyEmail(user.id, oldCode, meta)).rejects.toMatchObject({ code: "invalid_code" });
    }
    await auth.verifyEmail(user.id, newCode, meta);
  });

  it("refuses to resend once verified", async () => {
    const { user } = await registerAlice();
    await auth.verifyEmail(user.id, codeFromLastEmail(), meta);
    await expect(auth.resendVerification(user.id)).rejects.toMatchObject({ code: "already_verified" });
  });
});

describe("password reset", () => {
  it("does nothing visible for unknown emails", async () => {
    await auth.requestPasswordReset("ghost@example.com", meta);
    expect(sentEmails).toHaveLength(0);
    await expect(
      auth.resetPassword({ email: "ghost@example.com", code: "123456", password: "brand-new-pass-2" }, meta),
    ).rejects.toMatchObject({ code: "invalid_code" });
  });

  it("resets the password with the code, signs out all sessions and the code is single-use", async () => {
    const { tokens } = await registerAlice();
    await auth.requestPasswordReset("ALICE@example.com", meta);
    const code = codeFromLastEmail();
    expect(sentEmails.at(-1)!.subject).toMatch(/password reset code/);

    await auth.resetPassword({ email: "alice@example.com", code, password: "brand-new-pass-2" }, meta);

    expect((await auth.refreshSession(tokens.refreshToken!, meta)).ok).toBe(false);
    await expect(auth.login({ email: "alice@example.com", password: PASSWORD }, meta)).rejects.toMatchObject({
      code: "invalid_credentials",
    });
    const { user } = await auth.login({ email: "alice@example.com", password: "brand-new-pass-2" }, meta);
    expect(user.emailVerifiedAt).not.toBeNull();
    expect(sentEmails.at(-1)!.subject).toMatch(/password was changed/i);

    await expect(
      auth.resetPassword({ email: "alice@example.com", code, password: "another-pass-3" }, meta),
    ).rejects.toMatchObject({ code: "invalid_code" });
  });

  it("does not accept a verification code as a reset code", async () => {
    await registerAlice();
    const verifyCode = codeFromLastEmail();
    await auth.requestPasswordReset("alice@example.com", meta);
    const resetCode = codeFromLastEmail();
    if (verifyCode === resetCode) return; // 1-in-a-million coincidence
    await expect(
      auth.resetPassword({ email: "alice@example.com", code: verifyCode, password: "brand-new-pass-2" }, meta),
    ).rejects.toMatchObject({ code: "invalid_code" });
  });

  it("locks the reset code after 5 wrong guesses", async () => {
    await registerAlice();
    await auth.requestPasswordReset("alice@example.com", meta);
    const code = codeFromLastEmail();
    for (let i = 0; i < auth.MAX_CODE_ATTEMPTS; i++) {
      await expect(
        auth.resetPassword({ email: "alice@example.com", code: wrongCode(code), password: "brand-new-pass-2" }, meta),
      ).rejects.toMatchObject({ code: "invalid_code" });
    }
    await expect(
      auth.resetPassword({ email: "alice@example.com", code, password: "brand-new-pass-2" }, meta),
    ).rejects.toMatchObject({ code: "invalid_code" });
  });

  it("change password keeps only the current device signed in", async () => {
    const { user, tokens: oldDevice } = await registerAlice();
    const fresh = await auth.changePassword(user.id, PASSWORD, "changed-pass-4", meta);
    expect((await auth.refreshSession(oldDevice.refreshToken!, meta)).ok).toBe(false);
    expect((await auth.refreshSession(fresh.refreshToken!, meta)).ok).toBe(true);
    await expect(auth.changePassword(user.id, "wrong-current-1", "x-pass-55555", meta)).rejects.toMatchObject({
      code: "invalid_credentials",
    });
  });
});
