import "server-only";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { getDb } from "../db";
import { emailTokens, users, type User } from "../db/schema";
import { audit } from "../audit";
import { env } from "../env";
import { sendEmail } from "../email";
import { passwordChangedMessage, resetPasswordMessage, verifyEmailMessage } from "../email/templates";
import type { RequestMeta } from "../request";
import { burnPasswordCheck, hashPassword, verifyPassword } from "./password";
import { generateToken, sha256 } from "./tokens";
import { issueTokens, revokeAllForUser, type TokenPair } from "./session-store";

export { logout, refreshSession, type RefreshResult, type TokenPair } from "./session-store";

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

export class AuthError extends Error {
  constructor(
    public code:
      | "email_taken"
      | "invalid_credentials"
      | "account_disabled"
      | "invalid_token"
      | "already_verified",
    message?: string,
  ) {
    super(message ?? code);
  }
}

async function findUserByEmail(email: string): Promise<User | undefined> {
  const [user] = await getDb()
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${email.toLowerCase()}`)
    .limit(1);
  return user;
}

// ---------- Registration & login ----------

export async function register(
  input: { name: string; email: string; password: string },
  meta: RequestMeta,
): Promise<{ user: User; tokens: TokenPair }> {
  const email = input.email.trim().toLowerCase();
  if (await findUserByEmail(email)) throw new AuthError("email_taken");

  const passwordHash = await hashPassword(input.password);
  let user: User;
  try {
    [user] = (await getDb()
      .insert(users)
      .values({ name: input.name.trim(), email, passwordHash })
      .returning()) as [User];
  } catch (err) {
    // Unique index race: two sign-ups with the same email at once.
    if ((err as { code?: string }).code === "23505") throw new AuthError("email_taken");
    throw err;
  }

  await audit({ action: "auth.register", actorId: user.id, ip: meta.ip });
  // A failed email must not fail sign-up: the user can resend from the dashboard.
  await sendVerificationEmail(user).catch((err) => console.error("[register] verification email failed", err));
  const { accessToken, refreshToken } = await issueTokens(user, meta);
  return { user, tokens: { accessToken, refreshToken } };
}

export async function login(
  input: { email: string; password: string },
  meta: RequestMeta,
): Promise<{ user: User; tokens: TokenPair }> {
  const user = await findUserByEmail(input.email);
  if (!user) {
    await burnPasswordCheck(input.password);
    throw new AuthError("invalid_credentials");
  }
  const ok = await verifyPassword(user.passwordHash, input.password);
  if (!ok) {
    await audit({ action: "auth.login_failed", actorId: user.id, ip: meta.ip });
    throw new AuthError("invalid_credentials");
  }
  if (user.disabledAt) throw new AuthError("account_disabled");

  await getDb().update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  await audit({ action: "auth.login", actorId: user.id, ip: meta.ip });
  const { accessToken, refreshToken } = await issueTokens(user, meta);
  return { user, tokens: { accessToken, refreshToken } };
}

// ---------- Email tokens ----------

async function createEmailToken(userId: string, type: "verify_email" | "reset_password", ttlMs: number) {
  const db = getDb();
  // Invalidate older outstanding tokens of the same type.
  await db
    .update(emailTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(emailTokens.userId, userId), eq(emailTokens.type, type), isNull(emailTokens.usedAt)));
  const raw = generateToken();
  await db.insert(emailTokens).values({
    userId,
    type,
    tokenHash: sha256(raw),
    expiresAt: new Date(Date.now() + ttlMs),
  });
  return raw;
}

/** Atomically consume a valid, unused, unexpired token. Returns the user id or null. */
async function consumeEmailToken(raw: string, type: "verify_email" | "reset_password"): Promise<string | null> {
  const [row] = await getDb()
    .update(emailTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(emailTokens.tokenHash, sha256(raw)),
        eq(emailTokens.type, type),
        isNull(emailTokens.usedAt),
        gt(emailTokens.expiresAt, new Date()),
      ),
    )
    .returning({ userId: emailTokens.userId });
  return row?.userId ?? null;
}

export async function sendVerificationEmail(user: Pick<User, "id" | "email" | "name" | "emailVerifiedAt">) {
  if (user.emailVerifiedAt) throw new AuthError("already_verified");
  const raw = await createEmailToken(user.id, "verify_email", VERIFY_TTL_MS);
  const link = `${env.appUrl}/verify-email?token=${encodeURIComponent(raw)}`;
  await sendEmail(verifyEmailMessage(user.email, user.name, link));
}

export async function resendVerification(userId: string) {
  const [user] = await getDb().select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new AuthError("invalid_token");
  await sendVerificationEmail(user);
}

export async function verifyEmail(raw: string, meta: RequestMeta): Promise<string> {
  const userId = await consumeEmailToken(raw, "verify_email");
  if (!userId) throw new AuthError("invalid_token");
  await getDb()
    .update(users)
    .set({ emailVerifiedAt: new Date() })
    .where(and(eq(users.id, userId), isNull(users.emailVerifiedAt)));
  await audit({ action: "auth.email_verified", actorId: userId, ip: meta.ip });
  return userId;
}

/** Always resolves the same way whether or not the email exists (no account enumeration). */
export async function requestPasswordReset(email: string, meta: RequestMeta): Promise<void> {
  const user = await findUserByEmail(email);
  if (!user || user.disabledAt) return;
  const raw = await createEmailToken(user.id, "reset_password", RESET_TTL_MS);
  const link = `${env.appUrl}/reset-password?token=${encodeURIComponent(raw)}`;
  await audit({ action: "auth.password_reset_requested", actorId: user.id, ip: meta.ip });
  await sendEmail(resetPasswordMessage(user.email, user.name, link));
}

export async function resetPassword(raw: string, newPassword: string, meta: RequestMeta): Promise<void> {
  const userId = await consumeEmailToken(raw, "reset_password");
  if (!userId) throw new AuthError("invalid_token");
  const passwordHash = await hashPassword(newPassword);
  const [user] = await getDb()
    .update(users)
    // Clicking a reset link proves control of the inbox, so it also verifies the email.
    .set({ passwordHash, emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, now())` })
    .where(eq(users.id, userId))
    .returning();
  await revokeAllForUser(userId);
  await audit({ action: "auth.password_reset", actorId: userId, ip: meta.ip });
  if (user) await sendEmail(passwordChangedMessage(user.email, user.name)).catch(() => {});
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  meta: RequestMeta,
): Promise<TokenPair> {
  const [user] = await getDb().select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || !(await verifyPassword(user.passwordHash, currentPassword))) {
    throw new AuthError("invalid_credentials");
  }
  const passwordHash = await hashPassword(newPassword);
  await getDb().update(users).set({ passwordHash }).where(eq(users.id, userId));
  await revokeAllForUser(userId);
  await audit({ action: "auth.password_changed", actorId: userId, ip: meta.ip });
  await sendEmail(passwordChangedMessage(user.email, user.name)).catch(() => {});
  // Keep the current device signed in with a fresh login.
  const { accessToken, refreshToken } = await issueTokens(user, meta);
  return { accessToken, refreshToken };
}
