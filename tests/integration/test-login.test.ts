import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { auditLogs, users } from "@/server/db/schema";
import * as auth from "@/server/auth/service";
import { verifyAccessToken } from "@/server/auth/jwt";
import { getTestLoginConfig, testLogin, testLoginKeyMatches } from "@/server/auth/test-login";
import { setupTestDb } from "../support/db";

const meta = { ip: "203.0.113.11", userAgent: "vitest" };
const KEY = "k".repeat(32);

let t: Awaited<ReturnType<typeof setupTestDb>>;
beforeAll(async () => {
  t = await setupTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("test login config", () => {
  it("is off unless both a long key and an email are set", () => {
    expect(getTestLoginConfig()).toBeNull();
    vi.stubEnv("TEST_LOGIN_KEY", KEY);
    expect(getTestLoginConfig()).toBeNull();
    vi.stubEnv("TEST_LOGIN_EMAIL", "Host@Example.com");
    expect(getTestLoginConfig()).toEqual({ key: KEY, email: "host@example.com" });
    vi.stubEnv("TEST_LOGIN_KEY", "too-short");
    expect(getTestLoginConfig()).toBeNull();
  });

  it("only accepts the exact key", () => {
    const config = { key: KEY, email: "a@b.co" };
    expect(testLoginKeyMatches(KEY, config)).toBe(true);
    expect(testLoginKeyMatches(KEY + "x", config)).toBe(false);
    expect(testLoginKeyMatches("k".repeat(31) + "j", config)).toBe(false);
    expect(testLoginKeyMatches("", config)).toBe(false);
    expect(testLoginKeyMatches(null, config)).toBe(false);
  });
});

describe("testLogin", () => {
  it("signs into an existing account and marks it verified", async () => {
    const { user } = await auth.register({ name: "Vinod", email: "vinod@example.com", password: "correct-horse-1" }, meta);
    const tokens = await testLogin({ key: KEY, email: "vinod@example.com" }, meta);
    expect((await verifyAccessToken(tokens.accessToken))?.sub).toBe(user.id);
    expect((await auth.refreshSession(tokens.refreshToken!, meta)).ok).toBe(true);
    const [row] = await t.db.select().from(users).where(eq(users.id, user.id));
    expect(row!.emailVerifiedAt).toBeInstanceOf(Date);
    expect(await t.db.select().from(users)).toHaveLength(1);
    const logs = await t.db.select().from(auditLogs).where(eq(auditLogs.action, "auth.test_login"));
    expect(logs).toHaveLength(1);
  });

  it("creates a verified account when none exists", async () => {
    const tokens = await testLogin({ key: KEY, email: "new@example.com" }, meta);
    const [row] = await t.db.select().from(users);
    expect(row).toMatchObject({ email: "new@example.com", role: "host" });
    expect(row!.emailVerifiedAt).toBeInstanceOf(Date);
    expect((await verifyAccessToken(tokens.accessToken))?.sub).toBe(row!.id);
  });

  it("refuses a disabled account", async () => {
    const { user } = await auth.register({ name: "V", email: "v@example.com", password: "correct-horse-1" }, meta);
    await t.db.update(users).set({ disabledAt: new Date() }).where(eq(users.id, user.id));
    await expect(testLogin({ key: KEY, email: "v@example.com" }, meta)).rejects.toThrow(/disabled/);
  });
});
