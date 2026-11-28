import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { auditLogs, reports, streams, users } from "@/server/db/schema";
import * as auth from "@/server/auth/service";
import { __setLiveKitForTesting, roomForStream } from "@/server/livekit";
import { streamFormSchema } from "@/lib/validation/stream";
import { createStream } from "@/server/streams/service";
import { getViewerState, startBroadcast } from "@/server/streams/broadcast";
import { getPublicStream } from "@/server/streams/public";
import {
  createReport,
  deleteUserAsAdmin,
  getPlatformStats,
  listAllStreams,
  listAuditLog,
  listReports,
  listUsers,
  markUserVerified,
  resolveReport,
  setStreamDisabled,
  setUserDisabled,
} from "@/server/admin/service";
import { setupTestDb } from "../support/db";
import { createFakeLiveKit } from "../support/fake-livekit";

const meta = { ip: "203.0.113.30", userAgent: "vitest" };
const form = (title: string) => streamFormSchema.parse({ title, description: "", privacy: "unlisted", passcode: "" });

let t: Awaited<ReturnType<typeof setupTestDb>>;
let lk: ReturnType<typeof createFakeLiveKit>;
let adminId: string;
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
  adminId = (await auth.register({ name: "Admin", email: "admin@example.com", password: "correct-horse-1" }, meta)).user.id;
  await t.db.update(users).set({ role: "admin", emailVerifiedAt: new Date() }).where(eq(users.id, adminId));
  const host = await auth.register({ name: "Host Person", email: "host@example.com", password: "correct-horse-1" }, meta);
  hostId = host.user.id;
  await t.db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, hostId));
});

describe("users", () => {
  it("lists and searches users with stream counts and filters", async () => {
    await createStream(hostId, form("A"), meta);
    await auth.register({ name: "New Person", email: "new@example.com", password: "correct-horse-1" }, meta);
    const all = await listUsers({});
    expect(all.total).toBe(3);
    expect(all.rows.find((r) => r.email === "host@example.com")?.streams).toBe(1);
    expect((await listUsers({ query: "PERSON" })).total).toBe(2);
    expect((await listUsers({ filter: "unverified" })).rows.map((r) => r.email)).toEqual(["new@example.com"]);
    expect((await listUsers({ filter: "admins" })).rows.map((r) => r.email)).toEqual(["admin@example.com"]);
  });

  it("disabling signs the user out, ends their live broadcast and blocks login; enabling restores", async () => {
    const s = await createStream(hostId, form("Live"), meta);
    await startBroadcast(s.id, hostId, "browser", meta);
    const { tokens } = await auth.login({ email: "host@example.com", password: "correct-horse-1" }, meta);

    await setUserDisabled(adminId, hostId, true, "Spam", meta);
    expect((await auth.refreshSession(tokens.refreshToken!, meta)).ok).toBe(false);
    expect((await t.db.select().from(streams).where(eq(streams.id, s.id)))[0]!.status).toBe("ended");
    expect(lk.deletedRooms).toContain(roomForStream(s.id));
    expect(await getPublicStream(s.slug)).toBeNull();
    await expect(auth.login({ email: "host@example.com", password: "correct-horse-1" }, meta)).rejects.toMatchObject({
      code: "account_disabled",
    });

    await setUserDisabled(adminId, hostId, false, null, meta);
    await auth.login({ email: "host@example.com", password: "correct-horse-1" }, meta);
    const actions = (await t.db.select().from(auditLogs)).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["admin.user_disabled", "admin.user_enabled"]));
  });

  it("refuses to act on yourself or disable/delete another admin", async () => {
    await expect(setUserDisabled(adminId, adminId, true, null, meta)).rejects.toMatchObject({ code: "self" });
    await expect(deleteUserAsAdmin(adminId, adminId, meta)).rejects.toMatchObject({ code: "self" });
    const other = (await auth.register({ name: "A2", email: "a2@example.com", password: "correct-horse-1" }, meta)).user.id;
    await t.db.update(users).set({ role: "admin" }).where(eq(users.id, other));
    await expect(setUserDisabled(adminId, other, true, null, meta)).rejects.toMatchObject({ code: "is_admin" });
    await expect(deleteUserAsAdmin(adminId, other, meta)).rejects.toMatchObject({ code: "is_admin" });
  });

  it("marks emails verified and deletes users with their streams", async () => {
    const u = (await auth.register({ name: "Unv", email: "unv@example.com", password: "correct-horse-1" }, meta)).user.id;
    await markUserVerified(adminId, u, meta);
    expect((await t.db.select().from(users).where(eq(users.id, u)))[0]!.emailVerifiedAt).toBeInstanceOf(Date);

    await createStream(hostId, form("Gone soon"), meta);
    await deleteUserAsAdmin(adminId, hostId, meta);
    expect(await t.db.select().from(users).where(eq(users.id, hostId))).toHaveLength(0);
    expect(await t.db.select().from(streams).where(eq(streams.hostId, hostId))).toHaveLength(0);
    const [log] = await t.db.select().from(auditLogs).where(eq(auditLogs.action, "admin.user_deleted"));
    expect(log?.metadata).toMatchObject({ email: "host@example.com" });
  });
});

describe("streams", () => {
  it("lists with search and filters; disabling ends the broadcast and hides the viewer page", async () => {
    const live = await createStream(hostId, form("Sunday Service"), meta);
    await createStream(hostId, form("Cooking"), meta);
    await startBroadcast(live.id, hostId, "browser", meta);

    expect((await listAllStreams({})).rows[0]!.title).toBe("Sunday Service");
    expect((await listAllStreams({ filter: "live" })).total).toBe(1);
    expect((await listAllStreams({ query: "host@example" })).total).toBe(2);
    expect((await listAllStreams({ query: live.slug })).total).toBe(1);

    await setStreamDisabled(adminId, live.id, true, "Copyright", meta);
    expect((await listAllStreams({ filter: "disabled" })).rows[0]).toMatchObject({ title: "Sunday Service", disabledReason: "Copyright" });
    expect(await getViewerState(live.slug, undefined, meta)).toBeNull();
    await expect(startBroadcast(live.id, hostId, "browser", meta)).rejects.toMatchObject({ code: "disabled" });

    await setStreamDisabled(adminId, live.id, false, null, meta);
    expect((await getViewerState(live.slug, undefined, meta))?.status).toBe("ended");
  });
});

describe("reports", () => {
  it("accepts anonymous reports, dedupes per reporter, and lists them", async () => {
    const s = await createStream(hostId, form("Reported"), meta);
    expect(await createReport(s.slug, "spam", "  buy stuff  ", meta)).toEqual({ duplicate: false });
    expect(await createReport(s.slug, "hate", null, meta)).toEqual({ duplicate: true });
    expect(await createReport(s.slug, "hate", null, { ...meta, ip: "198.51.100.1" })).toEqual({ duplicate: false });
    await expect(createReport("nosuchslug1", "spam", null, meta)).rejects.toMatchObject({ code: "not_found" });

    const open = await listReports({});
    expect(open.total).toBe(2);
    expect(open.rows.find((r) => r.reason === "spam")).toMatchObject({ details: "buy stuff", streamTitle: "Reported" });
    const [row] = await t.db.select().from(reports).limit(1);
    expect(row!.reporterHash).not.toContain("203.0.113");
    expect((await listAllStreams({ filter: "reported" })).rows[0]?.openReports).toBe(2);
  });

  it("dismissing resolves one report; actioning disables the stream and resolves all its reports", async () => {
    const s = await createStream(hostId, form("Bad"), meta);
    await createReport(s.slug, "spam", null, meta);
    await createReport(s.slug, "hate", null, { ...meta, ip: "198.51.100.2" });
    const [first, second] = (await listReports({})).rows;

    await resolveReport(adminId, first!.id, "dismiss", "fine", meta);
    expect((await listReports({ status: "dismissed" })).rows[0]).toMatchObject({ resolutionNote: "fine" });

    await resolveReport(adminId, second!.id, "disable_stream", null, meta);
    expect((await listReports({})).total).toBe(0);
    expect((await listReports({ status: "actioned" })).total).toBe(1);
    expect((await t.db.select().from(streams).where(eq(streams.id, s.id)))[0]!.disabledAt).toBeInstanceOf(Date);
  });
});

describe("overview and audit", () => {
  it("summarises the platform and exposes the audit trail", async () => {
    const s = await createStream(hostId, form("Live"), meta);
    await startBroadcast(s.id, hostId, "browser", meta);
    await createReport(s.slug, "spam", null, meta);
    const stats = await getPlatformStats();
    expect(stats).toMatchObject({
      users: { total: 2, verified: 2, disabled: 0 },
      streams: { total: 1, live: 1 },
      last30d: { broadcasts: 1 },
      openReports: 1,
    });
    const log = await listAuditLog({ action: "stream" });
    expect(log.rows.map((r) => r.action)).toEqual(expect.arrayContaining(["stream.created", "stream.live"]));
    expect(log.rows.every((r) => r.action.startsWith("stream"))).toBe(true);
  });
});
