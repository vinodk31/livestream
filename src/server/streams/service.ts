import "server-only";
import { randomInt } from "node:crypto";
import { and, count, eq } from "drizzle-orm";
import { PLANS } from "@/lib/plans";
import type { StreamFormInput } from "@/lib/validation/stream";
import { getDb } from "../db";
import { streams, users, type Stream } from "../db/schema";
import { audit } from "../audit";
import { hashPassword } from "../auth/password";
import type { RequestMeta } from "../request";
import { getLiveKit, isLiveKitConfigured } from "../livekit";
import { deleteStored, storeImage } from "../storage";

// No 0/o, 1/l/i: slugs are sometimes read aloud or typed from a screen.
const SLUG_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
const SLUG_LENGTH = 10;

export function generateSlug(): string {
  let s = "";
  for (let i = 0; i < SLUG_LENGTH; i++) s += SLUG_ALPHABET[randomInt(SLUG_ALPHABET.length)];
  return s;
}

export class StreamError extends Error {
  constructor(public code: "not_found" | "limit_reached" | "passcode_required" | "is_live") {
    super(code);
  }
}

/** Loads a stream only if it belongs to the host. Everything host-facing goes through this. */
export async function getStreamForHost(streamId: string, hostId: string): Promise<Stream> {
  if (!/^[0-9a-f-]{36}$/i.test(streamId)) throw new StreamError("not_found");
  const [row] = await getDb()
    .select()
    .from(streams)
    .where(and(eq(streams.id, streamId), eq(streams.hostId, hostId)))
    .limit(1);
  if (!row) throw new StreamError("not_found");
  return row;
}

async function passcodeHashFor(input: StreamFormInput, existingHash: string | null): Promise<string | null> {
  if (input.privacy !== "private") return null;
  if (input.passcode) return hashPassword(input.passcode);
  if (existingHash) return existingHash;
  throw new StreamError("passcode_required");
}

export async function createStream(
  hostId: string,
  input: StreamFormInput,
  meta: RequestMeta,
  thumbnail?: Uint8Array | null,
): Promise<Stream> {
  const db = getDb();
  const [host] = await db.select({ plan: users.plan }).from(users).where(eq(users.id, hostId)).limit(1);
  if (!host) throw new StreamError("not_found");
  const [{ total } = { total: 0 }] = await db.select({ total: count() }).from(streams).where(eq(streams.hostId, hostId));
  if (total >= PLANS[host.plan].maxStreams) throw new StreamError("limit_reached");

  const passcodeHash = await passcodeHashFor(input, null);
  // Upload first so a bad image fails before anything is written.
  const thumbnailUrl = thumbnail?.byteLength ? await storeImage("thumbnails", thumbnail) : null;

  for (let attempt = 0; ; attempt++) {
    try {
      const [row] = await db
        .insert(streams)
        .values({
          hostId,
          slug: generateSlug(),
          title: input.title,
          description: input.description,
          privacy: input.privacy,
          passcodeHash,
          chatEnabled: input.chatEnabled,
          recordingEnabled: input.recordingEnabled,
          thumbnailUrl,
        })
        .returning();
      await audit({ action: "stream.created", actorId: hostId, targetType: "stream", targetId: row!.id, ip: meta.ip });
      return row!;
    } catch (err) {
      // Astronomically unlikely slug collision: just try another.
      if ((err as { code?: string }).code === "23505" && attempt < 3) continue;
      await deleteStored(thumbnailUrl);
      throw err;
    }
  }
}

export async function updateStream(
  streamId: string,
  hostId: string,
  input: StreamFormInput,
  meta: RequestMeta,
): Promise<Stream> {
  const current = await getStreamForHost(streamId, hostId);
  const passcodeHash = await passcodeHashFor(input, current.passcodeHash);
  const [row] = await getDb()
    .update(streams)
    .set({
      title: input.title,
      description: input.description,
      privacy: input.privacy,
      passcodeHash,
      chatEnabled: input.chatEnabled,
      recordingEnabled: input.recordingEnabled,
    })
    .where(and(eq(streams.id, streamId), eq(streams.hostId, hostId)))
    .returning();
  await audit({
    action: "stream.updated",
    actorId: hostId,
    targetType: "stream",
    targetId: streamId,
    metadata: {
      privacy: input.privacy,
      passcodeChanged: input.privacy === "private" && input.passcode != null,
    },
    ip: meta.ip,
  });
  return row!;
}

export async function setThumbnail(streamId: string, hostId: string, bytes: Uint8Array | null, meta: RequestMeta) {
  const current = await getStreamForHost(streamId, hostId);
  const url = bytes ? await storeImage("thumbnails", bytes) : null;
  await getDb().update(streams).set({ thumbnailUrl: url }).where(eq(streams.id, streamId));
  await deleteStored(current.thumbnailUrl);
  await audit({
    action: bytes ? "stream.thumbnail_set" : "stream.thumbnail_removed",
    actorId: hostId,
    targetType: "stream",
    targetId: streamId,
    ip: meta.ip,
  });
  return url;
}

/** Issues a new viewer link. Anyone holding the old link loses access. */
export async function resetStreamLink(streamId: string, hostId: string, meta: RequestMeta): Promise<string> {
  await getStreamForHost(streamId, hostId);
  for (let attempt = 0; ; attempt++) {
    const slug = generateSlug();
    try {
      await getDb().update(streams).set({ slug }).where(eq(streams.id, streamId));
      await audit({ action: "stream.link_reset", actorId: hostId, targetType: "stream", targetId: streamId, ip: meta.ip });
      return slug;
    } catch (err) {
      if ((err as { code?: string }).code === "23505" && attempt < 3) continue;
      throw err;
    }
  }
}

export async function deleteStream(streamId: string, hostId: string, meta: RequestMeta): Promise<void> {
  const current = await getStreamForHost(streamId, hostId);
  if (current.status === "live") throw new StreamError("is_live");
  await getDb().delete(streams).where(and(eq(streams.id, streamId), eq(streams.hostId, hostId)));
  await deleteStored(current.thumbnailUrl);
  if (current.ingressId && isLiveKitConfigured()) {
    await getLiveKit().deleteIngress(current.ingressId).catch((err) => console.warn("[deleteStream] ingress", err));
  }
  await audit({
    action: "stream.deleted",
    actorId: hostId,
    targetType: "stream",
    targetId: streamId,
    metadata: { title: current.title },
    ip: meta.ip,
  });
}
