import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { auditLogs, refreshTokens, streamSessions, streams, users } from "@/server/db/schema";
import * as auth from "@/server/auth/service";
import { verifyAccessToken } from "@/server/auth/jwt";
import { getDashboardStats, listStreams } from "@/server/streams/queries";
import { countActiveSessions, deleteAccount, revokeOtherSessions, updateProfile } from "@/server/account/service";
import { setupTestDb } from "../support/db";

const meta = { ip: "203.0.113.9", userAgent: "vitest" };
const PASSWORD = "correct-horse-1";
const NOW = new Date("2026-11-20T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

let t: Awaited<ReturnType<typeof setupTestDb>>;
beforeAll(async () => {
  t = await setupTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
});

async function makeHost(email: string) {
  return auth.register({ name: "Host " + email, email, password: PASSWORD }, meta);
}

let slugN = 0;
async function makeStream(hostId: string, over: Partial<typeof streams.$inferInsert> = {}) {
  const [row] = await t.db
    .insert(streams)
    .values({ hostId, slug: `s${++slugN}`, title: `Stream ${slugN}`, ...over })
    .returning();
  return row!;
}

async function makeSession(streamId: string, over: Partial<typeof streamSessions.$inferInsert> = {}) {
  await t.db.insert(streamSessions).values({ streamId, livekitRoom: `room-${++slugN}`, ...over });
}

describe("dashboard stats", () => {
  it("is all zeros for a new host", async () => {
    const { user } = await makeHost("a@example.com");
    expect(await getDashboardStats(user.id, NOW)).toEqual({
      totalStreams: 0,
      liveNow: 0,
      views30d: 0,
      watchSeconds30d: 0,
      peakViewers30d: 0,
      streamedSecondsThisMonth: 0,
    });
  });

  it("aggregates only this host's recent sessions and this month's streaming time", async () => {
    const { user } = await makeHost("a@example.com");
    const { user: other } = await makeHost("b@example.com");

    const live = await makeStream(user.id, { status: "live" });
    const ended = await makeStream(user.id, { status: "ended" });
    await makeStream(user.id);
    // Live now: started 2h ago, still running.
    await makeSession(live.id, { startedAt: hoursAgo(2), totalJoins: 40, viewerSeconds: 7200, peakViewers: 25 });
    // Ended 1 day ago, lasted 1h.
    await makeSession(ended.id, {
      startedAt: hoursAgo(25),
      endedAt: hoursAgo(24),
      totalJoins: 60,
      viewerSeconds: 3600,
      peakViewers: 30,
    });
    // 40 days ago: outside the 30-day window and last month.
    await makeSession(ended.id, {
      startedAt: hoursAgo(24 * 40 + 1),
      endedAt: hoursAgo(24 * 40),
      totalJoins: 999,
      viewerSeconds: 999,
      peakViewers: 999,
    });
    // Someone else's stream must not leak in.
    const theirs = await makeStream(other.id, { status: "live" });
    await makeSession(theirs.id, { startedAt: hoursAgo(1), totalJoins: 500, peakViewers: 500 });

    const stats = await getDashboardStats(user.id, NOW);
    expect(stats).toEqual({
      totalStreams: 3,
      liveNow: 1,
      views30d: 100,
      watchSeconds30d: 10_800,
      peakViewers30d: 30,
      streamedSecondsThisMonth: 3 * 3600,
    });
  });

  it("counts only the part of a session that falls in this month", async () => {
    const { user } = await makeHost("a@example.com");
    const s = await makeStream(user.id, { status: "ended" });
    // Ran from 1h before the month started until 1h after.
    await makeSession(s.id, {
      startedAt: new Date("2026-10-31T23:00:00Z"),
      endedAt: new Date("2026-11-01T01:00:00Z"),
    });
    expect((await getDashboardStats(user.id, NOW)).streamedSecondsThisMonth).toBe(3600);
  });
});

describe("listStreams", () => {
  it("puts live streams first, then most recently active, with view totals", async () => {
    const { user } = await makeHost("a@example.com");
    const old = await makeStream(user.id, { title: "Old", status: "ended", lastLiveAt: hoursAgo(100) });
    const recent = await makeStream(user.id, { title: "Recent", status: "ended", lastLiveAt: hoursAgo(1) });
    const live = await makeStream(user.id, { title: "Live", status: "live", lastLiveAt: hoursAgo(200) });
    await makeSession(recent.id, { totalJoins: 7 });
    await makeSession(recent.id, { totalJoins: 3 });

    const { items, total } = await listStreams(user.id);
    expect(total).toBe(3);
    expect(items.map((s) => s.id)).toEqual([live.id, recent.id, old.id]);
    expect(items[1]).toMatchObject({ totalViews: 10, broadcasts: 2 });
    expect(items[2]).toMatchObject({ totalViews: 0, broadcasts: 0 });
  });

  it("filters by status and searches titles case-insensitively, treating % and _ literally", async () => {
    const { user } = await makeHost("a@example.com");
    await makeStream(user.id, { title: "Sunday Service", status: "ended" });
    await makeStream(user.id, { title: "sunday rehearsal" });
    await makeStream(user.id, { title: "100% Product Demo", status: "live" });

    expect((await listStreams(user.id, { status: "ended" })).items.map((s) => s.title)).toEqual(["Sunday Service"]);
    expect((await listStreams(user.id, { query: "SUNDAY" })).total).toBe(2);
    expect((await listStreams(user.id, { query: "%" })).items.map((s) => s.title)).toEqual(["100% Product Demo"]);
    expect((await listStreams(user.id, { query: "_" })).total).toBe(0);
    expect((await listStreams(user.id, { status: "live", query: "sunday" })).total).toBe(0);
  });

  it("paginates and never returns another host's streams", async () => {
    const { user } = await makeHost("a@example.com");
    const { user: other } = await makeHost("b@example.com");
    for (let i = 0; i < 5; i++) await makeStream(user.id);
    await makeStream(other.id);

    const p1 = await listStreams(user.id, { pageSize: 2, page: 1 });
    const p3 = await listStreams(user.id, { pageSize: 2, page: 3 });
    expect(p1).toMatchObject({ total: 5, pageCount: 3, page: 1 });
    expect(p1.items).toHaveLength(2);
    expect(p3.items).toHaveLength(1);
    const all = await listStreams(user.id, { pageSize: 50 });
    expect(all.items.every((s) => s.id)).toBe(true);
    expect(all.total).toBe(5);
  });
});

describe("account settings", () => {
  it("updates the display name", async () => {
    const { user } = await makeHost("a@example.com");
    await updateProfile(user.id, { name: "  New Name " }, meta);
    const [row] = await t.db.select().from(users).where(eq(users.id, user.id));
    expect(row!.name).toBe("New Name");
  });

  it("signs out other devices but keeps the current one", async () => {
    const { user, tokens: thisDevice } = await makeHost("a@example.com");
    const laptop = await auth.login({ email: "a@example.com", password: PASSWORD }, meta);
    const phone = await auth.login({ email: "a@example.com", password: PASSWORD }, meta);
    // Rotate the phone once: still one device.
    await auth.refreshSession(phone.tokens.refreshToken!, meta);
    expect(await countActiveSessions(user.id)).toBe(3);

    const sid = (await verifyAccessToken(thisDevice.accessToken))!.sid;
    expect(await revokeOtherSessions(user.id, sid, meta)).toBe(2);

    expect(await countActiveSessions(user.id)).toBe(1);
    expect((await auth.refreshSession(thisDevice.refreshToken!, meta)).ok).toBe(true);
    expect((await auth.refreshSession(laptop.tokens.refreshToken!, meta)).ok).toBe(false);
  });

  it("deletes the account and everything it owns, keeping an anonymised audit trail", async () => {
    const { user } = await makeHost("a@example.com");
    const s = await makeStream(user.id);
    await makeSession(s.id);

    await expect(deleteAccount(user.id, "wrong-password-1", meta)).rejects.toMatchObject({
      code: "invalid_credentials",
    });
    expect(await t.db.select().from(users)).toHaveLength(1);

    await deleteAccount(user.id, PASSWORD, meta);
    expect(await t.db.select().from(users)).toHaveLength(0);
    expect(await t.db.select().from(streams)).toHaveLength(0);
    expect(await t.db.select().from(streamSessions)).toHaveLength(0);
    expect(await t.db.select().from(refreshTokens)).toHaveLength(0);
    const [log] = await t.db.select().from(auditLogs).where(eq(auditLogs.action, "account.deleted"));
    expect(log).toMatchObject({ actorId: null, targetId: user.id });
  });
});
