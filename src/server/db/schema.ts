import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  inet,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

// ---------- Enums ----------

export const userRole = pgEnum("user_role", ["host", "admin"]);
export const userPlan = pgEnum("user_plan", ["free", "pro"]);
export const emailTokenType = pgEnum("email_token_type", ["verify_email", "reset_password"]);
export const streamPrivacy = pgEnum("stream_privacy", ["public", "unlisted", "private"]);
export const streamStatus = pgEnum("stream_status", ["idle", "live", "ended"]);
export const recordingStatus = pgEnum("recording_status", [
  "none",
  "recording",
  "processing",
  "ready",
  "failed",
]);
export const deviceType = pgEnum("device_type", ["desktop", "mobile", "tablet", "other"]);
export const reportReason = pgEnum("report_reason", [
  "spam",
  "harassment",
  "hate",
  "violence",
  "sexual",
  "copyright",
  "other",
]);
export const reportStatus = pgEnum("report_status", ["open", "dismissed", "actioned"]);

// ---------- Users & auth ----------

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: varchar("email", { length: 320 }).notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    role: userRole("role").notNull().default("host"),
    plan: userPlan("plan").notNull().default("free"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    disabledReason: text("disabled_reason"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("users_email_lower_idx").on(sql`lower(${t.email})`)],
);

/**
 * Refresh tokens. Only a SHA-256 hash of the token is stored.
 * Tokens rotate on every use; all tokens from one login share a `familyId`
 * so that reuse of a rotated token can revoke the whole family.
 */
export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    familyId: uuid("family_id").notNull(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    replacedById: uuid("replaced_by_id"),
    userAgent: varchar("user_agent", { length: 512 }),
    ip: inet("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("refresh_tokens_hash_idx").on(t.tokenHash),
    index("refresh_tokens_user_idx").on(t.userId),
    index("refresh_tokens_family_idx").on(t.familyId),
  ],
);

/** Single-use tokens for email verification and password reset (hash only). */
export const emailTokens = pgTable(
  "email_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: emailTokenType("type").notNull(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("email_tokens_hash_idx").on(t.tokenHash),
    index("email_tokens_user_type_idx").on(t.userId, t.type),
  ],
);

// ---------- Streams ----------

export const streams = pgTable(
  "streams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Short public id used in /watch/{slug}. */
    slug: varchar("slug", { length: 16 }).notNull(),
    hostId: uuid("host_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 120 }).notNull(),
    description: text("description"),
    privacy: streamPrivacy("privacy").notNull().default("unlisted"),
    /** Argon2 hash of the viewer passcode (private streams only). */
    passcodeHash: text("passcode_hash"),
    thumbnailUrl: text("thumbnail_url"),
    status: streamStatus("status").notNull().default("idle"),
    chatEnabled: boolean("chat_enabled").notNull().default(true),
    recordingEnabled: boolean("recording_enabled").notNull().default(true),
    /** LiveKit ingress (RTMP/WHIP) for OBS and hardware encoders. */
    ingressId: varchar("ingress_id", { length: 64 }),
    ingressUrl: text("ingress_url"),
    ingressStreamKey: text("ingress_stream_key"),
    ingressType: varchar("ingress_type", { length: 8 }),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    disabledReason: text("disabled_reason"),
    lastLiveAt: timestamp("last_live_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("streams_slug_idx").on(t.slug),
    index("streams_host_idx").on(t.hostId, t.createdAt),
    index("streams_status_idx").on(t.status),
  ],
);

/** One row per broadcast of a stream (a stream can go live many times). */
export const streamSessions = pgTable(
  "stream_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    streamId: uuid("stream_id")
      .notNull()
      .references(() => streams.id, { onDelete: "cascade" }),
    livekitRoom: varchar("livekit_room", { length: 128 }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    peakViewers: integer("peak_viewers").notNull().default(0),
    totalJoins: integer("total_joins").notNull().default(0),
    /** Sum of viewer-seconds, for average watch time and plan usage. */
    viewerSeconds: integer("viewer_seconds").notNull().default(0),
    egressId: varchar("egress_id", { length: 64 }),
    recordingStatus: recordingStatus("recording_status").notNull().default("none"),
    recordingUrl: text("recording_url"),
    recordingDurationSec: integer("recording_duration_sec"),
    recordingSizeBytes: integer("recording_size_bytes"),
  },
  (t) => [
    index("stream_sessions_stream_idx").on(t.streamId, t.startedAt),
    uniqueIndex("stream_sessions_room_idx").on(t.livekitRoom),
  ],
);

/** Anonymous per-viewer join records. No personal data: viewerKey is random per browser. */
export const viewerStats = pgTable(
  "viewer_stats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => streamSessions.id, { onDelete: "cascade" }),
    viewerKey: varchar("viewer_key", { length: 64 }).notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    leftAt: timestamp("left_at", { withTimezone: true }),
    deviceType: deviceType("device_type").notNull().default("other"),
    country: varchar("country", { length: 2 }),
  },
  (t) => [index("viewer_stats_session_idx").on(t.sessionId, t.joinedAt)],
);

// ---------- Moderation & audit ----------

export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    streamId: uuid("stream_id")
      .notNull()
      .references(() => streams.id, { onDelete: "cascade" }),
    reason: reportReason("reason").notNull(),
    details: text("details"),
    /** Salted hash of reporter IP, for abuse throttling only. */
    reporterHash: varchar("reporter_hash", { length: 64 }),
    status: reportStatus("status").notNull().default("open"),
    resolvedById: uuid("resolved_by_id").references(() => users.id, { onDelete: "set null" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolutionNote: text("resolution_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("reports_status_idx").on(t.status, t.createdAt)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: varchar("action", { length: 64 }).notNull(),
    targetType: varchar("target_type", { length: 32 }),
    targetId: varchar("target_id", { length: 64 }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    ip: inet("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_logs_actor_idx").on(t.actorId, t.createdAt),
    index("audit_logs_action_idx").on(t.action, t.createdAt),
  ],
);

// ---------- Relations ----------

export const usersRelations = relations(users, ({ many }) => ({
  streams: many(streams),
  refreshTokens: many(refreshTokens),
}));

export const streamsRelations = relations(streams, ({ one, many }) => ({
  host: one(users, { fields: [streams.hostId], references: [users.id] }),
  sessions: many(streamSessions),
  reports: many(reports),
}));

export const streamSessionsRelations = relations(streamSessions, ({ one, many }) => ({
  stream: one(streams, { fields: [streamSessions.streamId], references: [streams.id] }),
  viewers: many(viewerStats),
}));

export const viewerStatsRelations = relations(viewerStats, ({ one }) => ({
  session: one(streamSessions, { fields: [viewerStats.sessionId], references: [streamSessions.id] }),
}));

export const reportsRelations = relations(reports, ({ one }) => ({
  stream: one(streams, { fields: [reports.streamId], references: [streams.id] }),
}));

export type User = typeof users.$inferSelect;
export type Stream = typeof streams.$inferSelect;
export type StreamSession = typeof streamSessions.$inferSelect;
