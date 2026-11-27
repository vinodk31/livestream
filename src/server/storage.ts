import "server-only";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { del, put } from "@vercel/blob";
import { generateToken } from "./auth/tokens";

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export type ImageType = "image/jpeg" | "image/png" | "image/webp";
const EXT: Record<ImageType, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

const LOCAL_DIR = path.join(process.cwd(), ".uploads");
const LOCAL_PREFIX = "/api/uploads/";

export class StorageError extends Error {
  constructor(public code: "not_configured" | "invalid_image" | "too_large") {
    super(code);
  }
}

/** Sniffs the real type from magic bytes; never trusts the browser-supplied MIME type. */
export function detectImageType(bytes: Uint8Array): ImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function blobConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

/** Stores a validated image and returns its public URL. */
export async function storeImage(folder: string, bytes: Uint8Array): Promise<string> {
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new StorageError("too_large");
  const type = detectImageType(bytes);
  if (!type) throw new StorageError("invalid_image");
  const name = `${folder}/${generateToken(12)}.${EXT[type]}`;

  if (blobConfigured()) {
    const blob = await put(name, Buffer.from(bytes), {
      access: "public",
      contentType: type,
      addRandomSuffix: false,
      cacheControlMaxAge: 60 * 60 * 24 * 365,
    });
    return blob.url;
  }
  if (process.env.NODE_ENV === "production" && !process.env.ALLOW_LOCAL_UPLOADS) {
    throw new StorageError("not_configured");
  }
  // Local development fallback: files on disk, served by /api/uploads/[...path].
  const file = path.join(LOCAL_DIR, name);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
  return `${LOCAL_PREFIX}${name}`;
}

/** Best-effort delete of something previously returned by storeImage. */
export async function deleteStored(url: string | null | undefined): Promise<void> {
  if (!url) return;
  try {
    if (url.startsWith(LOCAL_PREFIX)) {
      const file = resolveLocal(url.slice(LOCAL_PREFIX.length));
      if (file) await unlink(file);
    } else if (blobConfigured()) {
      await del(url);
    }
  } catch (err) {
    console.warn("[storage] delete failed", url, err);
  }
}

/** Maps a local upload path to a file inside .uploads, refusing anything that escapes it. */
export function resolveLocal(relative: string): string | null {
  const file = path.resolve(LOCAL_DIR, relative);
  return file.startsWith(LOCAL_DIR + path.sep) ? file : null;
}

export async function readLocal(relative: string): Promise<{ bytes: Buffer; type: ImageType } | null> {
  const file = resolveLocal(relative);
  if (!file) return null;
  try {
    const bytes = await readFile(file);
    const type = detectImageType(bytes);
    return type ? { bytes, type } : null;
  } catch {
    return null;
  }
}
