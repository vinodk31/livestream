import { describe, expect, it } from "vitest";
import { formatCount, formatDuration, formatRelative } from "@/lib/format";

describe("format", () => {
  it.each([
    [0, "0"],
    [999, "999"],
    [1200, "1.2K"],
    [2_500_000, "2.5M"],
  ])("formatCount(%d) = %s", (n, s) => expect(formatCount(n)).toBe(s));

  it.each([
    [0, "0m"],
    [95, "1m"],
    [3600, "1h"],
    [3720, "1h 2m"],
    [90_000, "25h"],
  ])("formatDuration(%d) = %s", (n, s) => expect(formatDuration(n)).toBe(s));

  it("formats relative times", () => {
    const now = new Date("2026-11-20T12:00:00Z");
    expect(formatRelative(new Date("2026-11-20T11:59:30Z"), now)).toBe("just now");
    expect(formatRelative(new Date("2026-11-20T10:00:00Z"), now)).toBe("2 hours ago");
    expect(formatRelative(new Date("2026-11-19T12:00:00Z"), now)).toBe("yesterday");
  });
});
