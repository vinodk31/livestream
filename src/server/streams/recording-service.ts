import "server-only";
import { and, desc, eq, inArray, isNotNull, lt, ne } from "drizzle-orm";
import { PLANS } from "@/lib/plans";
import { getDb } from "../db";
import { streamSessions, streams, users, type StreamSession } from "../db/schema";
import { audit } from "../audit";
import { getLiveKit, type EgressResult } from "../livekit";
import {
  deleteRecordingObject,
  getRecordingStorage,
  recordingKey,
  signedRecordingUrl,
} from "../recordings";
import type { RequestMeta } from "../request";

/** Called when a new broadcast session starts. Never throws: a recording problem must not stop the stream. */
export async function startSessionRecording(streamId: string, sessionId: string, room: string): Promise<void> {
  const storage = getRecordingStorage();
  if (!storage) return;
  const key = recordingKey(streamId, sessionId);
  try {
    const egressId = await getLiveKit().startRecording(room, key, storage);
    await getDb()
      .update(streamSessions)
      .set({ egressId, recordingStatus: "recording", recordingUrl: key })
      .where(eq(streamSessions.id, sessionId));
  } catch (err) {
    console.error("[recording] start failed", err);
    await getDb().update(streamSessions).set({ recordingStatus: "failed" }).where(eq(streamSessions.id, sessionId));
  }
}

/** Called when a broadcast ends: asks LiveKit to finish the file. */
export async function stopSessionRecording(session: StreamSession): Promise<void> {
  if (!session.egressId || session.recordingStatus !== "recording") return;
  try {
    await getLiveKit().stopEgress(session.egressId);
  } catch (err) {
    console.error("[recording] stop failed", err);
  }
  await getDb()
    .update(streamSessions)
    .set({ recordingStatus: "processing" })
    .where(and(eq(streamSessions.id, session.id), eq(streamSessions.recordingStatus, "recording")));
}

async function retentionDays(streamId: string): Promise<number> {
  const [row] = await getDb()
    .select({ plan: users.plan })
    .from(streams)
    .innerJoin(users, eq(users.id, streams.hostId))
    .where(eq(streams.id, streamId))
    .limit(1);
  return PLANS[row?.plan ?? "free"].recordingRetentionDays;
}

/** Applies an egress result (from polling or the LiveKit webhook) to its session. */
export async function applyEgressResult(egressId: string, result: EgressResult): Promise<void> {
  if (result.status === "active") return;
  const db = getDb();
  const [session] = await db.select().from(streamSessions).where(eq(streamSessions.egressId, egressId)).limit(1);
  if (!session || !["recording", "processing"].includes(session.recordingStatus)) return;
  if (result.status === "failed") {
    console.error("[recording] egress failed", egressId, result.error);
    await db.update(streamSessions).set({ recordingStatus: "failed" }).where(eq(streamSessions.id, session.id));
    return;
  }
  const days = await retentionDays(session.streamId);
  await db
    .update(streamSessions)
    .set({
      recordingStatus: "ready",
      recordingDurationSec: result.durationSec,
      recordingSizeBytes: result.sizeBytes,
      recordingExpiresAt: new Date(Date.now() + days * 86_400_000),
    })
    .where(eq(streamSessions.id, session.id));
}

/** Lazily checks unfinished recordings of ended sessions (no webhook needed). */
async function refreshPending(sessions: StreamSession[]): Promise<boolean> {
  const pending = sessions.filter(
    (s) => s.endedAt && s.egressId && (s.recordingStatus === "processing" || s.recordingStatus === "recording"),
  );
  for (const s of pending) {
    try {
      await applyEgressResult(s.egressId!, await getLiveKit().getEgress(s.egressId!));
    } catch (err) {
      console.error("[recording] status check failed", err);
    }
  }
  return pending.length > 0;
}

export type RecordingRow = Pick<
  StreamSession,
  | "id"
  | "startedAt"
  | "endedAt"
  | "recordingStatus"
  | "recordingDurationSec"
  | "recordingSizeBytes"
  | "recordingExpiresAt"
  | "peakViewers"
  | "totalJoins"
>;

/** All broadcasts of a stream that have (or had) a recording. Caller must check ownership. */
export async function listRecordings(streamId: string): Promise<RecordingRow[]> {
  const load = () =>
    getDb()
      .select()
      .from(streamSessions)
      .where(and(eq(streamSessions.streamId, streamId), ne(streamSessions.recordingStatus, "none")))
      .orderBy(desc(streamSessions.startedAt))
      .limit(50);
  let rows = await load();
  if (await refreshPending(rows)) rows = await load();
  return rows;
}

async function ownedSession(sessionId: string, hostId: string): Promise<StreamSession & { title: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) throw new Error("not_found");
  const [row] = await getDb()
    .select({ session: streamSessions, title: streams.title })
    .from(streamSessions)
    .innerJoin(streams, eq(streams.id, streamSessions.streamId))
    .where(and(eq(streamSessions.id, sessionId), eq(streams.hostId, hostId)))
    .limit(1);
  if (!row) throw new Error("not_found");
  return { ...row.session, title: row.title };
}

/** Watch and download links for the host. */
export async function recordingLinks(sessionId: string, hostId: string) {
  const s = await ownedSession(sessionId, hostId);
  if (s.recordingStatus !== "ready" || !s.recordingUrl) throw new Error("not_ready");
  const date = s.startedAt.toISOString().slice(0, 10);
  const [watch, download] = await Promise.all([
    signedRecordingUrl(s.recordingUrl),
    signedRecordingUrl(s.recordingUrl, { downloadName: `${s.title} ${date}` }),
  ]);
  return { watch, download };
}

export async function deleteRecording(sessionId: string, hostId: string, meta: RequestMeta): Promise<void> {
  const s = await ownedSession(sessionId, hostId);
  if (s.recordingUrl) await deleteRecordingObject(s.recordingUrl);
  await getDb().update(streamSessions).set({ recordingStatus: "deleted" }).where(eq(streamSessions.id, s.id));
  await audit({ action: "recording.deleted", actorId: hostId, targetType: "session", targetId: s.id, ip: meta.ip });
}

export type Replay = { url: string; durationSec: number | null; recordedAt: Date };

/** The latest available replay of a stream, for the public watch page. */
export async function getLatestReplay(streamId: string): Promise<Replay | null> {
  const load = () =>
    getDb()
      .select()
      .from(streamSessions)
      .where(and(eq(streamSessions.streamId, streamId), isNotNull(streamSessions.endedAt)))
      .orderBy(desc(streamSessions.startedAt))
      .limit(3);
  let rows = await load();
  if (await refreshPending(rows)) rows = await load();
  const ready = rows.find(
    (r) => r.recordingStatus === "ready" && r.recordingUrl && (!r.recordingExpiresAt || r.recordingExpiresAt > new Date()),
  );
  if (!ready) return null;
  const url = await signedRecordingUrl(ready.recordingUrl!);
  return url ? { url, durationSec: ready.recordingDurationSec, recordedAt: ready.startedAt } : null;
}

/** Deletes recordings past their plan's retention. Run daily by the cron route. */
export async function purgeExpiredRecordings(): Promise<number> {
  const expired = await getDb()
    .select({ id: streamSessions.id, key: streamSessions.recordingUrl })
    .from(streamSessions)
    .where(and(eq(streamSessions.recordingStatus, "ready"), lt(streamSessions.recordingExpiresAt, new Date())));
  const done: string[] = [];
  for (const r of expired) {
    try {
      if (r.key) await deleteRecordingObject(r.key);
      done.push(r.id);
    } catch (err) {
      console.error("[recording] purge failed", r.id, err);
    }
  }
  if (done.length) {
    await getDb().update(streamSessions).set({ recordingStatus: "deleted" }).where(inArray(streamSessions.id, done));
  }
  return done.length;
}
