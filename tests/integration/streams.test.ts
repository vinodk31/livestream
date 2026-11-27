import { existsSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { auditLogs, streamSessions, streams, users } from "@/server/db/schema";
import * as auth from "@/server/auth/service";
import { verifyPassword } from "@/server/auth/password";
import { PLANS } from "@/lib/plans";
import { streamFormSchema } from "@/lib/validation/stream";
import {
  createStream,
  deleteStream,
  getStreamForHost,
  resetStreamLink,
  setThumbnail,
  updateStream,
} from "@/server/streams/service";
import { getPublicStream } from "@/server/streams/public";
import { getStreamStats } from "@/server/streams/queries";
import { setupTestDb } from "../support/db";

const meta = { ip: "203.0.113.10", userAgent: "vitest" };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

const form = (over: Record<string, unknown> = {}) =>
  streamFormSchema.parse({ title: "My stream", description: "", privacy: "unlisted", passcode: "", ...over });

const localFile = (url: string) => path.join(process.cwd(), ".uploads", url.replace("/api/uploads/", ""));

let t: Awaited<ReturnType<typeof setupTestDb>>;
let host: string;
let other: string;

beforeAll(async () => {
  t = await setupTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  host = (await auth.register({ name: "Host", email: "host@example.com", password: "correct-horse-1" }, meta)).user.id;
  other = (await auth.register({ name: "Other", email: "other@example.com", password: "correct-horse-1" }, meta)).user.id;
});

describe("createStream", () => {
  it("creates an unlisted stream with a short unambiguous slug", async () => {
    const s = await createStream(host, form({ title: "  Sunday Service ", description: "Weekly" }), meta);
    expect(s).toMatchObject({
      title: "Sunday Service",
      description: "Weekly",
      privacy: "unlisted",
      status: "idle",
      chatEnabled: false,
      recordingEnabled: false,
      passcodeHash: null,
    });
    expect(s.slug).toMatch(/^[23456789abcdefghjkmnpqrstuvwxyz]{10}$/);
    const logs = await t.db.select().from(auditLogs).where(eq(auditLogs.action, "stream.created"));
    expect(logs[0]).toMatchObject({ actorId: host, targetId: s.id });
  });

  it("requires and hashes a passcode for private streams", async () => {
    await expect(createStream(host, form({ privacy: "private" }), meta)).rejects.toMatchObject({
      code: "passcode_required",
    });
    const s = await createStream(host, form({ privacy: "private", passcode: "open sesame" }), meta);
    expect(s.passcodeHash).not.toContain("open sesame");
    expect(await verifyPassword(s.passcodeHash!, "open sesame")).toBe(true);
  });

  it("ignores a passcode on non-private streams", async () => {
    const s = await createStream(host, form({ privacy: "public", passcode: "abcd" }), meta);
    expect(s.passcodeHash).toBeNull();
  });

  it("enforces the plan's stream limit", async () => {
    const max = PLANS.free.maxStreams;
    await t.db.insert(streams).values(
      Array.from({ length: max }, (_, i) => ({ hostId: host, slug: `seed${i}x`, title: `S${i}` })),
    );
    await expect(createStream(host, form(), meta)).rejects.toMatchObject({ code: "limit_reached" });
    // Other hosts are unaffected.
    await createStream(other, form(), meta);
  });

  it("stores a valid thumbnail and rejects files that aren't images", async () => {
    const s = await createStream(host, form(), meta, PNG);
    expect(s.thumbnailUrl).toMatch(/^\/api\/uploads\/thumbnails\/.+\.png$/);
    expect(existsSync(localFile(s.thumbnailUrl!))).toBe(true);

    const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
    await expect(createStream(host, form(), meta, html)).rejects.toMatchObject({ code: "invalid_image" });
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    big.set(PNG);
    await expect(createStream(host, form(), meta, big)).rejects.toMatchObject({ code: "too_large" });
    expect(await t.db.select().from(streams)).toHaveLength(1);
  });
});

describe("ownership", () => {
  it("hides other hosts' streams from every host-side operation", async () => {
    const s = await createStream(host, form(), meta);
    await expect(getStreamForHost(s.id, other)).rejects.toMatchObject({ code: "not_found" });
    await expect(updateStream(s.id, other, form({ title: "Hacked" }), meta)).rejects.toMatchObject({ code: "not_found" });
    await expect(resetStreamLink(s.id, other, meta)).rejects.toMatchObject({ code: "not_found" });
    await expect(setThumbnail(s.id, other, PNG, meta)).rejects.toMatchObject({ code: "not_found" });
    await expect(deleteStream(s.id, other, meta)).rejects.toMatchObject({ code: "not_found" });
    await expect(getStreamForHost("not-a-uuid", host)).rejects.toMatchObject({ code: "not_found" });
    expect((await getStreamForHost(s.id, host)).title).toBe("My stream");
  });
});

describe("updateStream", () => {
  it("keeps the existing passcode when left blank, replaces it when given, clears it when no longer private", async () => {
    const s = await createStream(host, form({ privacy: "private", passcode: "first-code" }), meta);
    const kept = await updateStream(s.id, host, form({ privacy: "private", title: "Renamed" }), meta);
    expect(kept.title).toBe("Renamed");
    expect(kept.passcodeHash).toBe(s.passcodeHash);

    const changed = await updateStream(s.id, host, form({ privacy: "private", passcode: "second-code" }), meta);
    expect(await verifyPassword(changed.passcodeHash!, "second-code")).toBe(true);

    const opened = await updateStream(s.id, host, form({ privacy: "unlisted" }), meta);
    expect(opened.passcodeHash).toBeNull();
    // Going private again now needs a new passcode.
    await expect(updateStream(s.id, host, form({ privacy: "private" }), meta)).rejects.toMatchObject({
      code: "passcode_required",
    });
  });

  it("toggles chat and recording", async () => {
    const s = await createStream(host, form({ chatEnabled: "on", recordingEnabled: "on" }), meta);
    expect(s).toMatchObject({ chatEnabled: true, recordingEnabled: true });
    const u = await updateStream(s.id, host, form({ chatEnabled: "on" }), meta);
    expect(u).toMatchObject({ chatEnabled: true, recordingEnabled: false });
  });
});

describe("thumbnails", () => {
  it("replacing deletes the old file; removing clears it", async () => {
    const s = await createStream(host, form(), meta, PNG);
    const first = s.thumbnailUrl!;
    const second = await setThumbnail(s.id, host, PNG, meta);
    expect(second).not.toBe(first);
    expect(existsSync(localFile(first))).toBe(false);
    expect(existsSync(localFile(second!))).toBe(true);

    await setThumbnail(s.id, host, null, meta);
    expect((await getStreamForHost(s.id, host)).thumbnailUrl).toBeNull();
    expect(existsSync(localFile(second!))).toBe(false);
  });
});

describe("viewer link", () => {
  it("resetting the link makes the old one stop working", async () => {
    const s = await createStream(host, form({ title: "Town hall" }), meta);
    expect((await getPublicStream(s.slug))?.title).toBe("Town hall");
    const slug = await resetStreamLink(s.id, host, meta);
    expect(slug).not.toBe(s.slug);
    expect(await getPublicStream(s.slug)).toBeNull();
    expect((await getPublicStream(slug))?.hostName).toBe("Host");
  });

  it("hides disabled streams, streams of disabled hosts, and malformed slugs", async () => {
    const s = await createStream(host, form(), meta);
    expect(await getPublicStream("../../etc")).toBeNull();
    expect(await getPublicStream("UPPERCASE1")).toBeNull();

    await t.db.update(users).set({ disabledAt: new Date() }).where(eq(users.id, host));
    expect(await getPublicStream(s.slug)).toBeNull();
    await t.db.update(users).set({ disabledAt: null }).where(eq(users.id, host));

    await t.db.update(streams).set({ disabledAt: new Date() }).where(eq(streams.id, s.id));
    expect(await getPublicStream(s.slug)).toBeNull();
  });

  it("never exposes the passcode hash publicly", async () => {
    const s = await createStream(host, form({ privacy: "private", passcode: "secret-1" }), meta);
    const pub = await getPublicStream(s.slug);
    expect(pub).not.toBeNull();
    expect(JSON.stringify(pub)).not.toContain("argon2");
    expect(Object.keys(pub!)).not.toContain("passcodeHash");
  });
});

describe("deleteStream", () => {
  it("refuses while live, then deletes the stream, its sessions and its thumbnail", async () => {
    const s = await createStream(host, form(), meta, PNG);
    await t.db.insert(streamSessions).values({ streamId: s.id, livekitRoom: "r1", totalJoins: 5 });
    expect((await getStreamStats(s.id)).views).toBe(5);

    await t.db.update(streams).set({ status: "live" }).where(eq(streams.id, s.id));
    await expect(deleteStream(s.id, host, meta)).rejects.toMatchObject({ code: "is_live" });

    await t.db.update(streams).set({ status: "ended" }).where(eq(streams.id, s.id));
    await deleteStream(s.id, host, meta);
    expect(await t.db.select().from(streams)).toHaveLength(0);
    expect(await t.db.select().from(streamSessions)).toHaveLength(0);
    expect(existsSync(localFile(s.thumbnailUrl!))).toBe(false);
  });
});
