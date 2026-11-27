import { NextResponse, type NextRequest } from "next/server";
import { readLocal } from "@/server/storage";

/** Serves local-dev uploads. In production, images live on Vercel Blob and this returns 404. */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/uploads/[...path]">) {
  if (process.env.BLOB_READ_WRITE_TOKEN) return new NextResponse(null, { status: 404 });
  const { path } = await ctx.params;
  const file = await readLocal(path.join("/"));
  if (!file) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": file.type,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
