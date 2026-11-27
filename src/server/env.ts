import "server-only";

const isProd = process.env.NODE_ENV === "production";

export const env = {
  isProd,
  get appUrl(): string {
    const url =
      process.env.APP_URL ??
      (process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : "http://localhost:3000");
    return url.replace(/\/$/, "");
  },
  get emailFrom(): string {
    return process.env.EMAIL_FROM ?? "InstantLive <onboarding@resend.dev>";
  },
};
