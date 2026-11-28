import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { streamSessions, users } from "@/server/db/schema";
import * as auth from "@/server/auth/service";
import { __setLiveKitForTesting } from "@/server/livekit";
import { PLANS } from "@/lib/plans";
import { streamFormSchema } from "@/lib/validation/stream";
import { createStream } from "@/server/streams/service";
import { endBroadcast, startBroadcast } from "@/server/streams/broadcast";
import {
  deleteRecording,
  getLatestReplay,
  listRecordings,
  purgeExpiredRecordings,
  recordingLinks,
} from "@/server/streams/recording-service";
import { signedRecordingUrl } from "@/server/recordings";
import { setupTestDb } from "../support/db";
import { createFakeLiveKit } from "../support/fake-livekit";

const meta = { ip: "203.0.113.20", userAgent: "vitest" };
const form = (over: Record<string, unknown> = {}) =>
  streamFormSchema.parse({ title: "Rec test", description: "", privacy: "unlisted", passcode: "", recordingEnabled: "on", ...over });

let t: Awaited<ReturnType<typeof setupTestDb>>;
let lk: ReturnType<typeof createFakeLiveKit>;
let hostId: string;
const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));

beforeAll(async () => {
  t = await setupTestDb();
});
afterAll(async () => {
  __setLiveKitForTesting(undefined);
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.stubEnv("RECORDING_S3_BUCKET", "replays");
  vi.stubEnv("RECORDING_S3_ACCESS_KEY_ID", "AKIDEXAMPLE");
  vi.stubEnv("RECORDING_S3_SECRET_ACCESS_KEY", "secret-example");
  vi.stubEnv("RECORDING_S3_ENDPOINT", "https://acct.r2.cloudflarestorage.com");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockClear();
  lk = createFakeLiveKit();
  __setLiveKitForTesting(lk);
  hostId = (await auth.register({ name: "Host", email: "host@example.com", password: "correct-horse-1" }, meta)).user.id;
  await t.db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, hostId));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function broadcastOnce(over: Record<string, unknown> = {}) {
  const s = await createStream(hostId, form(over), meta);
  const conn = await startBroadcast(s.id, hostId, "browser", meta);
  return { stream: s, sessionId: conn.sessionId };
}

const session = async (id: string) => (await t.db.select().from(streamSessions).where(eq(streamSessions.id, id)))[0]!;

describe("recording lifecycle", () => {
  it("starts with the broadcast, stops at the end, and becomes a replay when LiveKit finishes", async () => {
    const { stream, sessionId } = await broadcastOnce();
    const s1 = await session(sessionId);
    expect(s1).toMatchObject({ recordingStatus: "recording", recordingUrl: `recordings/${stream.id}/${sessionId}.mp4` });
    const egress = lk.egresses.get(s1.egressId!)!;
    expect(egress.key).toBe(s1.recordingUrl);

    await endBroadcast(stream.id, hostId, "host_ended", meta);
    expect(egress.stopped).toBe(true);
    expect((await session(sessionId)).recordingStatus).toBe("processing");
    expect(await getLatestReplay(stream.id)).toBeNull(); // still processing

    egress.result = { status: "complete", durationSec: 3600, sizeBytes: 3_500_000_000 };
    const replay = await getLatestReplay(stream.id);
    expect(replay?.url).toMatch(/^https:\/\/acct\.r2\.cloudflarestorage\.com\/replays\/recordings\/.+X-Amz-Signature=/);
    const done = await session(sessionId);
    expect(done).toMatchObject({ recordingStatus: "ready", recordingDurationSec: 3600, recordingSizeBytes: 3_500_000_000 });
    const days = (done.recordingExpiresAt!.getTime() - Date.now()) / 86_400_000;
    expect(Math.round(days)).toBe(PLANS.free.recordingRetentionDays);
  });

  it("doesn't record when turned off for the stream, or when storage isn't configured", async () => {
    const off = await broadcastOnce({ recordingEnabled: undefined });
    expect((await session(off.sessionId)).recordingStatus).toBe("none");
    vi.stubEnv("RECORDING_S3_BUCKET", "");
    const unconfigured = await broadcastOnce({ title: "Second" });
    expect((await session(unconfigured.sessionId)).recordingStatus).toBe("none");
    expect(lk.egresses.size).toBe(0);
  });

  it("a failed recording start never stops the broadcast", async () => {
    lk.failNextRecording = true;
    const { sessionId } = await broadcastOnce();
    expect((await session(sessionId)).recordingStatus).toBe("failed");
  });

  it("marks failed recordings and lists them for the host", async () => {
    const { stream, sessionId } = await broadcastOnce();
    await endBroadcast(stream.id, hostId, "host_ended", meta);
    lk.egresses.get((await session(sessionId)).egressId!)!.result = { status: "failed", error: "boom" };
    const rows = await listRecordings(stream.id);
    expect(rows.map((r) => r.recordingStatus)).toEqual(["failed"]);
    expect(await getLatestReplay(stream.id)).toBeNull();
  });
});

describe("host actions", () => {
  async function readyRecording() {
    const b = await broadcastOnce();
    await endBroadcast(b.stream.id, hostId, "host_ended", meta);
    lk.egresses.get((await session(b.sessionId)).egressId!)!.result = { status: "complete", durationSec: 60, sizeBytes: 1000 };
    await listRecordings(b.stream.id);
    return b;
  }

  it("signs watch and download links only for the owner", async () => {
    const { sessionId } = await readyRecording();
    const links = await recordingLinks(sessionId, hostId);
    expect(links.download).toContain("response-content-disposition=attachment");
    expect(links.watch).not.toContain("response-content-disposition");
    const other = (await auth.register({ name: "O", email: "o@example.com", password: "correct-horse-1" }, meta)).user.id;
    await expect(recordingLinks(sessionId, other)).rejects.toThrow("not_found");
  });

  it("deleting removes the file and the replay", async () => {
    const { stream, sessionId } = await readyRecording();
    await deleteRecording(sessionId, hostId, meta);
    const req = (fetchMock.mock.calls as unknown as [Request][]).map(([r]) => r).find((r) => r.method === "DELETE");
    expect(req?.url).toContain(`/replays/recordings/${stream.id}/${sessionId}.mp4`);
    expect(req?.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 /);
    expect((await session(sessionId)).recordingStatus).toBe("deleted");
    expect(await getLatestReplay(stream.id)).toBeNull();
  });

  it("purges recordings past retention", async () => {
    const { stream, sessionId } = await readyRecording();
    await t.db.update(streamSessions).set({ recordingExpiresAt: new Date(Date.now() - 1000) }).where(eq(streamSessions.id, sessionId));
    expect(await getLatestReplay(stream.id)).toBeNull();
    expect(await purgeExpiredRecordings()).toBe(1);
    expect((await session(sessionId)).recordingStatus).toBe("deleted");
    expect(await purgeExpiredRecordings()).toBe(0);
  });
});

describe("signed links", () => {
  it("sanitise download names and expire", async () => {
    const url = new URL((await signedRecordingUrl("recordings/a/b.mp4", { downloadName: 'Evil"; name\r\n', expiresInSec: 60 }))!);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("60");
    expect(url.searchParams.get("response-content-disposition")).toBe('attachment; filename="Evil name.mp4"');
  });
});
