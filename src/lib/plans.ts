/** Plan limits. Enforced when going live (module 5) and shown on the dashboard. */
export const PLANS = {
  free: {
    name: "Free",
    maxConcurrentViewers: 50,
    monthlyStreamHours: 10,
    maxStreams: 20,
    recordingRetentionDays: 7,
  },
  pro: {
    name: "Pro",
    maxConcurrentViewers: 1000,
    monthlyStreamHours: 100,
    maxStreams: 500,
    recordingRetentionDays: 90,
  },
} as const;

export type PlanId = keyof typeof PLANS;
export type Plan = (typeof PLANS)[PlanId];
