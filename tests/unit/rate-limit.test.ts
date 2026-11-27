import { beforeEach, describe, expect, it } from "vitest";
import { RATE_LIMITS, __resetRateLimits, rateLimit } from "@/server/rate-limit";

describe("rate limiter (memory fallback)", () => {
  beforeEach(() => __resetRateLimits());

  it("blocks after the configured limit, per key", async () => {
    const max = RATE_LIMITS.resendVerification.limit;
    for (let i = 0; i < max; i++) expect((await rateLimit("resendVerification", "u1")).success).toBe(true);
    expect((await rateLimit("resendVerification", "u1")).success).toBe(false);
    expect((await rateLimit("resendVerification", "u2")).success).toBe(true);
  });
});
