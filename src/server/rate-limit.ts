import "server-only";
import { Ratelimit, type Duration } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export type LimitResult = { success: boolean; remaining: number; reset: number };

type Rule = { limit: number; window: Duration };

/** Central list of limits so they're easy to review and tune. */
export const RATE_LIMITS = {
  loginIp: { limit: 30, window: "15 m" },
  loginAccount: { limit: 10, window: "15 m" },
  register: { limit: 5, window: "1 h" },
  forgotIp: { limit: 5, window: "1 h" },
  forgotAccount: { limit: 3, window: "1 h" },
  resetPassword: { limit: 10, window: "1 h" },
  resetPasswordAccount: { limit: 10, window: "1 h" },
  verifyCode: { limit: 10, window: "15 m" },
  resendVerification: { limit: 3, window: "1 h" },
  refresh: { limit: 120, window: "1 m" },
  changePassword: { limit: 10, window: "15 m" },
  deleteAccount: { limit: 5, window: "1 h" },
  streamWrite: { limit: 60, window: "10 m" },
  upload: { limit: 20, window: "10 m" },
  broadcastControl: { limit: 30, window: "10 m" },
  heartbeat: { limit: 30, window: "1 m" },
  passcode: { limit: 10, window: "10 m" },
  viewerJoin: { limit: 30, window: "10 m" },
  viewerPoll: { limit: 60, window: "1 m" },
} satisfies Record<string, Rule>;

export type RateLimitName = keyof typeof RATE_LIMITS;

function redisFromEnv(): Redis | null {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? new Redis({ url, token }) : null;
}

function durationToMs(d: Duration): number {
  const [n, unit] = d.split(" ") as [string, string];
  const mult: Record<string, number> = { ms: 1, s: 1e3, m: 6e4, h: 3.6e6, d: 8.64e7 };
  return Number(n) * (mult[unit] ?? 1e3);
}

/** In-memory fixed-window fallback for local dev and tests (not shared across instances). */
class MemoryLimiter {
  private hits = new Map<string, { count: number; reset: number }>();
  constructor(private rule: Rule) {}
  async limit(key: string): Promise<LimitResult> {
    const now = Date.now();
    const entry = this.hits.get(key);
    if (!entry || entry.reset <= now) {
      const reset = now + durationToMs(this.rule.window);
      this.hits.set(key, { count: 1, reset });
      return { success: true, remaining: this.rule.limit - 1, reset };
    }
    entry.count += 1;
    return {
      success: entry.count <= this.rule.limit,
      remaining: Math.max(0, this.rule.limit - entry.count),
      reset: entry.reset,
    };
  }
}

type Limiter = { limit(key: string): Promise<LimitResult> };
const limiters = new Map<RateLimitName, Limiter>();
let warned = false;

function getLimiter(name: RateLimitName): Limiter {
  let limiter = limiters.get(name);
  if (limiter) return limiter;
  const rule = RATE_LIMITS[name];
  const redis = redisFromEnv();
  if (redis) {
    limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(rule.limit, rule.window),
      prefix: `il:rl:${name}`,
      analytics: false,
    });
  } else {
    if (!warned && process.env.NODE_ENV === "production") {
      console.warn("[rate-limit] Redis not configured; using per-instance memory limits.");
      warned = true;
    }
    limiter = new MemoryLimiter(rule);
  }
  limiters.set(name, limiter);
  return limiter;
}

export async function rateLimit(name: RateLimitName, key: string): Promise<LimitResult> {
  try {
    return await getLimiter(name).limit(key);
  } catch (err) {
    // Fail open on limiter outages so auth keeps working; log for alerting.
    console.error(`[rate-limit] ${name} failed`, err);
    return { success: true, remaining: 0, reset: Date.now() };
  }
}

/** Test helper. */
export function __resetRateLimits() {
  limiters.clear();
}
