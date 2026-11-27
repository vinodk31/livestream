import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../db";
import { streams, users } from "../db/schema";

export type PublicStream = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  privacy: "public" | "unlisted" | "private";
  status: "idle" | "live" | "ended";
  thumbnailUrl: string | null;
  hostName: string;
  chatEnabled: boolean;
};

/** Looks up a stream for anonymous viewers. Disabled streams and disabled hosts are invisible. */
export async function getPublicStream(slug: string): Promise<PublicStream | null> {
  if (!/^[a-z0-9]{6,16}$/.test(slug)) return null;
  const [row] = await getDb()
    .select({
      id: streams.id,
      slug: streams.slug,
      title: streams.title,
      description: streams.description,
      privacy: streams.privacy,
      status: streams.status,
      thumbnailUrl: streams.thumbnailUrl,
      chatEnabled: streams.chatEnabled,
      hostName: users.name,
    })
    .from(streams)
    .innerJoin(users, eq(users.id, streams.hostId))
    .where(and(eq(streams.slug, slug), isNull(streams.disabledAt), isNull(users.disabledAt)))
    .limit(1);
  return row ?? null;
}
