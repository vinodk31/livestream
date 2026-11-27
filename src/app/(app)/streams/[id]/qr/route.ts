import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { StreamError, getStreamForHost } from "@/server/streams/service";
import { qrPng, qrSvg, watchUrl } from "@/server/streams/share";

/** Downloads the viewer-link QR code as PNG (default) or SVG. Host-only. */
export async function GET(request: NextRequest, ctx: RouteContext<"/streams/[id]/qr">) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await ctx.params;
  let slug: string;
  try {
    slug = (await getStreamForHost(id, user.id)).slug;
  } catch (err) {
    if (err instanceof StreamError) return NextResponse.json({ error: "not_found" }, { status: 404 });
    throw err;
  }
  const url = watchUrl(slug);
  const headers = {
    "Cache-Control": "private, no-store",
    "Content-Disposition": "",
  };
  if (request.nextUrl.searchParams.get("format") === "svg") {
    headers["Content-Disposition"] = `attachment; filename="instantlive-${slug}.svg"`;
    return new NextResponse(await qrSvg(url), { headers: { ...headers, "Content-Type": "image/svg+xml" } });
  }
  headers["Content-Disposition"] = `attachment; filename="instantlive-${slug}.png"`;
  return new NextResponse(new Uint8Array(await qrPng(url)), { headers: { ...headers, "Content-Type": "image/png" } });
}
