import "server-only";
import { and, eq, isNull, ne } from "drizzle-orm";
import { getDb } from "../db";
import { refreshTokens, users } from "../db/schema";
import { audit } from "../audit";
import { verifyPassword } from "../auth/password";
import { AuthError } from "../auth/service";
import type { RequestMeta } from "../request";

export async function updateProfile(userId: string, input: { name: string }, meta: RequestMeta): Promise<void> {
  await getDb().update(users).set({ name: input.name.trim() }).where(eq(users.id, userId));
  await audit({ action: "account.profile_updated", actorId: userId, ip: meta.ip });
}

/** Revokes every login except the current one. Returns how many devices were signed out. */
export async function revokeOtherSessions(userId: string, currentFamilyId: string, meta: RequestMeta): Promise<number> {
  const revoked = await getDb()
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(refreshTokens.userId, userId),
        ne(refreshTokens.familyId, currentFamilyId),
        isNull(refreshTokens.revokedAt),
      ),
    )
    .returning({ familyId: refreshTokens.familyId });
  const devices = new Set(revoked.map((r) => r.familyId)).size;
  await audit({ action: "account.sessions_revoked", actorId: userId, metadata: { devices }, ip: meta.ip });
  return devices;
}

/** Counts distinct active logins (one per device/browser). */
export async function countActiveSessions(userId: string): Promise<number> {
  const rows = await getDb()
    .selectDistinct({ familyId: refreshTokens.familyId })
    .from(refreshTokens)
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  return rows.length;
}

/**
 * Permanently deletes the account and everything it owns (streams, sessions, stats via
 * ON DELETE CASCADE). Requires the current password. Audit rows are kept, with the actor nulled.
 */
export async function deleteAccount(userId: string, password: string, meta: RequestMeta): Promise<void> {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || !(await verifyPassword(user.passwordHash, password))) {
    throw new AuthError("invalid_credentials");
  }
  await audit({
    action: "account.deleted",
    actorId: userId,
    targetType: "user",
    targetId: userId,
    ip: meta.ip,
  });
  await db.delete(users).where(eq(users.id, userId));
}
