import "server-only";
import { getDb } from "./db";
import { auditLogs } from "./db/schema";

export type AuditAction =
  | "auth.register"
  | "auth.login"
  | "auth.login_failed"
  | "auth.logout"
  | "auth.refresh_reuse_detected"
  | "auth.email_verified"
  | "auth.password_reset_requested"
  | "auth.password_reset"
  | "auth.password_changed"
  | "auth.test_login"
  | "account.profile_updated"
  | "account.sessions_revoked"
  | "account.deleted"
  | "stream.created"
  | "stream.updated"
  | "stream.deleted"
  | "stream.link_reset"
  | "stream.thumbnail_set"
  | "stream.thumbnail_removed"
  | "stream.live"
  | "stream.ended"
  | "recording.deleted"
  | "admin.user_disabled"
  | "admin.user_enabled"
  | "admin.user_verified"
  | "admin.user_deleted"
  | "admin.stream_disabled"
  | "admin.stream_enabled"
  | "admin.report_dismissed"
  | "admin.report_actioned"
  | "report.created";

export async function audit(entry: {
  action: AuditAction;
  actorId?: string | null;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}): Promise<void> {
  try {
    await getDb().insert(auditLogs).values({
      action: entry.action,
      actorId: entry.actorId ?? null,
      targetType: entry.targetType,
      targetId: entry.targetId,
      metadata: entry.metadata,
      ip: entry.ip ?? null,
    });
  } catch (err) {
    // Never let audit failures break the user flow.
    console.error("[audit] failed to write", entry.action, err);
  }
}
