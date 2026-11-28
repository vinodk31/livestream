import type { NextRequest } from "next/server";
import { AdminError, REPORT_REASONS, createReport, type ReportReason } from "@/server/admin/service";
import { crossOrigin, json } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";
import { metaFromHeaders } from "@/server/request";

/** Anonymous abuse report. Body: { reason, details? }. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/public/watch/[slug]/report">) {
  if (crossOrigin(request)) return json({ error: "forbidden" }, 403);
  const meta = metaFromHeaders(request.headers);
  if (!(await rateLimit("report", meta.ip ?? "unknown")).success) {
    return json({ error: "rate_limited", message: "You've sent several reports. Please wait a while." }, 429);
  }
  const { slug } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as { reason?: unknown; details?: unknown };
  if (typeof body.reason !== "string" || !REPORT_REASONS.includes(body.reason as ReportReason)) {
    return json({ error: "bad_request", message: "Choose a reason." }, 400);
  }
  try {
    await createReport(slug, body.reason as ReportReason, typeof body.details === "string" ? body.details : null, meta);
    return json({ ok: true });
  } catch (err) {
    if (err instanceof AdminError) return json({ error: "not_found" }, 404);
    console.error("[report]", err);
    return json({ error: "server_error", message: "Couldn't send the report." }, 500);
  }
}
