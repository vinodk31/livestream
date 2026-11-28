import "server-only";
import { AwsClient } from "aws4fetch";

/**
 * Recording storage: any S3-compatible bucket (Cloudflare R2, AWS S3, Backblaze B2...).
 * LiveKit Egress uploads the MP4 straight to the bucket; the app only signs short-lived links
 * so replays respect stream privacy (the bucket stays private).
 */
export type RecordingStorage = {
  bucket: string;
  region: string;
  /** Empty for AWS S3; e.g. https://<account>.r2.cloudflarestorage.com for R2. */
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export function getRecordingStorage(): RecordingStorage | null {
  const bucket = process.env.RECORDING_S3_BUCKET?.trim();
  const accessKeyId = process.env.RECORDING_S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.RECORDING_S3_SECRET_ACCESS_KEY?.trim();
  if (!bucket || !accessKeyId || !secretAccessKey) return null;
  return {
    bucket,
    accessKeyId,
    secretAccessKey,
    region: process.env.RECORDING_S3_REGION?.trim() || "auto",
    endpoint: (process.env.RECORDING_S3_ENDPOINT?.trim() ?? "").replace(/\/$/, ""),
  };
}

export const isRecordingConfigured = () => getRecordingStorage() !== null;

export function recordingKey(streamId: string, sessionId: string): string {
  return `recordings/${streamId}/${sessionId}.mp4`;
}

function objectUrl(s: RecordingStorage, key: string): URL {
  const base = s.endpoint || `https://s3.${s.region === "auto" ? "us-east-1" : s.region}.amazonaws.com`;
  // Path-style works for R2, MinIO and AWS alike.
  return new URL(`${base}/${encodeURIComponent(s.bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`);
}

function client(s: RecordingStorage) {
  return new AwsClient({
    accessKeyId: s.accessKeyId,
    secretAccessKey: s.secretAccessKey,
    service: "s3",
    region: s.region === "auto" && !s.endpoint ? "us-east-1" : s.region,
  });
}

/** Short-lived GET link. With `downloadName`, browsers save the file instead of playing it. */
export async function signedRecordingUrl(
  key: string,
  opts: { expiresInSec?: number; downloadName?: string } = {},
): Promise<string | null> {
  const s = getRecordingStorage();
  if (!s) return null;
  const url = objectUrl(s, key);
  url.searchParams.set("X-Amz-Expires", String(opts.expiresInSec ?? 6 * 60 * 60));
  if (opts.downloadName) {
    const safe = opts.downloadName.replace(/[^\w .-]/g, "").slice(0, 80) || "recording";
    url.searchParams.set("response-content-disposition", `attachment; filename="${safe}.mp4"`);
  }
  const signed = await client(s).sign(url.toString(), { method: "GET", aws: { signQuery: true } });
  return signed.url;
}

export async function deleteRecordingObject(key: string): Promise<void> {
  const s = getRecordingStorage();
  if (!s) return;
  const res = await client(s).fetch(objectUrl(s, key).toString(), { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new Error(`Recording delete failed: HTTP ${res.status}`);
}
