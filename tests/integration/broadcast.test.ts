import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { streamSessions, streams, users, viewerStats } from "@/server/db/schema";
import * as auth from "@/server/auth/service";
import { __setLiveKitForTesting, roomForStream } from "@/server/livekit";
import { PLANS } from "@/lib/plans";
import { streamFormSchema } from "@/lib/validation/stream";
import { createStream, deleteStream, updateStream } from "@/server/streams/service";
import {
  HEARTBEAT_STALE_MS,
  deviceTypeFromUserAgent,
  endBroadcast,
  getOrCreateObsSettings,
  getViewerState,
  heartbeat,
  joinAsViewer,
  recordViewerPing,
  startBroadcast,
  sweepAllStale,
  unlockWithPasscode,
} from "@/server/streams/broadcast";
import { getStreamStats } from "@/server/streams/queries";
import { setupTestDb } from "../support/db";
import { createFakeLiveKit } from "../support/fake-livekit";

const meta = { ip: "203.0.113.12", userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile" };
const form = (over: Record<string, unknown> = {}) =>
  streamFormSchema.parse({ title: "Live test", description: "", privacy: "unlisted", passcode: "", chatEnabled: "on", ...over });

let t: Awaited<ReturnType<typeof setupTestDb>>;
let lk: ReturnType<typeof createFakeLiveKit>;
let hostId: string;

beforeAll(async () => {
  t = await setupTestDb();
});
afterAll(async () => {
  __setLiveKitForTesting(undefined);
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  lk = createFakeLiveKit();
  __setLiveKitForTesting(lk);
  hostId = (await auth.register({ name: "Host", email: "host@example.com", password: "correct-horse-1" }, meta)).user.id;
  await t.db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, hostId));
});

async function liveStream(over: Record<string, unknown> = {}) {
  const s = await createStream(hostId, form(over), meta);
  await startBroadcast(s.id, hostId, "browser", meta);
  return s;
}

async function staleify(streamId: string) {
  await t.db
    .update(streamSessions)
    .set({ lastHeartbeatAt: new Date(Date.now() - HEARTBEAT_STALE_MS - 5_000) })
    .where(eq(streamSessions.streamId, streamId));
}

describe("going live", () => {
  it("creates a session, marks the stream live and issues a publishing host token", async () => {
    const s = await createStream(hostId, form(), meta);
    const conn = await startBroadcast(s.id, hostId, "browser", meta);
    expect(conn).toMatchObject({ wsUrl: "wss://fake.livekit.test", resumed: false });
    const [row] = await t.db.select().from(streams).where(eq(streams.id, s.id));
    expect(row!.status).toBe("live");
    expect(row!.lastLiveAt).toBeInstanceOf(Date);
    expect(lk.rooms.get(roomForStream(s.id))?.maxParticipants).toBe(PLANS.free.maxConcurrentViewers + 3);
    expect(lk.tokens.at(-1)).toMatchObject({ identity: "host", grant: { canPublish: true, canPublishData: true } });
  });

  it("requires a verified email and an enabled stream", async () => {
    const s = await createStream(hostId, form(), meta);
    await t.db.update(users).set({ emailVerifiedAt: null }).where(eq(users.id, hostId));
    await expect(startBroadcast(s.id, hostId, "browser", meta)).rejects.toMatchObject({ code: "email_unverified" });
    await t.db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, hostId));
    await t.db.update(streams).set({ disabledAt: new Date() }).where(eq(streams.id, s.id));
    await expect(startBroadcast(s.id, hostId, "browser", meta)).rejects.toMatchObject({ code: "disabled" });
  });

  it("refuses another host's stream", async () => {
    const other = (await auth.register({ name: "O", email: "o@example.com", password: "correct-horse-1" }, meta)).user.id;
    const s = await createStream(other, form(), meta);
    await expect(startBroadcast(s.id, hostId, "browser", meta)).rejects.toMatchObject({ code: "not_found" });
    await expect(heartbeat(s.id, hostId, meta)).rejects.toMatchObject({ code: "not_found" });
    await expect(getOrCreateObsSettings(s.id, hostId)).rejects.toMatchObject({ code: "not_found" });
  });

  it("blocks going live once the month's streaming time is used up", async () => {
    const s = await createStream(hostId, form(), meta);
    const hours = PLANS.free.monthlyStreamHours;
    const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1, 0, 0, 1));
    await t.db.insert(streamSessions).values({
      streamId: s.id,
      livekitRoom: "old",
      startedAt: monthStart,
      endedAt: new Date(monthStart.getTime() + hours * 3_600_000),
    });
    await expect(startBroadcast(s.id, hostId, "browser", meta)).rejects.toMatchObject({ code: "quota_exceeded" });
  });

  it("resumes the same session after a reload, but starts fresh after the host vanished", async () => {
    const s = await createStream(hostId, form(), meta);
    const first = await startBroadcast(s.id, hostId, "browser", meta);
    const again = await startBroadcast(s.id, hostId, "browser", meta);
    expect(again).toMatchObject({ sessionId: first.sessionId, resumed: true });

    await staleify(s.id);
    const fresh = await startBroadcast(s.id, hostId, "browser", meta);
    expect(fresh.sessionId).not.toBe(first.sessionId);
    const sessions = await t.db.select().from(streamSessions).where(eq(streamSessions.streamId, s.id));
    expect(sessions.filter((x) => x.endedAt == null)).toHaveLength(1);
  });
});

describe("heartbeat and ending", () => {
  it("reports viewers (not hosts) and tracks the peak", async () => {
    const s = await liveStream();
    lk.addParticipants(roomForStream(s.id), ["host", "host_obs", "v_a", "v_b", "v_c"]);
    let hb = await heartbeat(s.id, hostId, meta);
    expect(hb).toMatchObject({ live: true, viewers: 3, peakViewers: 3 });
    lk.rooms.get(roomForStream(s.id))!.identities = ["host", "v_a"];
    hb = await heartbeat(s.id, hostId, meta);
    expect(hb).toMatchObject({ live: true, viewers: 1, peakViewers: 3 });
  });

  it("ends the broadcast: stream ended, room closed, watch time rolled up", async () => {
    const s = await liveStream();
    const v = await joinAsViewer(s.slug, undefined, "Ann", meta);
    await t.db
      .update(viewerStats)
      .set({ joinedAt: new Date(Date.now() - 120_000), leftAt: new Date() })
      .where(eq(viewerStats.id, v.viewerId));
    await endBroadcast(s.id, hostId, "host_ended", meta);
    const [row] = await t.db.select().from(streams).where(eq(streams.id, s.id));
    expect(row!.status).toBe("ended");
    expect(lk.deletedRooms).toContain(roomForStream(s.id));
    const stats = await getStreamStats(s.id);
    expect(stats.views).toBe(1);
    expect(stats.watchSeconds).toBeGreaterThanOrEqual(119);
    expect(await heartbeat(s.id, hostId, meta)).toEqual({ live: false, reason: "ended" });
  });

  it("automatically ends broadcasts whose host stopped sending heartbeats", async () => {
    const s = await liveStream();
    expect((await getViewerState(s.slug, undefined, meta))?.status).toBe("live");
    await staleify(s.id);
    expect((await getViewerState(s.slug, undefined, meta))?.status).toBe("ended");
    const [session] = await t.db.select().from(streamSessions).where(eq(streamSessions.streamId, s.id));
    expect(session!.endedAt).toBeInstanceOf(Date);

    const s2 = await liveStream({ title: "Second" });
    await staleify(s2.id);
    expect(await sweepAllStale(meta)).toBe(1);
  });
});

describe("viewers", () => {
  it("can't join until the stream is live", async () => {
    const s = await createStream(hostId, form(), meta);
    expect((await getViewerState(s.slug, undefined, meta))?.status).toBe("idle");
    await expect(joinAsViewer(s.slug, undefined, "A", meta)).rejects.toMatchObject({ code: "not_live" });
    expect(await getViewerState("doesnotexist", undefined, meta)).toBeNull();
  });

  it("issues watch-only tokens, records the join and sanitises names", async () => {
    const s = await liveStream();
    const v = await joinAsViewer(s.slug, undefined, "  <b>Ann</b> 😀 ", { ...meta, country: "IN" });
    expect(v).toMatchObject({ wsUrl: "wss://fake.livekit.test", chatEnabled: true });
    const tok = lk.tokens.at(-1)!;
    expect(tok.identity).toMatch(/^v_/);
    expect(tok.name).toBe("bAnnb");
    expect(tok.grant).toMatchObject({ canSubscribe: true, canPublish: false, canPublishData: true });
    const [stat] = await t.db.select().from(viewerStats);
    expect(stat).toMatchObject({ deviceType: "mobile", country: "IN" });
    expect((await getStreamStats(s.id)).views).toBe(1);
  });

  it("gives viewers no chat permission when chat is off", async () => {
    const s = await liveStream({ chatEnabled: undefined });
    const v = await joinAsViewer(s.slug, undefined, "A", meta);
    expect(v.chatEnabled).toBe(false);
    expect(lk.tokens.at(-1)!.grant).toMatchObject({ canPublishData: false });
  });

  it("turns viewers away once the plan's viewer limit is reached", async () => {
    const s = await liveStream();
    const max = PLANS.free.maxConcurrentViewers;
    lk.addParticipants(roomForStream(s.id), ["host", ...Array.from({ length: max }, (_, i) => `v_${i}`)]);
    await expect(joinAsViewer(s.slug, undefined, "Late", meta)).rejects.toMatchObject({ code: "full" });
  });

  it("measures watch time only from correctly signed pings while live", async () => {
    const s = await liveStream();
    const v = await joinAsViewer(s.slug, undefined, "A", meta);
    expect(await recordViewerPing(v.viewerId, v.pingKey)).toBe(true);
    expect(await recordViewerPing(v.viewerId, v.pingKey + "x")).toBe(false);
    expect(await recordViewerPing("not-a-uuid", v.pingKey)).toBe(false);
    await endBroadcast(s.id, hostId, "host_ended", meta);
    expect(await recordViewerPing(v.viewerId, v.pingKey)).toBe(false);
  });
});

describe("private streams", () => {
  it("lock until the right passcode; changing the passcode re-locks", async () => {
    const s = await liveStream({ privacy: "private", passcode: "open-sesame" });
    expect((await getViewerState(s.slug, undefined, meta))?.status).toBe("locked");
    await expect(joinAsViewer(s.slug, undefined, "A", meta)).rejects.toMatchObject({ code: "locked" });
    await expect(unlockWithPasscode(s.slug, "wrong")).rejects.toMatchObject({ code: "bad_passcode" });

    const { cookie } = await unlockWithPasscode(s.slug, " open-sesame ");
    expect((await getViewerState(s.slug, cookie, meta))?.status).toBe("live");
    await joinAsViewer(s.slug, cookie, "A", meta);
    await expect(joinAsViewer(s.slug, cookie + "x", "A", meta)).rejects.toMatchObject({ code: "locked" });

    await updateStream(s.id, hostId, form({ privacy: "private", passcode: "new-code-1" }), meta);
    expect((await getViewerState(s.slug, cookie, meta))?.status).toBe("locked");
  });
});

describe("OBS ingress", () => {
  it("creates settings once, reuses them, regenerates on request and cleans up on delete", async () => {
    const s = await createStream(hostId, form(), meta);
    const a = await getOrCreateObsSettings(s.id, hostId);
    const b = await getOrCreateObsSettings(s.id, hostId);
    expect(b).toEqual(a);
    expect(lk.ingresses.size).toBe(1);
    const c = await getOrCreateObsSettings(s.id, hostId, true);
    expect(c.streamKey).not.toBe(a.streamKey);
    expect(lk.ingresses.size).toBe(1);
    await deleteStream(s.id, hostId, meta);
    expect(lk.ingresses.size).toBe(0);
  });
});

describe("device detection", () => {
  it.each([
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148", "mobile"],
    ["Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari", "mobile"],
    ["Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)", "tablet"],
    ["Mozilla/5.0 (Linux; Android 13; SM-X700) Safari", "tablet"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131", "desktop"],
    [null, "other"],
  ])("%s → %s", (ua, type) => expect(deviceTypeFromUserAgent(ua)).toBe(type));
});

describe("host dashboard sweep", () => {
  it("ends only this host's stale broadcasts", async () => {
    const { sweepHostStale } = await import("@/server/streams/broadcast");
    const mine = await liveStream({ title: "Mine" });
    const otherId = (await auth.register({ name: "O", email: "o2@example.com", password: "correct-horse-1" }, meta)).user.id;
    await t.db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, otherId));
    const theirs = await createStream(otherId, form({ title: "Theirs" }), meta);
    await startBroadcast(theirs.id, otherId, "browser", meta);
    await staleify(mine.id);
    await staleify(theirs.id);
    await sweepHostStale(hostId, meta);
    const rows = await t.db.select({ id: streams.id, status: streams.status }).from(streams);
    expect(rows.find((r) => r.id === mine.id)?.status).toBe("ended");
    expect(rows.find((r) => r.id === theirs.id)?.status).toBe("live");
  });
});
