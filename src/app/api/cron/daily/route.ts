import type { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { json } from "@/server/http";
import { sweepAllStale } from "@/server/streams/broadcast";
import { purgeExpiredRecordings } from "@/server/streams/recording-service";

/** Daily housekeeping, called by Vercel Cron (see vercel.json) with `Authorization: Bearer $CRON_SECRET`. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const got = request.headers.get("authorization") ?? "";
  const want = `Bearer ${secret}`;
  if (!secret || got.length !== want.length || !timingSafeEqual(Buffer.from(got), Buffer.from(want))) {
    return json({ error: "unauthorized" }, 401);
  }
  const meta = { ip: null, userAgent: "vercel-cron" };
  const [stale, purged] = await Promise.all([sweepAllStale(meta), purgeExpiredRecordings()]);
  return json({ ok: true, staleBroadcastsEnded: stale, recordingsDeleted: purged });
}
