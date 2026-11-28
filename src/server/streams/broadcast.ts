import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import { PLANS } from "@/lib/plans";
import { getDb } from "../db";
import { streamSessions, streams, users, viewerStats, type Stream, type StreamSession } from "../db/schema";
import { audit } from "../audit";
import { verifyPassword } from "../auth/password";
import {
  HOST_IDENTITY,
  HOST_OBS_IDENTITY,
  VIEWER_PREFIX,
  getLiveKit,
  isViewerIdentity,
  roomForStream,
} from "../livekit";
import type { RequestMeta } from "../request";
import { getDashboardStats } from "./queries";
import { startSessionRecording, stopSessionRecording } from "./recording-service";
import { getStreamForHost } from "./service";

/** The studio pings every 15s; after this long without one we assume the host is gone. */
export const HEARTBEAT_STALE_MS = 60_000;
const HOST_TOKEN_TTL = 6 * 60 * 60;
const VIEWER_TOKEN_TTL = 4 * 60 * 60;

export class BroadcastError extends Error {
  constructor(
    public code:
      | "not_found"
      | "email_unverified"
      | "disabled"
      | "quota_exceeded"
      | "not_live"
      | "full"
      | "locked"
      | "bad_passcode"
      | "obs_unavailable",
  ) {
    super(code);
  }
}

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET must be set to at least 32 characters.");
  return s;
}

function hmac(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

async function activeSession(streamId: string): Promise<StreamSession | undefined> {
  const [row] = await getDb()
    .select()
    .from(streamSessions)
    .where(and(eq(streamSessions.streamId, streamId), isNull(streamSessions.endedAt)))
    .orderBy(desc(streamSessions.startedAt))
    .limit(1);
  return row;
}

function isStale(session: StreamSession, now = Date.now()): boolean {
  return now - session.lastHeartbeatAt.getTime() > HEARTBEAT_STALE_MS;
}

async function hostOf(stream: Stream) {
  const [host] = await getDb().select().from(users).where(eq(users.id, stream.hostId)).limit(1);
  if (!host) throw new BroadcastError("not_found");
  return host;
}

// ---------- Host side ----------

export type HostConnection = {
  sessionId: string;
  wsUrl: string;
  token: string;
  startedAt: Date;
  resumed: boolean;
};

/**
 * Starts (or resumes, after a page reload) a broadcast. Marks the stream live and returns a
 * LiveKit token for the host. Enforces verification, moderation and monthly streaming time.
 */
export async function startBroadcast(
  streamId: string,
  hostId: string,
  source: "browser" | "obs",
  meta: RequestMeta,
): Promise<HostConnection> {
  const stream = await getStreamForHost(streamId, hostId).catch(() => {
    throw new BroadcastError("not_found");
  });
  const host = await hostOf(stream);
  if (!host.emailVerifiedAt) throw new BroadcastError("email_unverified");
  if (stream.disabledAt || host.disabledAt) throw new BroadcastError("disabled");

  const plan = PLANS[host.plan];
  const room = roomForStream(stream.id);
  const lk = getLiveKit();
  const db = getDb();

  let session = await activeSession(stream.id);
  let resumed = false;
  if (session && isStale(session)) {
    await endBroadcast(stream.id, null, "host_left", meta);
    session = undefined;
  }
  if (session) {
    resumed = true;
    await db.update(streamSessions).set({ lastHeartbeatAt: new Date(), source }).where(eq(streamSessions.id, session.id));
  } else {
    const used = (await getDashboardStats(hostId)).streamedSecondsThisMonth;
    if (used >= plan.monthlyStreamHours * 3600) throw new BroadcastError("quota_exceeded");
    // Room capacity is enforced by LiveKit too: viewers + host + OBS + a little slack.
    await lk.ensureRoom(room, { maxParticipants: plan.maxConcurrentViewers + 3 });
    [session] = await db.insert(streamSessions).values({ streamId: stream.id, livekitRoom: room, source }).returning();
    await db.update(streams).set({ status: "live", lastLiveAt: new Date() }).where(eq(streams.id, stream.id));
    if (stream.recordingEnabled) await startSessionRecording(stream.id, session!.id, room);
    await audit({ action: "stream.live", actorId: hostId, targetType: "stream", targetId: stream.id, metadata: { source }, ip: meta.ip });
  }

  const token = await lk.createToken({
    room,
    identity: HOST_IDENTITY,
    name: host.name,
    grant: { canPublish: true, canSubscribe: true, canPublishData: true, roomAdmin: true },
    ttlSeconds: HOST_TOKEN_TTL,
  });
  return { sessionId: session!.id, wsUrl: lk.wsUrl, token, startedAt: session!.startedAt, resumed };
}

export type HeartbeatResult =
  | { live: true; viewers: number; peakViewers: number; startedAt: Date; secondsLeftThisMonth: number }
  | { live: false; reason: "ended" | "quota_exceeded" };

/** Keeps the session alive, refreshes the viewer count and enforces the monthly limit mid-stream. */
export async function heartbeat(streamId: string, hostId: string, meta: RequestMeta): Promise<HeartbeatResult> {
  const stream = await getStreamForHost(streamId, hostId).catch(() => {
    throw new BroadcastError("not_found");
  });
  const session = await activeSession(stream.id);
  if (!session) return { live: false, reason: "ended" };

  const host = await hostOf(stream);
  const limit = PLANS[host.plan].monthlyStreamHours * 3600;
  const used = (await getDashboardStats(hostId)).streamedSecondsThisMonth;
  if (used >= limit) {
    await endBroadcast(stream.id, hostId, "quota_exceeded", meta);
    return { live: false, reason: "quota_exceeded" };
  }

  let viewers = 0;
  try {
    viewers = (await getLiveKit().listIdentities(session.livekitRoom)).filter(isViewerIdentity).length;
  } catch (err) {
    console.error("[heartbeat] listParticipants failed", err);
  }
  const [row] = await getDb()
    .update(streamSessions)
    .set({ lastHeartbeatAt: new Date(), peakViewers: sql`greatest(${streamSessions.peakViewers}, ${viewers})` })
    .where(eq(streamSessions.id, session.id))
    .returning({ peak: streamSessions.peakViewers });
  return {
    live: true,
    viewers,
    peakViewers: row?.peak ?? viewers,
    startedAt: session.startedAt,
    secondsLeftThisMonth: Math.max(0, limit - used),
  };
}

/** Ends the active session (if any): stream goes "ended", viewers are disconnected, stats are rolled up. */
export async function endBroadcast(
  streamId: string,
  actorId: string | null,
  reason: "host_ended" | "host_left" | "quota_exceeded" | "admin" | "deleted",
  meta: RequestMeta,
): Promise<void> {
  const db = getDb();
  const session = await activeSession(streamId);
  const now = new Date();
  if (session) {
    // Viewers who never pinged count as having left when they joined.
    await db
      .update(viewerStats)
      .set({ leftAt: sql`coalesce(${viewerStats.leftAt}, ${viewerStats.joinedAt})` })
      .where(eq(viewerStats.sessionId, session.id));
    const [{ seconds } = { seconds: 0 }] = await db
      .select({
        seconds: sql<number>`coalesce(sum(extract(epoch from (${viewerStats.leftAt} - ${viewerStats.joinedAt}))), 0)`.mapWith(Number),
      })
      .from(viewerStats)
      .where(eq(viewerStats.sessionId, session.id));
    // A host who vanished stopped streaming around their last heartbeat, not now.
    const endedAt = reason === "host_left" ? session.lastHeartbeatAt : now;
    await db
      .update(streamSessions)
      .set({ endedAt, viewerSeconds: Math.round(seconds) })
      .where(and(eq(streamSessions.id, session.id), isNull(streamSessions.endedAt)));
    await stopSessionRecording(session);
    try {
      await getLiveKit().deleteRoom(session.livekitRoom);
    } catch (err) {
      console.error("[endBroadcast] deleteRoom failed", err);
    }
  }
  await db.update(streams).set({ status: "ended" }).where(and(eq(streams.id, streamId), eq(streams.status, "live")));
  if (session) {
    await audit({
      action: "stream.ended",
      actorId,
      targetType: "stream",
      targetId: streamId,
      metadata: { reason, sessionId: session.id },
      ip: meta.ip,
    });
  }
}

/** Ends a broadcast whose host stopped sending heartbeats. Safe to call on any read path. */
export async function sweepIfStale(streamId: string, meta: RequestMeta): Promise<boolean> {
  const session = await activeSession(streamId);
  if (session && isStale(session)) {
    await endBroadcast(streamId, null, "host_left", meta);
    return true;
  }
  if (!session) {
    // Repair: "live" with no open session (e.g. a crash between writes).
    await getDb().update(streams).set({ status: "ended" }).where(and(eq(streams.id, streamId), eq(streams.status, "live")));
  }
  return false;
}

/** Ends every broadcast that has gone quiet (used by the dashboard and a periodic sweep). */
export async function sweepAllStale(meta: RequestMeta): Promise<number> {
  const stale = await getDb()
    .select({ streamId: streamSessions.streamId })
    .from(streamSessions)
    .where(
      and(isNull(streamSessions.endedAt), lt(streamSessions.lastHeartbeatAt, new Date(Date.now() - HEARTBEAT_STALE_MS))),
    );
  for (const { streamId } of stale) await endBroadcast(streamId, null, "host_left", meta);
  return stale.length;
}

/** Ends this host's broadcasts that have gone quiet, so dashboards never show a phantom "live". */
export async function sweepHostStale(hostId: string, meta: RequestMeta): Promise<void> {
  const stale = await getDb()
    .select({ streamId: streamSessions.streamId })
    .from(streamSessions)
    .innerJoin(streams, eq(streams.id, streamSessions.streamId))
    .where(
      and(
        eq(streams.hostId, hostId),
        isNull(streamSessions.endedAt),
        lt(streamSessions.lastHeartbeatAt, new Date(Date.now() - HEARTBEAT_STALE_MS)),
      ),
    );
  for (const { streamId } of stale) await endBroadcast(streamId, null, "host_left", meta);
}

// ---------- OBS / RTMP ----------

export type ObsSettings = { url: string; streamKey: string };

/** Creates (once) an RTMP ingress for the stream's room. Returns the server URL and stream key. */
export async function getOrCreateObsSettings(streamId: string, hostId: string, regenerate = false): Promise<ObsSettings> {
  const stream = await getStreamForHost(streamId, hostId).catch(() => {
    throw new BroadcastError("not_found");
  });
  const lk = getLiveKit();
  if (stream.ingressId && stream.ingressUrl && stream.ingressStreamKey && !regenerate) {
    return { url: stream.ingressUrl, streamKey: stream.ingressStreamKey };
  }
  if (stream.ingressId) await lk.deleteIngress(stream.ingressId).catch(() => {});
  let created;
  try {
    created = await lk.createRtmpIngress({ room: roomForStream(stream.id), identity: HOST_OBS_IDENTITY, name: "OBS" });
  } catch (err) {
    console.error("[obs] createIngress failed", err);
    throw new BroadcastError("obs_unavailable");
  }
  await getDb()
    .update(streams)
    .set({ ingressId: created.ingressId, ingressUrl: created.url, ingressStreamKey: created.streamKey, ingressType: "rtmp" })
    .where(eq(streams.id, stream.id));
  return { url: created.url, streamKey: created.streamKey };
}

// ---------- Viewer side ----------

/** Cookie that proves this browser entered the right passcode. Rotates when the passcode changes. */
export function accessCookieName(streamId: string): string {
  return `il_pass_${streamId.replace(/-/g, "").slice(0, 12)}`;
}

function accessValue(streamId: string, passcodeHash: string): string {
  return hmac(`pass:${streamId}:${passcodeHash}`);
}

type ViewerStream = Pick<Stream, "id" | "privacy" | "passcodeHash" | "status" | "chatEnabled" | "hostId">;

export function hasViewerAccess(stream: ViewerStream, cookieValue: string | undefined): boolean {
  if (stream.privacy !== "private") return true;
  if (!stream.passcodeHash || !cookieValue) return false;
  return safeEqual(cookieValue, accessValue(stream.id, stream.passcodeHash));
}

/** Loads the stream behind a public slug, hiding disabled streams and disabled hosts. */
export async function getViewerStream(slug: string): Promise<(ViewerStream & { title: string }) | null> {
  if (!/^[a-z0-9]{6,16}$/.test(slug)) return null;
  const [row] = await getDb()
    .select({
      id: streams.id,
      title: streams.title,
      privacy: streams.privacy,
      passcodeHash: streams.passcodeHash,
      status: streams.status,
      chatEnabled: streams.chatEnabled,
      hostId: streams.hostId,
    })
    .from(streams)
    .innerJoin(users, eq(users.id, streams.hostId))
    .where(and(eq(streams.slug, slug), isNull(streams.disabledAt), isNull(users.disabledAt)))
    .limit(1);
  return row ?? null;
}

/** Checks a viewer's passcode and returns the cookie value to remember it. */
export async function unlockWithPasscode(slug: string, passcode: string): Promise<{ streamId: string; cookie: string }> {
  const stream = await getViewerStream(slug);
  if (!stream) throw new BroadcastError("not_found");
  if (stream.privacy !== "private" || !stream.passcodeHash) {
    return { streamId: stream.id, cookie: "" };
  }
  if (!(await verifyPassword(stream.passcodeHash, passcode.trim()))) throw new BroadcastError("bad_passcode");
  return { streamId: stream.id, cookie: accessValue(stream.id, stream.passcodeHash) };
}

export type ViewerState = { status: "idle" | "live" | "ended" | "locked" };

export async function getViewerState(slug: string, accessCookie: string | undefined, meta: RequestMeta): Promise<ViewerState | null> {
  const stream = await getViewerStream(slug);
  if (!stream) return null;
  if (!hasViewerAccess(stream, accessCookie)) return { status: "locked" };
  if (stream.status === "live" && (await sweepIfStale(stream.id, meta))) return { status: "ended" };
  return { status: stream.status };
}

export function deviceTypeFromUserAgent(ua: string | null): "desktop" | "mobile" | "tablet" | "other" {
  if (!ua) return "other";
  if (/ipad|tablet|(android(?!.*mobile))/i.test(ua)) return "tablet";
  if (/mobi|iphone|ipod|android/i.test(ua)) return "mobile";
  if (/windows|macintosh|linux|cros/i.test(ua)) return "desktop";
  return "other";
}

export type ViewerConnection = { wsUrl: string; token: string; viewerId: string; pingKey: string; chatEnabled: boolean };

/** Issues a watch-only LiveKit token for an anonymous viewer and records the join. */
export async function joinAsViewer(
  slug: string,
  accessCookie: string | undefined,
  displayName: string,
  meta: RequestMeta & { country?: string | null },
): Promise<ViewerConnection> {
  const stream = await getViewerStream(slug);
  if (!stream) throw new BroadcastError("not_found");
  if (!hasViewerAccess(stream, accessCookie)) throw new BroadcastError("locked");
  if (stream.status !== "live" || (await sweepIfStale(stream.id, meta))) throw new BroadcastError("not_live");
  const session = await activeSession(stream.id);
  if (!session) throw new BroadcastError("not_live");

  const lk = getLiveKit();
  const [host] = await getDb().select({ plan: users.plan }).from(users).where(eq(users.id, stream.hostId)).limit(1);
  const max = PLANS[host?.plan ?? "free"].maxConcurrentViewers;
  const viewers = (await lk.listIdentities(session.livekitRoom)).filter(isViewerIdentity).length;
  if (viewers >= max) throw new BroadcastError("full");

  const [stat] = await getDb()
    .insert(viewerStats)
    .values({
      sessionId: session.id,
      viewerKey: randomBytes(12).toString("base64url"),
      deviceType: deviceTypeFromUserAgent(meta.userAgent),
      country: meta.country && /^[A-Z]{2}$/.test(meta.country) ? meta.country : null,
      leftAt: new Date(),
    })
    .returning({ id: viewerStats.id });
  await getDb()
    .update(streamSessions)
    .set({ totalJoins: sql`${streamSessions.totalJoins} + 1` })
    .where(eq(streamSessions.id, session.id));

  const name = displayName.replace(/[^\p{L}\p{N} ._'-]/gu, "").trim().slice(0, 40) || "Guest";
  const token = await lk.createToken({
    room: session.livekitRoom,
    identity: `${VIEWER_PREFIX}${stat!.id.slice(0, 8)}${randomBytes(3).toString("hex")}`,
    name,
    grant: { canSubscribe: true, canPublish: false, canPublishData: stream.chatEnabled },
    ttlSeconds: VIEWER_TOKEN_TTL,
  });
  return { wsUrl: lk.wsUrl, token, viewerId: stat!.id, pingKey: hmac(`ping:${stat!.id}`), chatEnabled: stream.chatEnabled };
}

/** Viewers ping while watching so watch time can be measured without trusting the client's numbers. */
export async function recordViewerPing(viewerId: string, pingKey: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(viewerId) || !safeEqual(pingKey, hmac(`ping:${viewerId}`))) return false;
  const updated = await getDb()
    .update(viewerStats)
    .set({ leftAt: new Date() })
    .where(
      and(
        eq(viewerStats.id, viewerId),
        sql`exists (select 1 from ${streamSessions} where ${streamSessions.id} = ${viewerStats.sessionId} and ${streamSessions.endedAt} is null)`,
      ),
    )
    .returning({ id: viewerStats.id });
  return updated.length > 0;
}
