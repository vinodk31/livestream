import "server-only";
import { and, count, desc, eq, gte, ilike, max, sql, sum, type SQL } from "drizzle-orm";
import { getDb } from "../db";
import { streamSessions, streams } from "../db/schema";

export type StreamStatusFilter = "all" | "live" | "idle" | "ended";
export const STREAMS_PAGE_SIZE = 20;

export type StreamListItem = {
  id: string;
  slug: string;
  title: string;
  privacy: "public" | "unlisted" | "private";
  status: "idle" | "live" | "ended";
  thumbnailUrl: string | null;
  disabled: boolean;
  createdAt: Date;
  lastLiveAt: Date | null;
  totalViews: number;
  broadcasts: number;
};

export type DashboardStats = {
  totalStreams: number;
  liveNow: number;
  views30d: number;
  watchSeconds30d: number;
  peakViewers30d: number;
  streamedSecondsThisMonth: number;
};

const DAY_MS = 86_400_000;

function startOfUtcMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Aggregates for the host dashboard. Always scoped to the given host. */
export async function getDashboardStats(hostId: string, now: Date = new Date()): Promise<DashboardStats> {
  const db = getDb();
  const since = new Date(now.getTime() - 30 * DAY_MS);
  const monthStart = startOfUtcMonth(now);

  const [streamCounts, recent, month] = await Promise.all([
    db
      .select({
        total: count(),
        live: sql<number>`count(*) filter (where ${streams.status} = 'live')`.mapWith(Number),
      })
      .from(streams)
      .where(eq(streams.hostId, hostId)),
    db
      .select({
        views: sum(streamSessions.totalJoins).mapWith(Number),
        watch: sum(streamSessions.viewerSeconds).mapWith(Number),
        peak: max(streamSessions.peakViewers),
      })
      .from(streamSessions)
      .innerJoin(streams, eq(streams.id, streamSessions.streamId))
      .where(and(eq(streams.hostId, hostId), gte(streamSessions.startedAt, since))),
    db
      .select({
        seconds: sql<number>`coalesce(sum(extract(epoch from (coalesce(${streamSessions.endedAt}, ${now.toISOString()}::timestamptz) - greatest(${streamSessions.startedAt}, ${monthStart.toISOString()}::timestamptz)))), 0)`.mapWith(
          Number,
        ),
      })
      .from(streamSessions)
      .innerJoin(streams, eq(streams.id, streamSessions.streamId))
      .where(
        and(
          eq(streams.hostId, hostId),
          sql`coalesce(${streamSessions.endedAt}, ${now.toISOString()}::timestamptz) > ${monthStart.toISOString()}::timestamptz`,
        ),
      ),
  ]);

  return {
    totalStreams: streamCounts[0]?.total ?? 0,
    liveNow: streamCounts[0]?.live ?? 0,
    views30d: recent[0]?.views ?? 0,
    watchSeconds30d: recent[0]?.watch ?? 0,
    peakViewers30d: recent[0]?.peak ?? 0,
    streamedSecondsThisMonth: Math.max(0, Math.round(month[0]?.seconds ?? 0)),
  };
}

/** Paginated list of a host's streams, live ones first, then most recently active. */
export async function listStreams(
  hostId: string,
  opts: { status?: StreamStatusFilter; query?: string; page?: number; pageSize?: number } = {},
): Promise<{ items: StreamListItem[]; total: number; page: number; pageCount: number }> {
  const db = getDb();
  const pageSize = opts.pageSize ?? STREAMS_PAGE_SIZE;
  const page = Math.max(1, Math.floor(opts.page ?? 1));

  const filters: SQL[] = [eq(streams.hostId, hostId)];
  if (opts.status && opts.status !== "all") filters.push(eq(streams.status, opts.status));
  const q = opts.query?.trim();
  if (q) filters.push(ilike(streams.title, `%${escapeLike(q)}%`));
  const where = and(...filters);

  const totals = db
    .select({
      streamId: streamSessions.streamId,
      views: sum(streamSessions.totalJoins).mapWith(Number).as("views"),
      broadcasts: count().as("broadcasts"),
    })
    .from(streamSessions)
    .groupBy(streamSessions.streamId)
    .as("totals");

  const [rows, [countRow]] = await Promise.all([
    db
      .select({
        id: streams.id,
        slug: streams.slug,
        title: streams.title,
        privacy: streams.privacy,
        status: streams.status,
        thumbnailUrl: streams.thumbnailUrl,
        disabledAt: streams.disabledAt,
        createdAt: streams.createdAt,
        lastLiveAt: streams.lastLiveAt,
        views: totals.views,
        broadcasts: totals.broadcasts,
      })
      .from(streams)
      .leftJoin(totals, eq(totals.streamId, streams.id))
      .where(where)
      .orderBy(
        sql`case when ${streams.status} = 'live' then 0 else 1 end`,
        desc(sql`coalesce(${streams.lastLiveAt}, ${streams.createdAt})`),
        desc(streams.id),
      )
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: count() }).from(streams).where(where),
  ]);

  const total = countRow?.total ?? 0;
  return {
    items: rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      privacy: r.privacy,
      status: r.status,
      thumbnailUrl: r.thumbnailUrl,
      disabled: r.disabledAt != null,
      createdAt: r.createdAt,
      lastLiveAt: r.lastLiveAt,
      totalViews: r.views ?? 0,
      broadcasts: r.broadcasts ?? 0,
    })),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export type StreamStats = { views: number; broadcasts: number; peakViewers: number; watchSeconds: number };

/** Lifetime stats for one stream. Callers must have already checked ownership. */
export async function getStreamStats(streamId: string): Promise<StreamStats> {
  const [row] = await getDb()
    .select({
      views: sum(streamSessions.totalJoins).mapWith(Number),
      broadcasts: count(),
      peak: max(streamSessions.peakViewers),
      watch: sum(streamSessions.viewerSeconds).mapWith(Number),
    })
    .from(streamSessions)
    .where(eq(streamSessions.streamId, streamId));
  return {
    views: row?.views ?? 0,
    broadcasts: row?.broadcasts ?? 0,
    peakViewers: row?.peak ?? 0,
    watchSeconds: row?.watch ?? 0,
  };
}
