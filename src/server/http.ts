import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { BroadcastError } from "./streams/broadcast";
import { LiveKitNotConfigured } from "./livekit";

/** Rejects cross-site POSTs to JSON endpoints (cookies are SameSite=Lax, this is belt and braces). */
export function crossOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  return origin != null && origin !== request.nextUrl.origin;
}

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

const MESSAGES: Record<BroadcastError["code"], [number, string]> = {
  not_found: [404, "Stream not found."],
  email_unverified: [403, "Verify your email before going live."],
  disabled: [403, "This stream has been disabled."],
  quota_exceeded: [403, "You've used this month's streaming time on your plan."],
  not_live: [409, "This stream isn't live right now."],
  full: [429, "This stream is full right now. Try again in a moment."],
  locked: [401, "Enter the passcode to watch."],
  bad_passcode: [401, "That passcode isn't right."],
  obs_unavailable: [503, "Streaming from OBS isn't available on this LiveKit project yet."],
};

/** Maps known errors to JSON responses; logs and hides everything else. */
export function errorResponse(err: unknown, where: string) {
  if (err instanceof BroadcastError) {
    const [status, message] = MESSAGES[err.code];
    return json({ error: err.code, message }, status);
  }
  if (err instanceof LiveKitNotConfigured) {
    return json({ error: "not_configured", message: "Live streaming isn't configured on this server yet." }, 503);
  }
  console.error(`[${where}]`, err);
  return json({ error: "server_error", message: "Something went wrong. Please try again." }, 500);
}
