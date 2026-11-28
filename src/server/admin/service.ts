import "server-only";
import { createHmac } from "node:crypto";
import { and, count, desc, eq, gte, ilike, isNotNull, isNull, or, sql, sum, type SQL } from "drizzle-orm";
import { getDb } from "../db";
import { auditLogs, refreshTokens, reports, streamSessions, streams, users } from "../db/schema";
import { audit } from "../audit";
import type { RequestMeta } from "../request";
import { endBroadcast, getViewerStream } from "../streams/broadcast";

export const ADMIN_PAGE_SIZE = 25;
const DAY = 86_400_000;

export class AdminError extends Error {
  constructor(public code: "not_found" | "self" | "is_admin" | "rate_limited") {
    super(code);
  }
}

function like(q: string) {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

function paging(page: number | undefined) {
  const p = Math.max(1, Math.floor(page ?? 1));
  return { page: p, offset: (p - 1) * ADMIN_PAGE_SIZE };
}

// ---------- Overview ----------

export async function getPlatformStats(now = new Date()) {
  const db = getDb();
  const since7 = new Date(now.getTime() - 7 * DAY);
  const since30 = new Date(now.getTime() - 30 * DAY);
  const [[u], [s], [b], [r]] = await Promise.all([
    db
      .select({
        total: count(),
        new7d: sql<number>`count(*) filter (where ${users.createdAt} >= ${since7.toISOString()}::timestamptz)`.mapWith(Number),
        verified: sql<number>`count(*) filter (where ${users.emailVerifiedAt} is not null)`.mapWith(Number),
        disabled: sql<number>`count(*) filter (where ${users.disabledAt} is not null)`.mapWith(Number),
      })
      .from(users),
    db
      .select({
        total: count(),
        live: sql<number>`count(*) filter (where ${streams.status} = 'live')`.mapWith(Number),
        disabled: sql<number>`count(*) filter (where ${streams.disabledAt} is not null)`.mapWith(Number),
      })
      .from(streams),
    db
      .select({
        broadcasts: count(),
        views: sum(streamSessions.totalJoins).mapWith(Number),
        watchSeconds: sum(streamSessions.viewerSeconds).mapWith(Number),
        peak: sql<number>`coalesce(max(${streamSessions.peakViewers}), 0)`.mapWith(Number),
      })
      .from(streamSessions)
      .where(gte(streamSessions.startedAt, since30)),
    db.select({ open: count() }).from(reports).where(eq(reports.status, "open")),
  ]);
  return {
    users: { total: u?.total ?? 0, new7d: u?.new7d ?? 0, verified: u?.verified ?? 0, disabled: u?.disabled ?? 0 },
    streams: { total: s?.total ?? 0, live: s?.live ?? 0, disabled: s?.disabled ?? 0 },
    last30d: {
      broadcasts: b?.broadcasts ?? 0,
      views: b?.views ?? 0,
      watchSeconds: b?.watchSeconds ?? 0,
      peakViewers: b?.peak ?? 0,
    },
    openReports: r?.open ?? 0,
  };
}

// ---------- Users ----------

export async function listUsers(opts: { query?: string; filter?: "all" | "disabled" | "unverified" | "admins"; page?: number }) {
  const db = getDb();
  const { page, offset } = paging(opts.page);
  const where: SQL[] = [];
  const q = opts.query?.trim();
  if (q) where.push(or(ilike(users.email, like(q)), ilike(users.name, like(q)))!);
  if (opts.filter === "disabled") where.push(isNotNull(users.disabledAt));
  if (opts.filter === "unverified") where.push(isNull(users.emailVerifiedAt));
  if (opts.filter === "admins") where.push(eq(users.role, "admin"));
  const cond = where.length ? and(...where) : undefined;

  const streamCounts = db
    .select({ hostId: streams.hostId, n: count().as("n") })
    .from(streams)
    .groupBy(streams.hostId)
    .as("sc");
  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        plan: users.plan,
        emailVerifiedAt: users.emailVerifiedAt,
        disabledAt: users.disabledAt,
        disabledReason: users.disabledReason,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
        streams: sql<number>`coalesce(${streamCounts.n}, 0)`.mapWith(Number),
      })
      .from(users)
      .leftJoin(streamCounts, eq(streamCounts.hostId, users.id))
      .where(cond)
      .orderBy(desc(users.createdAt))
      .limit(ADMIN_PAGE_SIZE)
      .offset(offset),
    db.select({ n: count() }).from(users).where(cond),
  ]);
  return { rows, total: total?.n ?? 0, page, pageCount: Math.max(1, Math.ceil((total?.n ?? 0) / ADMIN_PAGE_SIZE)) };
}

async function targetUser(adminId: string, userId: string) {
  if (adminId === userId) throw new AdminError("self");
  const [u] = await getDb().select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u) throw new AdminError("not_found");
  return u;
}

/** Disabling signs the user out everywhere and ends their live broadcasts. */
export async function setUserDisabled(adminId: string, userId: string, disabled: boolean, reason: string | null, meta: RequestMeta) {
  const u = await targetUser(adminId, userId);
  if (u.role === "admin" && disabled) throw new AdminError("is_admin");
  const db = getDb();
  await db
    .update(users)
    .set(disabled ? { disabledAt: new Date(), disabledReason: reason } : { disabledAt: null, disabledReason: null })
    .where(eq(users.id, userId));
  if (disabled) {
    await db.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
    const live = await db.select({ id: streams.id }).from(streams).where(and(eq(streams.hostId, userId), eq(streams.status, "live")));
    for (const s of live) await endBroadcast(s.id, adminId, "admin", meta);
  }
  await audit({
    action: disabled ? "admin.user_disabled" : "admin.user_enabled",
    actorId: adminId,
    targetType: "user",
    targetId: userId,
    metadata: reason ? { reason } : undefined,
    ip: meta.ip,
  });
}

export async function markUserVerified(adminId: string, userId: string, meta: RequestMeta) {
  const [u] = await getDb().select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  if (!u) throw new AdminError("not_found");
  await getDb().update(users).set({ emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, now())` }).where(eq(users.id, userId));
  await audit({ action: "admin.user_verified", actorId: adminId, targetType: "user", targetId: userId, ip: meta.ip });
}

/** Permanently deletes a non-admin user and everything they own. */
export async function deleteUserAsAdmin(adminId: string, userId: string, meta: RequestMeta) {
  const u = await targetUser(adminId, userId);
  if (u.role === "admin") throw new AdminError("is_admin");
  const live = await getDb().select({ id: streams.id }).from(streams).where(and(eq(streams.hostId, userId), eq(streams.status, "live")));
  for (const s of live) await endBroadcast(s.id, adminId, "admin", meta);
  await audit({
    action: "admin.user_deleted",
    actorId: adminId,
    targetType: "user",
    targetId: userId,
    metadata: { email: u.email },
    ip: meta.ip,
  });
  await getDb().delete(users).where(eq(users.id, userId));
}

// ---------- Streams ----------

export async function listAllStreams(opts: { query?: string; filter?: "all" | "live" | "disabled" | "reported"; page?: number }) {
  const db = getDb();
  const { page, offset } = paging(opts.page);
  const openReports = db
    .select({ streamId: reports.streamId, n: count().as("n") })
    .from(reports)
    .where(eq(reports.status, "open"))
    .groupBy(reports.streamId)
    .as("orp");
  const where: SQL[] = [];
  const q = opts.query?.trim();
  if (q) where.push(or(ilike(streams.title, like(q)), ilike(users.email, like(q)), eq(streams.slug, q.toLowerCase()))!);
  if (opts.filter === "live") where.push(eq(streams.status, "live"));
  if (opts.filter === "disabled") where.push(isNotNull(streams.disabledAt));
  if (opts.filter === "reported") where.push(sql`${openReports.n} > 0`);
  const cond = where.length ? and(...where) : undefined;

  const base = () =>
    db
      .select({
        id: streams.id,
        slug: streams.slug,
        title: streams.title,
        privacy: streams.privacy,
        status: streams.status,
        disabledAt: streams.disabledAt,
        disabledReason: streams.disabledReason,
        createdAt: streams.createdAt,
        lastLiveAt: streams.lastLiveAt,
        hostId: users.id,
        hostName: users.name,
        hostEmail: users.email,
        openReports: sql<number>`coalesce(${openReports.n}, 0)`.mapWith(Number),
      })
      .from(streams)
      .innerJoin(users, eq(users.id, streams.hostId))
      .leftJoin(openReports, eq(openReports.streamId, streams.id));
  const [rows, [total]] = await Promise.all([
    base()
      .where(cond)
      .orderBy(sql`case when ${streams.status} = 'live' then 0 else 1 end`, desc(streams.createdAt))
      .limit(ADMIN_PAGE_SIZE)
      .offset(offset),
    db
      .select({ n: count() })
      .from(streams)
      .innerJoin(users, eq(users.id, streams.hostId))
      .leftJoin(openReports, eq(openReports.streamId, streams.id))
      .where(cond),
  ]);
  return { rows, total: total?.n ?? 0, page, pageCount: Math.max(1, Math.ceil((total?.n ?? 0) / ADMIN_PAGE_SIZE)) };
}

/** Disabling ends any live broadcast and hides the viewer page. */
export async function setStreamDisabled(adminId: string, streamId: string, disabled: boolean, reason: string | null, meta: RequestMeta) {
  const [s] = await getDb().select().from(streams).where(eq(streams.id, streamId)).limit(1);
  if (!s) throw new AdminError("not_found");
  await getDb()
    .update(streams)
    .set(disabled ? { disabledAt: new Date(), disabledReason: reason } : { disabledAt: null, disabledReason: null })
    .where(eq(streams.id, streamId));
  if (disabled && s.status === "live") await endBroadcast(streamId, adminId, "admin", meta);
  await audit({
    action: disabled ? "admin.stream_disabled" : "admin.stream_enabled",
    actorId: adminId,
    targetType: "stream",
    targetId: streamId,
    metadata: reason ? { reason, title: s.title } : { title: s.title },
    ip: meta.ip,
  });
}

// ---------- Reports ----------

export const REPORT_REASONS = ["spam", "harassment", "hate", "violence", "sexual", "copyright", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

function reporterHash(ip: string | null): string | null {
  if (!ip) return null;
  const secret = process.env.AUTH_SECRET ?? "";
  return createHmac("sha256", secret).update(`report:${ip}`).digest("hex");
}

/** Anonymous report from the viewer page. One open report per reporter per stream. */
export async function createReport(slug: string, reason: ReportReason, details: string | null, meta: RequestMeta) {
  const stream = await getViewerStream(slug);
  if (!stream) throw new AdminError("not_found");
  const hash = reporterHash(meta.ip);
  if (hash) {
    const [dupe] = await getDb()
      .select({ id: reports.id })
      .from(reports)
      .where(and(eq(reports.streamId, stream.id), eq(reports.reporterHash, hash), eq(reports.status, "open")))
      .limit(1);
    if (dupe) return { duplicate: true };
  }
  const [row] = await getDb()
    .insert(reports)
    .values({ streamId: stream.id, reason, details: details?.trim().slice(0, 1000) || null, reporterHash: hash })
    .returning({ id: reports.id });
  await audit({ action: "report.created", targetType: "stream", targetId: stream.id, metadata: { reason, reportId: row!.id } });
  return { duplicate: false };
}

export async function listReports(opts: { status?: "open" | "dismissed" | "actioned"; page?: number }) {
  const db = getDb();
  const { page, offset } = paging(opts.page);
  const cond = eq(reports.status, opts.status ?? "open");
  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: reports.id,
        reason: reports.reason,
        details: reports.details,
        status: reports.status,
        createdAt: reports.createdAt,
        resolvedAt: reports.resolvedAt,
        resolutionNote: reports.resolutionNote,
        streamId: streams.id,
        streamTitle: streams.title,
        streamSlug: streams.slug,
        streamStatus: streams.status,
        streamDisabled: sql<boolean>`${streams.disabledAt} is not null`,
        hostEmail: users.email,
      })
      .from(reports)
      .innerJoin(streams, eq(streams.id, reports.streamId))
      .innerJoin(users, eq(users.id, streams.hostId))
      .where(cond)
      .orderBy(desc(reports.createdAt))
      .limit(ADMIN_PAGE_SIZE)
      .offset(offset),
    db.select({ n: count() }).from(reports).where(cond),
  ]);
  return { rows, total: total?.n ?? 0, page, pageCount: Math.max(1, Math.ceil((total?.n ?? 0) / ADMIN_PAGE_SIZE)) };
}

/** Dismiss a report, or act on it by disabling the stream (resolves all its open reports). */
export async function resolveReport(
  adminId: string,
  reportId: string,
  action: "dismiss" | "disable_stream",
  note: string | null,
  meta: RequestMeta,
) {
  const db = getDb();
  const [r] = await db.select().from(reports).where(eq(reports.id, reportId)).limit(1);
  if (!r) throw new AdminError("not_found");
  const resolved = { resolvedById: adminId, resolvedAt: new Date(), resolutionNote: note?.trim().slice(0, 500) || null };
  if (action === "dismiss") {
    await db.update(reports).set({ status: "dismissed", ...resolved }).where(eq(reports.id, reportId));
    await audit({ action: "admin.report_dismissed", actorId: adminId, targetType: "report", targetId: reportId, ip: meta.ip });
    return;
  }
  await setStreamDisabled(adminId, r.streamId, true, note?.trim() || `Reported: ${r.reason}`, meta);
  await db
    .update(reports)
    .set({ status: "actioned", ...resolved })
    .where(and(eq(reports.streamId, r.streamId), eq(reports.status, "open")));
  await audit({ action: "admin.report_actioned", actorId: adminId, targetType: "report", targetId: reportId, ip: meta.ip });
}

// ---------- Audit log ----------

export async function listAuditLog(opts: { action?: string; page?: number }) {
  const db = getDb();
  const { page } = paging(opts.page);
  const size = ADMIN_PAGE_SIZE * 2;
  const cond = opts.action ? ilike(auditLogs.action, `${opts.action.replace(/[\\%_]/g, "")}%`) : undefined;
  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        targetType: auditLogs.targetType,
        targetId: auditLogs.targetId,
        metadata: auditLogs.metadata,
        ip: auditLogs.ip,
        createdAt: auditLogs.createdAt,
        actorEmail: users.email,
      })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorId))
      .where(cond)
      .orderBy(desc(auditLogs.createdAt))
      .limit(size)
      .offset((page - 1) * size),
    db.select({ n: count() }).from(auditLogs).where(cond),
  ]);
  return { rows, total: total?.n ?? 0, page, pageCount: Math.max(1, Math.ceil((total?.n ?? 0) / size)) };
}
