import "server-only";
import { headers } from "next/headers";

export type RequestMeta = { ip: string | null; userAgent: string | null };

export function metaFromHeaders(h: Headers): RequestMeta {
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || h.get("x-real-ip") || null;
  return {
    ip: ip && isIp(ip) ? ip : null,
    userAgent: h.get("user-agent")?.slice(0, 512) ?? null,
  };
}

export async function getRequestMeta(): Promise<RequestMeta> {
  return metaFromHeaders(await headers());
}

function isIp(v: string): boolean {
  return /^[\d.]+$/.test(v) || /^[0-9a-fA-F:]+$/.test(v);
}
