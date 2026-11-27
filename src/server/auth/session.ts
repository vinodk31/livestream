import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { users } from "../db/schema";
import { ACCESS_COOKIE } from "./cookies";
import { verifyAccessToken, type AccessClaims } from "./jwt";

/** The subset of the user that is safe to pass to the UI. */
export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  role: "host" | "admin";
  plan: "free" | "pro";
  emailVerified: boolean;
};

/** Reads and verifies the access token (refreshing is handled by the proxy). */
export const getSession = cache(async (): Promise<AccessClaims | null> => {
  const jar = await cookies();
  return verifyAccessToken(jar.get(ACCESS_COOKIE)?.value);
});

/**
 * Data Access Layer entry point: loads the user from the database on every request,
 * so disabled accounts and role changes take effect immediately.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await getSession();
  if (!session) return null;
  const [user] = await getDb().select().from(users).where(eq(users.id, session.sub)).limit(1);
  if (!user || user.disabledAt) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    plan: user.plan,
    emailVerified: user.emailVerifiedAt != null,
  };
});

export async function requireUser(returnTo?: string): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect(returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : "/login");
  return user;
}

export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser("/admin");
  // 404 rather than 403 so the admin area is not advertised.
  if (user.role !== "admin") notFound();
  return user;
}
