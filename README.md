# InstantLive

Go live from the browser, share a link, and viewers watch instantly: no account, no app, no sign-up.

**Status:** Phase 1 in progress. Done: project setup, database schema, authentication.

## Stack

| Concern | Choice |
|---|---|
| App + API | Next.js 16 (App Router, Server Actions, Route Handlers), TypeScript |
| UI | Tailwind CSS v4, shadcn/ui-style components (`src/components/ui`) |
| Database | PostgreSQL (Neon on Vercel) with Drizzle ORM + SQL migrations in `drizzle/` |
| Auth | Email + password (argon2id), 15-min JWT access token + rotating 30-day refresh token in `__Host-` httpOnly cookies |
| Rate limiting | Upstash Redis (falls back to in-memory locally) |
| Email | Resend (prints to the console locally) |
| Streaming | LiveKit Cloud (coming in module 5) |
| Tests | Vitest; integration tests run against real Postgres in-process via PGlite |

## Project layout

```
src/
  app/
    (auth)/          login, register, forgot/reset password + server actions
    (app)/           signed-in area (dashboard, streams, settings…)
    verify-email/    email verification link handler
    api/auth/        refresh endpoint for long-lived client tabs
  components/        UI components (ui/ = shadcn-style primitives)
  lib/               shared client/server code (validation, utils)
  server/            server-only code
    auth/            jwt, cookies, password hashing, session DAL, auth service
    db/              Drizzle schema + client
    email/           Resend sender + templates
    audit.ts         audit log writer
    rate-limit.ts    all rate limits in one place
  proxy.ts           session refresh + optimistic route guard (Next 16's "middleware")
drizzle/             generated SQL migrations (committed)
tests/               unit + integration tests
scripts/             migrate + make-admin
```

## Local development

Requirements: Node 22+, and Postgres 16 (Docker is easiest).

```bash
npm install
cp .env.example .env.local      # then set AUTH_SECRET: openssl rand -base64 48
docker compose up -d            # local Postgres on :5432
npm run db:migrate
npm run dev                     # http://localhost:3000
```

Without `RESEND_API_KEY`, emails (verification and password-reset codes) are printed in the terminal running `npm run dev`, so you can copy the 6-digit code.

Make yourself an admin after signing up:

```bash
npm run db:make-admin -- you@example.com
```

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm test` | Unit + integration tests (no external DB needed) |
| `npm run lint` / `npm run typecheck` | Static checks |
| `npm run db:generate` | Create a migration after editing `src/server/db/schema.ts` |
| `npm run db:migrate` | Apply migrations |

## Deploying to Vercel

1. **Import** the GitHub repo in Vercel (framework: Next.js, defaults are fine). Vercel runs `vercel-build`, which applies database migrations and then builds.
2. **Storage tab → add:**
   - **Neon Postgres**: sets `DATABASE_URL` and `DATABASE_URL_UNPOOLED`.
   - **Upstash Redis**: sets `KV_REST_API_URL` and `KV_REST_API_TOKEN` (shared rate limits across instances).
3. **Settings → Environment Variables:**

   | Name | Value |
   |---|---|
   | `AUTH_SECRET` | output of `openssl rand -base64 48` |
   | `APP_URL` | your production URL, e.g. `https://instantlive.vercel.app` |
   | `RESEND_API_KEY` | from resend.com → API Keys |
   | `EMAIL_FROM` | e.g. `InstantLive <no-reply@yourdomain.com>` (domain verified in Resend) |
   | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | from LiveKit Cloud → Settings → Keys (needed from module 5) |

4. **Redeploy.** The first deploy fails until Postgres is connected; that's expected.

> Until you verify a sending domain in Resend, Resend only delivers to your own account email.

## Security notes

- Passwords: argon2id (OWASP parameters); unknown emails take the same time as wrong passwords.
- Sessions: short-lived JWT + opaque refresh tokens stored only as SHA-256 hashes; rotation on every use, with reuse detection that revokes the whole login. Password reset/change signs out other sessions.
- Email verification and password reset use 6-digit codes: single-use, valid 15 minutes, burned after 5 wrong guesses, stored only as an HMAC keyed with `AUTH_SECRET` and bound to the user and purpose; requesting a new code invalidates the old one.
- No account enumeration on forgot-password; login errors are generic.
- Rate limits on login (per IP and per account), sign-up, reset, resend and refresh.
- Audit log of auth events (`audit_logs`), security headers, open-redirect protection, CSRF covered by SameSite cookies + Server Action origin checks + an Origin check on the refresh route.
