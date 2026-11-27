import "server-only";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { getDb } from "../db";
import { emailTokens, users, type User } from "../db/schema";
import { audit } from "../audit";
import { sendEmail } from "../email";
import { passwordChangedMessage, resetPasswordMessage, verifyEmailMessage } from "../email/templates";
import type { RequestMeta } from "../request";
import { burnPasswordCheck, hashPassword, verifyPassword } from "./password";
import { generateCode, hashCode, safeEqual } from "./tokens";
import { issueTokens, revokeAllForUser, type TokenPair } from "./session-store";

export { logout, refreshSession, type RefreshResult, type TokenPair } from "./session-store";

export const CODE_TTL_MS = 15 * 60 * 1000;
export const MAX_CODE_ATTEMPTS = 5;

export class AuthError extends Error {
  constructor(
    public code:
      | "email_taken"
      | "invalid_credentials"
      | "account_disabled"
      | "invalid_code"
      | "already_verified",
    message?: string,
    /** For invalid_code: wrong guesses left before the code is burned. */
    public attemptsLeft?: number,
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

// ---------- Email codes ----------

type CodeType = "verify_email" | "reset_password";

/** Sends a fresh 6-digit code, replacing any outstanding code of the same type. */
async function issueEmailCode(userId: string, type: CodeType): Promise<string> {
  const db = getDb();
  await db
    .update(emailTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(emailTokens.userId, userId), eq(emailTokens.type, type), isNull(emailTokens.usedAt)));
  const code = generateCode();
  await db.insert(emailTokens).values({
    userId,
    type,
    tokenHash: hashCode(type, userId, code),
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
  });
  return code;
}

/**
 * Checks a code against the user's current outstanding code. Wrong guesses are counted and the
 * code is burned after MAX_CODE_ATTEMPTS, so a 6-digit code can't be brute-forced.
 */
async function consumeEmailCode(userId: string, type: CodeType, code: string): Promise<void> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(emailTokens)
    .where(
      and(
        eq(emailTokens.userId, userId),
        eq(emailTokens.type, type),
        isNull(emailTokens.usedAt),
        gt(emailTokens.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(emailTokens.createdAt))
    .limit(1);
  if (!row || row.attempts >= MAX_CODE_ATTEMPTS) throw new AuthError("invalid_code");

  if (!safeEqual(row.tokenHash, hashCode(type, userId, code.trim()))) {
    const [updated] = await db
      .update(emailTokens)
      .set({ attempts: sql`${emailTokens.attempts} + 1` })
      .where(eq(emailTokens.id, row.id))
      .returning({ attempts: emailTokens.attempts });
    const remaining = Math.max(0, MAX_CODE_ATTEMPTS - (updated?.attempts ?? MAX_CODE_ATTEMPTS));
    throw new AuthError("invalid_code", undefined, remaining);
  }

  // Single use, even under concurrent submissions.
  const claimed = await db
    .update(emailTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(emailTokens.id, row.id), isNull(emailTokens.usedAt)))
    .returning({ id: emailTokens.id });
  if (claimed.length === 0) throw new AuthError("invalid_code");
}

export async function sendVerificationEmail(user: Pick<User, "id" | "email" | "name" | "emailVerifiedAt">) {
  if (user.emailVerifiedAt) throw new AuthError("already_verified");
  const code = await issueEmailCode(user.id, "verify_email");
  await sendEmail(verifyEmailMessage(user.email, user.name, code));
}

export async function resendVerification(userId: string) {
  const [user] = await getDb().select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new AuthError("invalid_code");
  await sendVerificationEmail(user);
}

export async function verifyEmail(userId: string, code: string, meta: RequestMeta): Promise<void> {
  await consumeEmailCode(userId, "verify_email", code);
  await getDb()
    .update(users)
    .set({ emailVerifiedAt: new Date() })
    .where(and(eq(users.id, userId), isNull(users.emailVerifiedAt)));
  await audit({ action: "auth.email_verified", actorId: userId, ip: meta.ip });
}

/** Always resolves the same way whether or not the email exists (no account enumeration). */
export async function requestPasswordReset(email: string, meta: RequestMeta): Promise<void> {
  const user = await findUserByEmail(email);
  if (!user || user.disabledAt) return;
  const code = await issueEmailCode(user.id, "reset_password");
  await audit({ action: "auth.password_reset_requested", actorId: user.id, ip: meta.ip });
  await sendEmail(resetPasswordMessage(user.email, user.name, code));
}

export async function resetPassword(
  input: { email: string; code: string; password: string },
  meta: RequestMeta,
): Promise<void> {
  const user = await findUserByEmail(input.email);
  if (!user || user.disabledAt) {
    // Same error and similar timing as a wrong code.
    await burnPasswordCheck(input.password);
    throw new AuthError("invalid_code");
  }
  await consumeEmailCode(user.id, "reset_password", input.code);
  const passwordHash = await hashPassword(input.password);
  await getDb()
    .update(users)
    // Receiving the code proves control of the inbox, so it also verifies the email.
    .set({ passwordHash, emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, now())` })
    .where(eq(users.id, user.id));
  await revokeAllForUser(user.id);
  await audit({ action: "auth.password_reset", actorId: user.id, ip: meta.ip });
  await sendEmail(passwordChangedMessage(user.email, user.name)).catch(() => {});
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
