import "server-only";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { users, type User } from "../db/schema";
import { audit } from "../audit";
import type { RequestMeta } from "../request";
import { hashPassword } from "./password";
import { issueTokens, type TokenPair } from "./session-store";

/**
 * TEMPORARY testing aid: lets whoever holds TEST_LOGIN_KEY sign in as TEST_LOGIN_EMAIL
 * without the password form. Disabled unless both env vars are set.
 * Remove TEST_LOGIN_KEY before real users arrive.
 */
const MIN_KEY_LENGTH = 24;

export type TestLoginConfig = { key: string; email: string };

export function getTestLoginConfig(): TestLoginConfig | null {
  const key = process.env.TEST_LOGIN_KEY?.trim();
  const email = process.env.TEST_LOGIN_EMAIL?.trim().toLowerCase();
  if (!key || key.length < MIN_KEY_LENGTH || !email || !email.includes("@")) return null;
  return { key, email };
}

export function isTestLoginEnabled(): boolean {
  return getTestLoginConfig() !== null;
}

export function testLoginKeyMatches(candidate: string | null | undefined, config: TestLoginConfig): boolean {
  if (!candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(config.key);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Signs in as the configured account, creating it (already verified) if it doesn't exist. */
export async function testLogin(config: TestLoginConfig, meta: RequestMeta): Promise<TokenPair> {
  const db = getDb();
  let [user] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${config.email}`)
    .limit(1);

  if (!user) {
    // Random password nobody knows; use the bypass link or "Forgot password" to get in.
    const passwordHash = await hashPassword(randomBytes(32).toString("base64url"));
    [user] = (await db
      .insert(users)
      .values({ email: config.email, name: "Test Host", passwordHash, emailVerifiedAt: new Date() })
      .returning()) as [User];
  } else {
    if (user.disabledAt) throw new Error("Test login account is disabled");
    if (!user.emailVerifiedAt) {
      [user] = (await db
        .update(users)
        .set({ emailVerifiedAt: new Date() })
        .where(eq(users.id, user.id))
        .returning()) as [User];
    }
  }

  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  await audit({ action: "auth.test_login", actorId: user.id, ip: meta.ip });
  const { accessToken, refreshToken } = await issueTokens(user, meta);
  return { accessToken, refreshToken };
}
