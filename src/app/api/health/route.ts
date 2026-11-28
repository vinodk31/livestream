import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/server/db";

export const dynamic = "force-dynamic";

/** Underlying driver error (e.g. ECONNREFUSED, auth failed), without connection strings. */
function describe(err: unknown): string {
  const root = err instanceof Error && err.cause instanceof Error ? err.cause : err;
  const msg = root instanceof Error ? root.message : String(root);
  return msg.replace(/postgres(ql)?:\/\/\S+/g, "[url]").split("\n")[0]!.slice(0, 120);
}

/**
 * Configuration self-check. Reports only yes/no per setting, never values, so it is safe to
 * leave public. Use it after changing environment variables in Vercel.
 */
export async function GET() {
  const secret = process.env.AUTH_SECRET ?? "";
  const checks = {
    authSecret: secret.length >= 32 ? "ok" : secret ? "too_short (needs 32+ characters)" : "missing",
    database: await getDb()
      .execute(sql`select 1`)
      .then(() => "ok")
      .catch((err: unknown) => `error: ${describe(err)}`),
    databaseMigrated: await getDb()
      .execute(sql`select count(*) from users`)
      .then(() => "ok")
      .catch(() => "no (tables missing)"),
    email: process.env.RESEND_API_KEY ? "ok" : "missing RESEND_API_KEY",
    emailFrom: process.env.EMAIL_FROM ? "ok" : "missing (using default onboarding@resend.dev)",
    appUrl: process.env.APP_URL ? "ok" : "missing APP_URL",
    rateLimitStore:
      (process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL) ? "ok" : "missing (per-instance memory only)",
    fileStorage: process.env.BLOB_READ_WRITE_TOKEN ? "ok" : "missing BLOB_READ_WRITE_TOKEN",
    livekit:
      process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET
        ? "ok"
        : "missing LIVEKIT_* (needed from module 5)",
    recording:
      process.env.RECORDING_S3_BUCKET && process.env.RECORDING_S3_ACCESS_KEY_ID && process.env.RECORDING_S3_SECRET_ACCESS_KEY
        ? "ok"
        : "missing RECORDING_S3_* (replays disabled)",
    cron: process.env.CRON_SECRET ? "ok" : "missing CRON_SECRET (daily cleanup won't run)",
    testLoginLink: process.env.TEST_LOGIN_KEY
      ? (process.env.TEST_LOGIN_KEY.length >= 24 && process.env.TEST_LOGIN_EMAIL ? "enabled" : "misconfigured (key 24+ chars and TEST_LOGIN_EMAIL required)")
      : "off",
  };
  const required = [checks.authSecret, checks.database, checks.databaseMigrated];
  const healthy = required.every((c) => c === "ok");
  return NextResponse.json(
    { status: healthy ? "ok" : "misconfigured", checks },
    { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
