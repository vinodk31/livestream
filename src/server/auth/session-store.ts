import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../db";
import { refreshTokens, users, type User } from "../db/schema";
import { audit } from "../audit";
import type { RequestMeta } from "../request";
import { REFRESH_TOKEN_TTL_SEC, signAccessToken } from "./jwt";
import { generateToken, sha256 } from "./tokens";

// Kept free of password hashing so the proxy can import it without native modules.

/** A just-rotated refresh token is still accepted (access token only) for this long, to absorb parallel requests. */
const ROTATION_GRACE_MS = 30 * 1000;

export type TokenPair = { accessToken: string; refreshToken?: string };

export async function issueTokens(user: User, meta: RequestMeta, familyId: string = randomUUID()): Promise<Required<TokenPair> & { tokenId: string }> {
  const refreshToken = generateToken();
  const [row] = await getDb()
    .insert(refreshTokens)
    .values({
      userId: user.id,
      familyId,
      tokenHash: sha256(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SEC * 1000),
      userAgent: meta.userAgent,
      ip: meta.ip,
    })
    .returning({ id: refreshTokens.id });
  const accessToken = await signAccessToken({
    sub: user.id,
    role: user.role,
    sid: familyId,
    ev: user.emailVerifiedAt != null,
  });
  return { accessToken, refreshToken, tokenId: row!.id };
}

// ---------- Refresh token rotation ----------

export type RefreshResult =
  | { ok: true; userId: string; tokens: TokenPair }
  | { ok: false; reason: "invalid" | "expired" | "reused" | "disabled" };

export async function refreshSession(rawToken: string, meta: RequestMeta): Promise<RefreshResult> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, sha256(rawToken)))
    .limit(1);
  if (!row) return { ok: false, reason: "invalid" };
  if (row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };

  const [user] = await db.select().from(users).where(eq(users.id, row.userId)).limit(1);
  if (!user || user.disabledAt) {
    await revokeFamily(row.familyId);
    return { ok: false, reason: "disabled" };
  }

  const accessOnly = async (): Promise<RefreshResult> => ({
    ok: true,
    userId: user.id,
    tokens: {
      accessToken: await signAccessToken({
        sub: user.id,
        role: user.role,
        sid: row.familyId,
        ev: user.emailVerifiedAt != null,
      }),
    },
  });

  if (row.revokedAt) {
    // Revoked by logout, password change or an earlier family kill: simply invalid.
    if (!row.replacedById) return { ok: false, reason: "invalid" };
    const withinGrace = Date.now() - row.revokedAt.getTime() < ROTATION_GRACE_MS;
    if (withinGrace) return accessOnly();
    // A rotated token was presented again: assume theft and kill the whole login.
    await revokeFamily(row.familyId);
    await audit({
      action: "auth.refresh_reuse_detected",
      actorId: user.id,
      metadata: { familyId: row.familyId },
      ip: meta.ip,
    });
    return { ok: false, reason: "reused" };
  }

  // Claim the old token atomically; if another request beat us to it, fall back to grace behaviour.
  const claimed = await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.id, row.id), isNull(refreshTokens.revokedAt)))
    .returning({ id: refreshTokens.id });
  if (claimed.length === 0) return accessOnly();

  const next = await issueTokens(user, meta, row.familyId);
  await db.update(refreshTokens).set({ replacedById: next.tokenId }).where(eq(refreshTokens.id, row.id));
  return { ok: true, userId: user.id, tokens: { accessToken: next.accessToken, refreshToken: next.refreshToken } };
}

export async function revokeFamily(familyId: string) {
  await getDb()
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
}

export async function revokeAllForUser(userId: string) {
  await getDb()
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
}

export async function logout(rawRefreshToken: string | undefined, meta: RequestMeta): Promise<void> {
  if (!rawRefreshToken) return;
  const [row] = await getDb()
    .select({ familyId: refreshTokens.familyId, userId: refreshTokens.userId })
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, sha256(rawRefreshToken)))
    .limit(1);
  if (!row) return;
  await revokeFamily(row.familyId);
  await audit({ action: "auth.logout", actorId: row.userId, ip: meta.ip });
}

