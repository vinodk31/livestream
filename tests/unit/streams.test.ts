import { describe, expect, it } from "vitest";
import { streamFormSchema } from "@/lib/validation/stream";
import { detectImageType, resolveLocal } from "@/server/storage";
import { generateSlug } from "@/server/streams/service";

describe("stream form validation", () => {
  const base = { title: "T", description: "", privacy: "unlisted", passcode: "" };

  it("normalises empty optional fields and checkboxes", () => {
    expect(streamFormSchema.parse(base)).toEqual({
      title: "T",
      description: null,
      privacy: "unlisted",
      passcode: null,
      chatEnabled: false,
      recordingEnabled: false,
    });
    expect(streamFormSchema.parse({ ...base, chatEnabled: "on" }).chatEnabled).toBe(true);
  });

  it.each([
    [{ title: "   " }, "title"],
    [{ title: "x".repeat(121) }, "title"],
    [{ privacy: "secret" }, "privacy"],
    [{ passcode: "abc" }, "passcode"],
    [{ passcode: "x".repeat(33) }, "passcode"],
    [{ description: "x".repeat(2001) }, "description"],
  ])("rejects %j", (over, field) => {
    const r = streamFormSchema.safeParse({ ...base, ...over });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.path[0]).toBe(field);
  });
});

describe("image sniffing", () => {
  it("recognises JPEG, PNG and WebP by content, not extension", () => {
    expect(detectImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(detectImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(detectImageType(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(detectImageType(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    expect(detectImageType(new TextEncoder().encode("GIF89a"))).toBeNull();
  });

  it("refuses paths that escape the uploads folder", () => {
    expect(resolveLocal("thumbnails/a.png")).toMatch(/\.uploads\/thumbnails\/a\.png$/);
    expect(resolveLocal("../.env.local")).toBeNull();
    expect(resolveLocal("thumbnails/../../package.json")).toBeNull();
  });
});

describe("slugs", () => {
  it("are 10 chars from an alphabet without look-alike characters", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const s = generateSlug();
      expect(s).toMatch(/^[23456789abcdefghjkmnpqrstuvwxyz]{10}$/);
      seen.add(s);
    }
    expect(seen.size).toBe(1000);
  });
});
